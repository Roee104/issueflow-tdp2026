import { BadRequestException, Controller, Get, ParseEnumPipe, Query } from '@nestjs/common';
import { AuditAction, AuditActor, AuditEntityType } from './audit-log.entity';
import { AuditLogsService } from './audit-logs.service';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  findAll(
    @Query('entityType', new ParseEnumPipe(AuditEntityType, { optional: true }))
    entityType?: AuditEntityType,
    @Query('entityId') entityId?: string,
    @Query('action', new ParseEnumPipe(AuditAction, { optional: true }))
    action?: AuditAction,
    @Query('actor', new ParseEnumPipe(AuditActor, { optional: true }))
    actor?: AuditActor,
  ) {
    let parsedEntityId: number | undefined;
    if (entityId !== undefined) {
      parsedEntityId = parseInt(entityId, 10);
      if (isNaN(parsedEntityId)) {
        throw new BadRequestException('entityId must be a valid integer');
      }
    }

    return this.auditLogsService.findAll({ entityType, entityId: parsedEntityId, action, actor });
  }
}
