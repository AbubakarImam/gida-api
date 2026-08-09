import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { QueryListingsDto } from './dto/query-listings.dto';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const listingWithImages = Prisma.validator<Prisma.ListingDefaultArgs>()({
  include: { images: { orderBy: { position: 'asc' } } },
});
type ListingWithImages = Prisma.ListingGetPayload<typeof listingWithImages>;

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateListingDto) {
    if (dto.isOffer && (dto.discountedPriceCents ?? 0) >= dto.regularPriceCents) {
      throw new BadRequestException(
        'discountedPriceCents must be less than regularPriceCents',
      );
    }

    const listing = await this.prisma.listing.create({
      data: {
        ownerId,
        type: dto.type,
        name: dto.name,
        description: dto.description,
        bedrooms: dto.bedrooms,
        bathrooms: dto.bathrooms,
        parking: dto.parking,
        furnished: dto.furnished,
        address: dto.address,
        regularPriceCents: dto.regularPriceCents,
        discountedPriceCents: dto.isOffer ? dto.discountedPriceCents : null,
        isOffer: dto.isOffer,
      },
      ...listingWithImages,
    });

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      await this.setLocation(listing.id, dto.latitude, dto.longitude);
    }

    return this.serialize(listing, await this.getCoordinates([listing.id]));
  }

  async findAll(query: QueryListingsDto) {
    const limit = query.limit ?? 8;

    if (query.near) {
      return this.findNear(query, limit);
    }

    const where: Prisma.ListingWhereInput = {
      ...(query.type && { type: query.type }),
      ...(query.status && { status: query.status }),
      ...(query.offer !== undefined && { isOffer: query.offer === 'true' }),
      ...(query.ownerId && { ownerId: query.ownerId }),
    };

    const listings = await this.prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      ...listingWithImages,
    });

    const hasMore = listings.length > limit;
    const page = hasMore ? listings.slice(0, limit) : listings;
    const coords = await this.getCoordinates(page.map((l) => l.id));

    return {
      items: page.map((l) => this.serialize(l, coords)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * PostGIS radius search — `near=lat,lng` + `radiusKm`. Prisma can't model
   * the `geography` column, so this path drops to a raw, parameterized query;
   * everything else about the response shape matches findAll().
   */
  private async findNear(query: QueryListingsDto, limit: number) {
    const [latStr, lngStr] = (query.near ?? '').split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const radiusMeters = (query.radiusKm ?? 10) * 1000;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      throw new BadRequestException('near must be "lat,lng"');
    }

    const nearbyIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM listings
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})
        AND (${query.type ?? null}::"ListingType" IS NULL OR type = ${query.type ?? null}::"ListingType")
        AND (${query.status ?? null}::"ListingStatus" IS NULL OR status = ${query.status ?? null}::"ListingStatus")
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${limit};
    `;

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: nearbyIds.map((r) => r.id) } },
      ...listingWithImages,
    });
    // Preserve the distance-ordering the raw query already computed.
    const order = new Map(nearbyIds.map((r, i) => [r.id, i]));
    listings.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const coords = await this.getCoordinates(listings.map((l) => l.id));
    return {
      items: listings.map((l) => this.serialize(l, coords)),
      nextCursor: null,
    };
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      ...listingWithImages,
    });
    if (!listing) throw new NotFoundException('Listing not found');

    return this.serialize(listing, await this.getCoordinates([id]));
  }

  async update(id: string, dto: UpdateListingDto) {
    const current = await this.prisma.listing.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Listing not found');

    const isOffer = dto.isOffer ?? current.isOffer;
    const regularPriceCents = dto.regularPriceCents ?? current.regularPriceCents;
    const discountedPriceCents =
      dto.discountedPriceCents ?? current.discountedPriceCents ?? undefined;

    if (isOffer && (discountedPriceCents ?? 0) >= regularPriceCents) {
      throw new BadRequestException(
        'discountedPriceCents must be less than regularPriceCents',
      );
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(dto.type && { type: dto.type }),
        ...(dto.status && { status: dto.status }),
        ...(dto.name && { name: dto.name }),
        ...(dto.description && { description: dto.description }),
        ...(dto.bedrooms !== undefined && { bedrooms: dto.bedrooms }),
        ...(dto.bathrooms !== undefined && { bathrooms: dto.bathrooms }),
        ...(dto.parking !== undefined && { parking: dto.parking }),
        ...(dto.furnished !== undefined && { furnished: dto.furnished }),
        ...(dto.address && { address: dto.address }),
        ...(dto.regularPriceCents !== undefined && {
          regularPriceCents: dto.regularPriceCents,
        }),
        isOffer,
        discountedPriceCents: isOffer ? (discountedPriceCents ?? null) : null,
      },
      ...listingWithImages,
    });

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      await this.setLocation(id, dto.latitude, dto.longitude);
    }

    return this.serialize(listing, await this.getCoordinates([id]));
  }

  async remove(id: string) {
    await this.prisma.listing.delete({ where: { id } });
  }

  private async setLocation(listingId: string, latitude: number, longitude: number) {
    await this.prisma.$executeRaw`
      UPDATE listings
      SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
      WHERE id = ${listingId};
    `;
  }

  private async getCoordinates(listingIds: string[]): Promise<Map<string, Coordinates>> {
    if (listingIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      { id: string; lat: number; lng: number }[]
    >`
      SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM listings
      WHERE id = ANY(${listingIds}) AND location IS NOT NULL;
    `;

    return new Map(
      rows.map((r) => [r.id, { latitude: r.lat, longitude: r.lng }]),
    );
  }

  private serialize(
    listing: ListingWithImages,
    coords: Map<string, Coordinates>,
  ) {
    const { regularPriceCents, discountedPriceCents, ownerId, ...rest } = listing;
    return {
      ...rest,
      ownerId,
      regularPrice: regularPriceCents / 100,
      discountedPrice:
        discountedPriceCents !== null ? discountedPriceCents / 100 : null,
      coordinates: coords.get(listing.id) ?? null,
    };
  }
}
