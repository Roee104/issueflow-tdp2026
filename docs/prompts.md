# AI Usage — IssueFlow TDP 2026

## Model

**Claude Sonnet 4.6** (`claude-sonnet-4-6`)  
Accessed via Claude.ai (chat) and Claude Code CLI.

---

## Usage

I used Claude Sonnet 4.6 throughout this project as a coding assistant — for planning, implementation, testing, and documentation.

Before writing any code, I used the chat interface to analyze the requirements, design the database schema, and define the architecture. I documented all decisions in `CLAUDE.md`, which served as the instruction file for Claude Code during implementation.

During implementation, I worked with Claude Code step by step — writing each part of the codebase, reviewing the output, testing manually, and iterating where needed. Every file was reviewed and approved before being committed. All Git operations were done by me.

---

## Instruction File

**`CLAUDE.md`** — written before implementation began. Contains the full architecture, database schema, business logic rules, API contract overrides, and implementation order. This is the main prompt used to guide Claude Code.

---

## Deviations from the Original Plan

During implementation, several decisions evolved from what was originally defined in `CLAUDE.md`:

| Original Plan | What Was Implemented | Reason |
|---|---|---|
| Optimistic locking (version field) | Pessimistic locking (SELECT FOR UPDATE) | Version field not in README request body — client-side optimistic locking not possible |
| Comments table without soft delete fields | Added `isDeleted` and `deletedAt` | Required for cascade soft delete from tickets |
| Users hard deleted | Users soft deleted | Preserve historical references in audit logs and ticket assignments |
| Plain `@Column()` foreign keys | `@ManyToOne` + `@JoinColumn()` on all FKs | FK constraints not enforced at database level without proper relationships |
| Unit tests only | Unit tests (40) + E2e tests (23) | E2e tests added to verify the full stack works end to end |
