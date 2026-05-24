/**
 * Controller for authentication endpoints.
 * Handles login, logout, and current user profile retrieval.
 * Login is publicly accessible; logout and me require a valid JWT.
 */
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Authenticates a user and returns a signed JWT access token.
   * Marked @Public so the global JWT guard does not apply.
   * Returns 200 (not 201) — this is not a resource creation.
   *
   * @param dto - The login credentials
   * @returns JWT access token, token type, and expiry
   */
  @Post('login')
  @Public()
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  /**
   * Invalidates the current JWT by adding it to the server-side deny-list.
   * The raw token is extracted from the Authorization header to pass to the blacklist.
   *
   * @param request - The incoming HTTP request containing the Authorization header
   */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request) {
    // Extract the raw Bearer token from the Authorization header for blacklisting
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request as any);
    await this.authService.logout(token);
  }

  /**
   * Returns the profile of the currently authenticated user.
   * The user is identified from the JWT payload set by the global guard.
   *
   * @param user - The authenticated user extracted from the JWT payload
   * @returns The user's profile in the standard user response shape
   */
  @Get('me')
  getMe(@CurrentUser() user: { userId: number }) {
    return this.authService.getMe(user.userId);
  }
}
