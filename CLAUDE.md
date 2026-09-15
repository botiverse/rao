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
- Only `src/main/agents/host.ts` imports `@botiverse/oar` at runtime.
  Persistence is `src/main/sessions/store.ts`: append-only JSONL of oar
  `Event`s per session plus `index.json`. Store the flat `Event`, never a
  UI-shaped transcript, so replay and live share one fold. The
  renderer and shared modules may import its types (`import type`).
- The renderer is sandboxed: no Node, no Electron, no `require`. Talk to main
  through `window.rao` only.
- Transcript state is a pure fold over oar `Event`s in
  `src/renderer/src/lib/transcript.ts`. Extend the fold and its tests rather
  than mutating transcript items from components.
- Tool call identity is `(agentPath, callId)`, never `callId` alone.
- Do not synthesize facts the runtime did not report (turn boundaries,
  tool outcomes). oar's spec forbids it and so does this UI.
