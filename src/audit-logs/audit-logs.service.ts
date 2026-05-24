/**
 * Shared service for writing and querying the system audit log.
 * Injected into every feature module that performs state-changing operations.
 * Available globally via @Global() on AuditLogsModule — no explicit import needed.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType, AuditLog } from './audit-log.entity';

/** Parameters required to record a single audit log entry. */
export interface AuditLogParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number;
  /** Null when the actor is SYSTEM (e.g. auto-assignment, escalation cron). */
  performedBy: number | null;
  actor: AuditActor;
}

/** Optional filters for querying the audit log — all fields are independent. */
export interface AuditLogFilters {
  entityType?: AuditEntityType;
  entityId?: number;
  action?: AuditAction;
  actor?: AuditActor;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Records a single state-changing action in the audit log.
   * Called after every successful write operation across the system.
   *
   * @param params - The action details to persist
   */
  async log(params: AuditLogParams): Promise<void> {
    await this.auditLogRepo.save({
      ...params,
      timestamp: new Date(),
    });
  }

  /**
   * Returns all audit log entries matching the given filters, newest first.
   * Only filters that are explicitly provided are applied to the query —
   * undefined fields are ignored rather than matched against NULL.
   *
   * @param filters - Optional filters to narrow the result set
   * @returns Array of audit log entries in descending timestamp order
   */
  async findAll(filters: AuditLogFilters) {
    const where: Partial<AuditLog> = {};
    if (filters.entityType !== undefined) where.entityType = filters.entityType;
    if (filters.entityId !== undefined) where.entityId = filters.entityId;
    if (filters.action !== undefined) where.action = filters.action;
    if (filters.actor !== undefined) where.actor = filters.actor;

    const logs = await this.auditLogRepo.find({
      where,
      order: { timestamp: 'DESC' },
    });

    return logs.map((l) => this.toResponse(l));
  }

  /**
   * Maps an AuditLog entity to the public API response shape.
   * Timestamp is serialized as an ISO-8601 string with UTC Z suffix.
   */
  private toResponse(log: AuditLog) {
    return {
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      performedBy: log.performedBy,
      actor: log.actor,
      timestamp: (log.timestamp as Date).toISOString(),
    };
  }
}
