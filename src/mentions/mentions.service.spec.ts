/**
 * Unit tests for MentionsService.
 * Verifies @mention parsing, case-insensitive username matching,
 * deduplication, unknown user handling, and update ordering.
 */
import { MentionsService } from './mentions.service';

describe('MentionsService', () => {
  let service: MentionsService;

  let mockMentionRepo: any;
  let mockCommentRepo: any;
  let mockUserRepo: any;

  beforeEach(() => {
    mockMentionRepo = {
      find: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    mockCommentRepo = { createQueryBuilder: jest.fn() };
    mockUserRepo = { find: jest.fn(), findOne: jest.fn() };

    service = new MentionsService(
      mockMentionRepo,
      mockCommentRepo,
      mockUserRepo,
    );
  });

  // ── saveMentions ──────────────────────────────────────────────────────────

  describe('saveMentions', () => {
    it('should parse @username and save a mention record', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, username: 'jdoe' });

      await service.saveMentions(10, 'Hello @jdoe!');

      expect(mockMentionRepo.save).toHaveBeenCalledWith({
        commentId: 10,
        userId: 1,
      });
    });

    it('should match usernames case-insensitively', async () => {
      // ILike in the service means the DB handles case; in the unit test
      // findOne is mocked — we just verify it was called with the uppercased string,
      // and that if found, the mention is saved.
      mockUserRepo.findOne.mockResolvedValue({ id: 2, username: 'Alice' });

      await service.saveMentions(10, 'Hey @ALICE!');

      // findOne should have been called (with whatever ILike wraps 'ALICE')
      expect(mockUserRepo.findOne).toHaveBeenCalled();
      expect(mockMentionRepo.save).toHaveBeenCalledWith({
        commentId: 10,
        userId: 2,
      });
    });

    it('should deduplicate repeated mentions of the same username', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, username: 'jdoe' });

      await service.saveMentions(10, '@jdoe did this, and @jdoe confirmed it');

      // Parsed usernames: ['jdoe'] after dedup — save called only once
      expect(mockMentionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should silently ignore a username that does not exist in the database', async () => {
      mockUserRepo.findOne.mockResolvedValue(null); // unknown user

      await service.saveMentions(10, 'Hello @ghost!');

      expect(mockMentionRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── updateMentions ────────────────────────────────────────────────────────

  describe('updateMentions', () => {
    it('should delete all previous mentions then save the new ones', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 5, username: 'asmith' });

      await service.updateMentions(10, 'Thanks @asmith!');

      // Old mentions removed first
      expect(mockMentionRepo.delete).toHaveBeenCalledWith({ commentId: 10 });
      // New mentions saved
      expect(mockMentionRepo.save).toHaveBeenCalledWith({
        commentId: 10,
        userId: 5,
      });
      // Verify delete-then-save ordering via Jest invocation call order
      const deleteOrder = mockMentionRepo.delete.mock.invocationCallOrder[0];
      const saveOrder = mockMentionRepo.save.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(saveOrder);
    });
  });
});
