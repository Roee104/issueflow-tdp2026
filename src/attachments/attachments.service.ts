import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { unlinkSync } from 'fs';
import { Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ticket } from '../tickets/ticket.entity';
import { Attachment } from './attachment.entity';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async upload(ticketId: number, file: Express.Multer.File, performedBy: number) {
    if (file.size > MAX_FILE_SIZE) {
      this.deleteFile(file.path);
      throw new BadRequestException('File size must not exceed 10 MB');
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) {
      this.deleteFile(file.path);
      throw new NotFoundException(`Ticket with id ${ticketId} not found`);
    }

    const attachment = this.attachmentRepo.create({
      ticketId,
      filename: file.originalname,
      contentType: file.mimetype,
      filePath: file.path,
    });

    const saved = await this.attachmentRepo.save(attachment);
    await this.auditLogsService.log({
      action: AuditAction.UPLOAD_ATTACHMENT,
      entityType: AuditEntityType.TICKET,
      entityId: ticketId,
      performedBy,
      actor: AuditActor.USER,
    });

    return this.toResponse(saved);
  }

  async remove(ticketId: number, attachmentId: number, performedBy: number): Promise<void> {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId, ticketId },
    });
    if (!attachment) throw new NotFoundException(`Attachment with id ${attachmentId} not found`);

    this.deleteFile(attachment.filePath);
    await this.attachmentRepo.delete(attachmentId);
    await this.auditLogsService.log({
      action: AuditAction.DELETE_ATTACHMENT,
      entityType: AuditEntityType.TICKET,
      entityId: ticketId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  private deleteFile(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch {}
  }

  private toResponse(attachment: Attachment) {
    return {
      id: attachment.id,
      ticketId: attachment.ticketId,
      filename: attachment.filename,
      contentType: attachment.contentType,
    };
  }
}
