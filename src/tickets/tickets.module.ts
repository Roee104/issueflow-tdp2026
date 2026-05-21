import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../comments/comment.entity';
import { Ticket } from './ticket.entity';
import { TicketsController } from './tickets.controller';
import { TicketsEscalationService } from './tickets-escalation.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, Comment])],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsEscalationService],
  exports: [TicketsService],
})
export class TicketsModule {}
