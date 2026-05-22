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

  async updateMentions(commentId: number, content: string): Promise<void> {
    await this.mentionRepo.delete({ commentId });
    await this.saveMentions(commentId, content);
  }

  async getMentionedUsers(
    commentId: number,
  ): Promise<{ id: number; username: string; fullName: string }[]> {
    const mentions = await this.mentionRepo.find({ where: { commentId } });
    if (mentions.length === 0) return [];

    const userIds = mentions.map((m) => m.userId);
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    return users.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName }));
  }

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

  private parseUsernames(content: string): string[] {
    const matches = content.match(/@(\w+)/g) ?? [];
    const usernames = matches.map((m) => m.slice(1));
    return [...new Set(usernames)];
  }
}
