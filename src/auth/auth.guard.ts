/**
 * Global JWT authentication guard applied to all routes via APP_GUARD.
 * Implements a three-step validation flow on every protected request:
 * 1. Check if the route is marked @Public — skip all checks if so
 * 2. Validate JWT signature and expiry via Passport
 * 3. Check the token against the server-side deny-list (logout blacklist)
 * 4. Verify the user still exists and is not soft-deleted
 *
 * This guard ensures that logged-out tokens and deleted user accounts
 * are rejected immediately without waiting for token expiry.
 */
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ExtractJwt } from 'passport-jwt';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

/**
 * Extends Passport's AuthGuard to add blacklist and soft-delete checks
 * on top of standard JWT signature and expiry validation.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  /**
   * Executes the three-step authentication flow for every incoming request.
   *
   * @param context - The NestJS execution context for the current request
   * @returns true if the request is authenticated and authorized
   * @throws UnauthorizedException if the token is blacklisted or the user is soft-deleted
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Step 1: Allow @Public routes through without any authentication
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Step 2: Validate JWT signature and expiry via Passport — sets request.user on success
    await (super.canActivate(context) as Promise<boolean>);

    const request = context.switchToHttp().getRequest();
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);

    // Step 3: Reject tokens that have been explicitly invalidated via logout
    if (token && (await this.authService.isTokenBlacklisted(token))) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    // Step 4: Reject requests from soft-deleted users — their tokens remain
    // technically valid until expiry, so this check is necessary
    const payload = request.user as { userId: number };
    const user = await this.usersService.findByIdInternal(payload.userId);
    if (!user) {
      throw new UnauthorizedException('User account no longer exists');
    }

    return true;
  }
}
