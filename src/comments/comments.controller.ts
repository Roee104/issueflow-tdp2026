/**
 * Controller for comment endpoints scoped to a specific ticket.
 * All routes are nested under /tickets/:ticketId/comments — the ticketId
 * is validated in the service before any comment operation is performed.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Returns all non-deleted comments for the given ticket, each including
   * the list of users mentioned via @username in the comment content.
   *
   * @param ticketId - The ticket whose comments to retrieve
   * @returns Array of comments with mentionedUsers populated
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   */
  @Get()
  findAll(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.commentsService.findAllByTicket(ticketId);
  }

  /**
   * Creates a new comment on the ticket and parses any @mentions in the content.
   *
   * @param ticketId - The ticket to comment on
   * @param dto - The comment content and authorId
   * @param user - The authenticated user (used for audit logging)
   * @returns The created comment with mentionedUsers populated
   * @throws NotFoundException if the ticket does not exist or is soft-deleted
   * @throws BadRequestException if the authorId does not reference a valid user
   */
  @Post()
  create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.commentsService.create(ticketId, dto, user.userId);
  }

  /**
   * Updates the content of a comment using pessimistic locking to prevent
   * simultaneous edits. Re-evaluates @mentions after the update.
   *
   * @param ticketId - The ticket the comment belongs to
   * @param commentId - The comment to update
   * @param dto - The new content
   * @param user - The authenticated user (used for audit logging)
   * @throws NotFoundException if the comment does not exist or belongs to a different ticket
   * @throws ConflictException if another user is currently editing the same comment
   */
  @Patch(':commentId')
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: { userId: number },
  ) {
    return this.commentsService.update(ticketId, commentId, dto, user.userId);
  }

  /**
   * Soft-deletes a comment. The record remains in the database for audit purposes.
   *
   * @param ticketId - The ticket the comment belongs to
   * @param commentId - The comment to delete
   * @param user - The authenticated user (used for audit logging)
   * @throws NotFoundException if the comment does not exist or belongs to a different ticket
   */
  @Delete(':commentId')
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: { userId: number },
  ) {
    return this.commentsService.remove(ticketId, commentId, user.userId);
  }
}
