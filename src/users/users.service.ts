/**
 * Service handling user account management including creation, updates, and soft delete.
 *
 * Passwords are hashed with bcrypt (10 rounds) before persistence and are never
 * returned in API responses — toResponse() explicitly excludes the password field.
 *
 * Users are soft-deleted rather than hard-deleted to preserve referential integrity
 * with audit logs, ticket assignments, and comment authorship records.
 * Soft-deleted users cannot authenticate — JwtAuthGuard checks isDeleted on every request.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  AuditAction,
  AuditActor,
  AuditEntityType,
} from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** Returns all active (non-deleted) users in the public response shape (no password). */
  async findAll() {
    const users = await this.userRepo.find({ where: { isDeleted: false } });
    return users.map((u) => this.toResponse(u));
  }

  /**
   * Returns a single active user in the public response shape (no password).
   *
   * @param id - The user ID to retrieve
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  async findById(id: number) {
    const user = await this.userRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    return this.toResponse(user);
  }

  /**
   * Creates a new user with a bcrypt-hashed password.
   * POST /users is public — performedBy defaults to null since no JWT is present.
   * PostgreSQL unique constraint violation (23505) is caught and returned as 409 Conflict.
   *
   * @param dto - User details including plaintext password
   * @param performedBy - The ID of the creating user, or null for self-registration
   * @returns The created user in the public response shape (no password)
   * @throws ConflictException if username or email already exists
   */
  async create(dto: CreateUserDto, performedBy: number | null = null) {
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      password: hashedPassword,
    });
    try {
      const saved = await this.userRepo.save(user);
      await this.auditLogsService.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.USER,
        entityId: saved.id,
        performedBy,
        actor: AuditActor.USER,
      });
      return this.toResponse(saved);
    } catch (err) {
      // PostgreSQL error 23505 = unique_violation — username or email already taken
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Username or email already exists');
      }
      throw err;
    }
  }

  /**
   * Updates a user's fullName and/or role.
   *
   * @param id - The user to update
   * @param dto - Fields to update (all optional)
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  async update(
    id: number,
    dto: UpdateUserDto,
    performedBy: number | null = null,
  ): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    await this.userRepo.update(id, dto);
    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.USER,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Soft-deletes a user by setting isDeleted=true and recording deletedAt.
   * After deletion, the user's JWT token is rejected on the next request
   * by JwtAuthGuard's soft-delete check (findByIdInternal returns null).
   *
   * @param id - The user to soft-delete
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the user does not exist or is already soft-deleted
   */
  async remove(id: number, performedBy: number | null = null): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    await this.userRepo.update(id, { isDeleted: true, deletedAt: new Date() });
    await this.auditLogsService.log({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.USER,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Returns the full User entity including password hash.
   * Used by AuthService.login() to verify credentials via bcrypt.compare().
   * Never used for API responses — use findById() instead.
   *
   * @param username - The username to look up
   * @returns The full User entity, or null if not found or soft-deleted
   */
  async findByUsernameInternal(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username, isDeleted: false } });
  }

  /**
   * Returns the full User entity including password hash.
   * Used by JwtAuthGuard to verify the user is still active on every request.
   * Returns null for soft-deleted users — the guard rejects such requests with 401.
   *
   * @param id - The user ID from the JWT payload
   * @returns The full User entity, or null if not found or soft-deleted
   */
  async findByIdInternal(id: number): Promise<User | null> {
    return this.userRepo.findOne({ where: { id, isDeleted: false } });
  }

  /**
   * Maps a User entity to the public API response shape.
   * Password is intentionally excluded — never exposed via any API endpoint.
   */
  toResponse(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }
}
