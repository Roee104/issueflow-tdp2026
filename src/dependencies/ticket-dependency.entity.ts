import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity';

@Entity('ticket_dependencies')
export class TicketDependency {
  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticketId' })
  @PrimaryColumn()
  ticketId: number;

  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'blockerId' })
  @PrimaryColumn()
  blockerId: number;
}
