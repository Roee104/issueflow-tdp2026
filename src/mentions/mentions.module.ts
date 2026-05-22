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
