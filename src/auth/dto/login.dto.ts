/**
 * Data Transfer Object for the POST /auth/login endpoint.
 * Validates that both username and password are non-empty strings.
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
