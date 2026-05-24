/**
 * Entity representing a file attached to a ticket.
 * The file itself is stored on the filesystem under the uploads/ directory.
 * This entity stores only the metadata and the path needed to retrieve it.
 *
 * Allowed file types: image/png, image/jpeg, application/pdf, text/plain.
 * Maximum file size: 10 MB — enforced at the service layer before saving.
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  /** The ticket this attachment belongs to. */
  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticketId' })
  @Column()
  ticketId: number;

  /** The original filename as uploaded by the client. */
  @Column()
  filename: string;

  /** The MIME type of the file — validated against the allowed types list before saving. */
  @Column()
  contentType: string;

  /** The absolute path to the file on the server filesystem. Never returned in API responses. */
  @Column()
  filePath: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
