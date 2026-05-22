import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditActor } from '../audit-logs/audit-log.entity';
import { UserRole } from '../users/user.entity';
import { TicketsEscalationService } from './tickets-escalation.service';
import { TicketPriority, TicketStatus, TicketType } from './ticket.entity';
import { TicketsService } from './tickets.service';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const makeTicket = (overrides: Record<string, any> = {}) => ({
  id: 1,
  title: 'Test ticket',
  description: 'Description',
  status: TicketStatus.TODO,
  priority: TicketPriority.LOW,
  type: TicketType.BUG,
  projectId: 1,
  assigneeId: null,
  dueDate: null,
  isOverdue: false,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

// ─── TicketsService ───────────────────────────────────────────────────────────

describe('TicketsService', () => {
  let service: TicketsService;

  let mockTicketRepo: any;
  let mockCommentRepo: any;
  let mockDepRepo: any;
  let mockUserRepo: any;
  let mockDataSource: any;
  let mockAuditLogsService: any;
  let mockQueryRunner: any;

  beforeEach(() => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest.fn(),
      manager: {
        findOne: jest.fn(),
        find: jest.fn(),
        update: jest.fn(),
      },
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };

    mockTicketRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    mockCommentRepo = { update: jest.fn() };
    mockDepRepo = { find: jest.fn() };
    mockUserRepo = { find: jest.fn() };
    mockDataSource = { createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner) };
    mockAuditLogsService = { log: jest.fn().mockResolvedValue(undefined) };

    service = new TicketsService(
      mockTicketRepo,
      mockCommentRepo,
      mockDepRepo,
      mockUserRepo,
      mockDataSource,
      mockAuditLogsService,
    );
  });

  // ── Status transitions ────────────────────────────────────────────────────

  describe('update – forward status transitions', () => {
    const setupQueryRunner = (currentStatus: TicketStatus, newStatus: TicketStatus) => {
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        makeTicket({ status: currentStatus }),
      );
      if (newStatus === TicketStatus.DONE) {
        mockQueryRunner.manager.find.mockResolvedValueOnce([]); // no blockers
      }
      mockQueryRunner.manager.update.mockResolvedValue(undefined);
    };

    it('should allow TODO → IN_PROGRESS', async () => {
      setupQueryRunner(TicketStatus.TODO, TicketStatus.IN_PROGRESS);
      await expect(
        service.update(1, { status: TicketStatus.IN_PROGRESS }, 1),
      ).resolves.not.toThrow();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should allow IN_PROGRESS → IN_REVIEW', async () => {
      setupQueryRunner(TicketStatus.IN_PROGRESS, TicketStatus.IN_REVIEW);
      await expect(
        service.update(1, { status: TicketStatus.IN_REVIEW }, 1),
      ).resolves.not.toThrow();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should allow IN_REVIEW → DONE when no blockers exist', async () => {
      setupQueryRunner(TicketStatus.IN_REVIEW, TicketStatus.DONE);
      await expect(
        service.update(1, { status: TicketStatus.DONE }, 1),
      ).resolves.not.toThrow();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('update – backward status transitions', () => {
    it('should throw 400 for IN_PROGRESS → TODO (backward)', async () => {
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        makeTicket({ status: TicketStatus.IN_PROGRESS }),
      );
      await expect(
        service.update(1, { status: TicketStatus.TODO }, 1),
      ).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw 400 for DONE → IN_REVIEW (backward, also DONE guard)', async () => {
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        makeTicket({ status: TicketStatus.DONE }),
      );
      await expect(
        service.update(1, { status: TicketStatus.IN_REVIEW }, 1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update – DONE ticket is immutable', () => {
    it('should throw 400 when updating any field on a DONE ticket', async () => {
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        makeTicket({ status: TicketStatus.DONE }),
      );
      await expect(
        service.update(1, { title: 'new title' }, 1),
      ).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('update – DONE transition blocked by unresolved blockers', () => {
    it('should throw 400 when a blocker is not DONE', async () => {
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(makeTicket({ status: TicketStatus.IN_REVIEW }))
        .mockResolvedValueOnce(makeTicket({ id: 2, status: TicketStatus.IN_PROGRESS }));
      mockQueryRunner.manager.find.mockResolvedValueOnce([{ ticketId: 1, blockerId: 2 }]);

      await expect(
        service.update(1, { status: TicketStatus.DONE }, 1),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when all blockers are DONE', async () => {
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(makeTicket({ status: TicketStatus.IN_REVIEW }))
        .mockResolvedValueOnce(makeTicket({ id: 2, status: TicketStatus.DONE }));
      mockQueryRunner.manager.find.mockResolvedValueOnce([{ ticketId: 1, blockerId: 2 }]);
      mockQueryRunner.manager.update.mockResolvedValue(undefined);

      await expect(
        service.update(1, { status: TicketStatus.DONE }, 1),
      ).resolves.not.toThrow();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  // ── Auto-assignment ───────────────────────────────────────────────────────

  describe('create – auto-assignment', () => {
    const baseDto = {
      title: 'T',
      description: 'D',
      status: TicketStatus.TODO,
      priority: TicketPriority.LOW,
      type: TicketType.BUG,
      projectId: 1,
    };

    it('should assign the developer with the lowest workload', async () => {
      mockUserRepo.find.mockResolvedValue([
        { id: 1, username: 'dev1', role: UserRole.DEVELOPER },
        { id: 2, username: 'dev2', role: UserRole.DEVELOPER },
      ]);
      // dev1 has 3 open tickets, dev2 has 1 — dev2 should be chosen
      mockTicketRepo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

      const saved = makeTicket({ id: 1, assigneeId: 2 });
      mockTicketRepo.create.mockReturnValue(saved);
      mockTicketRepo.save.mockResolvedValue(saved);

      const result = await service.create(baseDto, 1);

      expect(result.assigneeId).toBe(2);
      expect(mockAuditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AUTO_ASSIGN, actor: AuditActor.SYSTEM }),
      );
    });

    it('should break ties by lowest developer id', async () => {
      mockUserRepo.find.mockResolvedValue([
        { id: 1, username: 'dev1', role: UserRole.DEVELOPER },
        { id: 2, username: 'dev2', role: UserRole.DEVELOPER },
      ]);
      // Both have the same workload — dev1 (id=1) wins the tie
      mockTicketRepo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(2);

      const saved = makeTicket({ id: 1, assigneeId: 1 });
      mockTicketRepo.create.mockReturnValue(saved);
      mockTicketRepo.save.mockResolvedValue(saved);

      const result = await service.create(baseDto, 1);

      expect(result.assigneeId).toBe(1);
    });

    it('should set assigneeId to null when no developers exist', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const saved = makeTicket({ id: 1, assigneeId: null });
      mockTicketRepo.create.mockReturnValue(saved);
      mockTicketRepo.save.mockResolvedValue(saved);

      const result = await service.create(baseDto, 1);

      expect(result.assigneeId).toBeNull();
      const autoAssignCalls = mockAuditLogsService.log.mock.calls.filter(
        ([args]: any) => args?.action === AuditAction.AUTO_ASSIGN,
      );
      expect(autoAssignCalls).toHaveLength(0);
    });

    it('should not auto-assign when assigneeId is explicitly provided', async () => {
      const saved = makeTicket({ id: 1, assigneeId: 5 });
      mockTicketRepo.create.mockReturnValue(saved);
      mockTicketRepo.save.mockResolvedValue(saved);

      await service.create({ ...baseDto, assigneeId: 5 }, 1);

      expect(mockUserRepo.find).not.toHaveBeenCalled();
    });
  });

  // ── CSV import ────────────────────────────────────────────────────────────

  describe('importFromCsv', () => {
    it('should return partial success — valid rows created, invalid rows collected', async () => {
      const csv = [
        'title,description,status,priority,type,assigneeId',
        'Fix bug,A bug,TODO,LOW,BUG,',
        'Bad row,Desc,NOT_A_STATUS,LOW,BUG,',
      ].join('\n');

      const saved = makeTicket({ id: 10 });
      mockTicketRepo.create.mockReturnValue(saved);
      mockTicketRepo.save.mockResolvedValue(saved);

      const result = await service.importFromCsv(Buffer.from(csv), 1, 1);

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row).toBe(3);
    });

    it('should include the invalid value in the error message for bad enum', async () => {
      const csv = [
        'title,description,status,priority,type,assigneeId',
        'T,D,BOGUS_STATUS,LOW,BUG,',
      ].join('\n');

      const result = await service.importFromCsv(Buffer.from(csv), 1, 1);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain('BOGUS_STATUS');
    });
  });

  // ── Soft delete cascade ───────────────────────────────────────────────────

  describe('remove – soft delete cascade', () => {
    it('should soft delete ticket comments before soft deleting the ticket', async () => {
      mockTicketRepo.findOne.mockResolvedValue(makeTicket());
      mockCommentRepo.update.mockResolvedValue(undefined);
      mockTicketRepo.update.mockResolvedValue(undefined);

      await service.remove(1, 1);

      expect(mockCommentRepo.update).toHaveBeenCalledWith(
        { ticketId: 1, isDeleted: false },
        expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      );
      expect(mockTicketRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
      );
    });
  });
});

// ─── TicketsEscalationService ─────────────────────────────────────────────────

describe('TicketsEscalationService', () => {
  let escalationService: TicketsEscalationService;
  let mockTicketRepo: any;
  let mockAuditLogsService: any;

  beforeEach(() => {
    mockTicketRepo = { find: jest.fn(), update: jest.fn() };
    mockAuditLogsService = { log: jest.fn().mockResolvedValue(undefined) };

    escalationService = new TicketsEscalationService(
      mockTicketRepo,
      mockAuditLogsService,
    );
  });

  it('should escalate LOW → MEDIUM', async () => {
    mockTicketRepo.find.mockResolvedValue([makeTicket({ priority: TicketPriority.LOW })]);
    mockTicketRepo.update.mockResolvedValue(undefined);

    await escalationService.escalate();

    expect(mockTicketRepo.update).toHaveBeenCalledWith(1, { priority: TicketPriority.MEDIUM });
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ESCALATE, actor: AuditActor.SYSTEM, performedBy: null }),
    );
  });

  it('should escalate MEDIUM → HIGH', async () => {
    mockTicketRepo.find.mockResolvedValue([makeTicket({ priority: TicketPriority.MEDIUM })]);
    mockTicketRepo.update.mockResolvedValue(undefined);

    await escalationService.escalate();

    expect(mockTicketRepo.update).toHaveBeenCalledWith(1, { priority: TicketPriority.HIGH });
  });

  it('should escalate HIGH → CRITICAL and set isOverdue=true', async () => {
    mockTicketRepo.find.mockResolvedValue([makeTicket({ priority: TicketPriority.HIGH })]);
    mockTicketRepo.update.mockResolvedValue(undefined);

    await escalationService.escalate();

    expect(mockTicketRepo.update).toHaveBeenCalledWith(1, {
      priority: TicketPriority.CRITICAL,
      isOverdue: true,
    });
  });

  it('should skip CRITICAL tickets (idempotent — never escalate further)', async () => {
    mockTicketRepo.find.mockResolvedValue([makeTicket({ priority: TicketPriority.CRITICAL })]);

    await escalationService.escalate();

    expect(mockTicketRepo.update).not.toHaveBeenCalled();
    expect(mockAuditLogsService.log).not.toHaveBeenCalled();
  });

  it('should make no updates when query returns empty (DONE and null-dueDate tickets excluded)', async () => {
    mockTicketRepo.find.mockResolvedValue([]);

    await escalationService.escalate();

    expect(mockTicketRepo.update).not.toHaveBeenCalled();
    expect(mockAuditLogsService.log).not.toHaveBeenCalled();
  });

  it('should pass status and dueDate filters in the find query', async () => {
    mockTicketRepo.find.mockResolvedValue([]);

    await escalationService.escalate();

    const [[findArg]] = mockTicketRepo.find.mock.calls;
    // Not(DONE) is a FindOperator — truthy, not a plain string
    expect(findArg.where.status).toBeTruthy();
    expect(findArg.where.status).not.toBe(TicketStatus.DONE);
    // LessThan(now) is a FindOperator — truthy, not null/undefined
    expect(findArg.where.dueDate).toBeTruthy();
    expect(findArg.where.isDeleted).toBe(false);
  });
});
