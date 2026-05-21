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
