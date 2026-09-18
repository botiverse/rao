import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Exercise the real bundle with the sandbox's restricted module boundary.
// Node's normal require would hide unsupported external dependencies.
let exposed;
const calls = [];
runInNewContext(
  readFileSync(new URL("../out/preload/index.cjs", import.meta.url), "utf8"),
  {
    require(id) {
      assert.equal(id, "electron", `Sandbox preload must not require external module: ${id}`);
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, "rao");
            assert.equal(exposed, undefined);
            exposed = api;
          },
        },
        ipcRenderer: {
          invoke(...args) {
            calls.push(args);
            return Promise.resolve([]);
          },
          on() {},
          off() {},
        },
      };
    },
  },
  { filename: "preload/index.cjs", timeout: 1000 },
);
assert.ok(exposed, "Preload must expose window.rao before the renderer starts");
await exposed.runtimes.list();
await exposed.sessions.list();
assert.deepEqual(calls, [["runtimes:list"], ["session:list"]]);
process.stdout.write("Sandbox preload loads and exposes the renderer API.\n");
