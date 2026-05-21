import { Entity, PrimaryColumn } from 'typeorm';

@Entity('ticket_dependencies')
export class TicketDependency {
  @PrimaryColumn()
  ticketId: number;

  @PrimaryColumn()
  blockerId: number;
}
