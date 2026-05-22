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

  // Static routes declared before parameterized to avoid route shadowing
  @Get('deleted')
  @UseGuards(RolesGuard)
  findDeleted() {
    return this.projectsService.findDeleted();
  }

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':projectId')
  findOne(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projectsService.findById(projectId);
  }

  @Get(':projectId/workload')
  getWorkload(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projectsService.getWorkload(projectId);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: { userId: number }) {
    return this.projectsService.create(dto, user.userId);
  }

  @Patch(':projectId')
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.projectsService.update(projectId, dto, user.userId);
  }

  @Delete(':projectId')
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.projectsService.remove(projectId, user.userId);
  }

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
