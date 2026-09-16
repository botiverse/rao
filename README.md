<p align="center">
  <img src="build/icon.png" alt="Rao logo" width="96" height="96">
</p>

# Rao

An elegant local desktop agent workspace built on [oar](https://github.com/botiverse/oar).

## Project first

Rao organizes agent work around projects. A project brings together a local
folder, a chosen agent, an ongoing conversation and a saved note—a place to
return to and keep working.

Use the conversation to move the work forward. Keep the project's direction,
constraints and useful context in its note. When that context belongs in a
message, type `@note` to attach it explicitly. The note stays under your control;
messages without `@note` do not include it automatically.

Each project keeps its own conversation and note, even when several projects
share the same folder. You can approach the same codebase with different goals
or agents while keeping each line of work together.

## Local by design

Your files, project metadata and conversation history live on your machine.
Rao runs your agents locally, uses their existing logins and has no backend of
its own. Agents still connect to their configured model providers; local-only
means the workspace and agent execution stay local, not that inference is
necessarily offline.

## Built on oar

[oar](https://github.com/botiverse/oar) gives Rao a shared interface to Claude
Code, Codex, Kimi Code, Pi and Grok Build. Choose the agent that fits your project
and work through the same conversation UI and controls.

Rao focuses on the workspace; oar provides runtime discovery, session control
and streaming events. The runtime Dashboard lets you inspect available agents,
models, account usage and diagnostics. Skills, MCP servers and tools are also
available from the Dashboard and each project's sidebar, where supported by
the runtime.

## Requirements

- Node.js 24 or newer and pnpm 11 (`corepack enable pnpm`)
- At least one agent CLI installed: `claude`, `codex`, `kimi`, or `grok`.
  Pi is bundled through oar's SDK and needs a provider login.

## Develop

```sh
pnpm install
pnpm dev          # renderer HMR + main/preload rebuild and app restart
pnpm check        # typecheck + lint + format check + tests
pnpm build        # bundle main, preload and renderer into out/
pnpm package:mac  # build a .dmg and .zip into release/
```

## Layout

```
src/shared/     IPC contract shared by all processes (types + channel names)
src/main/       Electron main: window, security, typed IPC, AgentHost (oar), SessionStore
src/preload/    contextBridge exposing window.rao
src/renderer/   React UI; transcript is a pure fold over oar events
docs/           ARCHITECTURE.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the processes fit
together and how oar's session contract is used.

## A note on permissions

oar starts runtimes with their interactive approval prompts disabled, because
an embedded agent that stops at a prompt nobody can see would hang. Treat a Rao
session like a `--dangerously-skip-permissions` run: point it at a directory
you are comfortable letting an agent edit.

## License

Apache-2.0
