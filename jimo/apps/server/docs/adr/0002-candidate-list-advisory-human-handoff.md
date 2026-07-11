---
status: accepted
---

# Candidate lists are advisory queries for human hand-off, not Flowable candidateUsers/candidateGroups

Flowable natively supports multi-candidate tasks via `candidateUsers`/`candidateGroups`, where any candidate can claim or race to act on a task. Our new role/org/position combined-filter resolution rules (see `Resolution Rule` in `CONTEXT.md`) produce a Candidate List per approval-chain step, and the obvious path would be to write that list onto the Flowable task as native candidates.

We decided instead that the Candidate List is purely an advisory query result: at submission time the initiator picks one person from the first step's Candidate List, and at each subsequent approval the approver — while approving — picks one person from the next step's Candidate List as part of the same action. The picked person becomes the task's ordinary single `assignee`; the Candidate List itself is never written to Flowable and is not persisted beyond the query that produced it. If a step's Candidate List resolves to empty, the hand-off blocks with a visible error (no default fallback, no silent skip).

This was a deliberate simplification requested over the native candidate-group/claim pattern: it avoids building claim/unclaim UI and race-condition handling for a scenario where the business wants a human to make one explicit hand-off decision, not a pool of people independently racing to grab work. It keeps the existing single-`assignee` Flowable task model and `DynamicAssigneeListener` mechanism unchanged — only the source of the assignee changes, from fully automatic resolution (legacy `SELF_DEPT_LEAD`-style rules, still resolved in BPM) to a human pick from a candidate set queried on the Server side (see ADR-0003) and then handed to BPM as a plain assignee. The two rule styles coexist (see ADR-0001), so not every step in a chain presents a picker — only steps using the new rule type do.
