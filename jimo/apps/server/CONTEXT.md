# Server (NestJS)

The low-code platform's backend: generates CRUD modules from schema definitions, enforces RBAC, and runs the approval engine that routes generated business records through BPM for sign-off.

## Language

**Platform Role**:
A named permission grouping (`sys_roles`) that a user is assigned via `sys_user_roles`, enforced by Casbin for API-level access control. This is the platform's single source of truth for "who can do what."
_Avoid_: BPM role, permission group

**Position (岗位)**:
The real-world job title of a person (`sys_employees.position`, e.g. "采购经理"), independent of platform Role. A person's Position does not grant any platform permission by itself — it is an organizational/HR attribute, used by approval candidate resolution as a filter dimension.
_Avoid_: title, job title, BPM title

**Approval Chain**:
An ordered list of resolution-rule names (e.g. `["deptHead", "deptFinance"]`) computed once at submission time by evaluating `sys_approval_flows` rules against the submitted record's fields. Each element names a step, not a person.
_Avoid_: approval flow, workflow steps

**Candidate List (候选人列表)**:
The set of people eligible for one approval-chain step, resolved at the moment that step is reached (not at submission time). The Candidate List is not a shared pool that multiple people race to act on — instead, exactly one person is designated from it as the step's actual approver: the initiator picks from the first step's Candidate List when submitting, and thereafter each approver, upon approving their step, picks the next approver from the following step's Candidate List (combining "approve" and "hand off" into one action). If the last step's approval completes the chain, no further pick happens. If a step's Candidate List resolves to zero people, the step blocks with a visible error rather than falling back to a default or skipping silently — this is distinct from co-signing (a different, not-yet-built task type where every listed person must act).
_Avoid_: assignee (legacy — implies system-computed, not human-picked), approver pool, or-sign (this is "pick one," not "first to act wins")

**Resolution Rule**:
A named, reusable definition (BPM `resolution_rules` table) of how to compute a Candidate List for an approval-chain step. A rule may combine Platform Role, Org Scope, and Position as independent, optional filters — the Candidate List is the intersection of whichever filters are set. If the intersection is empty, the step blocks and surfaces an error rather than falling back to a default approver or skipping the step silently.
_Avoid_: strategy (legacy single-person term), assignee rule

**Org Scope**:
The organizational-unit filter within a Resolution Rule. Takes one of two forms: a **fixed department** (a specific department, optionally its subtree), or a **relative anchor** resolved against the submitter's own department at task-creation time — `self` (the submitter's department), `parent` (the submitter's department's direct parent, one level only), or `company` (the submitter's top-level ancestor department, i.e. the root of its department tree, always including its full subtree). There is no "group" anchor — a department forest with multiple top-level roots has no single node representing "the whole group," so no rule can scope to it.
_Avoid_: department scope, org filter

**Org Sync**:
The one-way mirror (`BpmOrgSyncService`) that pushes Server's users/departments/roles into BPM's local tables so BPM can resolve Candidate Lists without calling back into Server per task. Server is always the source of truth; BPM's copy is a read-side mirror for resolution only.
_Avoid_: user sync, org mirror (fine as a description, but "Org Sync" is the canonical name for the mechanism)
