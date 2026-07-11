# Context Map

## Contexts

- [Server](./jimo/apps/server/CONTEXT.md) — NestJS backend: low-code CRUD generation, RBAC/Casbin, approval engine
- [Web](./jimo/apps/web/CONTEXT.md) — React/Umi frontend consuming the server API
- [Shared](./jimo/packages/shared/CONTEXT.md) — cross-package TypeScript types and enums
- [BPM Service](./bpm/bpm-service/CONTEXT.md) — Java/Flowable workflow engine, contract module + generic approval task execution

## Relationships

- **Server → BPM Service**: Server starts approval processes and queries tasks via HTTP (`/bpm/api/approvals/*`); BPM Service resolves the concrete approver(s) for each step at task-creation time and reports outcomes back to Server via an HMAC-signed webhook.
- **Server → BPM Service (org mirror)**: Server is the source of truth for users/departments/roles; `BpmOrgSyncService` pushes user/department changes into BPM's own mirrored tables so BPM's assignee resolution can run locally without calling back into Server per task.
- **Server ↔ Shared**: Server imports `ApiResponse`/enum types from Shared.
- **Web ↔ Shared**: Web imports the same types from Shared for request/response typing.
