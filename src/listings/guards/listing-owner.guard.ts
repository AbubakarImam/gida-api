import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Replaces the frontend's client-side
 * `listing.userRef !== auth.currentUser.uid` check (EditListing.jsx) with a
 * real authorization boundary: a request that skips the React app entirely
 * still can't edit or delete a listing it doesn't own.
 */
@Injectable()
export class ListingOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const listingId: string = request.params.id;
    const userId: string | undefined = request.user?.id;

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { ownerId: true },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.ownerId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }

    return true;
  }
}
