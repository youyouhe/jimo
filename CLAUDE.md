# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Repo root is a **low-code admin platform** — a pnpm monorepo with NestJS backend, React + Ant Design Pro frontend, a Java/Spring Boot BPM service, and shared TypeScript types.

- **Backend**: NestJS 11 + Drizzle ORM + PostgreSQL 16 + Redis 7
- **Frontend**: React 18 + Ant Design Pro (Umi 4 Max) + Zustand
- **BPM**: Spring Boot 2.7 + Flowable 6.8 + MySQL 8
- **Shared**: `@jimo/shared` package with ApiResponse types and enums
- **Infra**: Docker Compose for dev with hot reload
- Node ≥ 18.16, pnpm pinned to `9.15.9` (packageManager field), Java 17

## Commands

Node commands run from `jimo/` (the pnpm workspace root) unless noted.

### Development

```bash
# One-shot start/stop (recommended)
cd jimo && bash scripts/dev.sh              # start backend + frontend
cd jimo && bash scripts/dev.sh stop         # stop everything
cd jimo && bash scripts/dev.sh restart      # restart everything
cd jimo && bash scripts/dev.sh status       # show status

# Start one side only
cd jimo && bash scripts/dev.sh start backend
cd jimo && bash scripts/dev.sh start frontend

# Logs
cd jimo && bash scripts/dev.sh logs             # all
cd jimo && bash scripts/dev.sh logs backend     # backend only
```

`dev.sh` handles `.env` loading, `@jimo/shared` build check, and zombie process cleanup. PID/log files live under `jimo/.tmp/{pids,logs}`. Override ports with `PORT` (backend, default 8888) and `FRONT_PORT` (frontend, default 8000).

```bash
# Install workspace deps
cd jimo && pnpm install

# Bring up infra only (Postgres, MySQL, Redis, MinIO)
docker compose -f infrastructure/docker-compose.dev.yml up -d postgres mysql redis minio

# Or bring up everything (adds NestJS + web + BPM containers)
docker compose -f infrastructure/docker-compose.dev.yml up -d

# Repo-root shortcuts (see Makefile)
make dev          # docker compose up -d
make down         # docker compose down
```

### Build

```bash
# @jimo/shared must be built first — other workspaces import from its dist/
cd jimo/packages/shared && pnpm run build

cd jimo/apps/server && pnpm run build
cd jimo/apps/web && pnpm run build

# Or all via Turborepo from the workspace root
cd jimo && pnpm run build
```

### Testing

```bash
# Backend (Jest)
cd jimo/apps/server && pnpm run test                       # unit
cd jimo/apps/server && pnpm run test -- -t "name pattern"  # single test
cd jimo/apps/server && pnpm run test:l2                    # L2 integration (sets RUN_L2_DB=1, needs Postgres)
cd jimo/apps/server && pnpm run test:cov                   # coverage

# Frontend (Playwright)
cd jimo/apps/web && pnpm run test:e2e:install              # one-time: install chromium
cd jimo/apps/web && pnpm run test:e2e
```

### Database

```bash
cd jimo/apps/server
pnpm run db:generate    # Generate Drizzle migrations from schema changes
pnpm run db:migrate     # Apply pending migrations
pnpm run db:seed        # Seed initial data (admin user, roles, menus)
pnpm run db:studio      # Open Drizzle Studio (web UI for DB inspection)
```

### BPM Service (Java)

```bash
cd bpm/bpm-service
mvn clean package -DskipTests     # Build JAR
mvn spring-boot:run               # Run directly (needs MySQL on localhost:3306)
```

### Lint & Format

```bash
cd jimo
pnpm run lint         # Lint all workspaces via Turbo
pnpm run format       # Prettier across TypeScript files
```

## Architecture

### Monorepo Structure

