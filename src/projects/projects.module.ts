/**
 * Projects module — manages project lifecycle including soft delete and restore.
 *
 * Imports Ticket and Comment entities directly to handle cascade soft delete
 * and restore without creating circular dependencies on TicketsModule or CommentsModule.
 *
 * Imports User entity to support the workload endpoint, which queries developer
 * assignments without depending on UsersModule.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../comments/comment.entity';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';
import { Project } from './project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Ticket, Comment, User])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
