/**
 * Unit tests for ProjectsService.
 * Verifies cascade soft delete and cascade restore behavior:
 * - Deleting a project soft-deletes all its tickets and their comments
 * - Deleting a project with no tickets still soft-deletes the project
 * - Restoring a project restores all its tickets and their comments
 * - Restoring a non-deleted project throws 404
 */
import { NotFoundException } from '@nestjs/common';
import { AuditAction, AuditActor } from '../audit-logs/audit-log.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;

  let mockProjectRepo: any;
  let mockTicketRepo: any;
  let mockCommentRepo: any;
  let mockUserRepo: any;
  let mockAuditLogsService: any;

  /** Creates a minimal project object for use in mock responses. */
  const makeProject = (overrides: Record<string, any> = {}) => ({
    id: 1,
    name: 'Project Alpha',
    description: 'Test project',
    ownerId: 1,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    mockProjectRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    mockTicketRepo = { find: jest.fn(), update: jest.fn() };
    mockCommentRepo = { update: jest.fn() };
    mockUserRepo = { find: jest.fn() };
    mockAuditLogsService = { log: jest.fn().mockResolvedValue(undefined) };

    service = new ProjectsService(
      mockProjectRepo,
      mockTicketRepo,
      mockCommentRepo,
      mockUserRepo,
      mockAuditLogsService,
    );
  });

  // ── Soft delete cascade ───────────────────────────────────────────────────

  describe('remove – cascade soft delete', () => {
    it('should soft delete all tickets and their comments when a project is deleted', async () => {
      mockProjectRepo.findOne.mockResolvedValue(makeProject());

      // Two tickets belong to this project
      const tickets = [{ id: 10 }, { id: 11 }];
      mockTicketRepo.find.mockResolvedValue(tickets);
      mockTicketRepo.update.mockResolvedValue(undefined);
      mockCommentRepo.update.mockResolvedValue(undefined);
      mockProjectRepo.update.mockResolvedValue(undefined);

      await service.remove(1, 1);

      // Comments of both tickets should be soft-deleted
      expect(mockCommentRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      );

      // All non-deleted tickets of the project should be soft-deleted
      expect(mockTicketRepo.update).toHaveBeenCalledWith(
        { projectId: 1, isDeleted: false },
        expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      );

      // The project itself should be soft-deleted
      expect(mockProjectRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      );

      expect(mockAuditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.DELETE, actor: AuditActor.USER }),
      );
    });

    it('should still soft delete the project even if it has no tickets', async () => {
      mockProjectRepo.findOne.mockResolvedValue(makeProject());
      mockTicketRepo.find.mockResolvedValue([]); // no tickets
      mockProjectRepo.update.mockResolvedValue(undefined);

      await service.remove(1, 1);

      // No comments to cascade to — commentRepo should not be called
      expect(mockCommentRepo.update).not.toHaveBeenCalled();
      expect(mockProjectRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isDeleted: true }),
      );
    });
  });

  // ── Restore cascade ───────────────────────────────────────────────────────

  describe('restore – cascade restore', () => {
    it('should restore all tickets and their comments when a project is restored', async () => {
      mockProjectRepo.findOne.mockResolvedValue(makeProject({ isDeleted: true }));

      const tickets = [{ id: 10 }, { id: 11 }];
      mockTicketRepo.find.mockResolvedValue(tickets);
      mockTicketRepo.update.mockResolvedValue(undefined);
      mockCommentRepo.update.mockResolvedValue(undefined);
      mockProjectRepo.update.mockResolvedValue(undefined);

      await service.restore(1, 1);

      // Comments of the restored tickets should be un-deleted
      expect(mockCommentRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isDeleted: false, deletedAt: null }),
      );

      // All deleted tickets of the project should be restored
      expect(mockTicketRepo.update).toHaveBeenCalledWith(
        { projectId: 1, isDeleted: true },
        expect.objectContaining({ isDeleted: false, deletedAt: null }),
      );

      // The project itself should be restored
      expect(mockProjectRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isDeleted: false, deletedAt: null }),
      );

      expect(mockAuditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.RESTORE, actor: AuditActor.USER }),
      );
    });

    it('should throw 404 when trying to restore a project that is not deleted', async () => {
      mockProjectRepo.findOne.mockResolvedValue(null); // not found among deleted

      await expect(service.restore(999, 1)).rejects.toThrow(NotFoundException);
      expect(mockTicketRepo.update).not.toHaveBeenCalled();
    });
  });
});
