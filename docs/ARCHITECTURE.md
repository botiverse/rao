# Architecture

Rao is a local-only Electron client for coding agents. One window, many
runtimes: Claude Code, Codex, Kimi Code, Pi and Grok Build are all driven
through [`@botiverse/oar`](https://github.com/botiverse/oar), which gives every
runtime the same session contract and the same ordered record stream.

```
┌──────────── renderer (Chromium, sandboxed) ────────────┐
│ React 19 · zustand · Tailwind 4                        │
│ transcript = fold(oar records)                          │
└────────────▲──────────────── window.rao ───────────────┘
             │ contextBridge (preload, CJS, sandbox: true)
┌────────────┴──────────── main (Electron/Node 24) ──────┐
│ ipc/register.ts   typed ipcMain handlers, sender check │
│ agents/host.ts    AgentHost: the only oar caller       │
│   runtimes.require(id).session(installation, {cwd})    │
│   session.rawEvents(observer)  → IPC session:event        │
│                             → sessions/store.ts (JSONL)│
│   observeAgent(session)     → IPC session:status       │
│ sessions/store.ts SessionStore: index.json + events    │
└────────────┬───────────────────────────────────────────┘
             │ oar adapters
      claude ─ codex ─ kimi ─ pi (in-process SDK) ─ grok
```

## Processes

**Main** owns the agents. `AgentHost` probes installations, opens sessions,
and forwards oar's complete `RawEvent`s and the derived agent status to the
renderer. It is a plain class with a `Sink` interface, so moving it into an
Electron `utilityProcess` later is a wiring change, not a rewrite. Nothing in
main renders anything.

**Preload** is the only bridge. It exposes `window.rao`, typed by
`RaoApi` in `src/shared/ipc.ts`, and nothing else. The preload is built as
CommonJS so the renderer can stay sandboxed (`sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`).

**Renderer** is a normal Vite + React app. It never imports Node or
Electron. It receives events and folds them into a transcript
(`src/shared/transcript.ts`, re-exported by the renderer), a pure function tested in
isolation and replayable from a recorded voyage log.

## The contract in `src/shared`

Everything that crosses a process boundary is declared once in
`src/shared/ipc.ts`: channel names, request and response shapes, and the
`RaoApi` surface. The shapes reuse oar's own types (`RawEvent`, `AgentStatus`,
`InstallationSnapshot`, `ListModelsResult`, `SessionCapabilities`) so the
renderer speaks the runtime's vocabulary with no translation layer to drift.
The module has no Electron or Node imports and compiles in both tsconfigs.

## How oar is used

- **Discover.** `runtime.installation()` for each runtime at startup; the
  result is shown in the sidebar and the new-session dialog. No account I/O.
- **Control.** `prompt` when idle; `steerOrQueue` while a turn runs, so the
  user always learns where input landed (`steered`, `queued`, or `rejected`
  with the reason). `abort` interrupts; `dispose` releases the runtime.
- **Observe.** `session.rawEvents()` retains requests, responses and native
  frames. OAR’s `reduceConversation` joins input identity and projects: text, reasoning,
  tool lifecycle, the runtime's own `turn_ended`, control rejections, the
  process exit. `observeAgent` + `simpleStateOf` collapse the stream into
  idle / busy / stuck / error for the status pill.
- **Attribution.** Sub-agent output carries `agentPath`; the transcript
  keys tool calls by `(agentPath, callId)`, never by `callId` alone.

## Persistence

Rao owns its data for project management, search indexes, and rebuilding views.
Runtime history is not the application's database.

Project names, notes, and avatars live in `<userData>/rao.sqlite`, owned by
`ProjectStore` in main through typed IPC. The renderer keeps an in-memory cache
and changes it only after successful persistence. SQLite uses WAL, a five-second
busy timeout, full synchronization, transactions, and schema version 1. This is
phase one: validated details are a JSON column; project ID and current session
handle are the same Rao handle (not the native runtime ID). The table also tracks
creation/update times, pending creation/deletion, and persistent tombstones.

Both development and packaged apps use `<appData>/Rao`; `RAO_USER_DATA` or an
explicit `--user-data-dir=...` overrides that for tests. The single-instance lock
is acquired before either store opens. Storage errors are surfaced instead of
turning into an empty project list.

Creation reserves metadata before starting a runtime and only returns success
after the session and project are both persisted. A failure attempts cleanup;
pending operations recover on restart. Deletion records its intent before
removing the JSONL session, then retains a tombstone. It is not a transaction
across SQLite and JSONL; a failed cleanup stays pending and retries at startup.

Project metadata is read exclusively from SQLite. The one-time localStorage
migration and its import/export UI have been removed after migration completion.
Existing SQLite databases remain readable; historical localStorage and backup
files are not accessed or modified.

`SessionStore` writes every `RawEvent` the
live subscription delivered to `<userData>/sessions/<handle>.events.jsonl`
(synchronous appends, crash-safe order) and the metadata to `index.json`
(atomic rewrite). Each new log entry contains `{streamId, record}` so sequence
numbers from different runtime instances never collide. OAR’s `reduceConversation`
drives both replay and live updates, followed by Rao’s rendering fold. The reader
still accepts historical flat events and `input_submission` entries. Buffered
pushes merge with history using per-stream cursors, without duplicate messages.

Continuing a stored session uses the runtime's native resume
(`SessionOptions.resume` with the stored `sessionId`). The resumed live
stream starts at seq 0 and does not replay history; the transcript on screen
comes from rao's log, the agent's memory comes from the runtime's own store.
`dispose` releases the runtime and keeps the record; project deletion coordinates
JSONL removal and a SQLite tombstone through `ProjectService`.

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
2. Optional export of the persisted raw records for debugging.
3. Model selection when creating a project (the Dashboard already exposes
   `runtime.listModels` and `runtime.accountUsage`).
