---
status: accepted
---

# Approval candidate resolution uses Server's Role/Position, not BPM's local role table

BPM (Java/Flowable) has its own local `roles`/`permissions`/`role_permissions` tables (R01–R04: 系统管理员/合同管理员/普通用户/表单设计者), scoped to its legacy contract module. Server is the platform's actual RBAC source of truth (`sys_roles` + Casbin), and separately tracks real job Position via `sys_employees.position`. Prior to this decision, `BpmOrgSyncService` synced a derived, concatenated string of Server role names into BPM's `users.title` column — conflating "role" and "position" into one cosmetic field.

We decided the new candidate-list resolution rules (role/org/position combinable filters) resolve against Server's Role and Position as separate, authoritative dimensions. Reusing BPM's contract-scoped roles would mix an unrelated permission model into general-purpose approval routing, and the existing title-concatenation hack (`syncUser`, `bpm-org-sync.service.ts`) is not queryable per-dimension.

**Correction (see ADR-0003):** the new resolution rules run entirely on the Server side, querying `sys_users`/`sys_user_roles`/`sys_roles`/`sys_employees` directly — not via BPM or Org Sync. The "extend Org Sync to carry role/position separately" follow-up originally noted here does not apply to the new rule type; Org Sync is unchanged and continues to serve only the legacy BPM-side strategies (`SELF_DEPT_LEAD` etc.).
