# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This `release/` directory is a **low-code admin platform** — a pnpm monorepo with NestJS backend, React + Ant Design Pro frontend, a Java/Spring Boot BPM service, and shared TypeScript types.

- **Backend**: NestJS 11 + Drizzle ORM + PostgreSQL 16 + Redis 7
- **Frontend**: React 18 + Ant Design Pro (Umi 4 Max) + Zustand
- **BPM**: Spring Boot 2.7 + Flowable 6.8 + MySQL 8
- **Shared**: `@lowcode/shared` package with ApiResponse types and enums
- **Infra**: Docker Compose for dev with hot reload
- Node ≥ 18.16, pnpm ≥ 8, Java 17

## Commands

All commands run from the `release/lowcode/` directory unless noted otherwise.

### Development

```bash
# 一键启停（推荐）
cd release/lowcode && bash scripts/dev.sh              # 启动后端 + 前端
cd release/lowcode && bash scripts/dev.sh stop         # 停止全部
cd release/lowcode && bash scripts/dev.sh restart      # 重启全部
cd release/lowcode && bash scripts/dev.sh status       # 查看状态

# 单独启动
cd release/lowcode && bash scripts/dev.sh start backend
cd release/lowcode && bash scripts/dev.sh start frontend

# 查看日志
cd release/lowcode && bash scripts/dev.sh logs        # 全部
cd release/lowcode && bash scripts/dev.sh logs backend  # 只看后端
```

脚本自动处理：`.env` 加载、shared 包编译检查、僵尸进程清理。

```bash
# Install all workspace dependencies
cd release/lowcode && pnpm install

# Start infrastructure only (PostgreSQL, MySQL, Redis, MinIO)
docker compose -f release/infrastructure/docker-compose.dev.yml up -d postgres mysql redis minio

# Run a single NestJS test
cd release/lowcode/apps/server && pnpm run test -- -t "test name pattern"
```

### Build

```bash
# Build the shared package first
cd release/lowcode/packages/shared && pnpm run build

# Build backend
cd release/lowcode/apps/server && pnpm run build

# Build frontend
cd release/lowcode/apps/web && pnpm run build

# Build all via Turborepo (from lowcode root)
cd release/lowcode && pnpm run build
```

### Database

```bash
cd release/lowcode/apps/server
pnpm run db:generate    # Generate Drizzle migrations from schema changes
pnpm run db:migrate     # Apply pending migrations
pnpm run db:seed        # Seed initial data (admin user, roles, menus)
pnpm run db:studio      # Open Drizzle Studio (web UI for DB inspection)
```

### BPM Service (Java)

```bash
cd release/bpm/bpm-service
mvn clean package -DskipTests     # Build JAR
mvn spring-boot:run               # Run directly (needs MySQL on localhost:3306)
```

### Lint & Format

```bash
cd release/lowcode
pnpm run lint         # Lint all workspaces via Turbo
pnpm run format       # Prettier across all TypeScript files
```

## Architecture

### Monorepo Structure

```
release/
├── lowcode/                  # pnpm monorepo (NestJS + React)
│   ├── apps/server/          # NestJS backend (@lowcode/server)
│   ├── apps/web/             # React frontend (@lowcode/web)
│   ├── packages/shared/      # Shared types & enums (@lowcode/shared)
│   ├── docker/               # Dockerfiles (dev + prod)
│   └── scripts/dev.sh        # Dev start/stop/status script
├── bpm/bpm-service/          # Java Spring Boot + Flowable BPM
├── infrastructure/           # Docker Compose dev, MySQL init, .env
└── Makefile                  # Dev shortcuts: install, build, dev, down
```

### Backend: NestJS `Controller → Service → Drizzle ORM → PostgreSQL`

Each module follows a strict structure:

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Controller | `apps/server/src/modules/<name>/<name>.controller.ts` | Route handlers, Swagger decorators, parameter binding |
| Service | `apps/server/src/modules/<name>/<name>.service.ts` | Business logic, Drizzle queries, returns `(result, error)` via exceptions |
| DTO | `apps/server/src/modules/<name>/dto/` | `class-validator` DTOs for create/update/query |
| Schema | `apps/server/src/db/schema/<name>.ts` | Drizzle ORM table definitions |

**Global providers** (in `AppModule`):
- `JwtAuthGuard` — global, skipped via `@Public()` decorator
- `RolesGuard` — global, enforces `@Roles(...)` decoration
- `AuthzGuard` — global, enforces Casbin RBAC (user → role → API path+method)
- `OperationInterceptor` — global, records every mutation to `sys_operation_records`
- `ResponseInterceptor` — wraps non-envelope returns as `{ code: 0, msg: 'success', data: T }`

