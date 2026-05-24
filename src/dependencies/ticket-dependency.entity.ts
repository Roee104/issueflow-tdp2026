/**
 * Junction entity representing a blocking dependency between two tickets.
 * Uses a composite primary key (ticketId + blockerId) — no surrogate key needed
 * since each pair can only have one dependency in each direction.
 *
 * Semantics: the ticket identified by ticketId cannot transition to DONE
 * until the ticket identified by blockerId is DONE.
 *
 * Both columns reference the same Ticket entity — this is a self-referencing
 * many-to-many relationship on the tickets table.
 */
import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity';

@Entity('ticket_dependencies')
export class TicketDependency {
  /** The ticket that is blocked — cannot reach DONE until its blocker is DONE. */
  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticketId' })
  @PrimaryColumn()
  ticketId: number;

  /** The ticket that blocks — must be DONE before the dependent ticket can proceed. */
  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'blockerId' })
  @PrimaryColumn()
  blockerId: number;
}
