/**
 * Service managing ticket dependency relationships.
 * Dependencies define which tickets must be completed before another ticket
 * can transition to DONE. Enforces five validation rules on every new dependency:
 * self-reference, cross-project, duplicate, and circular dependency detection.
 */
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

  /**
   * Adds a blocking dependency between two tickets after validating all constraints.
   * Validation order:
   * 1. Self-dependency check (immediate, no DB call)
   * 2. Both tickets must exist and not be soft-deleted
   * 3. Both tickets must belong to the same project
   * 4. Dependency must not already exist
   * 5. Adding the dependency must not create a circular chain (BFS)
   *
   * @param ticketId - The ticket to be blocked
   * @param blockerId - The ticket that blocks it
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws BadRequestException for any validation failure
   * @throws NotFoundException if either ticket does not exist or is soft-deleted
   */
  async add(ticketId: number, blockerId: number, performedBy: number): Promise<void> {
    if (ticketId === blockerId) {
      throw new BadRequestException('A ticket cannot block itself');
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${ticketId} not found`);

    const blocker = await this.ticketRepo.findOne({ where: { id: blockerId, isDeleted: false } });
    if (!blocker) throw new NotFoundException(`Ticket with id ${blockerId} not found`);

    // Dependencies across projects are not meaningful — tickets are scoped to a project
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

  /**
   * Returns all blockers for a ticket as a lightweight list of { id, title, status }.
   * Soft-deleted blockers are excluded from the response.
   *
   * @param ticketId - The ticket whose blockers to retrieve
   * @returns Array of blocking tickets with their current status
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
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

  /**
   * Removes a blocking dependency between two tickets.
   * The dependency row is hard-deleted from the junction table — no soft delete needed.
   *
   * @param ticketId - The blocked ticket
   * @param blockerId - The blocking ticket to remove
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the dependency does not exist
   */
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

  /**
   * Detects whether adding a new dependency would create a circular chain.
   * Uses BFS starting from the proposed blocker, following existing
   * "is blocked by" edges (TicketDependency.ticketId → blockerId).
   * If the BFS reaches the original ticketId, a cycle would be formed.
   *
   * Example: existing chain is A blocked by B. Adding B blocked by A
   * would create A → B → A. BFS from A finds B, then finds A again → cycle.
   *
   * @param ticketId - The ticket that would be blocked
   * @param newBlockerId - The proposed new blocker
   * @returns true if adding the dependency would create a cycle
   */
  private async wouldCreateCycle(ticketId: number, newBlockerId: number): Promise<boolean> {
    const visited = new Set<number>();
    const queue: number[] = [newBlockerId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === ticketId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      // Follow outgoing "is blocked by" edges from the current node
      const deps = await this.depRepo.find({ where: { ticketId: current } });
      for (const dep of deps) {
        queue.push(dep.blockerId);
      }
    }

    return false;
  }
}
