import { execFile } from "node:child_process";

/**
 * macOS launches GUI apps from launchd, which knows nothing about the user's
 * shell configuration. Runtime adapters and their child processes would then
 * miss PATH entries, proxies and tokens exported from `.zshrc`. Read the
 * interactive login shell once at startup and merge the result into
 * `process.env`, which every `spawn` inherits by default.
 *
 * The shell is asked to bracket `env -0` between two markers so that whatever a
 * user's shell config prints on startup (version managers are common) cannot be
 * mistaken for environment output.
 */
const MARKER = "__rao_shell_env__";
const SCRIPT = `printf '%s\\0' ${MARKER}; env -0; printf '%s\\0' ${MARKER}`;
const DEFAULT_TIMEOUT_MS = 5_000;

/** Shell state that describes the shell process, not the user's environment. */
const IGNORED = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID"]);

/** Extract NUL-delimited `KEY=value` pairs from a shell run, ignoring its chatter. */
export function parseShellEnvironment(output: string): Record<string, string> {
  const start = output.indexOf(MARKER);
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (start < 0 || end < 0) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const entry of output.slice(start + MARKER.length, end).split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    entries[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return entries;
}

/**
 * Union of the shell's PATH and the one the app was launched with, shell first
 * so the app resolves tools the way the terminal does. Appending keeps paths
 * that only exist in a development launch (`node_modules/.bin`).
 */
function mergePath(current: string | undefined, fromShell: string | undefined): string | undefined {
  if (fromShell === undefined || fromShell === "") {
    return current;
  }
  const seen = new Set<string>();
  const entries = [...fromShell.split(":"), ...(current ?? "").split(":")].filter((entry) => {
    if (entry === "" || seen.has(entry)) {
      return false;
    }
    seen.add(entry);
    return true;
  });
  return entries.join(":");
}

/**
 * Merge shell values into `target`. The shell wins for ordinary variables;
 * Electron and Rao internals are preserved, and PATH is unioned rather than
 * replaced so a development launch keeps its own entries.
 */
export function mergeShellEnvironment(
  target: NodeJS.ProcessEnv,
  entries: Record<string, string>,
): void {
  const currentPath = target["PATH"];
  for (const [key, value] of Object.entries(entries)) {
    if (
      IGNORED.has(key) ||
      key === "PATH" ||
      key.startsWith("ELECTRON_") ||
      key.startsWith("RAO_")
    ) {
      continue;
    }
    target[key] = value;
  }
  const path = mergePath(currentPath, entries["PATH"]);
  if (path !== undefined) {
    target["PATH"] = path;
  }
}

function runShell(shell: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", SCRIPT],
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      // A broken or slow rc file must degrade to the inherited environment, and
      // a non-zero exit can still carry usable output, so failures are ignored.
      (_error, stdout) => resolve(stdout ?? ""),
    );
  });
}

/**
 * Best-effort inheritance: never throws, never blocks the app on a pathological
 * rc file. Set `RAO_SHELL_ENV=0` to opt out.
 */
export async function inheritShellEnvironment(
  target: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (process.platform === "win32" || target["RAO_SHELL_ENV"] === "0") {
    return;
  }
  const shell = target["SHELL"];
  if (shell === undefined || shell === "") {
    return;
  }
  try {
    mergeShellEnvironment(target, parseShellEnvironment(await runShell(shell, DEFAULT_TIMEOUT_MS)));
  } catch (error) {
    console.error("shell environment was not inherited", error);
  }
}
