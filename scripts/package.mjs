import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "dist", "package");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "out"), join(stage, "out"), { recursive: true });
cpSync(join(root, "build"), join(stage, "build"), { recursive: true });
const { scripts: _scripts, devDependencies, packageManager: _manager, ...production } = manifest;
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      ...production,
      packageManager: "npm@" + spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim(),
    },
    null,
    2,
  ),
);

// Preserve actual pnpm resolution (including peers and nested version conflicts).
// electron-builder's dependency collector cannot reconstruct this from a flat copy.
const installed = new Map();
const queue = [];
function resolvePackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}
function add(name, origin, consumer, optional = false) {
  const source = resolvePackage(name, origin);
  if (!source) {
    if (optional) return;
    throw new Error(`Unresolved production dependency: ${name} from ${origin}`);
  }
  for (let dir = consumer; dir.startsWith(stage); dir = dirname(dir)) {
    const visible = installed.get(join(dir, "node_modules", name));
    if (visible === source) return;
    if (visible) break;
  }
  let target = join(stage, "node_modules", name);
  if (installed.has(target)) target = join(consumer, "node_modules", name);
  if (installed.has(target)) {
    if (installed.get(target) !== source) throw new Error(`Conflicting resolution for ${name}`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (path) => !path.slice(source.length).split(/[\\/]/).includes("node_modules"),
  });
  installed.set(target, source);
  queue.push([source, target]);
}
for (const name of Object.keys(manifest.dependencies)) add(name, root, stage);
for (let i = 0; i < queue.length; i++) {
  const [source, target] = queue[i];
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const deps = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.optionalDependencies };
  for (const name of Object.keys(deps))
    add(
      name,
      source,
      target,
      name in (pkg.optionalDependencies ?? {}) ||
        pkg.peerDependenciesMeta?.[name]?.optional === true,
    );
}
process.stdout.write(`Staged ${installed.size} resolved production packages\n`);
// Stage has no pnpm symlinks or dev dependencies. Sign only after the final archive is built.
const require = createRequire(import.meta.url);
const electronDist = join(dirname(require.resolve("electron/package.json")), "dist");
const bin = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);
const result = spawnSync(
  bin,
  [
    "--projectDir",
    stage,
    "--config",
    join(root, "electron-builder.yml"),
    `--config.electronVersion=${devDependencies.electron}`,
    `--config.electronDist=${electronDist}`,
    `--config.directories.buildResources=${join(root, "build")}`,
    `--config.directories.output=${join(root, "release", manifest.version)}`,
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
