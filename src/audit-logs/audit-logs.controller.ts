/**
 * Controller for the audit log retrieval endpoint.
 * Provides a single GET endpoint with optional filters to query
 * the append-only audit trail of all state-changing actions in the system.
 */
import { BadRequestException, Controller, Get, ParseEnumPipe, Query } from '@nestjs/common';
import { AuditAction, AuditActor, AuditEntityType } from './audit-log.entity';
import { AuditLogsService } from './audit-logs.service';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * Returns all audit log entries, optionally filtered by one or more fields.
   * Results are ordered newest first.
   *
   * entityId is accepted as a plain string rather than using ParseIntPipe because
   * ParseIntPipe({ optional: true }) incorrectly fires on absent values in this
   * version of NestJS — manual parsing is used instead.
   *
   * @param entityType - Filter by entity type (USER, PROJECT, TICKET, COMMENT)
   * @param entityId - Filter by the ID of the affected entity
   * @param action - Filter by action type (CREATE, UPDATE, DELETE, etc.)
   * @param actor - Filter by actor type (USER or SYSTEM)
   * @returns Array of audit log entries matching the given filters
   * @throws BadRequestException if entityId is provided but is not a valid integer
   */
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
