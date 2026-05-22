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

  // Static GET routes declared before parameterized :ticketId to prevent shadowing
  @Get('export')
  async export(
    @Query('projectId', ParseIntPipe) projectId: number,
    @Res() res: Response,
  ) {
    const csv = await this.ticketsService.exportToCsv(projectId);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  }

  @Get('deleted')
  @UseGuards(RolesGuard)
  findDeleted(@Query('projectId', ParseIntPipe) projectId: number) {
    return this.ticketsService.findDeleted(projectId);
  }

  // Static POST routes declared before parameterized :ticketId
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

  @Get()
  findAll(@Query('projectId', ParseIntPipe) projectId: number) {
    return this.ticketsService.findAllByProject(projectId);
  }

  @Get(':ticketId')
  findOne(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.ticketsService.findById(ticketId);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: { userId: number }) {
    return this.ticketsService.create(dto, user.userId);
  }

  @Post(':ticketId/restore')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.restore(ticketId, user.userId);
  }

  @Patch(':ticketId')
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.update(ticketId, dto, user.userId);
  }

  @Delete(':ticketId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.ticketsService.remove(ticketId, user.userId);
  }
}