4. Move `AgentHost` into a `utilityProcess` to keep the pi SDK's process
   global state (undici dispatcher) out of main.

## Runtime dashboard

The renderer reads `runtimes.list`, `runtimes.listModels`, and
`runtimes.accountUsage` through typed IPC. Usage/model reads pass a 15-second
timeout to oar and preserve unsupported and authentication results. These
reads do not open sessions. Queries settle independently and discard results
when their view is unmounted or refreshed.

`session.diagnostics` snapshots live oar sessions: model, capabilities, usage,
context usage, graph and the latest 100 records. This is current-process data,
not a reconstruction of persisted conversation history. Missing usage stays
unknown rather than being represented as zero. Refreshing runtime installation
information updates the creation dialog without reloading the session store.

Inventory queries use oar 0.4.0 through three additional typed IPC channels:
`runtimes.skills`, `runtimes.mcpServers`, and `runtimes.tools`. Main validates the
runtime and optional cwd, verifies installation, and forwards a 15-second timeout.
It neither opens nor resumes a project session. Omitted cwd is resolved to the
user's home directory in main (not Electron's process cwd). The Dashboard loads
all three global/default inventories automatically, with no directory selector.
These are native home-context results, not a synthetic strict global-only filter.
The project sidebar mounts the same panel on expansion, supplying the project's
runtime and cwd; project identity changes remount it. Unmounting cancels UI
acceptance of earlier responses; each category keeps its own result. Each category retains native coverage and partial-result
markers, including MCP-only tools and absent schemas. Existing native queries
cannot be canceled through oar; a discarded UI request can finish in the
background within the query timeout.

Runtime display names and SVG logos come from oar's browser-safe
`@botiverse/oar/brands` export. `RuntimeLogo` renders bundled data URIs in the
Dashboard, runtime selector, and project agent header. No remote icon fetch or
runtime process is required. `runtimeBrandIcon(brand, theme)` selects artwork for
the actual surface background, falling back to the default icon. Rao currently
uses dark surfaces; it does not infer this from the OS theme. Project avatars
remain independent user choices.

### In-flight user input

OAR supplies a logical input UUID shared across steer → queue fallback attempts.
Rao persists full records and renders OAR conversation updates keyed by input
identity. Requests appear immediately; responses and native echoes update the
same bubble. Native message observations do not imply model consumption or
semantic effect. Success acknowledgements are stored without a permanent badge.
Unlinked native messages remain available in records; Rao does not match them
by text or display them as duplicate bubbles. Cancellation remains deferred.

## Packaging and persistence verification

`pnpm package` / `pnpm package:mac` stage the production dependency graph in
`dist/package` using actual pnpm resolutions, including peers and nested versions.
Every staged top-level package is declared in the packaging manifest so the builder's
second dependency collection retains peer dependencies. Before signing,
`scripts/verify-package.cjs` checks every expected dependency location in the final
archive and fails the build if any is absent. No post-signing asar edits are required.

After `pnpm check` and `pnpm package`, run:

```sh
pnpm test:app "release/0.1.0/mac-arm64/Rao.app/Contents/MacOS/Rao"
```

On macOS the smoke test first copies the entire app outside the repository, preventing
missing imports from falling back to development `node_modules`. It creates an isolated
data directory with an existing SQLite project, opens development at an HTTP origin
and the real packaged window at a file origin, edits a note,
restarts both builds, checks singleton rejection, and verifies unchanged JSONL.
It exercises Electron's built-in SQLite and packaged OAR dependencies. It never
restarts or replaces the user's installed application.

## Runtime handoff

The Rao handle remains the stable project/conversation ID; it is independent of
its current native session ID. Switching runtime always opens a fresh native
session, including switching back to a previously used runtime. SQLite project
metadata and the project's JSONL path remain unchanged. Historical native session
IDs stay in the record envelopes and handoff markers.

The main process reads the saved project note and folds the complete project log
using the same shared transcript projection as the UI. It exports user/assistant
messages and tool calls as Markdown, omitting tool results and reasoning.
Previous handoff prompts are excluded by request/session identity, and previous
markers contribute only their runtime transition, so repeated handoffs do not
nest or duplicate historical payloads. A 512 KB UTF-8 transport guard rejects an
oversized export without truncation; this is not a model context-window estimate.

The payload is a normal first prompt, so adapters without system-prompt injection
are supported. It asks the receiving agent to acknowledge context and wait for
the next user message. Prompt acceptance is the preparation criterion; later
model/provider errors are displayed as ordinary runtime errors. Model settings
are remembered independently for each runtime.

Handoffs are allowed only with no running turn. A main-process operation guard
blocks competing sends, resume, delete and handoff requests while preparation is
in progress. A source that changes during preparation invalidates the transfer.
Preparation failure disposes the candidate and preserves the source binding.
After acceptance, the old runtime is disposed and a `runtime_handoff` marker is
appended and fsynced to the existing log. The marker is the commit point; startup
recovers the current binding from it if the debounced index flush was interrupted.
An I/O failure after source disposal can require resuming the old binding; the
source history is retained. Native adapter session creation/prompt calls are not
transactions with the filesystem and can leave an unused native session after a
process crash before commit.

The accepted native records are then replayed into the project log. The prompt
itself is represented by a handoff card rather than a duplicate user bubble.
Clicking the card opens a modal containing the exact Markdown sent to the runtime.
Native dialog focus containment and Escape dismissal support keyboard access.
The composer is disabled during preparation; existing project metadata and
conversation stay visible. Normal app restart resumes the currently bound native
session; explicit runtime switching never resumes an earlier one.
