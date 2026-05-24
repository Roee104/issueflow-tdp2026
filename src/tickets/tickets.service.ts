import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { DataSource, Not, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Comment } from '../comments/comment.entity';
import { TicketDependency } from '../dependencies/ticket-dependency.entity';
import { User, UserRole } from '../users/user.entity';
import { Ticket, TicketPriority, TicketStatus, TicketType } from './ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

const STATUS_ORDER: Record<TicketStatus, number> = {
  [TicketStatus.TODO]: 0,
  [TicketStatus.IN_PROGRESS]: 1,
  [TicketStatus.IN_REVIEW]: 2,
  [TicketStatus.DONE]: 3,
};

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(TicketDependency)
    private readonly depRepo: Repository<TicketDependency>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAllByProject(projectId: number) {
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: false },
    });
    return tickets.map((t) => this.toResponse(t));
  }

  async findById(id: number) {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);
    return this.toResponse(ticket);
  }

  async create(dto: CreateTicketDto, performedBy: number) {
    const triggersAutoAssign = dto.assigneeId === undefined;
    let assigneeId: number | null = dto.assigneeId ?? null;

    if (triggersAutoAssign) {
      assigneeId = await this.autoAssign(dto.projectId);
    }

    const ticket = this.ticketRepo.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      isOverdue: false,
    });

    try {
      const saved = await this.ticketRepo.save(ticket);

      await this.auditLogsService.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.TICKET,
        entityId: saved.id,
        performedBy,
        actor: AuditActor.USER,
      });

      if (triggersAutoAssign && assigneeId !== null) {
        await this.auditLogsService.log({
          action: AuditAction.AUTO_ASSIGN,
          entityType: AuditEntityType.TICKET,
          entityId: saved.id,
          performedBy: null,
          actor: AuditActor.SYSTEM,
        });
      }

      return this.toResponse(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        throw new BadRequestException(`Project or assignee referenced does not exist`);
      }
      throw err;
    }
  }

  private async autoAssign(projectId: number): Promise<number | null> {
    const developers = await this.userRepo.find({
      where: { role: UserRole.DEVELOPER, isDeleted: false },
      order: { id: 'ASC' },
    });

    if (developers.length === 0) return null;

    const workloads = await Promise.all(
      developers.map(async (dev) => ({
        dev,
        count: await this.ticketRepo.count({
          where: {
            projectId,
            assigneeId: dev.id,
            status: Not(TicketStatus.DONE),
            isDeleted: false,
          },
        }),
      })),
    );

    // Strict < keeps the first (lowest id) on tie — correct tie-break by registration order
    const best = workloads.reduce((a, b) => (b.count < a.count ? b : a));
    return best.dev.id;
  }

  async update(id: number, dto: UpdateTicketDto, performedBy: number): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

      const ticket = await queryRunner.manager.findOne(Ticket, {
        where: { id, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);

      if (ticket.status === TicketStatus.DONE) {
        throw new BadRequestException('Cannot update a ticket that is already DONE');
      }

      if (dto.status !== undefined && STATUS_ORDER[dto.status] < STATUS_ORDER[ticket.status]) {
        throw new BadRequestException(
          `Ticket status cannot move backward from ${ticket.status} to ${dto.status}`,
        );
      }

      if (dto.status === TicketStatus.DONE) {
        const blockers = await queryRunner.manager.find(TicketDependency, {
          where: { ticketId: id },
        });
        for (const dep of blockers) {
          const blocker = await queryRunner.manager.findOne(Ticket, {
            where: { id: dep.blockerId },
          });
          if (!blocker || blocker.status !== TicketStatus.DONE) {
            throw new BadRequestException(
              'Cannot transition to DONE: ticket has unresolved blockers',
            );
          }
        }
      }

      const updates: Partial<Ticket> = {};
      if (dto.title !== undefined) updates.title = dto.title;
      if (dto.description !== undefined) updates.description = dto.description;
      if (dto.status !== undefined) updates.status = dto.status;
      if (dto.priority !== undefined) {
        updates.priority = dto.priority;
        updates.isOverdue = false;
      }
      if (dto.assigneeId !== undefined) updates.assigneeId = dto.assigneeId;
      if (dto.dueDate !== undefined) updates.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

      await queryRunner.manager.update(Ticket, id, updates);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      const code = (err as any).code;
      const msg: string = (err as any).message ?? '';
      if (code === '55P03' || msg.includes('canceling statement due to lock timeout')) {
        throw new ConflictException('Ticket is currently being updated by another user');
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  async remove(id: number, performedBy: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);

    const now = new Date();
    await this.commentRepo.update({ ticketId: id, isDeleted: false }, { isDeleted: true, deletedAt: now });
    await this.ticketRepo.update(id, { isDeleted: true, deletedAt: now });

    await this.auditLogsService.log({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  async exportToCsv(projectId: number): Promise<string> {
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: false },
    });

    const rows = tickets.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      assigneeId: t.assigneeId ?? '',
    }));

    return stringify(rows, {
      header: true,
      columns: ['id', 'title', 'description', 'status', 'priority', 'type', 'assigneeId'],
    });
  }

  async importFromCsv(
    csvBuffer: Buffer,
    projectId: number,
    performedBy: number,
  ): Promise<{ created: number; failed: number; errors: { row: number; error: string }[] }> {
    let records: any[];
    try {
      records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      throw new BadRequestException('Invalid CSV format');
    }

    let created = 0;
    let failed = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // row 1 is the header

      try {
        if (!record.title) throw new Error('Missing required field: title');
        if (!record.description) throw new Error('Missing required field: description');
        if (!record.status) throw new Error('Missing required field: status');
        if (!record.priority) throw new Error('Missing required field: priority');
        if (!record.type) throw new Error('Missing required field: type');

        if (!Object.values(TicketStatus).includes(record.status)) {
          throw new Error(
            `Invalid status '${record.status}'. Valid values: ${Object.values(TicketStatus).join(', ')}`,
          );
        }
        if (!Object.values(TicketPriority).includes(record.priority)) {
          throw new Error(
            `Invalid priority '${record.priority}'. Valid values: ${Object.values(TicketPriority).join(', ')}`,
          );
        }
        if (!Object.values(TicketType).includes(record.type)) {
          throw new Error(
            `Invalid type '${record.type}'. Valid values: ${Object.values(TicketType).join(', ')}`,
          );
        }

        let assigneeId: number | null = null;
        if (record.assigneeId) {
          assigneeId = parseInt(record.assigneeId, 10);
          if (isNaN(assigneeId)) throw new Error('Invalid assigneeId: must be a number');
        }

        const ticket = this.ticketRepo.create({
          title: record.title,
          description: record.description,
          status: record.status as TicketStatus,
          priority: record.priority as TicketPriority,
          type: record.type as TicketType,
          projectId,
          assigneeId,
          isOverdue: false,
        });

        const saved = await this.ticketRepo.save(ticket);
        await this.auditLogsService.log({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.TICKET,
          entityId: saved.id,
          performedBy,
          actor: AuditActor.USER,
        });
        created++;
      } catch (err) {
        failed++;
        errors.push({ row: rowNum, error: (err as any).message });
      }
    }

    return { created, failed, errors };
  }

  async findDeleted(projectId: number) {
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: true },
    });
    return tickets.map((t) => this.toResponse(t));
  }

  async restore(id: number, performedBy: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: true } });
    if (!ticket) throw new NotFoundException(`Deleted ticket with id ${id} not found`);

    await this.commentRepo.update({ ticketId: id, isDeleted: true }, { isDeleted: false, deletedAt: null });
    await this.ticketRepo.update(id, { isDeleted: false, deletedAt: null });

    await this.auditLogsService.log({
      action: AuditAction.RESTORE,
      entityType: AuditEntityType.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  async findByIdRaw(id: number): Promise<Ticket | null> {
    return this.ticketRepo.findOne({ where: { id, isDeleted: false } });
  }

  toResponse(ticket: Ticket) {
    return {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      type: ticket.type,
      projectId: ticket.projectId,
      assigneeId: ticket.assigneeId,
      dueDate: ticket.dueDate ? (ticket.dueDate as Date).toISOString() : null,
      isOverdue: ticket.isOverdue,
    };
  }
}
