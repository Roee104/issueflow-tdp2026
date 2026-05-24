/**
 * Data Transfer Object for creating a new user.
 * This endpoint is public (@Public) — no JWT required.
 * Password is accepted in plaintext and hashed with bcrypt (10 rounds) in the service.
 * username and email must be unique — duplicates return 409 Conflict.
 */
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { UserRole } from '../user.entity';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsEnum(UserRole)
  role: UserRole;

  /** Plaintext password — hashed before persistence, never returned in responses. */
  @IsString()
  @IsNotEmpty()
  password: string;
}