Other key directories:
- `apps/server/src/core/auth/` — JWT login/refresh/logout, `passport-jwt` strategy
- `apps/server/src/core/casbin/` — In-memory Casbin enforcer, loads policies from DB on startup
- `apps/server/src/common/guards/` — JWT auth guard, roles guard, Casbin authorization guard
- `apps/server/src/common/interceptors/` — Response wrapping, operation audit logging
- `apps/server/src/common/filters/` — `HttpExceptionFilter` that normalizes errors to `{ code, message }`
- `apps/server/src/common/decorators/` — `@Public()`, `@CurrentUser()`, `@Roles()`
- `apps/server/src/database/` — Global Drizzle DB provider (`DATABASE_CONNECTION` token)
- `apps/server/src/db/` — Drizzle schemas, connection factory, seed script
- `apps/server/src/health/` — Health check endpoint (`/api/v1/health`)

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
- **Error codes** (from `@lowcode/shared`): `1xxx` auth, `2xxx` validation, `3xxx` domain, `5xxx` server
- Every API must be decorated with `@ApiTags()`, `@ApiOperation()`, and response DTOs for Swagger
- Swagger UI: `http://localhost:8888/api/docs`

### Frontend: Umi Max (page → service → API)

| Dir | Responsibility |
|-----|---------------|
| `apps/web/src/pages/<name>/` | Page components |
| `apps/web/src/services/<name>.ts` | API call wrappers (must use the shared `request` instance from `services/request.ts`) |
| `apps/web/src/stores/` | Zustand stores (user state with `persist` middleware) |
| `.umirc.ts` | Routes, proxy config, Umi plugins |

- **Routes**: Defined statically in `.umirc.ts`. `patchClientRoutes()` in `app.tsx` filters routes at runtime against the DB menu tree for role-based access control.
- **Request**: The shared `request` instance in `services/request.ts` auto-attaches Bearer token, handles 401 refresh with queue dedup, and unwraps `ApiResponse.data` on success (so service functions return `data` directly).
- **Initial state**: `getInitialState()` in `app.tsx` fetches accessible menus on load, persisted in `useUserStore.menuTree`.
- **Access control**: `access.ts` provides role-based flags (`isSuperAdmin`, `isAdmin`, etc.) for Umi's access plugin.

### Shared Package (`@lowcode/shared`)

- `api.ts` — `ApiResponse<T>`, `PaginatedData<T>`, `ok()`, `err()` response helpers
- `enums.ts` — `UserStatus`, `RoleCode`, `ApiErrorCode`
- Imported by both `@lowcode/server` and `@lowcode/web` as `workspace:*`
- Must be built first before other packages can import: `cd packages/shared && pnpm run build`

### BPM Service (Java / Spring Boot)

- Spring Boot 2.7 + Flowable 6.8, Java 17, MySQL 8
- Standard layered architecture: `controller/` → `service/` → `entity/` (JPA)
- Auth: `AuthInterceptor` checks a header token, `SecurityConfig` for CORS
- Health endpoint: `GET /bpm/api/health`
- Used by the low-code platform for workflow/contract management

## Environment Variables

Required (set in `release/lowcode/.env` for local dev or passed to Docker):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string for Drizzle |
| `JWT_SECRET` | HS256 signing key for access tokens |
| `JWT_REFRESH_SECRET` | HS256 signing key for refresh tokens (must differ from JWT_SECRET) |
| `REDIS_URL` | Redis connection (for future use) |
| `APP_PORT` | NestJS listen port (default: 8888) |
| `NODE_ENV` | `development` or `production` |

Optional: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `CORS_ORIGIN`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `BPM_SERVICE_URL`

## Key Constraints

- **Never read files under `node_modules/`** — use lock files, configs, or official docs instead
- `@lowcode/shared` must be built before `@lowcode/server` or `@lowcode/web` — the workspace dependency resolves to its `dist/` output
- Backend uses **soft delete**: set `deletedAt` via `sql\`NOW()\``, never hard-delete rows. All queries must include `isNull(table.deletedAt)`.
- The `ResponseInterceptor` auto-wraps controller return values. If a controller returns `{ code, ... }` directly, the interceptor passes it through unchanged.
- Casbin uses `keyMatch2` for path matching — `:id` segments in policies match any path segment.
- The `release/lowcode/docker/` directory contains Dockerfiles. Dev Dockerfiles mount source as volumes for hot reload; prod Dockerfiles copy built artifacts.
- Frontend `.umirc.ts` proxy directs `/api` to `http://localhost:8888` in dev. In Docker Compose, the web container is a standalone Umi dev server.
