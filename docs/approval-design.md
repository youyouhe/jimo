# 审批与归属体系设计 · jimo 低代码平台

> 状态：方案已定，MVP（BPM↔NestJS 回调通道）实施中
> 决策来源：与 DeepSeek 的架构讨论 + 对 `release/bpm/` 与 `release/jimo/` 的代码核查
> 日期：2026-06-19

## 1. 背景与核心结论

低代码平台要给业务表挂「审批流」，并解决「记录归属谁」的数据隔离问题。DeepSeek 给的是通用蓝图，但代码库现状与之有几处根本差异，本方案据此落地：

| 议题 | 通用假设 | 代码库实际 | 本方案对策 |
|---|---|---|---|
| BPM 定位 | 通用、数据轻量引擎 | 自包含合同审批 App，自带合同业务表+自有用户体系 | **BPM 永久合同专用（冻结）；NestJS 自建通用引擎** |
| NestJS↔BPM | 已集成 | 零集成，`BPM_SERVICE_URL` 定义未用 | MVP 先建回调通道 |
| 状态回调 | 已有 | 不存在（仅 JVM 内 TaskListener） | 在 `ContractStatusListener` 加 webhook 出口 |
| 业务表归属字段 | 强制预置 owner 等 | 仅 2 张 `lc_*` 表有审计用 `created_by`，从不参与查询过滤 | 归属引擎全新建设（P2） |
| 行级权限 | 隐含有 | Casbin 只做 API 路径+方法级，行级零支持 | 行级归属不进 Casbin，放 Service 基类 |
| 生成方式 | 运行时元数据驱动 | **构建期 codegen**（生成 TS 写盘+提交） | 规则 codegen 固化进生成代码 |
| 部门模型 | 可用 | `lc_departments` 存在但 `sys_users` 无 `dept_id` 外键 | P2 补外键 |

## 2. 目标架构：两执行器 + 统一门面

```
                       NestJS 低代码平台（单一审批门面）
   lc_posts / lc_orders ──→  ApprovalService（统一门面）
   lc_contracts(mirror)       ├─ executor='nestjs' → 内置轻量状态机
                              └─ executor='bpm'    → 代理到 BPM
                              lc_business_approvals（统一追踪表）
                                       │ 启动/查询(HTTP+HMAC)    │ 状态回调(webhook+HMAC)
                                       ▼                         ▼
                          BPM（合同专用·冻结）         合同流在此执行
                          Flowable + 合同业务表        ContractStatusListener
```

- NestJS 暴露唯一审批门面 `ApprovalService`，对 UI 一致。
- `executor` 字段决定路由：`contract` → 代理 BPM；其它 codegen 表 → NestJS 自建轻量状态机。
- 合同尊重既有投资不动；新业务表零依赖 BPM。

## 3. 已确定的五项决策

1. **BPM 定位**：永久合同专用；NestJS 自建通用引擎（contract 走 BPM，其余走 NestJS）。
2. **行级归属引擎落点**：生成的 `Service extends OwnableCrudService<T>`，基类在 list/get/update 注入归属过滤。
3. **规则模型**：Codegen 固化（归属策略/审批开关作为生成 flag 烘焙进生成代码）。
4. **MVP 首切片**：先建 BPM↔NestJS 回调通道。
5. （由 1 推出）回调契约从 day 1 用通用字段 `{businessType, businessId, status, processInstanceId, approver, comment}`，`businessType` 暂只有 `contract`。

## 4. MVP：BPM↔NestJS 回调通道

目标：跑通一条真实合同审批，验证最难的**服务间契约**（鉴权、关联、幂等、状态同步）。

### 4.1 BPM 侧（Java，改动极小）

| # | 文件 | 改动 |
|---|---|---|
| B1 | `ContractController.java` 审批处（约 216 行） | 盖戳流程变量 `lastApprover`、`lastApprovalComment`（各 1 行） |
| B2 | `ContractStatusListener.java`（约 34–36 行 `if(newStatus!=null)` 块） | `updateStatus` 后 `publishEvent(new ApprovalOutcomeEvent(...))` |
| B3 | 新增 `ApprovalWebhookPublisher`（`@TransactionalEventListener(AFTER_COMMIT)`） | `RestTemplate` POST 到 NestJS；HMAC-SHA256 签名，`X-BPM-Signature`+`X-BPM-Timestamp` 头；AFTER_COMMIT 保证 NestJS 宕机不回滚 Flowable 事务 |
| B4 | `application.yml` | `nestjs.callback.url` / `nestjs.callback.secret` / `nestjs.callback.timeout` |
| B5 | 新增 `@Bean RestTemplate` 配置 | Spring Boot 2.7 不自动装配 RestTemplate |

