/**
 * Unit tests for JwtAuthGuard.
 * Verifies the three-step authentication flow:
 * 1. @Public routes bypass all checks
 * 2. Blacklisted tokens are rejected with 401
 * 3. Soft-deleted users are rejected with 401
 *
 * @nestjs/passport is mocked before import so AuthGuard('jwt') resolves
 * to a simple stub — no real JWT validation occurs in these tests.
 */
import { UnauthorizedException } from '@nestjs/common';

// Mock @nestjs/passport BEFORE importing JwtAuthGuard so that
// AuthGuard('jwt') returns a simple base class — no real JWT validation.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => {
    class MockPassportGuard {
      // Always succeeds; tests control the outcome via mocked services.
      async canActivate() {
        return true;
      }
    }
    return MockPassportGuard;
  },
}));

import { JwtAuthGuard } from './auth.guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal NestJS ExecutionContext with the given token and userId. */
const makeContext = (token: string | null, userId = 1) => {
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: { userId },
  };
  return {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
  } as any;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let mockAuthService: { isTokenBlacklisted: jest.Mock };
  let mockUsersService: { findByIdInternal: jest.Mock };
  let mockReflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    mockAuthService = { isTokenBlacklisted: jest.fn() };
    mockUsersService = { findByIdInternal: jest.fn() };
    mockReflector = { getAllAndOverride: jest.fn() };

    guard = new JwtAuthGuard(
      mockAuthService as any,
      mockUsersService as any,
      mockReflector as any,
    );
  });

  it('should return true immediately for @Public routes without checking JWT or blacklist', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true); // isPublic = true

    const result = await guard.canActivate(makeContext('any-token'));

    expect(result).toBe(true);
    expect(mockAuthService.isTokenBlacklisted).not.toHaveBeenCalled();
    expect(mockUsersService.findByIdInternal).not.toHaveBeenCalled();
  });

  it('should throw 401 when the token is on the blacklist', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockAuthService.isTokenBlacklisted.mockResolvedValue(true);

    await expect(guard.canActivate(makeContext('blacklisted-token'))).rejects.toThrow(
      UnauthorizedException,
    );
    // User existence check must not run if the token is already blacklisted
    expect(mockUsersService.findByIdInternal).not.toHaveBeenCalled();
  });

  it('should throw 401 when the user from the JWT payload is soft-deleted or does not exist', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockAuthService.isTokenBlacklisted.mockResolvedValue(false);
    mockUsersService.findByIdInternal.mockResolvedValue(null); // soft-deleted

    await expect(guard.canActivate(makeContext('valid-token', 99))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should return true for a valid token whose user is active', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockAuthService.isTokenBlacklisted.mockResolvedValue(false);
    mockUsersService.findByIdInternal.mockResolvedValue({ id: 1, isDeleted: false });

    const result = await guard.canActivate(makeContext('valid-token', 1));

    expect(result).toBe(true);
  });
});
