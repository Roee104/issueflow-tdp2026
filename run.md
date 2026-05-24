# IssueFlow – Setup & Run Guide

## Prerequisites

- Node.js 20+
- Docker Desktop (for the PostgreSQL instance)

---

## 1. Install dependencies

```bash
npm install
```

---

## 2. Start the database

```bash
docker compose up -d
```

This starts a PostgreSQL container on `localhost:5432` with:
- User: `issueflow`
- Password: `issueflow`
- Database: `issueflow`

---

## 3. Configure environment

Create a `.env` file in the project root with the following values:

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

> The `.env` file is git-ignored and must be created manually.

---

## 4. Build the project

```bash
npm run build
```

---

## 5. Run the application

**Development mode** (watch mode — restarts automatically on file changes):

```bash
npm run start:dev
```

**Production mode:**

```bash
npm run start
```

The API is available at `http://localhost:3000`.

---

## 6. Run the unit tests

```bash
npm test
```

---

## 7. Run the e2e tests

### 7a. Create the test database (one-time setup)

The e2e tests use a separate `issueflow_test` database. Create it by running:

```bash
npm run test:setup
```

This executes:

```
docker exec -it issueflow-typescript-db-1 psql -U issueflow -c "CREATE DATABASE issueflow_test;"
```

> **Note:** The `test:setup` script uses `docker compose exec` which works regardless of the container name or the folder the project is cloned into.
>
> If the database already exists the command will error — that is safe to ignore.

### 7b. Run the e2e suite

```bash
npm run test:e2e
```

The e2e tests connect to `issueflow_test`, create all tables automatically via TypeORM `synchronize: true`, clean between test groups, and close the connection when done.
