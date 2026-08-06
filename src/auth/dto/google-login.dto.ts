import { IsString } from 'class-validator';

export class GoogleLoginDto {
  /** The Google ID token obtained client-side from Google's Sign-In SDK. */
  @IsString()
  idToken!: string;
}
