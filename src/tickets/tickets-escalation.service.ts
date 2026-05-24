/**
 * Scheduled service that automatically escalates the priority of overdue tickets.
 * Runs twice daily at 00:00 and 12:00 UTC via a cron job.
 *
 * Escalation rules:
 * - Only non-deleted, non-DONE tickets with a dueDate in the past are affected
 * - Priority is promoted one level: LOW→MEDIUM, MEDIUM→HIGH, HIGH→CRITICAL
 * - CRITICAL tickets are never escalated further — the promotion map has no entry for CRITICAL
 * - When a ticket reaches CRITICAL, isOverdue is also set to true
 * - isOverdue is reset to false when priority is manually changed via PATCH
 *
 * Each escalation is recorded in the audit log with actor=SYSTEM and performedBy=null.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Not, Repository } from 'typeorm';
import {
  AuditAction,
  AuditActor,
  AuditEntityType,
} from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';

/**
 * Maps each priority to the next escalation level.
 * CRITICAL is intentionally absent — tickets already at CRITICAL are skipped,
 * making the escalation idempotent for the highest priority level.
 */
const PRIORITY_PROMOTION: Partial<Record<TicketPriority, TicketPriority>> = {
  [TicketPriority.LOW]: TicketPriority.MEDIUM,
  [TicketPriority.MEDIUM]: TicketPriority.HIGH,
  [TicketPriority.HIGH]: TicketPriority.CRITICAL,
};

@Injectable()
export class TicketsEscalationService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Escalates overdue tickets by promoting their priority one level.
   * Runs at 00:00 and 12:00 UTC daily.
   *
   * Query conditions:
   * - isDeleted = false — skip soft-deleted tickets
   * - status != DONE — completed tickets are never escalated
   * - dueDate < now — LessThan(now) automatically excludes NULL dueDates via SQL semantics
   */
  @Cron('0 0,12 * * *', { timeZone: 'UTC' })
  async escalate(): Promise<void> {
    const now = new Date();

    // LessThan(now) translates to: dueDate < $1 in SQL
    // NULL < $1 evaluates to NULL (falsy) — tickets without a dueDate are excluded automatically
    const tickets = await this.ticketRepo.find({
      where: {
        isDeleted: false,
        status: Not(TicketStatus.DONE),
        dueDate: LessThan(now),
      },
    });

    for (const ticket of tickets) {
      const newPriority = PRIORITY_PROMOTION[ticket.priority];
      // No entry in the map means the ticket is already CRITICAL — skip to preserve idempotency
      if (!newPriority) continue;

      const updates: Partial<Ticket> = { priority: newPriority };
      // isOverdue is only set when the ticket first reaches CRITICAL priority
      if (newPriority === TicketPriority.CRITICAL) {
        updates.isOverdue = true;
      }

      await this.ticketRepo.update(ticket.id, updates);
      await this.auditLogsService.log({
        action: AuditAction.ESCALATE,
        entityType: AuditEntityType.TICKET,
        entityId: ticket.id,
        performedBy: null,
        actor: AuditActor.SYSTEM,
      });
    }
  }
}
