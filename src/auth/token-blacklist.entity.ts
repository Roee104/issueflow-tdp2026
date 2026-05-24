/**
 * Entity representing an invalidated JWT token.
 * Used to implement server-side logout — tokens added here are rejected
 * by JwtAuthGuard even if they have not yet naturally expired.
 *
 * The token column is indexed for fast lookups on every authenticated request.
 * Expired entries are cleaned up daily by AuthService.cleanupBlacklist().
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('token_blacklist')
export class TokenBlacklist {
  @PrimaryGeneratedColumn()
  id: number;

  /** The raw JWT string. Indexed for O(1) blacklist lookups on every request. */
  @Index()
  @Column({ type: 'text' })
  token: string;

  /** The token's natural expiry — used by the cleanup cron to prune stale entries. */
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