```
.
├── jimo/                     # pnpm monorepo (NestJS + React)
│   ├── apps/server/            # NestJS backend (@jimo/server)
│   ├── apps/web/               # React frontend (@jimo/web)
│   ├── packages/shared/        # Shared types & enums (@jimo/shared)
│   ├── docker/                 # Dockerfiles (dev + prod)
│   ├── scripts/                # dev.sh + one-off maintenance scripts
│   └── tools/                  # Code generators / workers
├── bpm/bpm-service/            # Java Spring Boot + Flowable BPM
├── infrastructure/             # docker-compose.dev.yml, MySQL init, env
├── docs/                       # Design & test docs
└── Makefile                    # Repo-root shortcuts (dev, down)
```

### Backend: NestJS `Controller → Service → Drizzle ORM → PostgreSQL`

Each module follows a strict structure:

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Controller | `jimo/apps/server/src/modules/<name>/<name>.controller.ts` | Route handlers, Swagger decorators, parameter binding |
| Service | `jimo/apps/server/src/modules/<name>/<name>.service.ts` | Business logic, Drizzle queries; throws typed HttpException on error |
| DTO | `jimo/apps/server/src/modules/<name>/dto/` | `class-validator` DTOs for create/update/query |
| Schema | `jimo/apps/server/src/db/schema/<name>.ts` | Drizzle ORM table definitions |

**Global providers** (in `AppModule`):
- `JwtAuthGuard` — global, skipped via `@Public()` decorator
- `RolesGuard` — global, enforces `@Roles(...)` decoration
- `AuthzGuard` — global, enforces Casbin RBAC (user → role → API path+method)
- `OperationInterceptor` — global, records every mutation to `sys_operation_records`
- `ResponseInterceptor` — wraps non-envelope returns as `{ code: 0, msg: 'success', data: T }`

Other key directories under `jimo/apps/server/src/`:
- `core/auth/` — JWT login/refresh/logout, `passport-jwt` strategy
- `core/casbin/` — In-memory Casbin enforcer, loads policies from DB on startup
- `common/guards/` — JWT auth guard, roles guard, Casbin authorization guard
- `common/interceptors/` — Response wrapping, operation audit logging
- `common/filters/` — `HttpExceptionFilter` normalizes errors to `{ code, message }`
- `common/decorators/` — `@Public()`, `@CurrentUser()`, `@Roles()`
- `database/` — Global Drizzle DB provider (`DATABASE_CONNECTION` token)
- `db/` — Drizzle schemas, connection factory, seed script
- `health/` — Health check endpoint (`/api/v1/health`)

### Auth Flow (JWT + Casbin RBAC)

1. `POST /api/v1/auth/login` — validates credentials, returns `access_token` (2h) + `refresh_token` (7d)
2. `JwtAuthGuard` extracts JWT, attaches `req.user = { sub, username, role, jti }`
3. `AuthzGuard` calls `casbinService.enforce(userId, path, method)` — in-memory, no DB round-trip
4. Casbin policies are loaded from DB on startup and reloaded when user roles change
5. Role hierarchy: `super_admin` → `admin` → `editor` → `viewer`
6. Token refresh: blacklists old refresh token's `jti`, issues new pair
7. Logout: blacklists both access and refresh `jti`

### API Contracts

- **Response envelope**: `{ code: number, msg: string, data: T }` — `code: 0` = success
- **Pagination**: `{ code: 0, data: { list: T[], total: number, page: number, pageSize: number } }`
- **Error codes** (from `@jimo/shared`): `1xxx` auth, `2xxx` validation, `3xxx` domain, `5xxx` server
- Every API must be decorated with `@ApiTags()`, `@ApiOperation()`, and response DTOs for Swagger
- Swagger UI: `http://localhost:8888/api/docs`

### Frontend: Umi Max (page → service → API)

| Dir | Responsibility |
|-----|---------------|
| `jimo/apps/web/src/pages/<name>/` | Page components |
| `jimo/apps/web/src/services/<name>.ts` | API call wrappers (must use the shared `request` instance from `services/request.ts`) |
| `jimo/apps/web/src/stores/` | Zustand stores (user state with `persist` middleware) |
| `jimo/apps/web/.umirc.ts` | Routes, proxy config, Umi plugins |

