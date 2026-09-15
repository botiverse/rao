/**
 * Typed ipcMain handlers. Each handler validates the sender and its
 * arguments before touching the AgentHost; the renderer is our own code,
 * but a compromised renderer must not gain more than the contract allows.
 */
import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import type { AgentHost } from "../agents/host";
import { IPC, isRuntimeId, type AppVersions, type OpenSessionRequest } from "@shared/ipc";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export function registerIpc(host: AgentHost, getWindow: () => BrowserWindow | null): void {
  const on = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      return handler(event, ...args);
    });
  };

  on(IPC.runtimesList, async () => host.listRuntimes());
  on(IPC.runtimesListModels, async (_event, runtime) => {
    if (!isRuntimeId(runtime)) {
      throw new TypeError("invalid runtime id");
    }
    return host.listModels(runtime);
  });

  on(IPC.sessionOpen, async (_event, request) => host.open(parseOpenRequest(request)));
  on(IPC.sessionResume, async (_event, handle) => host.resume(expectString(handle, "handle")));
  on(IPC.sessionList, () => host.list());
  on(IPC.sessionEvents, (_event, handle) => host.events(expectString(handle, "handle")));
  on(IPC.sessionPrompt, async (_event, handle, input) =>
    host.prompt(expectString(handle, "handle"), expectString(input, "input")),
  );
  on(IPC.sessionSteerOrQueue, async (_event, handle, input) =>
    host.steerOrQueue(expectString(handle, "handle"), expectString(input, "input")),
  );
  on(IPC.sessionAbort, async (_event, handle) => host.abort(expectString(handle, "handle")));
  on(IPC.sessionDispose, async (_event, handle) => host.dispose(expectString(handle, "handle")));

  on(IPC.dialogPickDirectory, async () => {
    const window = getWindow();
    const options: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
    const result =
      window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  on(IPC.appVersions, (): AppVersions => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? "unknown",
    node: process.versions.node,
    chrome: process.versions.chrome ?? "unknown",
    platform: process.platform,
  }));
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? "";
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  const trusted =
    url.startsWith("file://") || (devServer !== undefined && url.startsWith(devServer));
  if (!trusted) {
    throw new Error(`untrusted IPC sender: ${url}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
}

function parseOpenRequest(value: unknown): OpenSessionRequest {
  if (!isRecord(value)) {
    throw new TypeError("open request must be an object");
  }
  const record = value;
  if (!isRuntimeId(record["runtime"])) {
    throw new TypeError("invalid runtime id");
  }
  const request: OpenSessionRequest = {
    runtime: record["runtime"],
    cwd: expectString(record["cwd"], "cwd"),
    ...(typeof record["model"] === "string" ? { model: record["model"] } : {}),
    ...(typeof record["resume"] === "string" ? { resume: record["resume"] } : {}),
  };
  return request;
}
