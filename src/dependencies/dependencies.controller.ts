/**
 * Controller for ticket dependency endpoints scoped to a specific ticket.
 * Dependencies define blocking relationships between tickets — a ticket cannot
 * transition to DONE while it has unresolved blockers.
 *
 * All routes are nested under /tickets/:ticketId/dependencies.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DependenciesService } from './dependencies.service';
import { AddDependencyDto } from './dto/add-dependency.dto';

@Controller('tickets/:ticketId/dependencies')
export class DependenciesController {
  constructor(private readonly dependenciesService: DependenciesService) {}

  /**
   * Returns all blockers for the given ticket as a list of { id, title, status }.
   *
   * @param ticketId - The ticket whose blockers to retrieve
   * @returns Array of blocking tickets with their current status
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  @Get()
  findAll(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.dependenciesService.findAll(ticketId);
  }

  /**
   * Adds a blocking dependency — the target ticket cannot reach DONE until
   * the blocker ticket is DONE. Returns 200 (not 201) as this is not
   * a resource creation in the REST sense.
   *
   * @param ticketId - The ticket to block
   * @param dto - Contains the ID of the blocking ticket
   * @param user - The authenticated user (for audit logging)
   * @throws BadRequestException if the dependency is self-referential, cross-project,
   *   duplicate, or would create a circular dependency
   */
  @Post()
  @HttpCode(200)
  add(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: AddDependencyDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.dependenciesService.add(ticketId, dto.blockedBy, user.userId);
  }

  /**
   * Removes a blocking dependency between two tickets.
   *
   * @param ticketId - The blocked ticket
   * @param blockerId - The blocking ticket to remove
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the dependency does not exist
   */
  @Delete(':blockerId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockerId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.dependenciesService.remove(ticketId, blockerId, user.userId);
  }
}
