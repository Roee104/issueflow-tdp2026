/**
 * Tickets module — manages the full ticket lifecycle including CRUD,
 * status transitions, pessimistic locking, soft delete, restore,
 * CSV export/import, auto-assignment, and escalation.
 *
 * Imports Comment to handle cascade soft delete/restore without depending on CommentsModule.
 * Imports TicketDependency to enforce the DONE blocker check during status transitions.
 * Imports User to support auto-assignment workload queries.
 *
 * TicketsEscalationService is registered as a provider alongside TicketsService —
 * it runs as a scheduled cron job and shares the same module context.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../comments/comment.entity';
import { TicketDependency } from '../dependencies/ticket-dependency.entity';
import { User } from '../users/user.entity';
import { Ticket } from './ticket.entity';
import { TicketsController } from './tickets.controller';
import { TicketsEscalationService } from './tickets-escalation.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Comment, TicketDependency, User]),
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsEscalationService],
  exports: [TicketsService],
})
export class TicketsModule {}
