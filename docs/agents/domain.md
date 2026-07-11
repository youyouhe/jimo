# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is multi-context: `CONTEXT-MAP.md` at the root points to one `CONTEXT.md` per context.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — system-wide decisions that touch the area you're about to work in.
- **Context-scoped ADRs** — also check `docs/adr/` inside the relevant context directory for decisions scoped to that context.

If any of these files don't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
├── jimo/
│   ├── apps/
│   │   ├── server/
│   │   │   ├── CONTEXT.md
│   │   │   └── docs/adr/              ← NestJS backend decisions
│   │   └── web/
│   │       ├── CONTEXT.md
│   │       └── docs/adr/              ← React/Umi frontend decisions
│   └── packages/
│       └── shared/
│           ├── CONTEXT.md
│           └── docs/adr/              ← shared types/enums decisions
└── bpm/
    └── bpm-service/
        ├── CONTEXT.md
        └── docs/adr/                  ← Java/Spring Boot/Flowable BPM decisions
```

The four contexts are: `jimo/apps/server` (NestJS backend), `jimo/apps/web` (React frontend), `jimo/packages/shared` (shared TypeScript types/enums), and `bpm/bpm-service` (Java BPM service). Each gets its own `CONTEXT.md` and `docs/adr/` once created.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant context's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
