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

  async findAll() {
    const projects = await this.projectRepo.find({ where: { isDeleted: false } });
    return projects.map((p) => this.toResponse(p));
  }

  async findById(id: number) {
    const project = await this.projectRepo.findOne({ where: { id, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${id} not found`);
    return this.toResponse(project);
  }

  async findDeleted() {
    const projects = await this.projectRepo.find({ where: { isDeleted: true } });
    return projects.map((p) => this.toResponse(p));
  }

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
        throw new BadRequestException(`Owner with id ${dto.ownerId} does not exist`);
      }
      throw err;
    }
  }

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

  async getWorkload(projectId: number) {
    const project = await this.projectRepo.findOne({ where: { id: projectId, isDeleted: false } });
    if (!project) throw new NotFoundException(`Project with id ${projectId} not found`);

    // Load assigneeId + status for all non-deleted tickets in the project
    const tickets = await this.ticketRepo.find({
      where: { projectId, isDeleted: false },
      select: ['assigneeId', 'status'],
    });

    // Build a set of linked users and a map of open ticket counts
    const assigneeIds = new Set<number>();
    const openCounts = new Map<number, number>();

    for (const ticket of tickets) {
      if (ticket.assigneeId === null) continue;
      assigneeIds.add(ticket.assigneeId);
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
      openTicketCount: openCounts.get(u.id) ?? 0,
    }));

    // Primary sort: openTicketCount ASC; secondary: userId ASC for determinism
    workload.sort((a, b) => a.openTicketCount - b.openTicketCount || a.userId - b.userId);

    return workload;
  }

  private toResponse(project: Project) {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.ownerId,
    };
  }
}
