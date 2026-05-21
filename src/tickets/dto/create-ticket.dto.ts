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

  @IsInt()
  @IsPositive()
  @IsOptional()
  assigneeId?: number;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
