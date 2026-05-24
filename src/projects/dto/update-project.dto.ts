/**
 * Data Transfer Object for updating a project.
 * Both fields are optional — only provided fields are updated.
 * ownerId is intentionally excluded — project ownership cannot be transferred.
 */
import { IsOptional, IsString } from 'class-validator';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
