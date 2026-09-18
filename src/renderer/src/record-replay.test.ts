// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { SessionEvent, SessionEventMessage, SessionSummary } from "@shared/ipc";

const summary = (handle: string): SessionSummary => ({
  handle,
  runtime: "codex",
  sessionId: handle,
  cwd: "/same",
  title: null,
  openedAt: 1,
  updatedAt: 1,
  live: true,
  capabilities: null,
});
const message = (seq: number): SessionEvent => ({
  kind: "record",
  streamId: "process-a",
  receivedAt: seq,
  record: {
    kind: "request",
    id: `r${seq}`,
    direction: "toRuntime",
    sessionId: "native-a",
    agentPath: [],
    seq,
    receivedAt: seq,
    body: { kind: "steer", input: "same text", inputId: `input-${seq}` },
  },
});

it("merges replay and live records without losing late pushes or crossing projects", async () => {
  let push: (message: SessionEventMessage) => void = vi.fn();
  const first = Promise.withResolvers<readonly SessionEvent[]>();
  const second = Promise.withResolvers<readonly SessionEvent[]>();
  vi.stubGlobal("rao", {
    runtimes: { list: async () => [] },
    sessions: {
      list: async () => [summary("a"), summary("b")],
      events: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      onEvent: (listener: typeof push) => {
        push = listener;
        return () => {};
      },
      onStatus: () => () => {},
      onClosed: () => () => {},
    },
  });
  const { useStore } = await import("./store");
  const disconnect = useStore.getState().connect();
  try {
    await useStore.getState().load();
    const loading = useStore.getState().select("a");
    const alsoLoading = useStore.getState().select("a");
    push({ handle: "a", event: message(0) });
    push({ handle: "a", event: message(1) });
    first.resolve([message(0)]);
    await loading;
    expect(useStore.getState().sessions.a?.transcript).toHaveLength(2);
    push({ handle: "a", event: message(2) });
    second.resolve([message(0)]);
    await alsoLoading;
    expect(useStore.getState().sessions.a?.transcript).toHaveLength(3);
    expect(useStore.getState().sessions.b?.transcript).toBeNull();
    expect(useStore.getState().sessions.b?.buffered).toEqual([]);
  } finally {
    disconnect();
    vi.unstubAllGlobals();
  }
});
