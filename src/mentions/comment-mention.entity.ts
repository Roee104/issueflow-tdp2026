import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Comment } from '../comments/comment.entity';
import { User } from '../users/user.entity';

@Entity('comment_mentions')
export class CommentMention {
  @ManyToOne(() => Comment)
  @JoinColumn({ name: 'commentId' })
  @PrimaryColumn()
  commentId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  @PrimaryColumn()
  userId: number;
}
