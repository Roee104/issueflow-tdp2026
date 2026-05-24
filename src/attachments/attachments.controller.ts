/**
 * Controller for file attachment endpoints scoped to a specific ticket.
 * Handles multipart file uploads with MIME type validation via Multer,
 * and physical file deletion when an attachment is removed.
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';

/** MIME types permitted for upload — all others are rejected with 400. */
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];

/**
 * Multer configuration for disk-based file storage.
 * Files are saved to ./uploads/ with a UUID-prefixed name to prevent
 * collisions when multiple users upload files with the same original name.
 * MIME type validation is applied in the fileFilter before the file is written to disk.
 */
const multerOptions = {
  storage: diskStorage({
    destination: './uploads',
    // Prefix with UUID to guarantee uniqueness regardless of original filename
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          `File type '${file.mimetype}' is not allowed. Allowed types: image/png, image/jpeg, application/pdf, text/plain`,
        ),
        false,
      );
    }
  },
};

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  /**
   * Uploads a file and attaches it to the specified ticket.
   * MIME type is validated by Multer before reaching this handler.
   * File size (10 MB max) is validated in the service after upload.
   *
   * @param ticketId - The ticket to attach the file to
   * @param file - The uploaded file processed by Multer
   * @param user - The authenticated user performing the upload
   * @returns The created attachment metadata
   * @throws BadRequestException if no file is provided or file exceeds size limit
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: number },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.attachmentsService.upload(ticketId, file, user.userId);
  }

  /**
   * Deletes an attachment — removes both the database record and the physical file.
   *
   * @param ticketId - The ticket the attachment belongs to
   * @param attachmentId - The attachment to delete
   * @param user - The authenticated user performing the deletion
   * @throws NotFoundException if the attachment does not exist or belongs to a different ticket
   */
  @Delete(':attachmentId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.attachmentsService.remove(ticketId, attachmentId, user.userId);
  }
}
