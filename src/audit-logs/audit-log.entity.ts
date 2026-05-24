/**
 * Entity representing a single audit log entry.
 * The audit log is an append-only record of all state-changing actions
 * performed in the system — both by users and by automated processes (SYSTEM).
 *
 * Every create, update, delete, restore, and system action (auto-assignment,
 * escalation) is recorded here for full transparency and traceability.
 */
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

/** All possible state-changing actions that are recorded in the audit log. */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  RESTORE = 'RESTORE',
  /** Triggered automatically by the system when no assigneeId is provided on ticket creation. */
  AUTO_ASSIGN = 'AUTO_ASSIGN',
  /** Triggered automatically by the escalation cron job for overdue tickets. */
  ESCALATE = 'ESCALATE',
  ADD_DEPENDENCY = 'ADD_DEPENDENCY',
  REMOVE_DEPENDENCY = 'REMOVE_DEPENDENCY',
  UPLOAD_ATTACHMENT = 'UPLOAD_ATTACHMENT',
  DELETE_ATTACHMENT = 'DELETE_ATTACHMENT',
}

/** The type of entity that was affected by the action. */
export enum AuditEntityType {
  USER = 'USER',
  PROJECT = 'PROJECT',
  TICKET = 'TICKET',
  COMMENT = 'COMMENT',
}

/**
 * Identifies whether the action was performed by a human user
 * or by an automated system process (cron job, auto-assignment).
 */
export enum AuditActor {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'enum', enum: AuditEntityType })
  entityType: AuditEntityType;

  /** The primary key of the affected entity. */
  @Column()
  entityId: number;

  /**
   * The user who performed the action.
   * Null when the actor is SYSTEM (escalation cron, auto-assignment).
   */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'performedBy' })
  @Column({ nullable: true })
  performedBy: number | null;

  @Column({ type: 'enum', enum: AuditActor })
  actor: AuditActor;

  /** UTC timestamp of when the action occurred. */
  @Column({ type: 'timestamp' })
  timestamp: Date;
}
