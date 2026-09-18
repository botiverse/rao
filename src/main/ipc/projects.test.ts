/* oxlint-disable typescript/no-unsafe-type-assertion -- Only the Electron frame identity and project host methods used by these IPC handlers are mocked. */
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { AgentHost } from "../agents/host";
import { ProjectStore } from "../projects/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC } from "@shared/ipc";
const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
);
vi.mock("electron", () => ({
  app: {},
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
      handlers.set(name, handler),
  },
}));
import { registerIpc } from "./register";
afterEach(() => {
  handlers.clear();
  vi.unstubAllEnvs();
});
it("validates project payloads, session existence and exact sender/frame identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-ipc-projects-"));
  const projects = new ProjectStore(join(dir, "rao.sqlite"));
  const frame = { url: "http://localhost:5173/" };
  const webContents = { mainFrame: frame, getURL: () => frame.url };
  const event = { senderFrame: frame, sender: webContents } as unknown as IpcMainInvokeEvent;
  const host = {
    list: () => [{ handle: "known" }, { handle: "no-project" }],
  } as unknown as AgentHost;
  vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
  registerIpc(host, () => ({ webContents }) as unknown as BrowserWindow, projects);
  try {
    projects.create("known", { name: "Before", note: "" });
    projects.finishCreate("known");
    const save = handlers.get(IPC.projectsSave);
    expect(save?.(event, "known", { name: "After", note: "中文" })).toEqual({
      name: "After",
      note: "中文",
    });
    expect(() => save?.(event, "no-project", { name: "x", note: "" })).toThrow("Unknown");
    expect(() => save?.(event, "missing", { name: "x", note: "" })).toThrow("Unknown");
    expect(() => save?.(event, "../escape", { name: "x", note: "" })).toThrow("ID");
    expect(() => save?.(event, "known", { name: "x", note: 42 })).toThrow("Invalid");
    expect(() => save?.({ ...event, sender: {} } as IpcMainInvokeEvent, "known", {})).toThrow(
      "untrusted",
    );
    expect(() =>
      save?.({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent, "known", {}),
    ).toThrow("untrusted");
    frame.url = "http://localhost:5173@evil.test/";
    expect(() => save?.(event, "known", {})).toThrow("untrusted");
  } finally {
    projects.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
