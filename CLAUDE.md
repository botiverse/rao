# Rao

Electron client for coding agents, driven through `@botiverse/oar`. Read
`docs/ARCHITECTURE.md` before changing process boundaries.

## Commands

- `pnpm dev` runs the app with HMR. `pnpm check` must pass before a commit:
  it runs `typecheck`, `lint` (oxlint, type-aware, warnings fail), `format:check`
  (oxfmt) and `test` (vitest).
- `pnpm fix` applies lint autofixes and formats.

## Rules

- Anything crossing a process boundary is declared in `src/shared/ipc.ts`.
  Add the type and the channel there first, then the main handler, then the
  preload method. `src/shared` must not import `electron` or Node built-ins.
- Only `src/main/agents/host.ts` calls runtime execution APIs. Browser-safe
  `@botiverse/oar/observe` and `/brands` are also used by the renderer.
- Project metadata lives in main-owned `src/main/projects/store.ts` (SQLite).
  The renderer is an in-memory cache; acknowledge saves only after IPC succeeds.
  Project lifecycle spans SQLite and JSONL through
  `ProjectService` with durable recovery intent.
- Conversation persistence is `src/main/sessions/store.ts`: append-only JSONL
  of complete OAR records with stream-instance IDs, plus `index.json`.
  Do not store a UI-shaped transcript or rewrite historical event logs.
- The renderer is sandboxed: no Node, no Electron, no `require`. Talk to main
  through `window.rao` only.
- Transcript state is a pure fold over OAR records using its conversation reducer in
  `src/shared/transcript.ts` (re-exported by `src/renderer/src/lib/transcript.ts`). Extend the fold and its tests rather
  than mutating transcript items from components.
- Tool call identity is `(agentPath, callId)`, never `callId` alone.
- Do not synthesize facts the runtime did not report (turn boundaries,
  tool outcomes). oar's spec forbids it and so does this UI.
