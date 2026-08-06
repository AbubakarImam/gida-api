import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(listingId: string, senderId: string, dto: CreateMessageDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { ownerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    return this.prisma.message.create({
      data: { listingId, senderId, body: dto.body },
    });
  }

  async findThread(listingId: string, requesterId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { ownerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const messages = await this.prisma.message.findMany({
      where: { listingId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, name: true } } },
    });

    // Only the listing owner or someone who has sent a message in this
    // thread may read it — the closest analogue to the frontend's current
    // "only render <Contact> when you're not the owner" gate, enforced
    // server-side.
    const isOwner = listing.ownerId === requesterId;
    const isParticipant = messages.some((m) => m.senderId === requesterId);
    if (!isOwner && !isParticipant) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    return messages;
  }
}
