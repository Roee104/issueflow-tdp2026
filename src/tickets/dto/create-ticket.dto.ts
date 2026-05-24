/**
 * Data Transfer Object for creating a new ticket.
 * assigneeId is optional — if omitted, the system auto-assigns the ticket
 * to the developer with the lowest open ticket count in the project.
 * dueDate is accepted as an ISO-8601 string and converted to a Date in the service.
 */
import { IsEnum, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';
import { TicketPriority, TicketStatus, TicketType } from '../ticket.entity';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(TicketStatus)
  status: TicketStatus;

  @IsEnum(TicketPriority)
  priority: TicketPriority;

  @IsEnum(TicketType)
  type: TicketType;

  @IsInt()
  @IsPositive()
  projectId: number;

  /** If omitted (undefined), auto-assignment is triggered. */
  @IsInt()
  @IsPositive()
  @IsOptional()
  assigneeId?: number;

  /** ISO-8601 format (e.g. 2026-12-31T23:59:59Z). Used by the escalation cron job. */
  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
