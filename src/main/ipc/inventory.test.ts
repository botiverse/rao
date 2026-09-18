/* oxlint-disable typescript/no-unsafe-type-assertion -- IPC test doubles provide only the host methods and Electron event fields exercised by these handlers. */
import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectStore } from "../projects/store";
import type { BrowserWindow } from "electron";
import type { AgentHost } from "../agents/host";
import type { IpcMainInvokeEvent } from "electron";
import { IPC } from "@shared/ipc";

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
);
vi.mock("electron", () => ({
  app: { getVersion: () => "test" },
  dialog: {},
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => {
      handlers.set(channel, handler);
    },
  },
}));
import { registerIpc } from "./register";

beforeEach(() => handlers.clear());

it("registers all inventory channels and rejects invalid runtime, directory and sender", async () => {
  const result = {
    kind: "unsupported",
    code: "transport_unavailable",
    reason: "native limitation",
  };
  const skills = vi.fn().mockResolvedValue(result);
  const mcpServers = vi.fn().mockResolvedValue(result);
  const tools = vi.fn().mockResolvedValue(result);
  // Only these methods are exercised through the registered handlers.
  const host = { skills, mcpServers, tools } as unknown as AgentHost;
  const frame = { url: "file:///rao/index.html" };
  const webContents = { mainFrame: frame, getURL: () => frame.url };
  registerIpc(host, () => ({ webContents }) as unknown as BrowserWindow, {} as ProjectStore);
  const trusted = { senderFrame: frame, sender: webContents } as unknown as IpcMainInvokeEvent;
  await Promise.all(
    [
      [IPC.runtimesSkills, skills],
      [IPC.runtimesMcpServers, mcpServers],
      [IPC.runtimesTools, tools],
    ].map(async ([channel, reader]) => {
      const handler = handlers.get(String(channel));
      expect(handler).toBeDefined();
      expect(await handler?.(trusted, "codex", "/work")).toBe(result);
      expect(reader).toHaveBeenCalledWith("codex", "/work");
      await expect(handler?.(trusted, "unknown", "/work")).rejects.toThrow("invalid runtime");
      await expect(handler?.(trusted, "codex", { cwd: "/work" })).rejects.toThrow("cwd");
      await expect(handler?.(trusted, "codex", "")).rejects.toThrow("cwd");
      const untrusted = { senderFrame: { url: "https://example.com" } } as IpcMainInvokeEvent;
      expect(() => handler?.(untrusted, "codex", "/work")).toThrow("untrusted");
    }),
  );
});
