/**
 * Core service for ticket management — the most complex service in the system.
 *
 * Responsibilities:
 * - Full CRUD with soft delete and restore (cascades to comments)
 * - Status transition enforcement (forward-only, DONE is terminal)
 * - Pessimistic locking on updates (SELECT FOR UPDATE, 5s timeout)
 * - DONE blocker check (all dependencies must be DONE before transitioning)
 * - Auto-assignment by workload when assigneeId is omitted on creation
 * - CSV export and import with partial success handling
 * - Audit logging for all state-changing operations
 */
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

/**
 * Numeric ordering for status values used to enforce forward-only transitions.
 * A transition is valid only if the new status value is >= the current value.
 */
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

  /**
   * Returns all active (non-deleted) tickets for a project.
   *
   * @param projectId - The project whose tickets to retrieve
   */
  async findAllByProject(projectId: number) {
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: false },
    });
    return tickets.map((t) => this.toResponse(t));
  }

  /**
   * Returns a single active ticket by ID.
   *
   * @param id - The ticket ID to retrieve
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  async findById(id: number) {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);
    return this.toResponse(ticket);
  }

  /**
   * Creates a new ticket with optional auto-assignment.
   * If assigneeId is explicitly absent (undefined) from the DTO, auto-assignment
   * is triggered — the system selects the developer with the lowest open ticket
   * count in the project, tie-broken by lowest user ID.
   *
   * Two audit log entries are written when auto-assignment occurs:
   * CREATE (actor: USER) followed by AUTO_ASSIGN (actor: SYSTEM).
   *
   * @param dto - Ticket details. assigneeId absence triggers auto-assignment.
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @returns The created ticket
   * @throws BadRequestException if projectId or assigneeId reference non-existent entities
   */
  async create(dto: CreateTicketDto, performedBy: number) {
    // undefined means the field was not sent — triggers auto-assignment
    // null or a number means the client made an explicit choice
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

      // Log the system-triggered auto-assignment separately
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
      // PostgreSQL error 23503 = foreign key violation — projectId or assigneeId does not exist
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        throw new BadRequestException(`Project or assignee referenced does not exist`);
      }
      throw err;
    }
  }

  /**
   * Selects the most appropriate developer to assign a new ticket to.
   * Queries all non-deleted DEVELOPER users ordered by id ASC (ensures deterministic
   * tie-breaking — the developer registered earliest gets priority when counts are equal).
   * Counts each developer's non-DONE, non-deleted tickets in the project.
   * Uses strict < in reduce to keep the first (lowest id) on tie.
   *
   * @param projectId - The project to count workload within
   * @returns The userId of the selected developer, or null if no developers exist
   */
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

  /**
   * Updates ticket fields using pessimistic locking to prevent concurrent edits.
   *
   * Locking flow:
   * 1. Open a QueryRunner transaction
   * 2. SET LOCAL lock_timeout = '5s' — limits how long we wait for the lock
   * 3. SELECT FOR UPDATE — acquires a row-level write lock on the ticket
   * 4. Validate business rules (DONE immutability, forward-only transitions, blocker check)
   * 5. Apply updates and commit
   *
   * If PostgreSQL raises error 55P03 (lock_not_available), the 5s timeout was exceeded
   * and another transaction holds the lock — surfaced as 409 Conflict.
   *
   * Manual priority change resets isOverdue to false — the escalation cron will
   * re-evaluate on the next run if the ticket is still overdue.
   *
   * @param id - The ticket to update
   * @param dto - Fields to update (all optional)
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   * @throws BadRequestException if the ticket is DONE, transition is backward, or blockers unresolved
   * @throws ConflictException if the lock timeout is exceeded
   */
  async update(id: number, dto: UpdateTicketDto, performedBy: number): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Limit how long the transaction waits for the row lock
      await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

      const ticket = await queryRunner.manager.findOne(Ticket, {
        where: { id, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);

      // DONE tickets are immutable — no updates allowed
      if (ticket.status === TicketStatus.DONE) {
        throw new BadRequestException('Cannot update a ticket that is already DONE');
      }

      // Enforce forward-only status transitions
      if (dto.status !== undefined && STATUS_ORDER[dto.status] < STATUS_ORDER[ticket.status]) {
        throw new BadRequestException(
          `Ticket status cannot move backward from ${ticket.status} to ${dto.status}`,
        );
      }

      // When transitioning to DONE, all blocking tickets must already be DONE
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
        // Manual priority change overrides the escalation cron's isOverdue flag
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
      // PostgreSQL error 55P03 = lock_not_available (lock timeout exceeded)
      if (code === '55P03' || msg.includes('canceling statement due to lock timeout')) {
        throw new ConflictException('Ticket is currently being updated by another user');
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Audit log is written after the transaction commits successfully
    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Soft-deletes a ticket and cascades to soft-delete all its comments.
   *
   * @param id - The ticket to soft-delete
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the ticket does not exist or is already soft-deleted
   */
  async remove(id: number, performedBy: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${id} not found`);

    const now = new Date();
    // Cascade: soft delete all non-deleted comments on this ticket first
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

  /**
   * Exports all non-deleted tickets for a project as a CSV string.
   * Uses csv-stringify with explicit column ordering to ensure consistent output.
   * assigneeId is exported as an empty string when null — avoids 'null' in the CSV.
   *
   * @param projectId - The project whose tickets to export
   * @returns A CSV string with header row
   */
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
      // null assigneeId exported as empty string — avoids 'null' literal in CSV
      assigneeId: t.assigneeId ?? '',
    }));

    return stringify(rows, {
      header: true,
      columns: ['id', 'title', 'description', 'status', 'priority', 'type', 'assigneeId'],
    });
  }

  /**
   * Imports tickets from a CSV buffer into a project with partial success handling.
   * Row failures are collected and returned — a single invalid row does not abort the import.
   * Row numbers in errors are 1-indexed from the data rows (row 1 = first data row after header).
   *
   * @param csvBuffer - The raw CSV file buffer from Multer memoryStorage
   * @param projectId - The project to import tickets into
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @returns Summary of { created, failed, errors } with per-row error details
   * @throws BadRequestException if the CSV cannot be parsed at all
   */
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
      // i + 2 because row 1 is the header, and array index is 0-based
      const rowNum = i + 2; 

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
        // Collect the error and continue — partial success is intentional
        failed++;
        errors.push({ row: rowNum, error: (err as any).message });
      }
    }

    return { created, failed, errors };
  }

  /**
   * Returns all soft-deleted tickets for a project.
   * Used by the ADMIN-only GET /tickets/deleted endpoint.
   *
   * @param projectId - The project whose deleted tickets to retrieve
   */
  async findDeleted(projectId: number) {
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: true },
    });
    return tickets.map((t) => this.toResponse(t));
  }

  /**
   * Returns all soft-deleted tickets for a project.
   * Used by the ADMIN-only GET /tickets/deleted endpoint.
   *
   * @param projectId - The project whose deleted tickets to retrieve
   */
  async restore(id: number, performedBy: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id, isDeleted: true } });
    if (!ticket) throw new NotFoundException(`Deleted ticket with id ${id} not found`);

    // Cascade: restore all soft-deleted comments on this ticket
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

  /**
   * Returns the full Ticket entity for internal use by other services.
   * Unlike findById, this returns the raw entity rather than the response shape.
   * Used by the auto-assignment flow and restore endpoints.
   *
   * @param id - The ticket ID to retrieve
   * @returns The full Ticket entity, or null if not found or soft-deleted
   */
  async findByIdRaw(id: number): Promise<Ticket | null> {
    return this.ticketRepo.findOne({ where: { id, isDeleted: false } });
  }

  /**
   * Maps a Ticket entity to the public API response shape.
   * dueDate is serialized as an ISO-8601 string with UTC Z suffix.
   * isOverdue is always included so clients can display overdue status.
   */
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
