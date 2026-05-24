/**
 * Entity representing a system user.
 * Users support soft delete — deleted users are hidden from API responses
 * but preserved in the database to maintain referential integrity with
 * audit logs, ticket assignments, and comment authorship.
 *
 * The password field stores a bcrypt hash — it is never returned in API responses.
 * Soft-deleted users cannot authenticate — JwtAuthGuard checks isDeleted on every request.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** The two roles in the system — controls access to ADMIN-only endpoints. */
export enum UserRole {
  /** Full access including soft-deleted records and restore operations. */
  ADMIN = 'ADMIN',
  /** Standard access — cannot view deleted records or perform restore operations. */
  DEVELOPER = 'DEVELOPER',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  /** Must be unique across all users — duplicates return 409 Conflict. */
  @Column({ unique: true })
  username: string;

  /** Must be unique across all users — duplicates return 409 Conflict. */
  @Column({ unique: true })
  email: string;

  @Column()
  fullName: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  /** bcrypt hash — never returned in API responses via toResponse(). */
  @Column()
  password: string;

  /** Soft delete flag — true means the user is hidden from standard API responses. */
  @Column({ default: false })
  isDeleted: boolean;

  /** Set when the user is soft-deleted. Null for active users. */
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
