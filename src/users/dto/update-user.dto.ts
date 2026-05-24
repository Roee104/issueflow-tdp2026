/**
 * Data Transfer Object for updating a user.
 * Only fullName and role can be changed — username, email, and password
 * are intentionally excluded from updates.
 */
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../user.entity';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
