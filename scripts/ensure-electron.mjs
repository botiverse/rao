// pnpm may restore `electron` from its side-effects cache without the
// binary that electron's own postinstall downloads. Run that download when
// the binary is missing, so a fresh clone works after one `pnpm install`.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
let electronDir;
try {
  electronDir = dirname(require.resolve("electron/package.json"));
} catch {
  process.exit(0); // electron not installed (production install); nothing to do
}

const marker = join(electronDir, "path.txt");
if (existsSync(marker)) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [join(electronDir, "install.js")], {
  cwd: electronDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
