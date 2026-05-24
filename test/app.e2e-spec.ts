// Must be set before AppModule is imported so ConfigModule reads 'issueflow_test'
// dotenv does not override existing process.env values, so this takes precedence over .env
process.env.DB_NAME = 'issueflow_test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

// ─── Database helpers ──────────────────────────────────────────────────────────

async function cleanDb(ds: DataSource): Promise<void> {
  // Delete in FK-safe order: child tables before parent tables
  await ds.query('DELETE FROM comment_mentions');
  await ds.query('DELETE FROM ticket_dependencies');
  await ds.query('DELETE FROM attachments');
  await ds.query('DELETE FROM comments');
  await ds.query('DELETE FROM audit_logs');
  await ds.query('DELETE FROM token_blacklist');
  await ds.query('DELETE FROM tickets');
  await ds.query('DELETE FROM projects');
  await ds.query('DELETE FROM users');
}

// ─── Request helpers (httpServer set by beforeAll via closure) ─────────────────

let httpServer: any;

const api = () => request(httpServer);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const createUser = async (overrides: Record<string, any> = {}) => {
  const body = {
    username: 'testuser',
    email: 'test@test.com',
    fullName: 'Test User',
    role: 'DEVELOPER',
    password: 'password123',
    ...overrides,
  };
  return (await api().post('/users').send(body)).body;
};

