import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ticket } from '../tickets/ticket.entity';
import { TicketDependency } from './ticket-dependency.entity';

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TicketDependency)
    private readonly depRepo: Repository<TicketDependency>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async add(ticketId: number, blockerId: number, performedBy: number): Promise<void> {
    if (ticketId === blockerId) {
      throw new BadRequestException('A ticket cannot block itself');
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${ticketId} not found`);

    const blocker = await this.ticketRepo.findOne({ where: { id: blockerId, isDeleted: false } });
    if (!blocker) throw new NotFoundException(`Ticket with id ${blockerId} not found`);

    if (ticket.projectId !== blocker.projectId) {
      throw new BadRequestException('Both tickets must belong to the same project');
    }

    const existing = await this.depRepo.findOne({ where: { ticketId, blockerId } });
    if (existing) {
      throw new BadRequestException('This dependency already exists');
    }

    if (await this.wouldCreateCycle(ticketId, blockerId)) {
      throw new BadRequestException('Adding this dependency would create a circular dependency');
    }

    await this.depRepo.save({ ticketId, blockerId });
    await this.auditLogsService.log({
      action: AuditAction.ADD_DEPENDENCY,
      entityType: AuditEntityType.TICKET,
      entityId: ticketId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  async findAll(ticketId: number) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${ticketId} not found`);

    const deps = await this.depRepo.find({ where: { ticketId } });
    if (deps.length === 0) return [];

    const blockerIds = deps.map((d) => d.blockerId);
    const blockers = await this.ticketRepo.find({
      where: { id: In(blockerIds), isDeleted: false },
    });

    return blockers.map((b) => ({ id: b.id, title: b.title, status: b.status }));
  }

  async remove(ticketId: number, blockerId: number, performedBy: number): Promise<void> {
    const dep = await this.depRepo.findOne({ where: { ticketId, blockerId } });
    if (!dep) throw new NotFoundException(`Dependency not found`);

    await this.depRepo.delete({ ticketId, blockerId });
    await this.auditLogsService.log({
      action: AuditAction.REMOVE_DEPENDENCY,
      entityType: AuditEntityType.TICKET,
      entityId: ticketId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  // BFS from newBlockerId following "is blocked by" edges.
  // Returns true if newBlockerId can reach ticketId, which would form a cycle.
  private async wouldCreateCycle(ticketId: number, newBlockerId: number): Promise<boolean> {
    const visited = new Set<number>();
    const queue: number[] = [newBlockerId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === ticketId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = await this.depRepo.find({ where: { ticketId: current } });
      for (const dep of deps) {
        queue.push(dep.blockerId);
      }
    }

    return false;
  }
}
