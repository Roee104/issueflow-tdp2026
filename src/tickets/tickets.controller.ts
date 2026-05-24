/**
 * Controller for ticket endpoints.
 * Tickets are the core work items within a project.
 *
 * Route ordering is critical — static segments must be declared before
 * parameterized segments to prevent NestJS from capturing them as ticketId values:
 * - GET 'export' and GET 'deleted' before GET ':ticketId'
 * - POST 'import' before POST ':ticketId/restore' and POST ''
 *
 * ADMIN-only endpoints (deleted list, restore) are protected by RolesGuard
 * applied per-endpoint on top of the global JwtAuthGuard.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * Exports all non-deleted tickets for a project as a CSV file.
   * Uses @Res() to set Content-Type and send raw CSV — bypasses NestJS serialization.
   * Declared first to prevent 'export' being captured as a ticketId.
   *
   * @param projectId - The project whose tickets to export
   * @param res - The Express response object used to send the CSV
   */
  @Get('export')
  async export(
    @Query('projectId', ParseIntPipe) projectId: number,
    @Res() res: Response,
  ) {
    const csv = await this.ticketsService.exportToCsv(projectId);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  }

  /**
   * Returns all soft-deleted tickets for a project. ADMIN only.
   * Declared before GET ':ticketId' to prevent 'deleted' being captured as a ticketId.
   *
   * @param projectId - The project whose deleted tickets to retrieve
   */
  @Get('deleted')
  @UseGuards(RolesGuard)
  findDeleted(@Query('projectId', ParseIntPipe) projectId: number) {
    return this.ticketsService.findDeleted(projectId);
  }

  /**
   * Imports tickets from a CSV file into a project.
   * Uses memoryStorage so the file buffer is available without writing to disk.
   * Returns 200 with a partial success report { created, failed, errors }.
   * Declared before POST '' to maintain correct route ordering.
   *
   * @param file - The uploaded CSV file
   * @param projectId - The project to import tickets into
   * @param user - The authenticated user (for audit logging)
   * @throws BadRequestException if no file is provided or the CSV format is invalid
   */
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  import(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: { userId: number },
  ) {
    if (!file) throw new BadRequestException('No CSV file provided');
    return this.ticketsService.importFromCsv(file.buffer, projectId, user.userId);
  }

  /**
   * Returns all active (non-deleted) tickets for a project.
   *
   * @param projectId - The project whose tickets to retrieve
   */

  @Get()
  findAll(@Query('projectId', ParseIntPipe) projectId: number) {
    return this.ticketsService.findAllByProject(projectId);
  }

  /**
   * Returns a single active ticket by ID.
   *
   * @param ticketId - The ticket to retrieve
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  @Get(':ticketId')
  findOne(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.ticketsService.findById(ticketId);
  }

  /**
   * Creates a new ticket. If assigneeId is omitted, auto-assignment is triggered
   * — the system selects the developer with the lowest open ticket count in the project.
   *
   * @param dto - Ticket details including optional assigneeId
   * @param user - The authenticated user (for audit logging)
   * @returns The created ticket
   */
  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: { userId: number }) {
    return this.ticketsService.create(dto, user.userId);
  }

  /**
   * Restores a soft-deleted ticket and cascades to restore its comments.
   * Returns 200 (not 201) — this is not a resource creation. ADMIN only.
   *
   * @param ticketId - The soft-deleted ticket to restore
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the ticket does not exist or is not soft-deleted
   */
  @Post(':ticketId/restore')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.restore(ticketId, user.userId);
  }

  /**
   * Updates ticket fields using pessimistic locking to prevent concurrent edits.
   * Enforces forward-only status transitions and blocks updates on DONE tickets.
   *
   * @param ticketId - The ticket to update
   * @param dto - Fields to update (all optional)
   * @param user - The authenticated user (for audit logging)
   * @throws BadRequestException for invalid status transitions or DONE ticket updates
   * @throws ConflictException if another user is currently updating the same ticket
   */
  @Patch(':ticketId')
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.update(ticketId, dto, user.userId);
  }

  /**
   * Soft-deletes a ticket and cascades to soft-delete all its comments.
   *
   * @param ticketId - The ticket to soft-delete
   * @param user - The authenticated user (for audit logging)
   * @throws NotFoundException if the ticket does not exist or is already soft-deleted
   */
  @Delete(':ticketId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.remove(ticketId, user.userId);
  }
}
