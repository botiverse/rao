<p align="center">
  <img src="build/icon.png" alt="Rao logo" width="96" height="96">
</p>

# Rao

An elegant local desktop agent workspace built on [oar](https://github.com/botiverse/oar).

Project first: each project is a long-running maintainer agent with an ongoing
conversation and a project note. Organize work around projects, rather than
folders and sessions. Inspired by [Cursor Projects](https://cursor.com/blog/projects).

Your workspace and history stay on your machine. Rao uses your agents' existing
logins, with no backend of its own. Agents connect directly to their model providers.

Claude Code, Codex, Kimi Code, Pi and Grok Build in one workspace, powered by
oar's unified runtime API.

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