const login = async (
  username: string,
  password = 'password123',
): Promise<string> =>
  (await api().post('/auth/login').send({ username, password })).body
    .accessToken;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('IssueFlow E2E', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    httpServer = app.getHttpServer();
    ds = fixture.get<DataSource>(getDataSourceToken());

    await cleanDb(ds);
  });

  afterAll(async () => {
    await cleanDb(ds);
    await app.close();
  });

  // ── Auth flow ─────────────────────────────────────────────────────────────────

  describe('Auth flow', () => {
    beforeEach(() => cleanDb(ds));

    it('register → login → GET /auth/me returns profile → logout → same token returns 401', async () => {
      // Register
      const user = await createUser({
        username: 'jdoe',
        email: 'jdoe@test.com',
        fullName: 'John Doe',
      });
      expect(user.id).toBeDefined();
      expect(user).not.toHaveProperty('password');

      // Login
      const loginRes = await api()
        .post('/auth/login')
        .send({ username: 'jdoe', password: 'password123' })
        .expect(200);
      const { accessToken } = loginRes.body;
      expect(accessToken).toBeDefined();
      expect(loginRes.body.tokenType).toBe('Bearer');
      expect(loginRes.body.expiresIn).toBe(3600);

      // GET /auth/me
      const meRes = await api()
        .get('/auth/me')
        .set(auth(accessToken))
        .expect(200);
      expect(meRes.body.username).toBe('jdoe');
      expect(meRes.body.role).toBe('DEVELOPER');
      expect(meRes.body).not.toHaveProperty('password');

      // Logout
      await api().post('/auth/logout').set(auth(accessToken)).expect(200);

      // Old token is now blacklisted
      await api().get('/auth/me').set(auth(accessToken)).expect(401);
    });

    it('login with wrong password returns 401', async () => {
      await createUser({ username: 'alice', email: 'alice@test.com' });
      await api()
        .post('/auth/login')
        .send({ username: 'alice', password: 'wrong' })
        .expect(401);
    });

    it('request to protected endpoint without token returns 401', async () => {
      await api().get('/users').expect(401);
    });
  });

  // ── User management ───────────────────────────────────────────────────────────

  describe('User management', () => {
    let adminToken: string;

    beforeEach(async () => {
      await cleanDb(ds);
      await createUser({
        username: 'admin',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
      adminToken = await login('admin');
    });

    it('duplicate username returns 409', async () => {
      await createUser({ username: 'bob', email: 'bob@test.com' });
      const res = await api().post('/users').send({
        username: 'bob',
        email: 'other@test.com',
        fullName: 'Bob 2',
        role: 'DEVELOPER',
        password: 'pass',
      });
      expect(res.status).toBe(409);
    });

    it('invalid role value returns 400', async () => {
      const res = await api().post('/users').send({
        username: 'x',
        email: 'x@x.com',
        fullName: 'X',
        role: 'SUPERUSER',
        password: 'pass',
      });
      expect(res.status).toBe(400);
    });

    it('GET /users response never contains the password field', async () => {
      await createUser({ username: 'dev', email: 'dev@test.com' });
      const res = await api().get('/users').set(auth(adminToken)).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const u of res.body) {
        expect(u).not.toHaveProperty('password');
      }
    });

    it('soft-deleted user token returns 401 on all subsequent requests', async () => {
      const victim = await createUser({
        username: 'victim',
        email: 'victim@test.com',
      });
      const victimToken = await login('victim');

      // Token is valid before deletion
      await api().get('/auth/me').set(auth(victimToken)).expect(200);

      // Admin soft-deletes the user
      await api()
        .delete(`/users/${victim.id}`)
        .set(auth(adminToken))
        .expect(200);

      // Token is now rejected because findByIdInternal filters isDeleted=false
      await api().get('/auth/me').set(auth(victimToken)).expect(401);
    });
  });

  // ── Project lifecycle ─────────────────────────────────────────────────────────

  describe('Project lifecycle', () => {
    let adminToken: string;
    let devToken: string;
    let ownerId: number;

    beforeEach(async () => {
      await cleanDb(ds);
      const admin = await createUser({
        username: 'admin',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
      await createUser({
        username: 'dev',
        email: 'dev@test.com',
        role: 'DEVELOPER',
      });
      ownerId = admin.id;
      adminToken = await login('admin');
      devToken = await login('dev');
    });

    it('create → GET → PATCH → soft delete → gone from list → GET /projects/deleted → restore → visible again', async () => {
      // Create
      const created = (
        await api()
          .post('/projects')
          .set(auth(adminToken))
          .send({ name: 'Alpha', description: 'First project', ownerId })
          .expect(201)
      ).body;
      const projectId = created.id;
      expect(created.name).toBe('Alpha');

      // GET by id
      const got = (
        await api()
          .get(`/projects/${projectId}`)
          .set(auth(adminToken))
          .expect(200)
      ).body;
      expect(got.id).toBe(projectId);

      // PATCH
      await api()
        .patch(`/projects/${projectId}`)
        .set(auth(adminToken))
        .send({ name: 'Alpha Updated' })
        .expect(200);
      expect(
        (await api().get(`/projects/${projectId}`).set(auth(adminToken))).body
          .name,
      ).toBe('Alpha Updated');

      // Soft delete
      await api()
        .delete(`/projects/${projectId}`)
        .set(auth(adminToken))
        .expect(200);

      // Gone from standard list
      const list = (
        await api().get('/projects').set(auth(adminToken)).expect(200)
      ).body;
      expect(list.find((p: any) => p.id === projectId)).toBeUndefined();

      // Visible in deleted list (ADMIN only)
      const deletedList = (
        await api().get('/projects/deleted').set(auth(adminToken)).expect(200)
      ).body;
      expect(deletedList.find((p: any) => p.id === projectId)).toBeDefined();

      // Restore
      await api()
        .post(`/projects/${projectId}/restore`)
        .set(auth(adminToken))
        .expect(200);

      // Visible again in standard list
      const restoredList = (
        await api().get('/projects').set(auth(adminToken)).expect(200)
      ).body;
      expect(restoredList.find((p: any) => p.id === projectId)).toBeDefined();
    });

    it('DEVELOPER cannot access GET /projects/deleted → 403', async () => {
      await api().get('/projects/deleted').set(auth(devToken)).expect(403);
    });

    it('invalid ownerId (non-existent user) returns 400', async () => {
      const res = await api()
        .post('/projects')
        .set(auth(adminToken))
        .send({ name: 'Bad', description: 'Bad', ownerId: 99999 });
      expect(res.status).toBe(400);
    });
  });

  // ── Ticket lifecycle ──────────────────────────────────────────────────────────

  describe('Ticket lifecycle', () => {
    let token: string;
    let projectId: number;
    let userId: number;

    beforeEach(async () => {
      await cleanDb(ds);
      const user = await createUser({
        username: 'dev',
        email: 'dev@test.com',
        role: 'DEVELOPER',
      });
      userId = user.id;
      token = await login('dev');
      const project = (
        await api()
          .post('/projects')
          .set(auth(token))
          .send({ name: 'P', description: 'D', ownerId: userId })
          .expect(201)
      ).body;
      projectId = project.id;
    });

    it('forward transitions TODO→IN_PROGRESS→IN_REVIEW→DONE all succeed', async () => {
      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status: 'TODO',
            priority: 'LOW',
            type: 'BUG',
            projectId,
            assigneeId: userId,
          })
          .expect(201)
      ).body;
      const id = ticket.id;

      await api()
        .patch(`/tickets/${id}`)
        .set(auth(token))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      await api()
        .patch(`/tickets/${id}`)
        .set(auth(token))
        .send({ status: 'IN_REVIEW' })
        .expect(200);
      await api()
        .patch(`/tickets/${id}`)
        .set(auth(token))
        .send({ status: 'DONE' })
        .expect(200);

      const final = (
        await api().get(`/tickets/${id}`).set(auth(token)).expect(200)
      ).body;
      expect(final.status).toBe('DONE');
    });

    it('backward status transition returns 400', async () => {
      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status: 'IN_PROGRESS',
            priority: 'LOW',
            type: 'BUG',
            projectId,
            assigneeId: userId,
          })
          .expect(201)
      ).body;

      await api()
        .patch(`/tickets/${ticket.id}`)
        .set(auth(token))
        .send({ status: 'TODO' })
        .expect(400);
    });

    it('update on a DONE ticket returns 400', async () => {
      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status: 'DONE',
            priority: 'LOW',
            type: 'BUG',
            projectId,
            assigneeId: userId,
          })
          .expect(201)
      ).body;

      await api()
        .patch(`/tickets/${ticket.id}`)
        .set(auth(token))
        .send({ title: 'New title' })
        .expect(400);
    });

    it('ticket created without assigneeId is auto-assigned to the existing developer', async () => {
      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status: 'TODO',
            priority: 'LOW',
            type: 'BUG',
            projectId,
          })
          .expect(201)
      ).body;

      // The only DEVELOPER in the system should be auto-assigned
      expect(ticket.assigneeId).toBe(userId);
    });
  });

  // ── Dependencies ──────────────────────────────────────────────────────────────

  describe('Ticket dependencies', () => {
    let token: string;
    let projectId: number;
    let userId: number;

    const makeTicket = async (status = 'TODO') =>
      (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status,
            priority: 'LOW',
            type: 'BUG',
            projectId,
            assigneeId: userId,
          })
          .expect(201)
      ).body;

    beforeEach(async () => {
      await cleanDb(ds);
      const user = await createUser({
        username: 'dev',
        email: 'dev@test.com',
        role: 'DEVELOPER',
      });
      userId = user.id;
      token = await login('dev');
      const project = (
        await api()
          .post('/projects')
          .set(auth(token))
          .send({ name: 'P', description: 'D', ownerId: userId })
          .expect(201)
      ).body;
      projectId = project.id;
    });

    it('add dependency → PATCH ticket to DONE returns 400 (unresolved blocker) → resolve blocker → DONE succeeds', async () => {
      const blocker = await makeTicket('TODO');
      const blocked = await makeTicket('IN_REVIEW');

      // blocked is blocked by blocker
      await api()
        .post(`/tickets/${blocked.id}/dependencies`)
        .set(auth(token))
        .send({ blockedBy: blocker.id })
        .expect(200);

      // Cannot transition blocked to DONE while blocker is unresolved
      await api()
        .patch(`/tickets/${blocked.id}`)
        .set(auth(token))
        .send({ status: 'DONE' })
        .expect(400);

      // Resolve blocker through forward transitions
      await api()
        .patch(`/tickets/${blocker.id}`)
        .set(auth(token))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      await api()
        .patch(`/tickets/${blocker.id}`)
        .set(auth(token))
        .send({ status: 'IN_REVIEW' })
        .expect(200);
      await api()
        .patch(`/tickets/${blocker.id}`)
        .set(auth(token))
        .send({ status: 'DONE' })
        .expect(200);

      // Now blocked can go DONE
      await api()
        .patch(`/tickets/${blocked.id}`)
        .set(auth(token))
        .send({ status: 'DONE' })
        .expect(200);
    });

    it('self-dependency returns 400', async () => {
      const t = await makeTicket();
      await api()
        .post(`/tickets/${t.id}/dependencies`)
        .set(auth(token))
        .send({ blockedBy: t.id })
        .expect(400);
    });

    it('circular dependency (A blocked by B, then B blocked by A) returns 400', async () => {
      const a = await makeTicket();
      const b = await makeTicket();

      // a is blocked by b
      await api()
        .post(`/tickets/${a.id}/dependencies`)
        .set(auth(token))
        .send({ blockedBy: b.id })
        .expect(200);

      // b blocked by a would create a cycle
      await api()
        .post(`/tickets/${b.id}/dependencies`)
        .set(auth(token))
        .send({ blockedBy: a.id })
        .expect(400);
    });
  });

  // ── Comments and mentions ─────────────────────────────────────────────────────

  describe('Comments and @mentions', () => {
    let token: string;
    let authorId: number;
    let mentionedUserId: number;
    let ticketId: number;

    beforeEach(async () => {
      await cleanDb(ds);
      const author = await createUser({
        username: 'author',
        email: 'author@test.com',
        role: 'DEVELOPER',
      });
      const mentioned = await createUser({
        username: 'jdoe',
        email: 'jdoe@test.com',
        fullName: 'John Doe',
        role: 'DEVELOPER',
      });
      authorId = author.id;
      mentionedUserId = mentioned.id;
      token = await login('author');

      const project = (
        await api()
          .post('/projects')
          .set(auth(token))
          .send({ name: 'P', description: 'D', ownerId: authorId })
          .expect(201)
      ).body;

      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(token))
          .send({
            title: 'T',
            description: 'D',
            status: 'TODO',
            priority: 'LOW',
            type: 'BUG',
            projectId: project.id,
            assigneeId: authorId,
          })
          .expect(201)
      ).body;
      ticketId = ticket.id;
    });

    it('comment with @username returns mentionedUsers containing that user without password', async () => {
      const res = await api()
        .post(`/tickets/${ticketId}/comments`)
        .set(auth(token))
        .send({ authorId, content: 'Hey @jdoe, can you review this?' })
        .expect(201);

      expect(res.body.content).toContain('@jdoe');
      expect(res.body.mentionedUsers).toBeInstanceOf(Array);
      const mentioned = res.body.mentionedUsers.find(
        (u: any) => u.username === 'jdoe',
      );
      expect(mentioned).toBeDefined();
      expect(mentioned.fullName).toBe('John Doe');
      expect(mentioned).not.toHaveProperty('password');
    });

    it('GET /users/:userId/mentions returns the comment where the user was @mentioned', async () => {
      const commentRes = await api()
        .post(`/tickets/${ticketId}/comments`)
        .set(auth(token))
        .send({ authorId, content: 'Hey @jdoe!' })
        .expect(201);

      const mentionRes = await api()
        .get(`/users/${mentionedUserId}/mentions`)
        .set(auth(token))
        .expect(200);

      expect(mentionRes.body.total).toBeGreaterThan(0);
      expect(mentionRes.body.page).toBe(1);
      const found = mentionRes.body.data.find(
        (c: any) => c.id === commentRes.body.id,
      );
      expect(found).toBeDefined();
      expect(found.content).toContain('@jdoe');
      expect(found.mentionedUsers.length).toBeGreaterThan(0);
    });
  });

  // ── Soft delete cascade ───────────────────────────────────────────────────────

  describe('Soft delete cascade', () => {
    let adminToken: string;
    let ownerId: number;

    beforeEach(async () => {
      await cleanDb(ds);
      const admin = await createUser({
        username: 'admin',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
      ownerId = admin.id;
      adminToken = await login('admin');
    });

    it('delete project → tickets hidden from GET /tickets → restore project → tickets visible again', async () => {
      const project = (
        await api()
          .post('/projects')
          .set(auth(adminToken))
          .send({ name: 'P', description: 'D', ownerId })
          .expect(201)
      ).body;

      // Create a ticket in that project
      await api()
        .post('/tickets')
        .set(auth(adminToken))
        .send({
          title: 'T',
          description: 'D',
          status: 'TODO',
          priority: 'LOW',
          type: 'BUG',
          projectId: project.id,
          assigneeId: ownerId,
        })
        .expect(201);

      // Soft delete project cascades to tickets
      await api()
        .delete(`/projects/${project.id}`)
        .set(auth(adminToken))
        .expect(200);

      const ticketsAfterDelete = (
        await api()
          .get(`/tickets?projectId=${project.id}`)
          .set(auth(adminToken))
          .expect(200)
      ).body;
      expect(ticketsAfterDelete).toHaveLength(0);

      // Restore project cascades ticket restoration
      await api()
        .post(`/projects/${project.id}/restore`)
        .set(auth(adminToken))
        .expect(200);

      const ticketsAfterRestore = (
        await api()
          .get(`/tickets?projectId=${project.id}`)
          .set(auth(adminToken))
          .expect(200)
      ).body;
      expect(ticketsAfterRestore.length).toBeGreaterThan(0);
    });
  });

  // ── Audit log ─────────────────────────────────────────────────────────────────

  describe('Audit log', () => {
    let adminToken: string;
    let ownerId: number;

    beforeEach(async () => {
      await cleanDb(ds);
      const admin = await createUser({
        username: 'admin',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
      ownerId = admin.id;
      adminToken = await login('admin');
    });

    it('after creating a user and project, GET /audit-logs contains entries for both', async () => {
      await api()
        .post('/projects')
        .set(auth(adminToken))
        .send({ name: 'P', description: 'D', ownerId })
        .expect(201);

      const res = await api()
        .get('/audit-logs')
        .set(auth(adminToken))
        .expect(200);
      const types = res.body.map((l: any) => l.entityType);
      expect(types).toContain('USER');
      expect(types).toContain('PROJECT');
      // Entries have correct shape
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('action');
      expect(res.body[0]).toHaveProperty('timestamp');
    });

    it('GET /audit-logs?entityType=PROJECT returns only PROJECT entries', async () => {
      await api()
        .post('/projects')
        .set(auth(adminToken))
        .send({ name: 'P', description: 'D', ownerId })
        .expect(201);

      const res = await api()
        .get('/audit-logs?entityType=PROJECT')
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const entry of res.body) {
        expect(entry.entityType).toBe('PROJECT');
      }
    });

    it('GET /audit-logs?actor=SYSTEM returns only SYSTEM entries triggered by auto-assignment', async () => {
      const dev = await createUser({
        username: 'dev',
        email: 'dev@test.com',
        role: 'DEVELOPER',
      });
      const project = (
        await api()
          .post('/projects')
          .set(auth(adminToken))
          .send({ name: 'P', description: 'D', ownerId })
          .expect(201)
      ).body;

      // Create ticket without assigneeId → triggers AUTO_ASSIGN with actor=SYSTEM
      const devToken = await login('dev');
      const ticket = (
        await api()
          .post('/tickets')
          .set(auth(devToken))
          .send({
            title: 'T',
            description: 'D',
            status: 'TODO',
            priority: 'LOW',
            type: 'BUG',
            projectId: project.id,
          })
          .expect(201)
      ).body;

      // Auto-assignment should have happened
      expect(ticket.assigneeId).toBe(dev.id);

      const res = await api()
        .get('/audit-logs?actor=SYSTEM')
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const entry of res.body) {
        expect(entry.actor).toBe('SYSTEM');
        expect(entry.performedBy).toBeNull();
      }
    });
  });
});
