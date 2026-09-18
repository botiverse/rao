import type { ProjectStore } from "../projects/store";
import { ProjectService } from "../projects/service";
import { projectId, parseProjectDetails } from "@shared/projects";
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

export function registerIpc(
  host: AgentHost,
  getWindow: () => BrowserWindow | null,
  projects: ProjectStore,
): void {
  const on = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedSender(event, getWindow());
      return handler(event, ...args);
    });
  };

  const service = new ProjectService(host, projects);
  on(IPC.projectsList, () => projects.list());
  on(IPC.projectsSave, (_event, id, details) => {
    const handle = projectId(id);
    if (!host.list().some((item) => item.handle === handle)) throw new Error("Unknown project");
    return projects.save(handle, parseProjectDetails(details));
  });
  on(IPC.runtimesList, async () => host.listRuntimes());
  on(IPC.runtimesListModels, async (_event, runtime) => {
    if (!isRuntimeId(runtime)) {
      throw new TypeError("invalid runtime id");
    }
    return host.listModels(runtime);
  });

  on(IPC.runtimesAccountUsage, async (_event, runtime) => {
    if (!isRuntimeId(runtime)) throw new TypeError("invalid runtime id");
    return host.accountUsage(runtime);
  });
  for (const [channel, method] of [
    [IPC.runtimesSkills, "skills"],
    [IPC.runtimesMcpServers, "mcpServers"],
    [IPC.runtimesTools, "tools"],
  ] as const) {
    on(channel, async (_event, runtime, cwd) => {
      if (!isRuntimeId(runtime)) throw new TypeError("invalid runtime id");
      if (
        cwd !== undefined &&
        (typeof cwd !== "string" || cwd.trim().length === 0 || cwd.includes("\0"))
      ) {
        throw new TypeError("cwd must be a non-empty directory path");
      }
      return host[method](runtime, cwd);
    });
  }
  on(IPC.sessionDiagnostics, () => host.diagnostics());
  on(IPC.sessionDelete, async (_event, handle) => {
    const id = projectId(handle);
    if (!projects.has(id) && !host.list().some((item) => item.handle === id))
      throw new Error("Unknown project");
    await service.remove(id);
  });
  on(IPC.sessionSwitchRuntime, async (_event, handle, runtime) => {
    const id = projectId(handle);
    if (!isRuntimeId(runtime)) throw new TypeError("invalid runtime id");
    const project = projects.list()[id];
    if (!project) throw new Error("Unknown project");
    return host.switchRuntime(id, runtime, project.note);
  });
  on(IPC.sessionOpen, async (_event, request) => service.create(parseOpenRequest(request)));
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

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  const frame = event.senderFrame;
  if (
    !window ||
    event.sender !== window.webContents ||
    frame !== window.webContents.mainFrame ||
    frame.url !== window.webContents.getURL()
  )
    throw new Error("untrusted IPC sender");
  const url = new URL(frame.url);
  const dev = process.env["ELECTRON_RENDERER_URL"];
  const trusted = dev ? url.origin === new URL(dev).origin : url.protocol === "file:";
  if (!trusted) throw new Error("untrusted IPC sender");
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
    ...(record["project"] === undefined ? {} : { project: parseProjectDetails(record["project"]) }),
    cwd: expectString(record["cwd"], "cwd"),
    ...(typeof record["model"] === "string" ? { model: record["model"] } : {}),
    ...(typeof record["resume"] === "string" ? { resume: record["resume"] } : {}),
  };
  return request;
}