**幂等天然成立**：notice-task-create 每结局每实例只触发一次。

### 4.2 NestJS 侧（TypeScript）

| # | 文件 | 改动 |
|---|---|---|
| N1 | `packages/shared/src/enums.ts` | `BusinessApprovalStatus` + `ApprovalExecutor` |
| N2 | `db/schema/business-approvals.ts` | 表 `lc_business_approvals`：`businessType, businessId, executor, status, processInstanceId, initiatorId, approverId, comment, payload(jsonb)` + 标准时间戳/软删；`(businessType,businessId)` 唯一(软删) |
| N3 | `modules/approval/approval.service.ts` | `applyBpmOutcome`：按 `(businessType,businessId)` 幂等 upsert，重复同状态直接 ack |
| N4 | `modules/approval/approval.controller.ts` | `POST /api/v1/webhooks/bpm/approval`，`@Public()` + `BpmSignatureGuard` |
| N5 | `modules/approval/bpm-signature.guard.ts` + `hmac.util.ts` | HMAC-SHA256 验签 + 时间戳防重放窗口（±5min） + 常数时间比较 |
| N6 | `modules/approval/bpm-callback.dto.ts` | `class-validator` 载荷契约 |
| N7 | `main.ts` | `NestFactory.create(AppModule, { rawBody: true })`（HMAC 需原始字节） |
| N8 | `app.module.ts` | 注册 `ApprovalModule` |
| N9 | `.env` | `BPM_CALLBACK_SECRET`、`BPM_SERVICE_URL` |

### 4.3 MVP 简化项（P1 补）
- **身份映射**：MVP 直接存 BPM `EMPxxx`，不映射 `sys_users`；P1 建 `sys_users.bpm_user_id` + 同步。
- **发起审批**：MVP 暂用 BPM 服务账号代发；P1 做"以当前用户身份发起"。
- **流程图**：BPM `/diagram` 端点实测 404，MVP 不做图；P1 补。

### 4.4 验收标准
1. BPM 审批通过 → 5s 内 `lc_business_approvals` 出现 `status=APPROVED` 行。
2. 重复回调 → 第二次 ack 200 但不产生第二行、`replay=true`。
3. 伪造签名/超时 → 401。
4. NestJS 重启期间 BPM 回调不丢（BPM 重试 + AFTER_COMMIT）。

## 5. 回调契约（BPM → NestJS）

- 方法：`POST {NESTJS_URL}/api/v1/webhooks/bpm/approval`
- 头：`X-BPM-Signature: <hex hmac-sha256(secret, timestamp + "." + rawBody)>`、`X-BPM-Timestamp: <epoch ms>`
- 体：
  ```json
  {
    "businessType": "contract",
    "businessId": "<contract id>",
    "processInstanceId": "<flowable instance id>",
    "status": "APPROVED",
    "initiatorId": "EMP003",
    "approverId": "EMP008",
    "comment": "同意",
    "occurredAt": "1718772000000"
  }
  ```
- 鉴权：HMAC-SHA256 共享密钥 + ±5min 时间戳窗口。
- 关联键：`processInstanceId`（Flowable 原生 `businessKey` 未启用，勿依赖）。
- 幂等：NestJS 按 `(businessType, businessId)` 单行 + 同状态重放 ack。

## 6. 路线图

| 阶段 | 内容 |
|---|---|
| **MVP** | BPM↔NestJS 回调通道（§4） |
| **P1** | NestJS 自建轻量审批引擎（codegen 表用内置状态机；`executor='nestjs'` 分支） |
| **P2** | 归属引擎：`OwnableCrudService<T>` 基类 + codegen 注入 `owner_id/owner_dept_id/shared_with` + `sys_users.dept_id` 外键 + 策略 A/B/C/D |
| **P3** | Codegen 审批/归属开关：`AutoCodeDto` 加 `ownershipStrategy`/`approvalFlow` flag → 分支生成器 |
| **P4** | 策略 D 版本与发布：复用 `auto-code-histories` 的 `version+parentId` 模式；PUBLISHED 只读 + 发起新版本 |
| **P5** | 身份映射与离职交接：`sys_users.bpm_user_id` 同步、`transferOwnership` API |

## 7. 遗留待讨论（不阻塞 MVP）
1. **P1 引擎形态**：纯配置状态机 vs 嵌入 BPMN 引擎（`bpmn-engine`）。倾向前者。
2. **审批人解析**：是否在 NestJS 复刻 BPM 的 `AssigneeResolver`（SELF_DEPT_LEAD/BY_TITLE…），P1 先支持"指定人/指定角色"。
3. **contract 在低代码 UI 的呈现**：合同数据在 BPM，UI 列表是否镜像只读到 NestJS，或跳转 BPM。

