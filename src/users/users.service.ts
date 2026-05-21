import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
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

  async findAll() {
    const users = await this.userRepo.find({ where: { isDeleted: false } });
    return users.map((u) => this.toResponse(u));
  }

  async findById(id: number) {
    const user = await this.userRepo.findOne({ where: { id, isDeleted: false } });
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    return this.toResponse(user);
  }

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
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Username or email already exists');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateUserDto, performedBy: number | null = null): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id, isDeleted: false } });
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

  async remove(id: number, performedBy: number | null = null): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id, isDeleted: false } });
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

  // Used by AuthService — returns full entity including password hash
  async findByUsernameInternal(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username, isDeleted: false } });
  }

  // Used by AuthService — returns full entity including password hash
  async findByIdInternal(id: number): Promise<User | null> {
    return this.userRepo.findOne({ where: { id, isDeleted: false } });
  }

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
