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

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];

const multerOptions = {
  storage: diskStorage({
    destination: './uploads',
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

  @Delete(':attachmentId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.attachmentsService.remove(ticketId, attachmentId, user.userId);
  }
}