## 8. 文件清单（MVP NestJS 侧）
- `jimo/packages/shared/src/enums.ts`
- `jimo/apps/server/src/db/schema/business-approvals.ts`（新）
- `jimo/apps/server/src/db/schema/index.ts`
- `jimo/apps/server/src/modules/approval/`（新：module/controller/service/dto/guard/util）
- `jimo/apps/server/src/app.module.ts`
- `jimo/apps/server/src/main.ts`

## 9. 实施状态与待办

### 已完成（MVP，两侧编译/类型检查通过）
- NestJS：N1–N9 全部写入；`tsc --noEmit` 对本模块零错误（仅 `node_modules` 内 drizzle-orm 畸形 `.d.ts` 存量报错，obs 6576）。
- BPM：B1–B5 全部写入；`mvn -o compile` exit 0。
- HMAC 验签单测 `hmac.util.spec.ts` 4/4 通过——锁定 BPM↔NestJS 签名契约（`hex HMAC-SHA256(secret, timestamp + "." + body)`）。

### 数据库迁移（已处理）
`lc_business_approvals` 已直接建库（表 + 3 索引，`IF NOT EXISTS` 幂等，已验证 `to_regclass` 命中）。

> **存量问题（非本表引起）**：本项目 DB 一直用 `drizzle-kit push` 同步，迁移快照长期滞后——`lc_posts`/`lc_departments`/`sys_encoding_rules` 等都是 push 建的，从未进过迁移文件。因此 `pnpm run db:migrate` 在本库会因「表已存在」失败。**新增表请统一用 `drizzle-kit push`，不要用 migrate。** 之前 `db:generate` 产生的 0004（打包了全部脱节）已撤销（删 0004 sql/snapshot + 回退 `_journal.json`）。建议团队后续二选一：统一 `push`，或从当前库重生成迁移基线。

建表 SQL（新环境/备查，风格对齐既有迁移）：

```sql
CREATE TABLE "lc_business_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_type" varchar(50) NOT NULL,
	"business_id" varchar(64) NOT NULL,
	"executor" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"process_instance_id" varchar(64),
	"initiator_id" varchar(64),
	"approver_id" varchar(64),
	"comment" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_business_approvals_biz_active" ON "lc_business_approvals" USING btree ("business_type","business_id") WHERE "lc_business_approvals"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_business_approvals_proc" ON "lc_business_approvals" USING btree ("process_instance_id");--> statement-breakpoint
CREATE INDEX "idx_business_approvals_status" ON "lc_business_approvals" USING btree ("status");
```

### 待配置环境变量（两侧密钥必须一致）
- NestJS（`jimo/apps/server/.env`）：`BPM_CALLBACK_SECRET=<同 BPM>`
- BPM（启动环境）：`NESTJS_CALLBACK_SECRET=<同上>`、`NESTJS_CALLBACK_URL=http://<nestjs-host>:8888/api/v1/webhooks/bpm/approval`

### 联调验收（§4.4）✅ 全部通过（2026-06-19 实跑）
启 PostgreSQL + MySQL(容器) + BPM(8090, `mvn spring-boot:run`) + NestJS(8888)，EMP001 建 CC01 合同(5万) → 提交(链 `[deptHead]`→EMP003) → EMP003 审批通过：
1. ✅ BPM 日志 `BPM→NestJS webhook delivered businessId=e651cd72ca104f4f status=APPROVED attempt=1`。
2. ✅ `lc_business_approvals` 落一行 `business_type=contract, status=APPROVED, executor=bpm, initiator_id=EMP001, approver_id=EMP003`，`process_instance_id` 正确关联。
3. ✅ 重放同一回调 → `replay=true`，无第二行（curl 模拟已验）。
4. ✅ 篡改签名/超时 → 401（curl 模拟已验）。

**实跑中顺带修复的存量 bug**：BPM `application.yml` 的 JDBC URL `characterEncoding=utf8mb4`（MySQL 字符集名误当 Java 字符集名，mysql-connector-j 8.0.33 拒绝）→ 改为 `characterEncoding=UTF-8`。

## 10. P1（通用化 Flowable）实施状态 ✅ 全部完成（2026-06-20）

> Q1 决策更新：原定"BPM 永久合同专用 + NestJS 自建引擎"，经讨论改为 **"通用化 Flowable"**——BPM 升级为通用引擎，合同保留为首消费者，新业务表经通用层接入。链路来源 = **B：每业务类型运行时规则**（非预定、按记录字段动态求值）。

