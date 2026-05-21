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
}
