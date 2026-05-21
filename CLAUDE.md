# CLAUDE.md — IssueFlow TDP 2026 Homework Assignment

## CRITICAL INSTRUCTIONS

Read this entire file before writing a single line of code. Every decision here was made deliberately after careful analysis of the requirements. Do not deviate from these instructions without explicit approval from the developer.

**Work in steps. After completing each step, stop and wait for the developer's review and approval before moving to the next step.**

**NEVER run `git add`, `git commit`, or `git push`. All commits are made by the developer manually after reviewing the code. When you finish a step, tell the developer exactly what you built and wait for their approval.**

---

## 1. Project Overview

You are building **IssueFlow** — a RESTful backend API for a lightweight project and issue tracking platform. Think of it as a simplified Jira.

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL via TypeORM
- **Runtime**: Node.js
- **Deadline**: Friday May 23, 2026

The system manages four core entities: **Users**, **Projects**, **Tickets**, and **Comments** — along with several extended features.

This is a homework assignment for the AT&T TDP Israel 2026 program. The code will be reviewed by AT&T engineers and tested against the README API contract. You will be held accountable for every line of code.

---

## 2. Source Documents

Before doing anything, read these files carefully:

- `README.md` — the API contract. Every endpoint defined here must be implemented exactly as specified.
- `TDP_issueflow_requirements.pdf` — the full requirements document. Contains all functional and extended requirements.
- `docs/erd.mmd` — the database ERD showing all tables and relationships.

---

## 3. README Overrides

The README is the implementation contract. However, three specific deviations have been confirmed by AT&T:

### Override 1 — User Update Endpoint
The README shows `POST /users/update/:userId`. Keep the exact URL path but change the HTTP method:
```
PATCH /users/update/:userId
```

### Override 2 — Password Field on User Creation
The README does not include a password field on `POST /users`. Add it as a required field:
```json
{ "username": "jdoe", "email": "jdoe@example.com", "fullName": "John Doe", "role": "DEVELOPER", "password": "secret" }
```
- Hash the password with **bcrypt** before storing it
- **Never return the password field in any API response**

### Override 3 — HTTP Status Codes
Apply RESTful status codes:
- `POST` (resource creation) → **201 Created**
- `GET` → **200 OK**
- `PATCH` → **200 OK**
- `DELETE` → **200 OK**
- `POST` for non-create operations (login, logout, restore, add dependency) → **200 OK**

---

## 4. Strict Rules — Do Not Violate

- **Do not add any endpoints not in the README** unless explicitly instructed
- **Do not add any response fields not shown in the README** unless explicitly instructed
- **Do not add refresh tokens** — access token only, 1 hour expiry
- **Do not hard delete anything** — users, tickets, and projects are all soft deleted
- **Never return the password field** in any response under any circumstances
- **Never return `createdAt`, `updatedAt`, `isDeleted`, or `deletedAt`** in standard API responses
- **Never return `version`** — it is not used in this implementation
- **Do not add pagination** to any endpoint except `GET /users/:userId/mentions` which already has it in the README
- **Do not add CORS configuration**
- **Create the `uploads/` directory** if it doesn't exist, and add it to `.gitignore`

---

## 5. Environment Variables

