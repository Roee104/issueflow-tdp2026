/**
 * Mentions module — handles @username parsing, storage, and retrieval.
 *
 * Imports User and Comment entities directly rather than importing UsersModule
 * or CommentsModule, avoiding a circular dependency:
 * CommentsModule → MentionsModule → CommentsModule.
 *
 * Exports MentionsService so it can be injected into CommentsService
 * and UsersController for the GET /users/:userId/mentions endpoint.
 * No controller — the mentions endpoint lives in UsersController.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../comments/comment.entity';
import { User } from '../users/user.entity';
import { CommentMention } from './comment-mention.entity';
import { MentionsService } from './mentions.service';

@Module({
  imports: [TypeOrmModule.forFeature([CommentMention, Comment, User])],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
