/**
 * Audit logs module — provides the append-only audit trail for the entire system.
 *
 * Decorated with @Global() so AuditLogsService is available for injection
 * across all modules without requiring explicit imports. This is appropriate
 * because audit logging is a cross-cutting concern used by every feature module
 * (users, projects, tickets, comments, dependencies, attachments).
 *
 * Exports AuditLogsService so it can be injected directly into any provider
 * in the application without importing this module explicitly.
 */
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