Create a `.env` file in the project root with exactly these values:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=issueflow
DB_PASSWORD=issueflow
DB_NAME=issueflow
JWT_SECRET=issueflow-super-secret-jwt-key-2026
JWT_EXPIRES_IN=3600
UPLOAD_DIR=./uploads
```

Add `.env` to `.gitignore` — never commit it.

---

## 6. Database Configuration

- Use **TypeORM** with **PostgreSQL**
- Set `synchronize: true` — TypeORM will auto-create and update tables based on entities
- Load configuration from `.env` using `@nestjs/config` — install it with `npm install @nestjs/config`
- Every entity must use `@CreateDateColumn()` for `createdAt` and `@UpdateDateColumn()` for `updatedAt` — these are internal database fields only, never returned in API responses

## 6b. Development Mode

- During development use `npm run start:dev` — this runs in watch mode and automatically restarts when files change
- For final testing use `npm run start` or `npm run start:prod`
- The `run.md` documentation should explain both modes

## 6c. Token Blacklist Cleanup

Add a scheduled task that runs once daily to delete expired tokens from `token_blacklist`:
- Delete all rows where `expiresAt < now()`
- This keeps the table small and queries fast
- Run at 01:00 UTC daily

---

## 7. Database Schema

Implement exactly these 9 tables. Do not add or remove tables without approval.

### users
```
id          int, PK, auto increment
username    string, unique, not null
email       string, unique, not null
fullName    string, not null
role        enum: ADMIN | DEVELOPER, not null
password    string (bcrypt hashed), not null
isDeleted   boolean, default false
deletedAt   timestamp, nullable
createdAt   auto (never returned in responses)
updatedAt   auto (never returned in responses)
```

### projects
```
id          int, PK, auto increment
name        string, not null
description string, not null
ownerId     int, FK → users.id, not null
isDeleted   boolean, default false
deletedAt   timestamp, nullable
createdAt   auto
updatedAt   auto
```

### tickets
```
id          int, PK, auto increment
title       string, not null
description string, not null
status      enum: TODO | IN_PROGRESS | IN_REVIEW | DONE, not null
priority    enum: LOW | MEDIUM | HIGH | CRITICAL, not null
type        enum: BUG | FEATURE | TECHNICAL, not null
projectId   int, FK → projects.id, not null
assigneeId  int, FK → users.id, nullable
dueDate     timestamp, nullable
isOverdue   boolean, default false
isDeleted   boolean, default false
deletedAt   timestamp, nullable
createdAt   auto
updatedAt   auto
```

### comments
```
id          int, PK, auto increment
ticketId    int, FK → tickets.id, not null
authorId    int, FK → users.id, not null
content     string, not null
createdAt   auto
updatedAt   auto
```

### audit_logs
```
id          int, PK, auto increment
action      enum: CREATE | UPDATE | DELETE | RESTORE | AUTO_ASSIGN | ESCALATE | ADD_DEPENDENCY | REMOVE_DEPENDENCY | UPLOAD_ATTACHMENT | DELETE_ATTACHMENT, not null
entityType  enum: USER | PROJECT | TICKET | COMMENT, not null
entityId    int, not null
performedBy int, FK → users.id, nullable (null when actor is SYSTEM)
actor       enum: USER | SYSTEM, not null
timestamp   timestamp, not null (this is the audit log timestamp — not createdAt)
```

### token_blacklist
```
id          int, PK, auto increment
token       string, not null
expiresAt   timestamp, not null
createdAt   auto
updatedAt   auto
```

### ticket_dependencies
```
ticketId    int, FK → tickets.id, not null (the blocked ticket)
blockerId   int, FK → tickets.id, not null (the blocking ticket)
PRIMARY KEY (ticketId, blockerId)
```

### attachments
```
id          int, PK, auto increment
ticketId    int, FK → tickets.id, not null
filename    string, not null
contentType string, not null (MIME type)
filePath    string, not null (path on filesystem)
createdAt   auto
updatedAt   auto
```

### comment_mentions
```
commentId   int, FK → comments.id, not null
userId      int, FK → users.id, not null
PRIMARY KEY (commentId, userId)
```

---

## 8. Module Structure

Create exactly this folder structure:

```
src/
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    auth.guard.ts          (JWT guard — protects all endpoints)
    roles.guard.ts         (ADMIN-only guard)
    dto/
  users/
    users.module.ts
    users.controller.ts
    users.service.ts
    user.entity.ts
    dto/
  projects/
    projects.module.ts
    projects.controller.ts
    projects.service.ts
    project.entity.ts
    dto/
  tickets/
    tickets.module.ts
    tickets.controller.ts
    tickets.service.ts
    ticket.entity.ts
    tickets-escalation.service.ts  (cron job)
    dto/
  comments/
    comments.module.ts
    comments.controller.ts
    comments.service.ts
    comment.entity.ts
    dto/
  dependencies/
    dependencies.module.ts
    dependencies.controller.ts
    dependencies.service.ts
    ticket-dependency.entity.ts
  attachments/
    attachments.module.ts
    attachments.controller.ts
    attachments.service.ts
    attachment.entity.ts
  mentions/
    mentions.module.ts
    mentions.service.ts
    comment-mention.entity.ts
  audit-logs/
    audit-logs.module.ts
    audit-logs.controller.ts
    audit-logs.service.ts
    audit-log.entity.ts
  common/
    decorators/
      current-user.decorator.ts
    guards/
    pipes/
