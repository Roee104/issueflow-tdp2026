/**
 * Data Transfer Object for adding a ticket dependency.
 * Specifies which ticket blocks the target ticket from being completed.
 */
import { IsInt, IsPositive } from 'class-validator';

export class AddDependencyDto {
  @IsInt()
  @IsPositive()
  blockedBy: number;
}
