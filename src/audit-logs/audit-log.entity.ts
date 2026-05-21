import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  RESTORE = 'RESTORE',
  AUTO_ASSIGN = 'AUTO_ASSIGN',
  ESCALATE = 'ESCALATE',
  ADD_DEPENDENCY = 'ADD_DEPENDENCY',
  REMOVE_DEPENDENCY = 'REMOVE_DEPENDENCY',
  UPLOAD_ATTACHMENT = 'UPLOAD_ATTACHMENT',
  DELETE_ATTACHMENT = 'DELETE_ATTACHMENT',
}

export enum AuditEntityType {
  USER = 'USER',
  PROJECT = 'PROJECT',
  TICKET = 'TICKET',
  COMMENT = 'COMMENT',
}

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

  @Column()
  entityId: number;

  @Column({ nullable: true })
  performedBy: number | null;

  @Column({ type: 'enum', enum: AuditActor })
  actor: AuditActor;

  @Column({ type: 'timestamp' })
  timestamp: Date;
}
