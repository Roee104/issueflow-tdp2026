/**
 * Entity representing a project — the top-level container for tickets.
 * Projects support soft delete: deleting a project cascades to soft-delete
 * all its tickets and their comments. Restore reverses this cascade.
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  description: string;

  /** The user who owns this project. */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  @Column()
  ownerId: number;

  /** Soft delete flag — true means the project is hidden from standard API responses. */
  @Column({ default: false })
  isDeleted: boolean;

  /** Set when the project is soft-deleted. Null for active projects. */
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
