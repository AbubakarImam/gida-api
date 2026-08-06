import { IsInt, IsString, IsUUID, Min } from 'class-validator';

export class ConfirmUploadDto {
  @IsUUID()
  listingId!: string;

  @IsString()
  objectKey!: string;

  @IsInt()
  @Min(0)
  position!: number;
}
