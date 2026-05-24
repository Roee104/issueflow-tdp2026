/**
 * Data Transfer Object for updating a ticket.
 * All fields are optional — only provided fields are updated.
 * type is intentionally excluded — ticket type cannot be changed after creation.
 * Status transitions are validated in the service: only forward transitions are allowed
 * and a ticket cannot be updated once it reaches DONE.
 */
import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive, IsString } from 'class-validator';
import { TicketPriority, TicketStatus } from '../ticket.entity';

export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsInt()
  @IsPositive()
  @IsOptional()
  assigneeId?: number;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
