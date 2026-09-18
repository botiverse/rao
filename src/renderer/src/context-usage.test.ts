// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { SessionClosedMessage, SessionStatusMessage, SessionSummary } from "@shared/ipc";

const summary = (handle: string): SessionSummary => ({
  handle,
  runtime: "codex",
  sessionId: handle,
  cwd: "/same-folder",
  title: null,
  openedAt: 1,
  updatedAt: 1,
  live: true,
  capabilities: null,
  context: { tokens: 100, contextWindow: 1000, percent: 10 },
});

it("hydrates live context, routes updates by project handle, and clears it on close", async () => {
  let pushStatus: (message: SessionStatusMessage) => void = vi.fn();
  let pushClosed: (message: SessionClosedMessage) => void = vi.fn();
  vi.stubGlobal("rao", {
    runtimes: { list: async () => [] },
    sessions: {
      list: async () => [summary("a"), summary("b")],
      onEvent: () => () => {},
      onStatus: (listener: typeof pushStatus) => {
        pushStatus = listener;
        return () => {};
      },
      onClosed: (listener: typeof pushClosed) => {
        pushClosed = listener;
        return () => {};
      },
    },
  });
  const { useStore } = await import("./store");
  const disconnect = useStore.getState().connect();
  try {
    await useStore.getState().load();
    expect(useStore.getState().sessions.a?.summary.context?.percent).toBe(10);
    pushStatus({
      handle: "a",
      state: "busy",
      status: { kind: "idle" },
      model: null,
      context: { tokens: 500, contextWindow: 1000, percent: 50 },
    });
    expect(useStore.getState().sessions.a?.summary.context?.percent).toBe(50);
    expect(useStore.getState().sessions.b?.summary.context?.percent).toBe(10);
    pushStatus({
      handle: "a",
      state: "idle",
      status: { kind: "idle" },
      model: null,
      context: { tokens: 50, contextWindow: 1000, percent: 5 },
    });
    expect(useStore.getState().sessions.a?.summary.context?.percent).toBe(5);
    pushClosed({ handle: "a", reason: "exited" });
    expect(useStore.getState().sessions.a?.summary.context).toBeNull();
    expect(useStore.getState().sessions.b?.summary.context?.percent).toBe(10);
  } finally {
    disconnect();
    vi.unstubAllGlobals();
  }
});
