import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ListingType } from '@prisma/client';

export class CreateListingDto {
  @IsEnum(ListingType)
  type!: ListingType;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  bedrooms!: number;

  @IsInt()
  @Min(1)
  @Max(50)
  bathrooms!: number;

  @IsBoolean()
  parking!: boolean;

  @IsBoolean()
  furnished!: boolean;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  longitude?: number;

  @Type(() => Number)
  @IsInt()
  @Min(50 * 100, { message: 'regularPriceCents must be at least $50' })
  regularPriceCents!: number;

  @IsBoolean()
  isOffer!: boolean;

  // Only meaningful (and only required) when isOffer is true — mirrors the
  // frontend's own conditional-required field, but enforced server-side now.
  @ValidateIf((dto: CreateListingDto) => dto.isOffer)
  @Type(() => Number)
  @IsInt()
  @Min(50 * 100)
  discountedPriceCents?: number;
}
