/**
 * Core authentication service handling login, logout, token blacklisting,
 * and periodic cleanup of expired blacklist entries.
 *
 * JWT tokens are stateless by design — logout is implemented via a server-side
 * deny-list that persists invalidated tokens until they naturally expire.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { TokenBlacklist } from './token-blacklist.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(TokenBlacklist)
    private readonly blacklistRepo: Repository<TokenBlacklist>,
  ) {}

  /**
   * Validates credentials and issues a signed JWT access token.
   * Both username-not-found and wrong-password return the same generic error
   * to avoid leaking information about which accounts exist.
   *
   * @param username - The username to authenticate
   * @param password - The plaintext password to verify against the stored hash
   * @returns JWT access token, token type, and expiry in seconds
   * @throws UnauthorizedException if credentials are invalid
   */
  async login(username: string, password: string) {
    const user = await this.usersService.findByUsernameInternal(username);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new UnauthorizedException('Invalid credentials');

    // Embed userId, username, and role in the payload so downstream guards
    // and decorators can identify the user without an extra DB lookup
    const payload = { userId: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, tokenType: 'Bearer', expiresIn: 3600 };
  }

  /**
   * Invalidates a JWT by persisting it in the token blacklist table.
   * The token's natural expiry is decoded from the JWT claims and stored
   * so the cleanup cron can remove it once it is no longer valid anyway.
   *
   * @param token - The raw JWT string from the Authorization header
   */
  async logout(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token) as any;
    // Fall back to 1 hour from now if the exp claim cannot be decoded
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 3600 * 1000);
    await this.blacklistRepo.save({ token, expiresAt });
  }

  /**
   * Checks whether a token has been explicitly invalidated via logout.
   * Called on every authenticated request by JwtAuthGuard.
   *
   * @param token - The raw JWT string to check
   * @returns true if the token is blacklisted, false otherwise
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const entry = await this.blacklistRepo.findOne({ where: { token } });
    return !!entry;
  }

  /**
   * Returns the profile of the currently authenticated user.
   *
   * @param userId - The user ID extracted from the JWT payload
   * @returns The user's public profile
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  async getMe(userId: number) {
    return this.usersService.findById(userId);
  }

  /**
   * Scheduled cleanup job — removes expired tokens from the blacklist daily.
   * Expired tokens are rejected by JWT signature validation anyway, so keeping
   * them in the blacklist table serves no purpose after expiry.
   * Runs at 01:00 UTC daily.
   */
  @Cron('0 1 * * *', { timeZone: 'UTC' })
  async cleanupBlacklist(): Promise<void> {
    await this.blacklistRepo.delete({ expiresAt: LessThan(new Date()) });
  }
}
