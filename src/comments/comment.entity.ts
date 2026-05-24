/**
 * Entity representing a comment left on a ticket.
 * Comments support soft delete — they are hidden from standard responses
 * when isDeleted is true, but remain in the database for data integrity.
 *
 * Soft delete is cascaded from tickets: deleting a ticket soft-deletes all
 * its comments, and restoring a ticket restores them as well.
 *
 * Comments also participate in the @mention system — when a username is
 * referenced in content, a CommentMention record is created linking the
 * comment to the mentioned user.
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  /** The ticket this comment belongs to. */
  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticketId' })
  @Column()
  ticketId: number;

  /** The user who authored the comment. */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'authorId' })
  @Column()
  authorId: number;

  @Column({ type: 'text' })
  content: string;

  /** Soft delete flag — true means the comment is hidden from standard API responses. */
  @Column({ default: false })
  isDeleted: boolean;

  /** Set when the comment is soft-deleted. Null for active comments. */
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
