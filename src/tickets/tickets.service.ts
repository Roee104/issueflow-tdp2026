import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Comment } from '../comments/comment.entity';
import { TicketDependency } from '../dependencies/ticket-dependency.entity';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';
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
    const ticket = this.ticketRepo.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId: dto.assigneeId ?? null,
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
      return this.toResponse(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        throw new BadRequestException(`Project or assignee referenced does not exist`);
      }
      throw err;
    }
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
      const msg: string = err.message ?? '';
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

  // Used by Steps 13 and 15
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
