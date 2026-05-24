/**
 * Service managing project lifecycle including CRUD, soft delete with cascade,
 * restore with cascade, and developer workload aggregation.
 *
 * Cascade behavior:
 * - Soft deleting a project → soft deletes all its tickets → soft deletes all their comments
 * - Restoring a project → restores all its soft-deleted tickets → restores all their comments
 *
 * Ticket and Comment repositories are injected directly to handle the cascade
 * without creating circular dependencies on TicketsModule or CommentsModule.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Comment } from '../comments/comment.entity';
import { Ticket, TicketStatus } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** Returns all active (non-deleted) projects. */
  async findAll() {
    const projects = await this.projectRepo.find({ where: { isDeleted: false } });
    return projects.map((p) => this.toResponse(p));
  }

  /**
   * Returns a single active project by ID.
   *
   * @param id - The project ID to retrieve
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  async findById(id: number) {
    const project = await this.projectRepo.findOne({ where: { id, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${id} not found`);
    return this.toResponse(project);
  }

  /** Returns all soft-deleted projects. Used by the ADMIN-only deleted list endpoint. */
  async findDeleted() {
    const projects = await this.projectRepo.find({ where: { isDeleted: true } });
    return projects.map((p) => this.toResponse(p));
  }

  /**
   * Creates a new project.
   * PostgreSQL FK violation (23503) is caught if ownerId does not reference a valid user.
   *
   * @param dto - Project name, description, and ownerId
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @returns The created project
   * @throws BadRequestException if ownerId does not reference a valid user
   */
  async create(dto: CreateProjectDto, performedBy: number) {
    const project = this.projectRepo.create(dto);
    try {
      const saved = await this.projectRepo.save(project);
      await this.auditLogsService.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PROJECT,
        entityId: saved.id,
        performedBy,
        actor: AuditActor.USER,
      });
      return this.toResponse(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        // PostgreSQL error 23503 = foreign key violation — ownerId does not exist
        throw new BadRequestException(`Owner with id ${dto.ownerId} does not exist`);
      }
      throw err;
    }
  }

  /**
   * Updates a project's name and/or description.
   *
   * @param id - The project to update
   * @param dto - Fields to update
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  async update(id: number, dto: UpdateProjectDto, performedBy: number): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${id} not found`);
    await this.projectRepo.update(id, dto);
    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Soft-deletes a project and cascades to all its tickets and their comments.
   * Only IDs are selected when fetching tickets — full entity hydration is not needed.
   *
   * @param id - The project to soft-delete
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is already soft-deleted
   */
  async remove(id: number, performedBy: number): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${id} not found`);

    const now = new Date();

    // Cascade: soft delete all tickets in the project
    const tickets = await this.ticketRepo.find({
      where: { projectId: id, isDeleted: false },
      select: ['id'],
    });
    if (tickets.length > 0) {
      const ticketIds = tickets.map((t) => t.id);
      await this.ticketRepo.update({ projectId: id, isDeleted: false }, { isDeleted: true, deletedAt: now });
      // Cascade: soft delete all comments on those tickets
      await this.commentRepo.update({ ticketId: In(ticketIds) }, { isDeleted: true, deletedAt: now });
    }

    await this.projectRepo.update(id, { isDeleted: true, deletedAt: now });
    await this.auditLogsService.log({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Restores a soft-deleted project and cascades to restore its tickets and comments.
   *
   * @param id - The soft-deleted project to restore
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is not soft-deleted
   */
  async restore(id: number, performedBy: number): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id, isDeleted: true } });
    if (!project) throw new NotFoundException(`Deleted project with id ${id} not found`);

    // Cascade: restore all tickets that belong to this project
    const tickets = await this.ticketRepo.find({
      where: { projectId: id, isDeleted: true },
      select: ['id'],
    });
    if (tickets.length > 0) {
      const ticketIds = tickets.map((t) => t.id);
      await this.ticketRepo.update({ projectId: id, isDeleted: true }, { isDeleted: false, deletedAt: null });
      // Cascade: restore all comments on those tickets
      await this.commentRepo.update({ ticketId: In(ticketIds) }, { isDeleted: false, deletedAt: null });
    }

    await this.projectRepo.update(id, { isDeleted: false, deletedAt: null });
    await this.auditLogsService.log({
      action: AuditAction.RESTORE,
      entityType: AuditEntityType.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Returns the workload summary for all developers linked to this project.
   * A developer is "linked" if they have at least one non-deleted ticket assigned
   * in the project — regardless of whether those tickets are DONE.
   *
   * Uses in-memory aggregation with two DB queries:
   * 1. Load all tickets (assigneeId + status only — lightweight)
   * 2. Fetch user records for all distinct assignees
   *
   * @param projectId - The project to retrieve workload for
   * @returns Array of { userId, username, openTicketCount } sorted by openTicketCount ASC,
   *   then userId ASC as a deterministic tie-breaker
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  async getWorkload(projectId: number) {
    const project = await this.projectRepo.findOne({ where: { id: projectId, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${projectId} not found`);

    // Select only the fields needed for aggregation — avoids full entity hydration
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: false },
      select: ['assigneeId', 'status'],
    });

    // Single pass: build the set of linked developers and count their open tickets
    const assigneeIds = new Set<number>();
    const openCounts = new Map<number, number>();

    for (const ticket of tickets) {
      if (ticket.assigneeId === null) continue;
      assigneeIds.add(ticket.assigneeId);
      // DONE tickets do not count toward open workload
      if (ticket.status !== TicketStatus.DONE) {
        openCounts.set(ticket.assigneeId, (openCounts.get(ticket.assigneeId) ?? 0) + 1);
      }
    }

    if (assigneeIds.size === 0) return [];

    const users = await this.userRepo.find({
      where: { id: In([...assigneeIds]), isDeleted: false },
    });

    const workload = users.map((u) => ({
      userId: u.id,
      username: u.username,
      // Developers with only DONE tickets appear with openTicketCount: 0
      openTicketCount: openCounts.get(u.id) ?? 0,
    }));

    // Primary sort: openTicketCount ASC; secondary: userId ASC for determinism
    workload.sort((a, b) => a.openTicketCount - b.openTicketCount || a.userId - b.userId);

    return workload;
  }

  /** Maps a Project entity to the public API response shape. */
  private toResponse(project: Project) {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.ownerId,
    };
  }
}
