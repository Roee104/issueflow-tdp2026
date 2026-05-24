/**
 * Entity representing a ticket — the core work item in IssueFlow.
 *
 * Status lifecycle: TODO → IN_PROGRESS → IN_REVIEW → DONE.
 * Transitions are forward-only and enforced at the service layer.
 * Once a ticket reaches DONE it cannot be updated further.
 *
 * Tickets support soft delete — deleted tickets are hidden from standard
 * responses but preserved in the database. Soft delete cascades from projects.
 *
 * The escalation cron job promotes priority for overdue non-DONE tickets:
 * LOW→MEDIUM→HIGH→CRITICAL. Reaching CRITICAL also sets isOverdue=true.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

/** Forward-only status lifecycle for tickets. */
export enum TicketStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}

/** Priority levels used by both manual assignment and the escalation cron job. */
export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** The nature of the work — immutable after ticket creation. */
export enum TicketType {
  BUG = 'BUG',
  FEATURE = 'FEATURE',
  TECHNICAL = 'TECHNICAL',
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  description: string;

  @Column({ type: 'enum', enum: TicketStatus })
  status: TicketStatus;

  @Column({ type: 'enum', enum: TicketPriority })
  priority: TicketPriority;

  /** Immutable after creation — ticket type cannot be changed via PATCH. */
  @Column({ type: 'enum', enum: TicketType })
  type: TicketType;

  /** The project this ticket belongs to. */
  @ManyToOne(() => Project)
  @JoinColumn({ name: 'projectId' })
  @Column()
  projectId: number;

  /**
   * The developer assigned to this ticket.
   * Null if unassigned. When omitted on creation, auto-assignment selects
   * the developer with the lowest open ticket count in the project.
   */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigneeId' })
  @Column({ nullable: true })
  assigneeId: number | null;

  /** Used by the escalation cron job — tickets past this date are overdue. */
  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date | null;

  /**
   * Set to true by the escalation cron when priority reaches CRITICAL.
   * Reset to false when priority is manually updated via PATCH.
   */
  @Column({ default: false })
  isOverdue: boolean;

  /** Soft delete flag — true means the ticket is hidden from standard API responses. */
  @Column({ default: false })
  isDeleted: boolean;

  /** Set when the ticket is soft-deleted. Null for active tickets. */
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
