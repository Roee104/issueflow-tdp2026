/**
 * Service handling @mention parsing, storage, retrieval, and user mention feeds.
 *
 * When a comment is created or updated, content is scanned for @username patterns.
 * Each found username is looked up case-insensitively — if the user exists and is
 * not soft-deleted, a mention record is saved. Unknown usernames are silently ignored.
 *
 * On comment update, all existing mentions are deleted and re-parsed from the new
 * content — simpler and safer than diffing old vs new mentions.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { Comment } from '../comments/comment.entity';
import { User } from '../users/user.entity';
import { CommentMention } from './comment-mention.entity';

@Injectable()
export class MentionsService {
  constructor(
    @InjectRepository(CommentMention)
    private readonly mentionRepo: Repository<CommentMention>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Parses @mentions from comment content and saves a mention record for each
   * valid, non-deleted user found. Duplicate mentions of the same username are
   * deduplicated before lookup. Unknown usernames are silently ignored.
   *
   * @param commentId - The comment to associate mentions with
   * @param content - The raw comment content to parse
   */
  async saveMentions(commentId: number, content: string): Promise<void> {
    const usernames = this.parseUsernames(content);
    for (const username of usernames) {
      const user = await this.userRepo.findOne({
        where: { username: ILike(username), isDeleted: false },
      });
      if (user) {
        try {
          await this.mentionRepo.save({ commentId, userId: user.id });
        } catch {}
      }
    }
  }

  /**
   * Re-evaluates all mentions for a comment after its content changes.
   * Deletes all existing mention records first, then re-parses from new content.
   * This delete-then-insert approach is simpler than diffing old vs new mentions.
   *
   * @param commentId - The comment whose mentions to update
   * @param content - The updated comment content to parse
   */
  async updateMentions(commentId: number, content: string): Promise<void> {
    await this.mentionRepo.delete({ commentId });
    await this.saveMentions(commentId, content);
  }

  /**
   * Returns the list of users mentioned in a specific comment.
   * Called on every comment response to populate the mentionedUsers field.
   *
   * @param commentId - The comment to fetch mentioned users for
   * @returns Array of { id, username, fullName } for each mentioned user
   */
  async getMentionedUsers(
    commentId: number,
  ): Promise<{ id: number; username: string; fullName: string }[]> {
    const mentions = await this.mentionRepo.find({ where: { commentId } });
    if (mentions.length === 0) return [];

    const userIds = mentions.map((m) => m.userId);
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    return users.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName }));
  }

  /**
   * Returns a paginated feed of comments in which the given user was @mentioned.
   * Results are ordered newest first. Each comment includes its full mentionedUsers list.
   *
   * @param userId - The user whose mention feed to retrieve
   * @param page - 1-indexed page number
   * @param pageSize - Number of comments per page
   * @returns Paginated result with { data, total, page }
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  async getMentionsForUser(userId: number, page: number, pageSize: number) {
    const user = await this.userRepo.findOne({ where: { id: userId, isDeleted: false } });
    if (!user) throw new NotFoundException(`User with id ${userId} not found`);

    const qb = this.commentRepo
      .createQueryBuilder('comment')
      .innerJoin(CommentMention, 'mention', 'mention.commentId = comment.id')
      .where('mention.userId = :userId', { userId })
      .andWhere('comment.isDeleted = false')
      .orderBy('comment.createdAt', 'DESC');

    const total = await qb.getCount();
    const comments = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const data = await Promise.all(
      comments.map(async (comment) => {
        const mentionedUsers = await this.getMentionedUsers(comment.id);
        return {
          id: comment.id,
          ticketId: comment.ticketId,
          authorId: comment.authorId,
          content: comment.content,
          mentionedUsers,
        };
      }),
    );

    return { data, total, page };
  }

  /**
   * Extracts unique @usernames from comment content using regex.
   * Matches all @word patterns, strips the @ prefix, and deduplicates via Set.
   *
   * @param content - The raw comment content to parse
   * @returns Array of unique lowercase usernames found in the content
   */
  private parseUsernames(content: string): string[] {
    const matches = content.match(/@(\w+)/g) ?? [];
    const usernames = matches.map((m) => m.slice(1));
    return [...new Set(usernames)];
  }
}
