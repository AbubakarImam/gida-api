import { IsIn, IsString, IsUUID } from 'class-validator';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

export class PresignUploadDto {
  @IsUUID()
  listingId!: string;

  @IsString()
  filename!: string;

  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: string;
}
