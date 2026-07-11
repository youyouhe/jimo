---
status: accepted
---

# Candidate resolution runs entirely on the Server side, not via BPM/Org Sync

Server's Role (`sys_roles`) and Position (`sys_employees.position`) data is real-time and authoritative. BPM's copy, pushed one-way by Org Sync, exists only to let BPM's legacy `AssigneeResolver` resolve approvers locally at task-creation time without calling back into Server — a need specific to how the legacy single-approver strategies (`SELF_DEPT_LEAD`, `BY_TITLE`, etc.) are wired into Flowable listeners.

The new combined-filter Candidate List query (role + org scope + position, see `CONTEXT.md`) is invoked from Server's own `ApprovalService` at submission and approval time — not from a Flowable listener — so there is no need to resolve it inside BPM at all. We decided it queries Server's tables directly and lives entirely in a new Server-side rule store, never touching BPM or Org Sync. This supersedes the "extend Org Sync" follow-up noted in ADR-0001: that follow-up assumed resolution would happen in BPM, which is no longer the design. Org Sync remains unchanged, serving only the legacy strategies that still run in BPM.