```

---

## 9. Implementation Order

Build the project in exactly this order. **Stop after each step and wait for developer approval.**

```
Step 1  — Database setup & TypeORM configuration
Step 2  — Users module (CRUD + validation)
Step 3  — Auth module (JWT login, logout, me endpoint, guards)
Step 4  — Audit Log service (shared service used by all modules)
Step 5  — Projects module (CRUD, soft delete built in)
Step 6  — Tickets module core (CRUD, soft delete, status transitions, optimistic locking)
Step 7  — Comments module (CRUD, optimistic locking, authorId handling)
Step 8  — Dependencies module (add, list, remove, circular detection)
Step 9  — Attachments module (upload, delete, filesystem storage)
Step 10 — Mentions module (@mention parsing, storage, retrieval)
Step 11 — Ticket Export & Import (CSV export, CSV import with partial success)
Step 12 — Escalation cron job (auto-escalate overdue tickets)
Step 13 — Auto-assignment (least-loaded developer on ticket creation)
Step 14 — Workload endpoint (GET /projects/:projectId/workload)
Step 15 — Soft delete endpoints (list deleted, restore — ADMIN only)
Step 16 — Audit Log retrieval endpoint (GET /audit-logs with filters)
Step 17 — Tests (key behaviors)
Step 18 — Documentation (run.md, prompts.md)
```

---

## 10. Authentication & Authorization

- All endpoints are protected by JWT — unauthenticated requests return **401 Unauthorized**
- Use `@nestjs/jwt` and `passport-jwt`
- JWT payload contains: `{ userId, username, role }`
- Token expiry: 3600 seconds (1 hour)
- On logout: add the token to `token_blacklist` table with its expiry time
- On every authenticated request: check if token is in `token_blacklist` — if yes, return 401
- Clean up expired tokens from `token_blacklist` periodically
- ADMIN-only endpoints: soft delete list and restore endpoints — return **403 Forbidden** if role is not ADMIN
- Extract the current user from JWT in controllers using a `@CurrentUser()` decorator

---

## 11. Business Logic Rules

### Ticket Status Transitions
Status can only move forward — never backward:
```
TODO → IN_PROGRESS → IN_REVIEW → DONE
```
- Reject any backward transition with 400 Bad Request and a clear error message
- A DONE ticket cannot be updated at all — return 400 Bad Request

### Simultaneous Update Prevention
Tickets and comments use **database-level pessimistic locking** via SELECT FOR UPDATE to prevent two users updating the same record simultaneously:

- When a user requests to update a ticket or comment, the server begins a database transaction and runs `SELECT ... FOR UPDATE` on that row
- This locks the row at the database level — any other transaction trying to update the same row must wait
- If two requests arrive simultaneously, the second waits until the first transaction completes
- Return **409 Conflict** if the lock cannot be acquired within a reasonable timeout

The `version` field is NOT used — it is not in the README request body schema and therefore not implemented.

### Soft Delete Cascade
- Soft deleting a project → soft deletes all its tickets
- Soft deleting a ticket → soft deletes all its comments
- Restoring a project → restores all its tickets
- Restoring a ticket → restores all its comments
- All standard GET endpoints filter out soft-deleted records automatically

### User Deletion
- `DELETE /users/:userId` is a **soft delete** — sets `isDeleted = true` and `deletedAt = now()`
- Soft-deleted users are filtered from all standard GET responses
- All historical references remain intact — audit logs, ticket assignments, comment authors still reference the user by ID
- This preserves data integrity across the entire system

### What is NOT Logged in Audit Log
- GET requests — never logged
- Login (`POST /auth/login`) — not a business entity state change
- Logout (`POST /auth/logout`) — not a business entity state change

### Ticket Dependencies
- Both tickets must exist and belong to the same project — otherwise 400 Bad Request
- Detect circular dependencies before adding — if adding the dependency would create a cycle, return 400 Bad Request with a clear error
- A ticket cannot transition to DONE if it has any unresolved blockers (blockers not in DONE status) — return 400 Bad Request

### Auto-Assignment
Triggered only on ticket creation when `assigneeId` is not provided:
1. Query all users with role DEVELOPER
2. For each developer, count their non-DONE tickets assigned in this project (their workload)
3. Pick the developer with the lowest workload count
4. Tie-breaking: pick the developer with the lower `id` (registered first)
5. If no developers exist in the system — set `assigneeId = null`, no error
6. Log to audit log: `action: AUTO_ASSIGN, entityType: TICKET, actor: SYSTEM, performedBy: null`

A developer is considered linked to a project if they have at least one ticket assigned to them in that project.

### @Mention Parsing
- On comment create or update: scan content for `@username` patterns using regex `/@(\w+)/g`
- Look up each found username in the users table (case-insensitive)
- If user exists: create a row in `comment_mentions`
- If user does not exist: silently ignore
- On comment update: delete all existing mention rows for that comment, re-parse, re-insert
- Return `mentionedUsers: [{ id, username, fullName }]` in every comment response

### Escalation Cron Job
Runs twice daily at **00:00 UTC** and **12:00 UTC** (midnight and noon UTC):
1. Find all tickets where `dueDate < now` AND `status != DONE` AND `isDeleted = false`
2. For each ticket with priority below CRITICAL: promote priority one level (LOW→MEDIUM, MEDIUM→HIGH, HIGH→CRITICAL)
3. For each ticket that reaches CRITICAL and is still overdue: set `isOverdue = true`
4. Escalation is idempotent — CRITICAL tickets are never escalated further
5. A manual priority change via PATCH resets `isOverdue = false`
6. Log every escalation to audit log: `action: ESCALATE, entityType: TICKET, actor: SYSTEM, performedBy: null`

---

## 12. Attachment Rules

- Store files on the filesystem in the `./uploads/` directory
- Store only the file path in the database
- Maximum file size: **10 MB** — reject with 400 Bad Request if exceeded
- Allowed MIME types: `image/png`, `image/jpeg`, `application/pdf`, `text/plain` — reject all others with 400 Bad Request
- Use `multer` for file upload handling

---

## 13. CSV Export & Import Rules

### Export
- `GET /tickets/export?projectId={id}` returns a CSV file
- Fields: `id, title, description, status, priority, type, assigneeId`
- Use a CSV library — handle commas and quotes inside field values correctly
- Set response header: `Content-Type: text/csv`

### Import
- `POST /tickets/import` accepts multipart/form-data with `file` (CSV) and `projectId` (form field)
- Parse each row and create tickets in bulk
- Partial success — do not roll back on individual row failures
- Return: `{ "created": 42, "failed": 3, "errors": [...] }`
- Each error in the array should describe which row failed and why

---

## 14. Audit Logging

Every state-changing operation must be logged to `audit_logs`. GET requests are never logged.

| Action | EntityType | When |
|---|---|---|
| CREATE | USER | User created |
| UPDATE | USER | User updated |
| DELETE | USER | User soft deleted |
| CREATE | PROJECT | Project created |
| UPDATE | PROJECT | Project updated |
| DELETE | PROJECT | Project soft deleted |
| RESTORE | PROJECT | Project restored |
| CREATE | TICKET | Ticket created |
| UPDATE | TICKET | Ticket updated |
| DELETE | TICKET | Ticket soft deleted |
| RESTORE | TICKET | Ticket restored |
| AUTO_ASSIGN | TICKET | Auto-assignment triggered |
| ESCALATE | TICKET | Priority escalated by cron |
| CREATE | COMMENT | Comment created |
| UPDATE | COMMENT | Comment updated |
| DELETE | COMMENT | Comment deleted |
| ADD_DEPENDENCY | TICKET | Dependency added |
| REMOVE_DEPENDENCY | TICKET | Dependency removed |
| UPLOAD_ATTACHMENT | TICKET | Attachment uploaded |
| DELETE_ATTACHMENT | TICKET | Attachment deleted |

- `performedBy`: the userId from JWT (null for SYSTEM actions)
- `actor`: USER or SYSTEM
- `timestamp`: current UTC time at the moment of the action
- The `AuditLogsService` is a shared service injected into every other module that needs it

---

## 15. Error Handling

Return informative, consistent error responses across all endpoints:

```json
{
  "statusCode": 400,
  "message": "Ticket status cannot move backward from IN_PROGRESS to TODO",
  "error": "Bad Request"
}
```

Standard HTTP error codes:
- **400 Bad Request** — invalid input, validation failure, business rule violation
- **401 Unauthorized** — missing or invalid JWT token
- **403 Forbidden** — authenticated but insufficient role
- **404 Not Found** — resource does not exist
- **409 Conflict** — simultaneous update conflict (SELECT FOR UPDATE timeout or deadlock)
- **500 Internal Server Error** — unexpected server errors

Use NestJS built-in exceptions (`BadRequestException`, `NotFoundException`, `ForbiddenException`, etc.) consistently throughout.

---

## 16. Input Validation

Use `class-validator` and `class-transformer` for all DTOs:
- All required fields must be validated as non-empty
- Enum fields must be validated against their allowed values
- Email fields must be validated as valid email format
- Numeric IDs must be validated as positive integers
- Use NestJS `ValidationPipe` globally in `main.ts`

---

## 17. Commit Convention

Use conventional commits for every commit:

```
feat: implement user CRUD with role validation
feat: add JWT authentication with login and logout
fix: handle edge case in circular dependency detection
test: add unit tests for ticket status transitions
docs: add run.md with setup instructions
chore: configure TypeORM with PostgreSQL
```

Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`

