/**
 * Marks a route as publicly accessible — bypasses the global JwtAuthGuard.
 * Applied to endpoints that must be reachable without a JWT token,
 * such as POST /auth/login and POST /users (registration).
 *
 * The guard reads the IS_PUBLIC_KEY metadata via Reflector and returns
 * true immediately without performing any authentication checks.
 *
 * Usage: @Public()
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
