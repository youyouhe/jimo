# 审批与归属系统 · 测试指南

> 测试本会话构建的全部能力：原生部门、用户/部门同步、归属隔离/共享/转交、审批流。
> 前提：`release/jimo/.env` 已配好（`DATABASE_URL` / `JWT_SECRET` / `JWT_REFRESH_SECRET` / `BPM_SERVICE_URL=http://localhost:8090`）。

## 0. 启动

```bash
cd release
bash jimo/scripts/dev-all.sh up        # 一键：infra(docker) + BPM + 后端 + 前端
bash jimo/scripts/dev-all.sh status    # 查看端口/健康
bash jimo/scripts/dev-all.sh logs backend   # 看某服务日志（bpm|backend|frontend|infra）
bash jimo/scripts/dev-all.sh down      # 停后端/BPM/前端（docker infra 保留）
```

启动后：
- 前端 http://localhost:8000 ｜ 后端 Swagger http://localhost:8888/api/docs ｜ BPM http://localhost:8090/bpm/api/health
- **登录账号：`admin` / `admin123`**（应为 `super_admin` 角色；若不是，见文末排错）
- 共享密钥默认 `bpm-dev-shared-secret-2026`（脚本自动给两侧；改用 `APPROVAL_SECRET=xxx bash scripts/dev-all.sh up`）

---

## A. 原生部门管理（系统页）

**操作**：登录 → **系统管理 → 部门管理** → 新建部门（如 名称`研发部`、编码`RD`、负责人选某个用户）。

**验证**：
- 列表出现该部门，"负责人"列显示选的人。
- BPM 侧已镜像：`docker exec lowcode-mysql mysql -uroot -p123456 jimo_bpm -e "SELECT id,name,lead_id FROM departments WHERE id='RD';"`

---

## B. 用户 + 部门 → BPM 同步

**操作**：**系统管理 → 用户管理** → 新建用户（角色选 `editor`，**所属部门选刚建的部门**）。

**验证**（同步是建用户时自动触发的）：
- 后端日志 `backend.log` 出现 `syncUser ...: created BPM user EMPxxx`。
- NestJS 库回写了 bpm_user_id：
  ```bash
  docker exec lowcode-postgres psql -U lowcode lowcode_db -c \
    "SELECT username, dept_id, bpm_user_id FROM sys_users WHERE username='<你建的用户名>';"
  ```
  `bpm_user_id` 应为 `EMP009+`。
- BPM 侧有该用户：`docker exec lowcode-mysql mysql -uroot -p123456 jimo_bpm -e "SELECT id,name,dept_id FROM users WHERE id='<那个EMP号>';"`
- ⚠️ 用户**必须有部门**才会同步（BPM 要求 dept）；没部门的用户 `bpm_user_id` 为空。

---

## C. 归属隔离 / 共享 / 转交

先**代码生成器**生成一张普通业务表（不勾审批，随便几个字段）→ 重建前端 → 该表自动带 `owner_id`。

### C1. owner 隔离
1. 用 **editor 用户 A** 登录 → 进该表页 → 新建 2 条。
2. 登出，用 **editor 用户 B** 登录 → 该表页 → 新建 1 条。
3. **预期**：A 只看到 A 的 2 条；B 只看到 B 的 1 条；**admin（super_admin）看到全部**。
   - 机制：生成的 `findAll` 按 `owner_id = 当前用户` 过滤，admin 不过滤。

### C2. 共享（share）
A 把自己的一条记录共享给 B（owner-only，当前需走 Swagger，UI 按钮待加）：
- Swagger → `POST /api/v1/ownership/share`，body：
  ```json
  { "businessType": "<表名 snake_case>", "businessId": "<记录id>", "userIds": ["<B的user id>"] }
  ```
- 用 **A 的 token** 调（A 是 owner）。调完 B 再看该表 → 能看到这条共享记录。

### C3. 转交（transfer，离职交接锚点）
- Swagger → `POST /api/v1/ownership/transfer`，body：
  ```json
  { "businessType": "<表名>", "businessId": "<记录id>", "newOwnerId": "<B的user id>" }
  ```
- 用 **A 的 token** 调。调完后该记录 owner 变 B、`shared_with` 清空；A 不再可见，B 可见。

> `businessType` 是表名的 **snake_case**（如 `expense_claims`），即 `lc_<businessType>` 的后缀。

---

## D. 审批流（核心）

