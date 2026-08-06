import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { UploadsService } from './uploads.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presign')
  presign(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresignUploadDto) {
    return this.uploadsService.presign(user.id, dto);
  }

  @Post('confirm')
  confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmUploadDto) {
    return this.uploadsService.confirm(user.id, dto);
  }
}
