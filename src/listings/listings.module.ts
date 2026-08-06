import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingOwnerGuard } from './guards/listing-owner.guard';

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, ListingOwnerGuard],
  exports: [ListingsService],
})
export class ListingsModule {}
