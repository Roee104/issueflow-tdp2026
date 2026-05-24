/**
 * Data Transfer Object for creating a new project.
 * ownerId must reference an existing non-deleted user — validated at the
 * service layer via FK constraint (PostgreSQL error 23503).
 */
import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsInt()
  @IsPositive()
  ownerId: number;
}
