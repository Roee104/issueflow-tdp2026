import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, AuditActor, AuditEntityType } from '../audit-logs/audit-log.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MentionsService } from '../mentions/mentions.service';
import { Ticket } from '../tickets/ticket.entity';
import { Comment } from './comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
    private readonly mentionsService: MentionsService,
  ) {}

  async findAllByTicket(ticketId: number) {
    await this.validateTicket(ticketId);
    const comments = await this.commentRepo.find({
      where: { ticketId, isDeleted: false },
    });
    return Promise.all(
      comments.map(async (c) => {
        const mentionedUsers = await this.mentionsService.getMentionedUsers(c.id);
        return this.toResponse(c, mentionedUsers);
      }),
    );
  }

  async create(ticketId: number, dto: CreateCommentDto, performedBy: number) {
    await this.validateTicket(ticketId);

    const comment = this.commentRepo.create({
      ticketId,
      authorId: dto.authorId,
      content: dto.content,
    });

    try {
      const saved = await this.commentRepo.save(comment);
      await this.mentionsService.saveMentions(saved.id, dto.content);
      const mentionedUsers = await this.mentionsService.getMentionedUsers(saved.id);
      await this.auditLogsService.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.COMMENT,
        entityId: saved.id,
        performedBy,
        actor: AuditActor.USER,
      });
      return this.toResponse(saved, mentionedUsers);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        throw new BadRequestException(`Author with id ${dto.authorId} does not exist`);
      }
      throw err;
    }
  }

  async update(
    ticketId: number,
    commentId: number,
    dto: UpdateCommentDto,
    performedBy: number,
  ): Promise<void> {
    await this.validateTicket(ticketId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

      const comment = await queryRunner.manager.findOne(Comment, {
        where: { id: commentId, ticketId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });

      if (!comment) throw new NotFoundException(`Comment with id ${commentId} not found`);

      await queryRunner.manager.update(Comment, commentId, { content: dto.content });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      const code = (err as any).code;
      const msg: string = (err as any).message ?? '';
      if (code === '55P03' || msg.includes('canceling statement due to lock timeout')) {
        throw new ConflictException('Comment is currently being updated by another user');
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    await this.mentionsService.updateMentions(commentId, dto.content);
    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.COMMENT,
      entityId: commentId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  async remove(ticketId: number, commentId: number, performedBy: number): Promise<void> {
    await this.validateTicket(ticketId);

    const comment = await this.commentRepo.findOne({
      where: { id: commentId, ticketId, isDeleted: false },
    });
    if (!comment) throw new NotFoundException(`Comment with id ${commentId} not found`);

    await this.commentRepo.update(commentId, { isDeleted: true, deletedAt: new Date() });
    await this.auditLogsService.log({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.COMMENT,
      entityId: commentId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  private async validateTicket(ticketId: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) throw new NotFoundException(`Ticket with id ${ticketId} not found`);
  }

  toResponse(
    comment: Comment,
    mentionedUsers: { id: number; username: string; fullName: string }[] = [],
  ) {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorId: comment.authorId,
      content: comment.content,
      mentionedUsers,
    };
  }
}
