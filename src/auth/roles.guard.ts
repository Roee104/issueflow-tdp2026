/**
 * Authorization guard that restricts access to ADMIN users only.
 * Applied per-endpoint using @UseGuards(RolesGuard) on routes that require
 * elevated privileges — such as viewing deleted records and restoring them.
 *
 * Always used in combination with JwtAuthGuard — the global guard runs first
 * to authenticate the user, then RolesGuard checks the role.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '../users/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * Allows the request only if the authenticated user has the ADMIN role.
   *
   * @param context - The NestJS execution context for the current request
   * @returns true if the user is an ADMIN
   * @throws ForbiddenException if the user is not an ADMIN
   */
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('This action requires ADMIN role');
    }
    return true;
  }
}