- **Routes**: Defined statically in `.umirc.ts`. `patchClientRoutes()` in `app.tsx` filters routes at runtime against the DB menu tree for role-based access control.
- **Request**: The shared `request` instance in `services/request.ts` auto-attaches Bearer token, handles 401 refresh with queue dedup, and unwraps `ApiResponse.data` on success (so service functions return `data` directly).
- **Initial state**: `getInitialState()` in `app.tsx` fetches accessible menus on load, persisted in `useUserStore.menuTree`.
- **Access control**: `access.ts` provides role-based flags (`isSuperAdmin`, `isAdmin`, etc.) for Umi's access plugin.
- **Dev proxy**: `.umirc.ts` proxies `/api` to `http://localhost:8888`.

### Shared Package (`@jimo/shared`)

- `api.ts` — `ApiResponse<T>`, `PaginatedData<T>`, `ok()`, `err()` response helpers
- `enums.ts` — `UserStatus`, `RoleCode`, `ApiErrorCode`
- Imported by both `@jimo/server` and `@jimo/web` as `workspace:*`
- Must be built first before other packages can import: `cd jimo/packages/shared && pnpm run build`

### BPM Service (Java / Spring Boot)

- Spring Boot 2.7 + Flowable 6.8, Java 17, MySQL 8
- Standard layered architecture: `controller/` → `service/` → `entity/` (JPA)
- Auth: `AuthInterceptor` checks a header token, `SecurityConfig` for CORS
- Health endpoint: `GET /bpm/api/health`
- Used by the low-code platform for workflow/contract management

## Environment Variables

Required (set in `jimo/.env` for local dev or passed to Docker — see `jimo/.env.example`):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string for Drizzle |
| `JWT_SECRET` | HS256 signing key for access tokens |
| `JWT_REFRESH_SECRET` | HS256 signing key for refresh tokens (must differ from `JWT_SECRET`) |
| `REDIS_URL` | Redis connection (for future use) |
| `APP_PORT` | NestJS listen port (default: 8888) |
| `NODE_ENV` | `development` or `production` |

Optional: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `CORS_ORIGIN`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `BPM_SERVICE_URL`.

## Port Map

| Service | Port | Notes |
|---------|------|-------|
| React frontend | 8000 | Umi dev server (`HOST=0.0.0.0 max dev`) |
| NestJS backend | 8888 | REST + Swagger at `/api/docs` |
| BPM service | 8090 | Flowable, health at `/bpm/api/health` |
| PostgreSQL | 5432 | NestJS primary DB |
| MySQL | 3306 | Flowable DB |
| Redis | 6379 | cache / token blacklist |
| MinIO | 9000 / 9001 | S3 API / console |

## Key Constraints

- **Never read files under `node_modules/`** — use lock files, configs, or official docs instead.
- `@jimo/shared` must be built before `@jimo/server` or `@jimo/web` — the workspace dependency resolves to its `dist/` output.
- Backend uses **soft delete**: set `deletedAt` via `sql\`NOW()\``, never hard-delete rows. All queries must include `isNull(table.deletedAt)`.
- The `ResponseInterceptor` auto-wraps controller return values. If a controller returns `{ code, ... }` directly, the interceptor passes it through unchanged.
- Casbin uses `keyMatch2` for path matching — `:id` segments in policies match any path segment.
- `jimo/docker/` contains Dockerfiles. Dev Dockerfiles mount source as volumes for hot reload; prod Dockerfiles copy built artifacts.
- Frontend `.umirc.ts` proxy directs `/api` to `http://localhost:8888` in dev. In Docker Compose, the web container is a standalone Umi dev server.
- `pnpm` is pinned via `packageManager: pnpm@9.15.9` — use Corepack (or a matching pnpm) rather than a globally installed different major.
- A drizzle-kit patch is applied via `pnpm.patchedDependencies` (`patches/drizzle-kit@0.31.10.patch`) — `pnpm install` handles it, but keep the patch in sync if you upgrade drizzle-kit.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — a root `CONTEXT-MAP.md` points to per-context `CONTEXT.md` files (`jimo/apps/server/`, `jimo/apps/web/`, `jimo/packages/shared/`, `bpm/bpm-service/`). See `docs/agents/domain.md`.
