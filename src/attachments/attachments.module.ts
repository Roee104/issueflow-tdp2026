/**
 * Attachments module — handles file uploads and deletions for tickets.
 * Imports the Ticket entity directly to validate ticket existence
 * without creating a dependency on TicketsModule.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/ticket.entity';
import { Attachment } from './attachment.entity';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment, Ticket])],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
