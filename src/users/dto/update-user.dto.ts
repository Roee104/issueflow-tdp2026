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
