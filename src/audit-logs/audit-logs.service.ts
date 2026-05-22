import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType, AuditLog } from './audit-log.entity';

export interface AuditLogParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number;
  performedBy: number | null;
  actor: AuditActor;
}

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

  async log(params: AuditLogParams): Promise<void> {
    await this.auditLogRepo.save({
      ...params,
      timestamp: new Date(),
    });
  }

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
