import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ListingStatus, ListingType } from '@prisma/client';

export class QueryListingsDto {
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @IsOptional()
  @IsBooleanString()
  offer?: string;

  /** Filter to one owner's listings — e.g. a Profile page's "my listings". */
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  /** "lat,lng" — combine with radiusKm for a PostGIS-backed radius search. */
  @IsOptional()
  @IsString()
  near?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0.1)
  @Max(200)
  radiusKm?: number;

  /** Opaque cursor: the id of the last item from the previous page. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 8;
}
