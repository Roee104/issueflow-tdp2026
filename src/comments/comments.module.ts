/**
 * Comments module — handles comment creation, updates, deletion, and @mention parsing.
 *
 * Imports MentionsModule to wire in @mention parsing and storage on every
 * comment create and update operation.
 *
 * Imports the Ticket entity directly to validate ticket existence before
 * any comment operation — avoids a circular dependency with TicketsModule.
 *
 * Exports CommentsService so MentionsModule can access comment data
 * when building the mentions response.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MentionsModule } from '../mentions/mentions.module';
import { Ticket } from '../tickets/ticket.entity';
import { Comment } from './comment.entity';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, Ticket]), MentionsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
