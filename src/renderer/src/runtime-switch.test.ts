// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { SessionSummary, SessionEventMessage, SessionStatusMessage } from "@shared/ipc";

it("keeps project identity and history across success, preserves state on failure, and blocks duplicate sends", async () => {
  let pushEvent: (value: SessionEventMessage) => void = vi.fn();
  let pushStatus: (value: SessionStatusMessage) => void = vi.fn();
  const initial: SessionSummary = {
    handle: "project",
    runtime: "claude",
    sessionId: "old",
    cwd: "/workspace",
    title: null,
    openedAt: 1,
    updatedAt: 1,
    live: true,
    capabilities: null,
  };
  const pending = Promise.withResolvers<SessionSummary>();
  const switchRuntime = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("auth failed"));
  const prompt = vi.fn();
  vi.stubGlobal("rao", {
    runtimes: { list: async () => [] },
    sessions: {
      list: async () => [initial],
      events: async () => [
        {
          kind: "turn_started",
          input: "Original",
          seq: 0,
          receivedAt: 1,
          sessionId: "old",
          agentPath: [],
        },
      ],
      switchRuntime,
      prompt,
      onEvent: (listener: typeof pushEvent) => {
        pushEvent = listener;
        return () => {};
      },
      onStatus: (listener: typeof pushStatus) => {
        pushStatus = listener;
        return () => {};
      },
      onClosed: () => () => {},
    },
  });
  const { useStore } = await import("./store");
  const off = useStore.getState().connect();
  try {
    await useStore.getState().load();
    await useStore.getState().select("project");
    const switching = useStore.getState().switchRuntime("project", "codex");
    expect(useStore.getState().switching).toEqual(["project"]);
    await useStore.getState().switchRuntime("project", "pi");
    await useStore.getState().send("project", "racing input");
    expect(switchRuntime).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    pushEvent({
      handle: "project",
      event: {
        kind: "runtime_handoff",
        id: "h",
        receivedAt: 2,
        from: "claude",
        to: "codex",
        previousSessionId: "old",
        sessionId: "new",
        requestId: "r",
        runtimeModels: {},
        markdown: "handoff",
      },
    });
    pushStatus({
      handle: "project",
      state: "busy",
      status: { kind: "running", phase: "thinking", sinceSeq: 1, lastEventAt: 2 },
      model: "new-model",
      context: null,
    });
    const next = { ...initial, runtime: "codex" as const, sessionId: "new", model: "new-model" };
    pending.resolve(next);
    await switching;
    expect(useStore.getState().active).toBe("project");
    expect(useStore.getState().order).toEqual(["project"]);
    expect(useStore.getState().sessions.project?.state).toBe("busy");
    expect(useStore.getState().sessions.project?.transcript?.map((item) => item.kind)).toEqual([
      "user",
      "runtime_handoff",
    ]);
    await useStore.getState().switchRuntime("project", "pi");
    expect(useStore.getState().sessions.project?.summary).toEqual(next);
    expect(useStore.getState().error).toContain("auth failed");
    expect(useStore.getState().switching).toEqual([]);
  } finally {
    off();
    vi.unstubAllGlobals();
  }
});
