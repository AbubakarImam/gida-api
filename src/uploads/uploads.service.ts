import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

const MAX_IMAGES_PER_LISTING = 6;
const THUMBNAIL_WIDTH = 480;

@Injectable()
export class UploadsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('s3.bucket')!;
    this.publicUrl = this.config.get<string>('s3.publicUrl')!;
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('s3.endpoint'),
      region: this.config.get<string>('s3.region'),
      forcePathStyle: true, // required for MinIO / most non-AWS S3-compatible stores
      credentials: {
        accessKeyId: this.config.get<string>('s3.accessKeyId')!,
        secretAccessKey: this.config.get<string>('s3.secretAccessKey')!,
      },
    });
  }

  async presign(ownerId: string, dto: PresignUploadDto) {
    await this.assertOwnerAndCapacity(ownerId, dto.listingId);

    const objectKey = `listings/${dto.listingId}/${randomUUID()}-${dto.filename}`;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: dto.contentType,
      }),
      { expiresIn: 60 * 5 },
    );

    return { uploadUrl, objectKey };
  }

  async confirm(ownerId: string, dto: ConfirmUploadDto) {
    await this.assertOwnerAndCapacity(ownerId, dto.listingId);

    const thumbnailKey = await this.generateThumbnail(dto.objectKey);

    return this.prisma.listingImage.create({
      data: {
        listingId: dto.listingId,
        url: `${this.publicUrl}/${dto.objectKey}`,
        thumbnailUrl: thumbnailKey ? `${this.publicUrl}/${thumbnailKey}` : null,
        position: dto.position,
      },
    });
  }

  private async assertOwnerAndCapacity(ownerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { ownerId: true, _count: { select: { images: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId !== ownerId) {
      throw new ForbiddenException('You do not own this listing');
    }
    if (listing._count.images >= MAX_IMAGES_PER_LISTING) {
      throw new BadRequestException(
        `A listing may have at most ${MAX_IMAGES_PER_LISTING} images`,
      );
    }
  }

  /**
   * Downloads the just-uploaded original, produces a display-size thumbnail,
   * and re-uploads it — this is the thumbnailing step the original Firebase
   * Storage flow never had, so the listing grid stops shipping full-resolution
   * originals. Runs inline for scaffold simplicity; a production deployment
   * would move this onto a queue (BullMQ) so `confirm()` returns immediately.
   */
  private async generateThumbnail(objectKey: string): Promise<string | null> {
    const original = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const bytes = await original.Body?.transformToByteArray();
    if (!bytes) return null;

    const thumbnail = await sharp(bytes)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const thumbnailKey = objectKey.replace(/(\.[^./]+)$/, '-thumb.jpg');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: thumbnailKey,
        Body: thumbnail,
        ContentType: 'image/jpeg',
      }),
    );

    return thumbnailKey;
  }
}
