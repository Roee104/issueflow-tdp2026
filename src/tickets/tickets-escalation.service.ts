import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Not, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';

// Maps each priority to the next level; CRITICAL is absent — tickets at CRITICAL are never escalated further
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

  @Cron('0 0,12 * * *', { timeZone: 'UTC' })
  async escalate(): Promise<void> {
    const now = new Date();

    // LessThan(now) in SQL is: dueDate < $1 — NULL values are excluded automatically
    const tickets = await this.ticketRepo.find({
      where: {
        isDeleted: false,
        status: Not(TicketStatus.DONE),
        dueDate: LessThan(now),
      },
    });

    for (const ticket of tickets) {
      const newPriority = PRIORITY_PROMOTION[ticket.priority];
      if (!newPriority) continue; // CRITICAL ticket — idempotent, skip

      const updates: Partial<Ticket> = { priority: newPriority };
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
