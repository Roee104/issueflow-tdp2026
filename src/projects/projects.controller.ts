/**
 * Controller for project endpoints.
 * Projects are the top-level container for tickets.
 *
 * Route ordering is intentional — static segments ('deleted') are declared
 * before parameterized segments (':projectId') to prevent NestJS from
 * capturing 'deleted' as a projectId value.
 *
 * ADMIN-only endpoints (deleted list, restore) are protected by RolesGuard
 * applied per-endpoint on top of the global JwtAuthGuard.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Returns all soft-deleted projects. ADMIN only.
   * Declared before GET /:projectId to prevent 'deleted' being captured as a projectId.
   */
  @Get('deleted')
  @UseGuards(RolesGuard)
  findDeleted() {
    return this.projectsService.findDeleted();
  }

  /** Returns all active (non-deleted) projects. */
  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  /**
   * Returns a single active project by ID.
   *
   * @param projectId - The project to retrieve
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  @Get(':projectId')
  findOne(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projectsService.findById(projectId);
  }

  /**
   * Returns the workload summary for all developers linked to this project.
   * Each entry contains { userId, username, openTicketCount } sorted by
   * openTicketCount ASC, with userId ASC as a tie-breaker.
   *
   * @param projectId - The project to retrieve workload for
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  @Get(':projectId/workload')
  getWorkload(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projectsService.getWorkload(projectId);
  }

  /**
   * Creates a new project.
   *
   * @param dto - Project name, description, and ownerId
   * @param user - The authenticated user (for audit logging)
   * @returns The created project
   * @throws BadRequestException if ownerId does not reference a valid user
   */
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: { userId: number }) {
    return this.projectsService.create(dto, user.userId);
  }

  /**
   * Updates a project's name and/or description.
   *
   * @param projectId - The project to update
   * @param dto - Fields to update (all optional)
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is soft-deleted
   */
  @Patch(':projectId')
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.projectsService.update(projectId, dto, user.userId);
  }

  /**
   * Soft-deletes a project and cascades to all its tickets and their comments.
   *
   * @param projectId - The project to soft-delete
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is already soft-deleted
   */
  @Delete(':projectId')
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.projectsService.remove(projectId, user.userId);
  }

  /**
   * Restores a soft-deleted project and cascades to restore its tickets and comments.
   * Returns 200 (not 201) — this is not a resource creation.
   * ADMIN only.
   *
   * @param projectId - The soft-deleted project to restore
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the project does not exist or is not soft-deleted
   */
  @Post(':projectId/restore')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.projectsService.restore(projectId, user.userId);
  }
}