### 准备：建组织（审批人靠部门负责人解析）
1. **部门管理**：建部门 `RD`，**负责人 = 用户 L**。
2. **用户管理**：建用户 `U`，**所属部门 = RD**（这样 `deptHead` 规则解析到 L）。
   - 确认 U、L 都已同步到 BPM（`bpm_user_id` 非空，见 B）。

### 生成带审批的业务表
3. **代码生成器**：表名如 `expense`，加几个字段，**高级选项里 approvalFlow.enabled = true**，`defaultChain = ["deptHead"]` → 生成。
   - 该表自动写入 `sys_approval_flows`（business_type=`expense`）+ 生成的页面带"提交审批"按钮。

### 发起审批
4. 用 **U** 登录 → 进 expense 表页 → 新建一条 → 点该行的 **「提交审批」**。
   - 后端按 `deptHead` 动态解析 → 任务分给 **L**。
   - 验证：`docker exec lowcode-postgres psql -U lowcode lowcode_db -c "SELECT business_type,status,initiator_id FROM lc_business_approvals WHERE business_type='expense';"` → `status=PENDING`。

### 审批（审批人侧，走 Swagger —— 待办 UI 未建）
5. 用 **L** 登录，Swagger 顶部 Authorize 填 L 的 token：
   - `GET /api/v1/approvals/my-tasks` → 拿到 `processInstanceId`。
   - `POST /api/v1/approvals/{processInstanceId}/approve` body `{"approved":true,"comment":"同意"}`。
6. **验证闭环**：
   - BPM 日志 `bpm.log` 出现 `BPM→NestJS webhook delivered businessId=... status=APPROVED`。
   - `lc_business_approvals` 该行 `status=APPROVED`、`approver_id = <L 的 bpm_user_id>`。

### 动态链（可选，验证规则引擎）
- 把 `sys_approval_flows` 里 `expense` 的 config 改成带条件规则：
  ```bash
  docker exec lowcode-postgres psql -U lowcode lowcode_db -c \
    "UPDATE sys_approval_flows SET config='{\"rules\":[{\"when\":{\"amount\":{\"gt\":50}},\"chain\":[\"deptHead\",\"ceo\"]}],\"defaultChain\":[\"deptHead\"]}'::jsonb WHERE business_type='expense';"
  ```
- U 提交时 record 里 `amount>50` → 链变 `[deptHead,ceo]`（多一级）；`amount<=50` → `[deptHead]`。

---

## E. 合同审批（遗留流，确认没被破坏）
BPM 自带的合同流仍可用（不经 NestJS 门面）：
- Swagger 打开 BPM：http://localhost:8090/bpm/api（或直接 curl，带 `x-user-id: EMP001` 头）。
- `POST /contracts`（EMP001 建）→ `POST /contracts/{id}/submit`（EMP001）→ `POST /contracts/{id}/approve`（EMP003，header `x-user-id: EMP003`）。
- 预期：BPM 日志 `webhook delivered` + NestJS `lc_business_approvals` 落 `business_type=contract, status=APPROVED`。

---

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| admin 看不到全部记录（owner 隔离对 admin 也生效）| admin 角色不是 `super_admin`/`admin`。修：`UPDATE sys_users SET role='super_admin' WHERE username='admin';` |
| 用户没同步到 BPM（`bpm_user_id` 空）| 用户**没分配部门**。先建部门、给用户分配部门，再建/改用户。或对存量跑 `node release/jimo/scripts/backfill-bpm-org.mjs` |
| 审批提交后任务没人接 / 待办空 | 发起人或部门负责人没同步到 BPM（见上），或部门没设负责人。`deptHead` 规则解析的是发起人**部门负责人**。 |
| 回调没到 NestJS（BPM APPROVED 但 NestJS 表没更新）| 共享密钥两侧不一致；或 NestJS 没起。检查 `APPROVAL_SECRET` 一致 + 后端 health。BPM 日志会有 `webhook failed`。 |
| 审批人 approve 报 403 | 审批人（editor）对 `/approvals/*` 没 Casbin 权限。用 super_admin 测，或给该角色注册 API 权限（小尾巴）。 |
| `nest build` 报一堆 drizzle 错 | 正常（obs 6576 存量坑），带错仍 emit，不影响运行。 |
| 菜单不显示 / 改动没生效 | 前端路由变更需**重启前端**；菜单改动需**重新登录**（菜单树缓存）。 |

## 关键表速查
- NestJS(PG)：`lc_business_approvals`（审批状态）、`sys_approval_flows`（每类型审批链规则）、`sys_departments`、`sys_users.bpm_user_id/dept_id`。
- BPM(MySQL)：`approval_requests`、`users`、`departments`、Flowable `ACT_*`。
