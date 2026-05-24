/**
 * Authentication module — wires together JWT configuration, Passport strategy,
 * the global JWT guard, and the token blacklist persistence layer.
 *
 * Exports AuthService and JwtAuthGuard so they can be used in AppModule
 * where JwtAuthGuard is registered as a global APP_GUARD.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlacklist } from './token-blacklist.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule,
    // Configure JWT asynchronously so the secret and expiry are read from
    // environment variables via ConfigService rather than hardcoded
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: parseInt(configService.get<string>('JWT_EXPIRES_IN'), 10),
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([TokenBlacklist]),
    // UsersModule is imported so AuthService can call findByUsernameInternal
    // for login and findByIdInternal for the soft-delete check in JwtAuthGuard
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