Rules:
- Every commit must be in a working state
- Never commit broken code
- One logical unit of work per commit
- Commit after completing each implementation step

---

## 18. Testing Strategy

Write tests covering these key behaviors:
- Ticket status transition validation (forward only, DONE is final)
- Simultaneous update prevention (SELECT FOR UPDATE)
- JWT authentication (protected endpoints reject unauthenticated requests)
- Auto-assignment logic (least-loaded developer, tie-breaking by id)
- Circular dependency detection
- Soft delete cascade (deleting project soft deletes its tickets)
- @mention parsing and storage
- CSV import partial success handling
- Attachment validation (size and MIME type)
- Escalation logic (priority promotion, idempotency)

Use NestJS testing utilities (`@nestjs/testing`). Unit tests for services, integration tests for controllers where appropriate.

---

## 19. Documentation Requirements

### run.md
Create `run.md` in the project root with exact steps to:
1. Install dependencies (`npm install`)
2. Start the database (`docker compose up -d`)
3. Configure environment (create `.env` file with exact values)
4. Build the project (`npm run build`)
5. Run the application (`npm run start`)
6. Run the tests (`npm run test`)

### prompts.md
Create `docs/prompts.md` documenting AI usage. This will be filled in separately.

---

## 20. Response Format Rules

Every API response must exactly match the README response body. No extra fields, no missing fields.

Key rules:
- Never return `password`, `createdAt`, `updatedAt`, `version`, `isDeleted`, or `deletedAt` in standard responses
- `isDeleted` and `deletedAt` are only returned in soft-delete list endpoints (GET /tickets/deleted, GET /projects/deleted)
- Comments always include `mentionedUsers` array (empty array if no mentions)
- Tickets always include `isOverdue` boolean field
- Workload endpoint returns list sorted by `openTicketCount` ascending
- All timestamps must be ISO-8601 format with Z suffix: `"2026-05-20T14:30:00Z"`
- `GET /auth/me` returns the current authenticated user's profile in the same format as `GET /users/:userId` — without password

---

## 21. Important Notes

- The developer will review code after each step — **stop and wait for approval before proceeding**
- If you are uncertain about any decision, ask before implementing
- Read the README carefully — the exact field names in requests and responses matter
- The model used for this assignment is **Claude Sonnet 4.6**
- **All datetime operations must use UTC** — store in UTC, return in UTC, run crons in UTC
- **All timestamps in API responses must be in ISO-8601 format with Z suffix** — example: `"2026-05-20T14:30:00Z"`
- **Never use local server time** — always use UTC explicitly
- The `uploads/` directory should be added to `.gitignore`
