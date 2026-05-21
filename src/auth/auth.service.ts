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

  async login(username: string, password: string) {
    const user = await this.usersService.findByUsernameInternal(username);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new UnauthorizedException('Invalid credentials');

    const payload = { userId: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, tokenType: 'Bearer', expiresIn: 3600 };
  }

  async logout(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token) as any;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 3600 * 1000);
    await this.blacklistRepo.save({ token, expiresAt });
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const entry = await this.blacklistRepo.findOne({ where: { token } });
    return !!entry;
  }

  async getMe(userId: number) {
    return this.usersService.findById(userId);
  }

  // Runs at 01:00 UTC daily — removes expired tokens to keep the table small
  @Cron('0 1 * * *', { timeZone: 'UTC' })
  async cleanupBlacklist(): Promise<void> {
    await this.blacklistRepo.delete({ expiresAt: LessThan(new Date()) });
  }
}
