# Jimo Platform

自主构建的低代码管理平台 —— pnpm monorepo（NestJS 后端 + React 前端 + Java BPM 服务 + 共享类型）。

> 本仓库只包含低代码平台本体（原 `release/` 目录），已从 gin-vue-admin 克隆中独立分离。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | NestJS 11 · Drizzle ORM · PostgreSQL 16 · Redis 7 |
| 前端 | React 18 · Ant Design Pro (Umi 4 Max) · Zustand |
| BPM | Spring Boot 2.7 · Flowable 6.8 · MySQL 8 |
| 共享 | `@jimo/shared`（ApiResponse 类型与枚举） |
| 构建 | Turborepo · pnpm workspace |
| 基础设施 | Docker Compose（开发环境热重载） |

## 仓库结构

```
.
├── jimo/                  # pnpm monorepo（NestJS + React）
│   ├── apps/server/          # NestJS 后端 (@jimo/server)
│   ├── apps/web/             # React 前端 (@jimo/web)
│   ├── packages/shared/      # 共享类型与枚举 (@jimo/shared)
│   ├── docker/               # Dockerfile（dev + prod）
│   └── scripts/dev.sh        # 开发启停脚本
├── bpm/bpm-service/          # Java Spring Boot + Flowable BPM
├── infrastructure/           # Docker Compose、MySQL 初始化、.env
├── docs/                     # 设计与测试文档
└── Makefile
```

## 前置要求

- Node ≥ 18.16、pnpm ≥ 8（仓库固定 `pnpm@9.15.9`）
- Docker + Docker Compose
- Java 17、Maven（仅在需要本地构建/运行 BPM 服务时）

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/youyouhe/jimo.git
cd jimo

# 2. 准备环境变量
cp jimo/.env.example jimo/.env   # 按需修改数据库密码、JWT 密钥等

# 3. 一键启动全栈（PostgreSQL + MySQL + Redis + MinIO + NestJS + React + BPM）
docker compose -f infrastructure/docker-compose.dev.yml up -d

# 4. 等待约 30 秒后验证
curl http://localhost:8888/api/v1/health

# 5. 浏览器访问前端（默认账号 admin / admin123）
open http://localhost:8000
```

### 本地开发（热重载）

如果只想用 Docker 起基础设施、应用在本地跑热重载：

```bash
# 仅启动数据库 + 缓存 + 对象存储
docker compose -f infrastructure/docker-compose.dev.yml up -d postgres mysql redis minio

# 安装依赖并启动后端 + 前端
cd jimo && pnpm install
bash scripts/dev.sh                 # server → :8888 | web → :8000
bash scripts/dev.sh status          # 查看状态
bash scripts/dev.sh logs backend    # 只看后端日志
bash scripts/dev.sh stop            # 停止全部
```

## 端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| React 前端 | 8000 | Umi dev server |
| NestJS 后端 | 8888 | REST API + Swagger (`/api/docs`) |
| BPM Service | 8090 | Flowable REST API (`/bpm/api/health`) |
| PostgreSQL | 5432 | 主数据库（NestJS） |
| MySQL | 3306 | BPM 数据库（Flowable） |
| Redis | 6379 | 缓存 / Token 黑名单 |
| MinIO | 9000 / 9001 | 对象存储 API / 控制台 |

## 常用命令

所有命令默认在 `jimo/` 目录下执行。

```bash
pnpm install            # 安装所有工作区依赖
pnpm run dev            # 启动后端 + 前端（turbo）
pnpm run build          # 构建全部（先构建 @jimo/shared）
pnpm run lint           # 全工作区 lint
pnpm run format         # Prettier 格式化
```

数据库（Drizzle / NestJS）：

```bash
cd jimo/apps/server
pnpm run db:generate    # 从 schema 变更生成迁移
pnpm run db:migrate     # 应用待执行迁移
pnpm run db:seed        # 初始数据（管理员、角色、菜单）
pnpm run db:studio      # 打开 Drizzle Studio
```

BPM 服务（Java）：

```bash
cd bpm/bpm-service
mvn clean package -DskipTests     # 构建 JAR
mvn spring-boot:run               # 直接运行（需本地 MySQL :3306）
```

## 架构概览

**后端** `Controller → Service → Drizzle ORM → PostgreSQL`

- 全局守卫：`JwtAuthGuard`（`@Public()` 跳过）、`RolesGuard`（`@Roles()`）、`AuthzGuard`（Casbin RBAC）
- 全局拦截器：`OperationInterceptor`（ mutation 审计写入 `sys_operation_records`）、`ResponseInterceptor`（自动包裹为 `{ code, msg, data }`）
- 认证流程：JWT（access 2h / refresh 7d）+ Casbin RBAC，角色层级 `super_admin → admin → editor → viewer`
- **软删除**：统一用 `deletedAt`，查询必须带 `isNull(deletedAt)`，不硬删

**前端** Umi Max（page → service → API）

- 运行时 `patchClientRoutes()` 按数据库菜单树过滤路由，实现按角色控制访问
- 共享 `request` 实例自动附加 Bearer token、401 刷新去重、成功时解包 `data`

**共享包** `@jimo/shared`：`ApiResponse<T>`、`PaginatedData<T>`、错误码（`1xxx` 鉴权 / `2xxx` 校验 / `3xxx` 业务 / `5xxx` 服务端）、枚举。

**API 契约**：响应包 `{ code, msg, data }`，`code: 0` 为成功；分页 `{ list, total, page, pageSize }`。

## 环境变量

在 `jimo/.env` 中配置（参考 `jimo/.env.example`）：

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串（Drizzle） |
| `JWT_SECRET` | access token 签名密钥 |
| `JWT_REFRESH_SECRET` | refresh token 签名密钥（必须不同于 JWT_SECRET） |
| `REDIS_URL` | Redis 连接 |
| `APP_PORT` | NestJS 端口（默认 8888） |
| `NODE_ENV` | `development` / `production` |

可选：`POSTGRES_*`、`MYSQL_*`、`CORS_ORIGIN`、`MINIO_*`、`BPM_SERVICE_URL`。

## 文档

- [docs/approval-design.md](docs/approval-design.md) — 审批设计
- [docs/approval-testing.md](docs/approval-testing.md) — 审批测试
- [docs/测试框架方案.md](docs/测试框架方案.md)
- [docs/芯片验证方法借鉴到软件测试.md](docs/芯片验证方法借鉴到软件测试.md)

## 许可证

MIT，详见 [LICENSE](LICENSE)。

仓库不包含任何 gin-vue-admin（BSL 1.1）源代码；仅在 `about` 页与 BPM 注释中保留对上游的致谢。
