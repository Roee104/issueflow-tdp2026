/**
 * Service handling all comment operations including creation, updates,
 * soft deletion, and @mention parsing.
 *
 * Every operation validates the parent ticket first — if the ticket is
 * soft-deleted or does not exist, the operation is rejected with 404.
 *
 * Comment updates use pessimistic locking (SELECT FOR UPDATE) to prevent
 * two users from editing the same comment simultaneously.
 *
 * @mention parsing runs after every create and update — newly added mentions
 * are saved and removed mentions are deleted on each update.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AuditAction,
  AuditActor,
  AuditEntityType,
} from '../audit-logs/audit-log.entity';
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

  /**
   * Returns all non-deleted comments for a ticket, each with their mentionedUsers populated.
   * Promise.all is used to fetch mentions for all comments concurrently.
   *
   * @param ticketId - The ticket whose comments to retrieve
   * @returns Array of comment response objects with mentionedUsers
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  async findAllByTicket(ticketId: number) {
    await this.validateTicket(ticketId);
    const comments = await this.commentRepo.find({
      where: { ticketId, isDeleted: false },
    });
    return Promise.all(
      comments.map(async (c) => {
        const mentionedUsers = await this.mentionsService.getMentionedUsers(
          c.id,
        );
        return this.toResponse(c, mentionedUsers);
      }),
    );
  }

  /**
   * Creates a new comment, parses @mentions from the content, and logs the action.
   * PostgreSQL FK violation (23503) is caught if authorId does not reference a valid user.
   *
   * @param ticketId - The ticket to comment on
   * @param dto - The comment data including authorId and content
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @returns The created comment with mentionedUsers populated
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   * @throws BadRequestException if the authorId does not reference a valid user
   */
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
      const mentionedUsers = await this.mentionsService.getMentionedUsers(
        saved.id,
      );
      await this.auditLogsService.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.COMMENT,
        entityId: saved.id,
        performedBy,
        actor: AuditActor.USER,
      });
      return this.toResponse(saved, mentionedUsers);
    } catch (err) {
      // PostgreSQL error 23503 = foreign key violation — authorId does not exist
      if (err instanceof QueryFailedError && (err as any).code === '23503') {
        throw new BadRequestException(
          `Author with id ${dto.authorId} does not exist`,
        );
      }
      throw err;
    }
  }

  /**
   * Updates a comment's content using pessimistic locking to prevent concurrent edits.
   * The lock has a 5-second timeout — if another transaction holds the lock longer,
   * PostgreSQL raises error 55P03 which is surfaced as 409 Conflict.
   *
   * @mention re-evaluation runs after the transaction commits — old mentions are
   * deleted and new ones are inserted based on the updated content.
   *
   * @param ticketId - The ticket the comment belongs to (used to prevent cross-ticket access)
   * @param commentId - The comment to update
   * @param dto - The new content
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the comment does not exist or belongs to a different ticket
   * @throws ConflictException if another user is currently editing the same comment
   */
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
      // Limit how long the transaction waits for the lock before failing
      await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

      const comment = await queryRunner.manager.findOne(Comment, {
        where: { id: commentId, ticketId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });

      if (!comment)
        throw new NotFoundException(`Comment with id ${commentId} not found`);

      await queryRunner.manager.update(Comment, commentId, {
        content: dto.content,
      });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      const code = (err as any).code;
      const msg: string = (err as any).message ?? '';
      // PostgreSQL error 55P03 = lock_not_available (lock timeout exceeded)
      if (
        code === '55P03' ||
        msg.includes('canceling statement due to lock timeout')
      ) {
        throw new ConflictException(
          'Comment is currently being updated by another user',
        );
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Re-evaluate mentions after the transaction commits — delete old, insert new
    await this.mentionsService.updateMentions(commentId, dto.content);
    await this.auditLogsService.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.COMMENT,
      entityId: commentId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Soft-deletes a comment — sets isDeleted and deletedAt rather than removing the row.
   * The ticketId is included in the lookup to prevent cross-ticket access.
   *
   * @param ticketId - The ticket the comment belongs to
   * @param commentId - The comment to soft-delete
   * @param performedBy - The ID of the authenticated user (for audit logging)
   * @throws NotFoundException if the comment does not exist or belongs to a different ticket
   */
  async remove(
    ticketId: number,
    commentId: number,
    performedBy: number,
  ): Promise<void> {
    await this.validateTicket(ticketId);

    const comment = await this.commentRepo.findOne({
      where: { id: commentId, ticketId, isDeleted: false },
    });
    if (!comment)
      throw new NotFoundException(`Comment with id ${commentId} not found`);

    await this.commentRepo.update(commentId, {
      isDeleted: true,
      deletedAt: new Date(),
    });
    await this.auditLogsService.log({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.COMMENT,
      entityId: commentId,
      performedBy,
      actor: AuditActor.USER,
    });
  }

  /**
   * Validates that the given ticket exists and is not soft-deleted.
   * Called at the start of every comment operation.
   *
   * @param ticketId - The ticket ID to validate
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  private async validateTicket(ticketId: number): Promise<void> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId, isDeleted: false },
    });
    if (!ticket)
      throw new NotFoundException(`Ticket with id ${ticketId} not found`);
  }

  /**
   * Maps a Comment entity to the public API response shape.
   * mentionedUsers defaults to an empty array if not provided —
   * this signature allows callers to pass pre-fetched mentions without
   * requiring a separate lookup in every code path.
   */
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
