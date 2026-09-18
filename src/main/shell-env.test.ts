import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { expect, it } from "vitest";
import { inheritShellEnvironment, mergeShellEnvironment, parseShellEnvironment } from "./shell-env";

const MARKER = "__rao_shell_env__";
function shellOutput(...entries: string[]): string {
  return `Using Node v24.15.0\n${MARKER}\0${entries.join("\0")}\0${MARKER}`;
}

it("reads environment entries past whatever the shell printed on startup", () => {
  expect(
    parseShellEnvironment(shellOutput("PATH=/usr/bin", "HTTPS_PROXY=http://127.0.0.1:6152")),
  ).toEqual({ PATH: "/usr/bin", HTTPS_PROXY: "http://127.0.0.1:6152" });
});

it("keeps values containing '=' and drops blank or malformed entries", () => {
  expect(parseShellEnvironment(shellOutput("TOKEN=a=b=c", "=broken", "NO_VALUE", ""))).toEqual({
    TOKEN: "a=b=c",
  });
});

it("returns nothing when the markers are missing or unterminated", () => {
  expect(parseShellEnvironment("$SHELL did not run")).toEqual({});
  expect(parseShellEnvironment(`${MARKER}\0PATH=/usr/bin`)).toEqual({});
});

it("lets the shell win while preserving Electron, Rao and the launching PATH", () => {
  const target: NodeJS.ProcessEnv = {
    PATH: "/repo/node_modules/.bin:/usr/bin",
    ELECTRON_RUN_AS_NODE: "1",
    RAO_SHELL_ENV: "1",
    HTTPS_PROXY: "http://stale:1",
  };
  mergeShellEnvironment(target, {
    PATH: "/Users/me/.local/bin:/usr/bin",
    HTTPS_PROXY: "http://127.0.0.1:6152",
    PWD: "/Users/me",
    SHLVL: "2",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    RAO_USER_DATA: "/tmp/elsewhere",
  });
  expect(target["HTTPS_PROXY"]).toBe("http://127.0.0.1:6152");
  // Shell entries come first; development-only entries survive at the end.
  expect(target["PATH"]).toBe("/Users/me/.local/bin:/usr/bin:/repo/node_modules/.bin");
  expect(target["PWD"]).toBeUndefined();
  expect(target["SHLVL"]).toBeUndefined();
  expect(target["ELECTRON_RUN_AS_NODE"]).toBe("1");
  expect(target["RAO_USER_DATA"]).toBeUndefined();
});

it("leaves PATH untouched when the shell reports none", () => {
  const target: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  mergeShellEnvironment(target, { LANG: "en_US.UTF-8" });
  expect(target["PATH"]).toBe("/usr/bin");
  expect(target["LANG"]).toBe("en_US.UTF-8");
});

/** A stand-in shell so the spawn, parse and merge path is exercised end to end. */
function fakeShell(): string {
  const dir = mkdtempSync(join(tmpdir(), "rao-shell-env-"));
  const path = join(dir, "fake-shell");
  writeFileSync(
    path,
    `#!/bin/bash
printf '%s\\0' ${MARKER}
printf 'SHELL_ENV_TEST=ok\\0'
printf 'PATH=/shell/bin\\0'
printf 'PWD=/somewhere\\0'
printf '%s\\0' ${MARKER}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

it.skipIf(process.platform === "win32")(
  "inherits a real shell run and can be opted out of",
  async () => {
    const shell = fakeShell();
    const target: NodeJS.ProcessEnv = { SHELL: shell, PATH: "/app/bin" };
    try {
      await inheritShellEnvironment(target);
      expect(target["SHELL_ENV_TEST"]).toBe("ok");
      expect(target["PATH"]).toBe("/shell/bin:/app/bin");
      expect(target["PWD"]).toBeUndefined();

      const disabled: NodeJS.ProcessEnv = { SHELL: shell, PATH: "/app/bin", RAO_SHELL_ENV: "0" };
      await inheritShellEnvironment(disabled);
      expect(disabled["PATH"]).toBe("/app/bin");
      expect(disabled["SHELL_ENV_TEST"]).toBeUndefined();
    } finally {
      rmSync(dirname(shell), { recursive: true, force: true });
    }
  },
);
