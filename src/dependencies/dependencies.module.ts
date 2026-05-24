/**
 * Dependencies module — manages blocking relationships between tickets.
 * Imports the Ticket entity directly to validate ticket existence and
 * same-project membership without creating a dependency on TicketsModule.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/ticket.entity';
import { TicketDependency } from './ticket-dependency.entity';
import { DependenciesController } from './dependencies.controller';
import { DependenciesService } from './dependencies.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketDependency, Ticket])],
  controllers: [DependenciesController],
  providers: [DependenciesService],
  exports: [DependenciesService],
})
export class DependenciesModule {}
