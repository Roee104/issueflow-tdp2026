import { Entity, PrimaryColumn } from 'typeorm';

@Entity('comment_mentions')
export class CommentMention {
  @PrimaryColumn()
  commentId: number;

  @PrimaryColumn()
  userId: number;
}
