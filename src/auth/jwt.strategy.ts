/**
 * Passport JWT strategy — validates incoming Bearer tokens and extracts
 * the authenticated user's identity from the token payload.
 *
 * On successful validation, the returned object is attached to request.user
 * and made available to guards and decorators via @CurrentUser().
 */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Expired tokens are rejected here — no need to handle expiry downstream
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Called by Passport after the JWT signature and expiry are verified.
   * The returned object becomes request.user for the duration of the request.
   *
   * @param payload - The decoded JWT payload
   * @returns The minimal user identity used throughout the request lifecycle
   */
  async validate(payload: any) {
    return {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    };
  }
}
