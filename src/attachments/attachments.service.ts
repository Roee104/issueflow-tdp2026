/**
 * Service handling file attachment lifecycle for tickets.
 * Files are stored on the filesystem under ./uploads/ — this service manages
 * both the database metadata and the physical files, ensuring they stay in sync.
 * If a validation check fails after a file has been written to disk, the file
 * is deleted before the error is thrown to prevent orphaned files.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { unlinkSync } from 'fs';
import { Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ticket } from '../tickets/ticket.entity';
import { Attachment } from './attachment.entity';

/** Maximum allowed file size in bytes (10 MB). */
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

  /**
   * Saves an uploaded file to the database and records the audit event.
   * Size is validated after Multer writes the file to disk — if it fails,
   * the file is deleted before throwing to avoid leaving orphaned files.
   *
   * @param ticketId - The ticket to attach the file to
   * @param file - The Multer file object containing path, size, and MIME type
   * @param performedBy - The ID of the user performing the upload
   * @returns The created attachment metadata (without filePath)
   * @throws BadRequestException if the file exceeds 10 MB
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  async upload(ticketId: number, file: Express.Multer.File, performedBy: number) {
    // Size check happens after Multer writes to disk — delete the file if it fails
    if (file.size > MAX_FILE_SIZE) {
      this.deleteFile(file.path);
      throw new BadRequestException('File size must not exceed 10 MB');
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) {
      // Delete the already-written file to prevent orphaned uploads
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

  /**
   * Deletes an attachment — removes both the physical file and the database record.
   * The ticketId is included in the lookup to prevent cross-ticket access.
   *
   * @param ticketId - The ticket the attachment belongs to
   * @param attachmentId - The attachment to delete
   * @param performedBy - The ID of the user performing the deletion
   * @throws NotFoundException if the attachment does not exist or belongs to a different ticket
   */
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

  /**
   * Safely deletes a file from the filesystem.
   * Errors are silently swallowed — a missing file should not prevent
   * the database record from being cleaned up.
   *
   * @param filePath - The absolute path to the file to delete
   */
  private deleteFile(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch {}
  }

  /**
   * Maps an Attachment entity to the public API response shape.
   * filePath is intentionally excluded — it is an internal server detail.
   */
  private toResponse(attachment: Attachment) {
    return {
      id: attachment.id,
      ticketId: attachment.ticketId,
      filename: attachment.filename,
      contentType: attachment.contentType,
    };
  }
}
