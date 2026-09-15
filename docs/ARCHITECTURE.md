# Architecture

Rao is a local-only Electron client for coding agents. One window, many
runtimes: Claude Code, Codex, Kimi Code, Pi and Grok Build are all driven
through [`@botiverse/oar`](https://github.com/botiverse/oar), which gives every
runtime the same session contract and the same ordered record stream.

```
┌──────────── renderer (Chromium, sandboxed) ────────────┐
│ React 19 · zustand · Tailwind 4                        │
│ transcript = fold(oar events)                          │
└────────────▲──────────────── window.rao ───────────────┘
             │ contextBridge (preload, CJS, sandbox: true)
┌────────────┴──────────── main (Electron/Node 24) ──────┐
│ ipc/register.ts   typed ipcMain handlers, sender check │
│ agents/host.ts    AgentHost: the only oar caller       │
│   runtimes.require(id).session(installation, {cwd})    │
│   session.events(observer)  → IPC session:event        │
│                             → sessions/store.ts (JSONL)│
│   observeAgent(session)     → IPC session:status       │
│ sessions/store.ts SessionStore: index.json + events    │
└────────────┬───────────────────────────────────────────┘
             │ oar adapters
      claude ─ codex ─ kimi ─ pi (in-process SDK) ─ grok
```

## Processes

**Main** owns the agents. `AgentHost` probes installations, opens sessions,
and forwards oar's flat `Event`s and the derived agent status to the
renderer. It is a plain class with a `Sink` interface, so moving it into an
Electron `utilityProcess` later is a wiring change, not a rewrite. Nothing in
main renders anything.

**Preload** is the only bridge. It exposes `window.rao`, typed by
`RaoApi` in `src/shared/ipc.ts`, and nothing else. The preload is built as
CommonJS so the renderer can stay sandboxed (`sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`).

**Renderer** is a normal Vite + React app. It never imports Node or
Electron. It receives events and folds them into a transcript
(`src/renderer/src/lib/transcript.ts`), a pure function tested in
isolation and replayable from a recorded voyage log.

## The contract in `src/shared`

Everything that crosses a process boundary is declared once in
`src/shared/ipc.ts`: channel names, request and response shapes, and the
`RaoApi` surface. The shapes reuse oar's own types (`Event`, `AgentStatus`,
`InstallationSnapshot`, `ListModelsResult`, `SessionCapabilities`) so the
renderer speaks the runtime's vocabulary with no translation layer to drift.
The module has no Electron or Node imports and compiles in both tsconfigs.

## How oar is used

- **Discover.** `runtime.installation()` for each runtime at startup; the
  result is shown in the sidebar and the new-session dialog. No account I/O.
- **Control.** `prompt` when idle; `steerOrQueue` while a turn runs, so the
  user always learns where input landed (`steered`, `queued`, or `rejected`
  with the reason). `abort` interrupts; `dispose` releases the runtime.
- **Observe.** `session.events()` is the consumer face: text, reasoning,
  tool lifecycle, the runtime's own `turn_ended`, control rejections, the
  process exit. `observeAgent` + `simpleStateOf` collapse the stream into
  idle / busy / stuck / error for the status pill.
- **Attribution.** Sub-agent output carries `agentPath`; the transcript
  keys tool calls by `(agentPath, callId)`, never by `callId` alone.

## Persistence

oar deliberately has no "read session history" API: each runtime stores
history in its own shape (codex `thread/read` turns, claude transcript
jsonl, pi's history tree), none of which is the live wire format, so a
provider-independent readback would need a second projection per runtime.
Rao therefore keeps its own copy. `SessionStore` writes every `Event` the
live subscription delivered to `<userData>/sessions/<handle>.events.jsonl`
(synchronous appends, crash-safe order) and the metadata to `index.json`
(atomic rewrite). Because the stored log is the same flat `Event` stream the
UI consumed live, replaying it through `appendEvent` rebuilds the transcript
exactly; a change to the fold applies to old sessions too.

Continuing a stored session uses the runtime's native resume
(`SessionOptions.resume` with the stored `sessionId`). The resumed live
stream starts at seq 0 and does not replay history; the transcript on screen
comes from rao's log, the agent's memory comes from the runtime's own store.
`dispose` releases the runtime and keeps the record; `delete` removes both.

## Permissions

oar sessions run with interactive permission gates disabled (this is oar's
documented default; an embedded runtime that stops at an approval prompt
would simply hang). Rao therefore says so in the composer footer. Sandboxing
opt-ins such as `OAR_CODEX_SANDBOX` are a planned setting.

## Tooling

| Concern               | Tool                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Package manager       | pnpm (hoisted layout for Electron packaging)                                                     |
| Bundling / dev server | electron-vite 5 on Vite 7; main is ESM, preload CJS                                              |
| Types                 | TypeScript 7 (native), `strict` plus `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` |
| Lint                  | oxlint, type-aware, warnings are errors                                                          |
| Format                | oxfmt                                                                                            |
| Tests                 | vitest                                                                                           |
| Packaging             | electron-builder (`electron-builder.yml`)                                                        |

`pnpm check` runs typecheck, lint, format check and tests in sequence.

## Planned next steps

1. A "stop runtime" action separate from delete (the host already
   distinguishes `dispose` from `delete`; the UI only exposes delete).
2. Optional raw voyage recording (`openVoyage` over `rawEvents`) as a debug
   switch, kept apart from the Event log the UI depends on.
3. Model picker backed by `runtime.listModels`, and account usage from
   `runtime.accountUsage`.
4. Move `AgentHost` into a `utilityProcess` to keep the pi SDK's process
   global state (undici dispatcher) out of main.
