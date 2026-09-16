<p align="center">
  <img src="build/icon.png" alt="Rao logo" width="96" height="96">
</p>

# Rao

A local desktop client for coding agents. Rao opens sessions with Claude Code,
Codex, Kimi Code, Pi and Grok Build through one interface, and gives them a
window instead of a terminal: streaming transcript, collapsible tool calls and
reasoning, a status pill that says whether the agent is thinking, running a
tool, stalled or done, and a composer that steers or queues while a turn runs.

Everything stays on your machine. Rao drives the agents you already have
installed and logged in; it holds no keys and talks to no server of its own.

Runtimes are driven through [`@botiverse/oar`](https://github.com/botiverse/oar).

## Requirements

- Node.js 24 or newer and pnpm 11 (`corepack enable pnpm`)
- At least one agent CLI installed: `claude`, `codex`, `kimi`, or `grok`.
  Pi is bundled through oar's SDK and needs a provider login.

## Develop

```sh
pnpm install
pnpm dev          # electron-vite dev server with HMR for the renderer
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
