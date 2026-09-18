/* eslint-disable no-await-in-loop -- Polling and restart checks depend on the preceding observation. */
// Real Electron/packaged-app smoke test. Uses only disposable data and mock history.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron");
let packaged = process.argv[2];
assert.ok(packaged, "Pass the packaged Rao executable path");
const data = mkdtempSync(join(tmpdir(), "rao-sqlite-smoke-"));
// An app under the repository can accidentally resolve missing dependencies from
// the repository's node_modules. Test the installed layout outside that tree.
if (process.platform === "darwin") {
  const app = resolve(packaged, "../../..");
  const isolatedApp = join(data, "Rao.app");
  cpSync(app, isolatedApp, { recursive: true, verbatimSymlinks: true });
  packaged = join(isolatedApp, "Contents", "MacOS", "Rao");
}

mkdirSync(join(data, "sessions"));
const handle = "sqlite-smoke-project";
const summary = {
  handle,
  runtime: "pi",
  sessionId: "native-test",
  cwd: data,
  title: "Test conversation",
  openedAt: 1,
  updatedAt: 1,
};
writeFileSync(join(data, "sessions", "index.json"), JSON.stringify([summary]));
const log =
  JSON.stringify({
    kind: "text_delta",
    sessionId: "native-test",
    agentPath: [],
    seq: 1,
    receivedAt: 1,
    text: "Retained JSONL conversation",
  }) + "\n";
writeFileSync(join(data, "sessions", `${handle}.events.jsonl`), log);
const legacy = JSON.stringify({
  version: 0,
  state: {
    details: {
      [handle]: {
        name: "迁移测试",
        goal: "目标",
        context: "知识",
        avatar: { icon: "Book", color: "#86afe5" },
      },
    },
  },
});
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const target = path === "/" ? "index.html" : path.slice(1);
  if (target.includes("..")) {
    response.writeHead(400).end();
    return;
  }
  try {
    let content = readFileSync(join(root, "out", "renderer", target));
    if (target === "index.html")
      content = Buffer.from(
        content
          .toString()
          .replace(
            "<head>",
            `<head><script>if (!localStorage.getItem('rao-projects-v2')) localStorage.setItem('rao-projects-v2', ${JSON.stringify(legacy)});</script>`,
          ),
      );
    response.setHeader(
      "Content-Type",
      target.endsWith(".js")
        ? "text/javascript"
        : target.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
async function cdp(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(500),
      }).then((r) => r.json());
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await once(ws, "open");
        let id = 0;
        const requests = new Map();
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          const entry = requests.get(message.id);
          if (entry) {
            requests.delete(message.id);
            if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
            else entry.resolve(message.result);
          }
        });
        return {
          close: () => ws.close(),
          call(method, params = {}) {
            const key = ++id;
            return new Promise((resolveCall, reject) => {
              requests.set(key, { resolve: resolveCall, reject });
              ws.send(JSON.stringify({ id: key, method, params }));
            });
          },
        };
      }
    } catch {
      /* wait for our own process */
    }
    await delay(100);
  }
  throw new Error("Electron did not expose a loaded window");
}
async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  return port;
}
async function run(binary, dev, expectedNote, nextNote, screenshot = false) {
  const port = await freePort();
  const env = { ...process.env, RAO_USER_DATA: data, NODE_ENV: dev ? "development" : "production" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  if (dev) env.ELECTRON_RENDERER_URL = origin;
  const child = spawn(binary, [...(dev ? [root] : []), `--remote-debugging-port=${port}`], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    writeFileSync(join(data, dev ? "development.log" : "packaged.log"), output);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    writeFileSync(join(data, dev ? "development.log" : "packaged.log"), output);
  });
  let connection;
  try {
    connection = await cdp(port);
    const evaluate = async (expression) => {
      const result = await connection.call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    let loaded = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(window.rao && document.body?.innerText.includes('迁移测试'))`)) {
        loaded = true;
        break;
      }
      await delay(100);
    }
    assert.ok(loaded, `Window failed to load projects: ${output}`);
    const details = await evaluate("window.rao.projects.list()");
    assert.equal(details[handle].note, expectedNote);
    assert.deepEqual(details[handle].avatar, { icon: "Book", color: "#86afe5" });
    assert.equal(Object.keys(details).length, 1);
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b => b.title === '迁移测试').click()`,
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(`document.body.innerText.includes('Retained JSONL conversation')`)) break;
      await delay(100);
    }
    assert.ok(await evaluate(`document.body.innerText.includes('Retained JSONL conversation')`));
    if (nextNote) {
      // Exercise the actual controlled textarea and save button, not only IPC.
      await evaluate(
        `(() => { const e = document.querySelector('#project-note'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ${JSON.stringify(nextNote)}); e.dispatchEvent(new Event('input', {bubbles:true})); })()`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save note').click()`,
      );
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await evaluate("window.rao.projects.list()"))[handle].note === nextNote) break;
        await delay(100);
      }
      assert.equal((await evaluate("window.rao.projects.list()"))[handle].note, nextNote);
    }
    if (!dev) {
      assert.equal(await evaluate("localStorage.getItem('rao-projects-v2')"), null);
      assert.deepEqual(
        await evaluate(`window.rao.projects.importLegacy(${JSON.stringify(legacy)})`),
        { imported: 0, skipped: 1 },
      );
      assert.equal(
        (await evaluate("window.rao.projects.list()"))[handle].note,
        nextNote ?? expectedNote,
      );
    }
    assert.ok(
      (await evaluate("window.rao.runtimes.list()")).length > 0,
      "Packaged OAR imports and installation queries must work",
    );
    if (screenshot) {
      const capture = await connection.call("Page.captureScreenshot");
      writeFileSync(join(data, "packaged-window.png"), Buffer.from(capture.data, "base64"));
    }
    const other = spawn(binary, dev ? [root] : [], { env, stdio: "ignore" });
    const timeout = setTimeout(() => other.kill("SIGKILL"), 8000);
    const [code] = await once(other, "exit");
    clearTimeout(timeout);
    assert.equal(code, 0, "Second instance must exit without opening storage");
    assert.doesNotMatch(
      output,
      /Uncaught Exception|ERR_MODULE_NOT_FOUND|Error occurred in handler/,
    );
    process.stdout.write(
      `${dev ? "development" : "packaged"}: UI, SQLite, JSONL, OAR and singleton passed\n`,
    );
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    connection?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
      await stopped;
      clearTimeout(timeout);
    }
    writeFileSync(join(data, dev ? "development.log" : "packaged.log"), output);
  }
}
try {
  await run(electron, true, "目标\n\n知识", "开发版保存的笔记");
  await run(resolve(packaged), false, "开发版保存的笔记", "安装版保存的笔记", true);
  await run(resolve(packaged), false, "安装版保存的笔记");
  await run(electron, true, "安装版保存的笔记");
  assert.equal(readFileSync(join(data, "sessions", `${handle}.events.jsonl`), "utf8"), log);
  process.stdout.write(`Verified shared data and untouched JSONL. Artifacts: ${data}\n`);
} finally {
  server.close();
}
