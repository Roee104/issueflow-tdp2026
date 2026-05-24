/**
 * Parameter decorator that extracts the authenticated user from the request.
 * The user object is set by JwtStrategy.validate() after successful JWT verification
 * and contains { userId, username, role }.
 *
 * Usage: @CurrentUser() user: { userId: number }
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
