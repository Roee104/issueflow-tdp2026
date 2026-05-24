/**
 * Unit tests for DependenciesService.
 * Verifies all validation rules enforced when adding a ticket dependency:
 * - Self-dependency prevention
 * - Cross-project dependency prevention
 * - Duplicate dependency prevention
 * - Circular dependency detection via BFS
 * - Valid dependency creation and audit logging
 */
import { BadRequestException } from '@nestjs/common';
import { AuditAction, AuditActor } from '../audit-logs/audit-log.entity';
import { DependenciesService } from './dependencies.service';

describe('DependenciesService', () => {
  let service: DependenciesService;

  let mockDepRepo: any;
  let mockTicketRepo: any;
  let mockAuditLogsService: any;

  /** Creates a minimal ticket object for use in mock responses. */
  const makeTicket = (id: number, projectId: number) => ({
    id,
    projectId,
    isDeleted: false,
  });

  beforeEach(() => {
    mockDepRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    mockTicketRepo = { findOne: jest.fn() };
    mockAuditLogsService = { log: jest.fn().mockResolvedValue(undefined) };

    service = new DependenciesService(
      mockDepRepo,
      mockTicketRepo,
      mockAuditLogsService,
    );
  });

  describe('add', () => {
    it('should throw 400 when a ticket tries to block itself', async () => {
      await expect(service.add(1, 1, 1)).rejects.toThrow(BadRequestException);
      // Self-dependency check happens before any DB lookup
      expect(mockTicketRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw 400 when tickets belong to different projects', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket(1, 1))
        .mockResolvedValueOnce(makeTicket(2, 2)); // different project

      await expect(service.add(1, 2, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 for a duplicate dependency', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket(1, 1))
        .mockResolvedValueOnce(makeTicket(2, 1));
      mockDepRepo.findOne.mockResolvedValue({ ticketId: 1, blockerId: 2 }); // already exists

      await expect(service.add(1, 2, 1)).rejects.toThrow(BadRequestException);
      expect(mockDepRepo.save).not.toHaveBeenCalled();
    });

    it('should throw 400 when adding the dependency would create a circular cycle', async () => {
      // Existing: ticket 2 is blocked by ticket 1
      // Adding:   ticket 1 is blocked by ticket 2  → cycle: 1→2→1
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket(1, 1))
        .mockResolvedValueOnce(makeTicket(2, 1));
      mockDepRepo.findOne.mockResolvedValue(null); // no duplicate

      // BFS from blockerId=2: find deps where ticketId=2 → [{ticketId:2, blockerId:1}]
      // Current=2 != ticketId=1, then queue=[1], current=1 == ticketId=1 → cycle
      mockDepRepo.find.mockResolvedValueOnce([{ ticketId: 2, blockerId: 1 }]);

      await expect(service.add(1, 2, 1)).rejects.toThrow(BadRequestException);
      expect(mockDepRepo.save).not.toHaveBeenCalled();
    });

    it('should save a valid dependency and log ADD_DEPENDENCY', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket(1, 1))
        .mockResolvedValueOnce(makeTicket(2, 1));
      mockDepRepo.findOne.mockResolvedValue(null);
      mockDepRepo.find.mockResolvedValue([]); // no existing deps — no cycle
      mockDepRepo.save.mockResolvedValue({ ticketId: 1, blockerId: 2 });

      await expect(service.add(1, 2, 1)).resolves.not.toThrow();

      expect(mockDepRepo.save).toHaveBeenCalledWith({
        ticketId: 1,
        blockerId: 2,
      });
      expect(mockAuditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ADD_DEPENDENCY,
          actor: AuditActor.USER,
          entityId: 1,
        }),
      );
    });
  });
});
