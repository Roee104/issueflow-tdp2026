/**
 * Junction entity representing a @mention of a user within a comment.
 * Uses a composite primary key (commentId + userId) — a user can only be
 * mentioned once per comment regardless of how many times @username appears
 * in the content. Duplicates are silently ignored during mention parsing.
 *
 * Mention records are deleted and re-inserted on every comment update
 * to keep them in sync with the current content.
 */
import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Comment } from '../comments/comment.entity';
import { User } from '../users/user.entity';

@Entity('comment_mentions')
export class CommentMention {
  /** The comment in which the mention appears. */
  @ManyToOne(() => Comment)
  @JoinColumn({ name: 'commentId' })
  @PrimaryColumn()
  commentId: number;

  /** The user who was mentioned via @username in the comment content. */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  @PrimaryColumn()
  userId: number;
}