### P1.0 用户/部门同步 + 部门原生化 ✅
- `sys_departments`（持久 sys_，含 `lead_id`）+ `sys_users` 加 `dept_id`(FK) + `bpm_user_id`；废弃 `lc_departments`。
- 部门重做为**原生系统功能**：手写 `/system/departments` 页（树+负责人选择器），挂"系统管理"菜单（修正了先前误挂 `/lc/departments` 生成页的问题）。
- BPM 加 `POST/PUT/DELETE /api/admin/users` + `/departments`（EMP id 自动生成、dept upsert、synced 用户默认分 R02 角色）；NestJS `BpmOrgSyncService` 挂 user/dept CRUD 实时推送 + 回填 `bpm_user_id`；回填脚本 `backfill-bpm-org.mjs`。
- **E2E**：NestJS 建部门/用户 → BPM 镜像 + `bpm_user_id` 回写；删除 → 双向清零。

### P1.1 BPM 通用审批层 ✅
- `approval_requests` 表（business_type/business_key/process_key/status）+ `generic-approval.bpmn20.xml`（universal 的通用版：businessType/businessKey + `genericApprovalListener`）+ `GenericApprovalListener`（更新 approval_requests + 发**既有** `ApprovalOutcomeEvent`）+ `ApprovalController`（`/api/approvals` start/my-tasks/approve/status）。
- 合同流原样不动；通用回调通道同时服务合同与任意业务类型。
- **E2E**：`post/post-e2e-1`（EMP001→deptHead→EMP003）→ BPM APPROVED → webhook → NestJS 落 APPROVED。

### P1.2 NestJS 审批门面 + 动态链 ✅
- `sys_approval_flows`（每业务类型运行时规则，config=`{rules:[{when:{字段:{op:值}},chain:[...]}], defaultChain:[...]}`）。
- `ApprovalService`：`startApproval`（按记录字段求值规则→动态 chain→调 BPM start→写 lc_business_approvals）+ `getMyTasks`/`approve` 代理 + 流程配置 CRUD。
- **E2E**：amount=10→`[deptHead]`、amount=100→`[deptHead,ceo]`（动态链分支正确）；同步用户审批→回调→APPROVED。
- 顺带修：部门 DTO `= ''` 默认值（致 PATCH 失败）；org 同步给 synced 用户分 R02 角色（否则无审批权限）。

### P1.3 codegen 审批开关 ✅
- `AutoCodeDto` 加 `approvalFlow`（enabled/defaultChain）；生成器（sync + async 两路径）`enabled`→upsert `sys_approval_flows`(business_type=tableName)；前端生成器条件产出 `submit{Entity}Approval` service fn + "提交审批"按钮。
- **验证**：preview 条件正确；真实 generate `zz_p13b` → `sys_approval_flows` 落行 + 生成页含提交按钮（已清理测试模块）。

### 端到端闭环
代码生成器勾选"启用审批" → 写 `sys_approval_flows` + 生成提交按钮 → 用户提交 → NestJS 按记录动态算 chain → BPM 通用流 → `AssigneeResolver` 按组织动态解析审批人 → HMAC 回调 → NestJS 状态同步。

## 11. P2（归属引擎）实施状态

> 路径决策：A（OwnershipHelper 注入 + universal 列），非"继承基类"——因生成的 service 有 relation/code 复杂逻辑，基类重构代价大。

### P2.owner MVP ✅（已提交 2e74579，2026-06-21）
- 生成的 `lc_*` 表 universal 加 `owner_id`（+ `shared_with` 在 SQL 层备用）。
- `OwnershipHelper`（global）：非管理员 → `owner_id = 当前用户`；admin/super_admin → 不过滤（看全部）。
- 生成器：`findAll(query, userId, isAdmin)` 注入过滤；`create(dto, userId)` 盖戳 `ownerId`；controller 经 `@CurrentUser` 传用户/角色。
- **E2E**：非管理员 GET→只看自己（1 条）；super_admin GET→全部（3 条）。

### P2 仍待办
- `shared_with` 过滤（Drizzle schema 加 jsonb 列 + 过滤 `owner_id=me OR shared_with ∋ me`）——完成策略 B。
- 通用 `share` / `transferOwnership` API（动态表更新，离职交接锚点）。
- 策略 A（强私有）/ C（部门共享）/ D（公开资产 + 版本）。

## 12. 仍待办（全局）
- P2 后续（见 §11）：shared_with 过滤 + share/transfer + 策略 A/C/D。
- P4 策略 D 版本与发布。
- 小尾巴：NestJS 角色→BPM 角色精细映射、`approval:approve` 专用权限、BPM CJK 存储复核、admin 走 `sys_apis` 注册。
- 存量坑：drizzle-orm `.d.ts` 畸形（obs 6576，`nest build` 带错仍 emit）；DB 用 `drizzle-kit push` 同步（迁移快照脱节，勿用 migrate）。
