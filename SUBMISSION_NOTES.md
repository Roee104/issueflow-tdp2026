# IssueFlow — Submission Notes

## AT&T Clarifications

Before implementation began, three ambiguities were identified in the requirements and escalated to AT&T via email. The responses shaped several architectural decisions:

| Question | AT&T Response |
|---|---|
| Should `POST /users` include a `password` field? | Yes — add it |
| Which takes priority when README and requirements conflict — RESTful principles or the README? | RESTful principles take priority |
| What HTTP method should `PATCH /users/update/:userId` use? | PATCH takes priority over the README |

---

## Assumptions

Several requirements were underspecified. The following assumptions were made and applied consistently throughout the implementation:

**Project membership:**
The requirements reference "developers in a project" and "workload per project" but define no project membership table or endpoint. There is no mechanism in the API contract for assigning users to projects. The assumption made is that all active DEVELOPER users in the system are candidates for auto-assignment, and the workload endpoint returns developers who have at least one ticket assigned in the project. This is the most reasonable interpretation given the absence of a membership model.

**Auto-assignment scope:**
Auto-assignment selects the DEVELOPER with the lowest count of non-DONE, non-deleted tickets assigned in the target project. Tie-breaking is by lowest user ID (earliest registration). If no developers exist in the system, the ticket is created unassigned with no error.

**Escalation frequency:**
The requirements specify that overdue tickets should be escalated but do not define how often. The cron job runs at 00:00 and 12:00 UTC daily — twice per day as a reasonable default for a ticket management system.

**Public user registration:**
`POST /users` is public per the README and accepts any role including ADMIN. This follows the API contract exactly. In a production system, ADMIN role assignment would be restricted, but the requirements make no such distinction.

**Soft delete for users:**
The requirements specify soft delete for projects and tickets but are silent on users. Soft delete was applied to users to preserve referential integrity — audit logs, ticket assignments, and comment authorship all reference user IDs. Hard-deleting a user would orphan these records.

---

## Key Implementation Decisions

**Pessimistic locking over optimistic:**
The README PATCH request bodies for tickets and comments do not include a `version` field. Client-side optimistic locking requires the client to send the current version with every update request. Since this field is absent from the contract, pessimistic locking (SELECT FOR UPDATE) was implemented instead. Lock timeout is set to 5 seconds at the PostgreSQL session level — exceeded locks return 409 Conflict.

**Server-side JWT deny-list:**
Logout is implemented via a server-side token blacklist table rather than relying on token expiry. This ensures tokens are immediately invalidated on logout. Expired entries are cleaned up daily by a scheduled cron job at 01:00 UTC.

**Soft-deleted user token rejection:**
After discovering during testing that soft-deleted users could still authenticate using existing JWT tokens, a third validation step was added to the global JWT guard. On every authenticated request, the guard verifies the user still exists and is not soft-deleted — rejecting with 401 if not.

**Foreign key handling:**
Foreign key IDs are stored directly on the entities using TypeORM `@ManyToOne` + `@JoinColumn` decorators alongside `@Column()`. This links the relationships at the ORM level while keeping the column name explicit. PostgreSQL foreign key constraints are enforced through TypeORM's schema synchronization, and invalid foreign key values are rejected at the database level with error 23503.

---

## Known Limitations

- **No refresh tokens:** Access tokens expire after 1 hour. Users must re-authenticate after expiry. Refresh tokens were not implemented as they are not part of the API contract.
- **Escalation is not retroactive on startup:** The escalation cron runs on schedule only. Tickets that became overdue while the application was offline are escalated on the next cron run.

---

## Testing

Two levels of tests are provided:

- **Unit tests (40):** Test business logic in isolation using mocked repositories. Cover status transitions, auto-assignment, escalation, circular dependency detection, mention parsing, and cascade soft delete.
- **E2e tests (23):** Test the full HTTP request/response cycle against a real PostgreSQL database (`issueflow_test`). Cover auth flow, user management, project lifecycle, ticket lifecycle, dependencies, mentions, soft delete cascade, and audit log filtering.

Run instructions are in `run.md`.
