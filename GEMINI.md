# GEMINI.md

All AI agent rules for this repository live in **[AGENTS.md](AGENTS.md)**. Read it before doing anything.

Quick reminders:
- One database per service. No cross-service imports. Only share code through `packages/common`.
- Event contracts: `packages/common/src/contracts.ts` (backward-compatible changes only).
- Migrations are append-only.
- Run `npm run build` before you finish, then go through the Definition of Done checklist (AGENTS.md §9).
