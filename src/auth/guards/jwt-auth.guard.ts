import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * The real version of the frontend's `PrivateRoute` / `useAuthStatus` check —
 * this is enforced server-side, so it can't be bypassed by calling the API
 * directly instead of going through the React app.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
