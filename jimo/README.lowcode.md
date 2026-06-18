# Jimo Platform

自主构建的低代码管理平台，MIT 许可证。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | NestJS 11 · Drizzle ORM · PostgreSQL 16 · Redis 7 |
| 前端 | React 18 · Ant Design Pro (Umi 4) · Zustand |
| 项目结构 | pnpm workspace monorepo · Turborepo |
| BPM | Flowable 6.8 (bpm-service，保持不变) |
| 开发环境 | Docker Compose |

## 快速开始

```bash
# 1. 克隆并进入目录
git clone <repo> && cd gin-vue-admin

# 2. 复制环境变量（按需修改）
cp .env.example .env

# 3. 启动全部服务（PostgreSQL + MySQL + Redis + NestJS + React + BPM）
docker compose -f docker-compose.dev.yml up -d

# 4. 等待约 30 秒，验证服务就绪
curl http://localhost:8888/api/v1/health

# 5. 浏览器访问前端
open http://localhost:8000   # 默认账号 admin / admin123
```

## 端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| React 前端 | 8000 | Umi dev server |
| NestJS 后端 | 8888 | REST API + Swagger |
| BPM Service | 8090 | Flowable REST API |
| PostgreSQL | 5432 | 主数据库 (NestJS) |
| MySQL | 3306 | BPM 数据库 (Flowable) |
| Redis | 6379 | 缓存/Token 黑名单 |

## API 文档

Swagger UI: http://localhost:8888/api/docs

## 开发命令

```bash
# 安装所有工作区依赖
pnpm install

# 仅启动基础设施（数据库 + 缓存）
docker compose -f docker-compose.dev.yml up -d postgres mysql redis

# 本地运行后端（热重载）
cd apps/server && pnpm run dev

# 本地运行前端（热重载）
cd apps/web && pnpm run dev

# 数据库操作
cd apps/server && pnpm run db:generate   # 生成迁移
cd apps/server && pnpm run db:migrate    # 执行迁移
cd apps/server && pnpm run db:seed       # 写入种子数据
```

## 目录结构

```
gin-vue-admin/
├── apps/
│   ├── server/         # NestJS 后端
│   │   ├── src/
│   │   │   ├── common/         # 装饰器、过滤器、拦截器、守卫
│   │   │   ├── core/auth/      # JWT 认证模块
│   │   │   ├── database/       # Drizzle ORM Provider
│   │   │   ├── db/             # Schema + 迁移 + 种子数据
│   │   │   ├── health/         # 健康检查
│   │   │   └── modules/user/   # 用户管理模块
│   │   └── migrations/         # drizzle-kit 生成的 SQL
│   └── web/            # React + Ant Design Pro 前端
│       └── src/
│           ├── pages/login/    # 登录页
│           ├── pages/dashboard/ # 首页
│           ├── services/       # API 请求层
│           └── stores/         # Zustand 状态
├── packages/
│   └── shared/         # 前后端共享类型 (@jimo/shared)
│       └── src/
│           ├── api.ts          # ApiResponse, PaginatedResponse
│           └── enums.ts        # UserStatus, RoleCode, ApiErrorCode
├── bpm-service/        # Flowable BPM（保持不变）
├── docker/             # Dockerfile 集合
└── docker-compose.dev.yml  # 开发环境一键启动
```

## Phase 2 路线图

- 角色管理 (sys_roles + sys_user_roles)
- Casbin RBAC 权限控制 (node-casbin + Redis 策略同步)
- 动态菜单 (sys_menus + patchRoutes 注入)
- 按钮级权限控制
- 代码生成器 (Hygen + Protected Region 模式)

## 许可证

MIT
