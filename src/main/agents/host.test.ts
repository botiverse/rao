import type { ControlResult, RawEvent, SteerOrQueueResult } from "@botiverse/oar";
import { appendSessionEvent, emptyTranscriptState } from "../../renderer/src/lib/transcript";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SessionStore } from "../sessions/store";

const runtime = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("@botiverse/oar", () => ({
  runtimes: runtime,
  observeAgent: vi.fn(() => ({ subscribe: vi.fn(), dispose: vi.fn() })),
  simpleStateOf: vi.fn(),
}));
import { AgentHost } from "./host";

it("queries account usage with a verified installation and preserves provider states", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-host-"));
  const store = new SessionStore(dir);
  const host = new AgentHost({ event: vi.fn(), status: vi.fn(), closed: vi.fn() }, store);
  const installation = { kind: "available", via: "executable", command: "/bin/agent" };
  const accountUsage = vi.fn().mockResolvedValue({ kind: "reauth_required" });
  const session = vi.fn();
  try {
    runtime.require.mockReturnValue({
      installation: async () => installation,
      accountUsage,
      session,
    });
    expect(await host.accountUsage("claude")).toEqual({ kind: "reauth_required" });
    expect(accountUsage).toHaveBeenCalledWith(installation, { timeoutMs: 15000 });
    expect(session).not.toHaveBeenCalled();
    expect(host.diagnostics()).toEqual([]);
    runtime.require.mockReturnValue({ session });
    expect(await host.accountUsage("pi")).toEqual({
      kind: "unsupported",
      reason: "capability_unavailable",
    });
    runtime.require.mockReturnValue({
      id: "codex",
      installation: async () => ({ kind: "not_found" }),
      accountUsage,
    });
    await expect(host.accountUsage("codex")).rejects.toThrow("not available");
    expect(accountUsage).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("forwards independent inventory queries and directory without creating sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-inventory-"));
  const store = new SessionStore(dir);
  const host = new AgentHost({ event: vi.fn(), status: vi.fn(), closed: vi.fn() }, store);
  const installation = { kind: "available", via: "executable", command: "/bin/agent" };
  const result = { kind: "unsupported", code: "transport_unavailable", reason: "native limit" };
  const skills = vi.fn().mockResolvedValue(result);
  const mcpServers = vi.fn().mockResolvedValue(result);
  const tools = vi.fn().mockResolvedValue(result);
  const session = vi.fn();
  runtime.require.mockReturnValue({
    installation: async () => installation,
    skills,
    mcpServers,
    tools,
    session,
  });
  try {
    const results = await Promise.all(
      (["skills", "mcpServers", "tools"] as const).map(async (method) =>
        host[method]("codex", "/project-b"),
      ),
    );
    expect(results).toEqual([result, result, result]);
    for (const reader of [skills, mcpServers, tools]) {
      expect(reader).toHaveBeenCalledExactlyOnceWith(installation, {
        cwd: "/project-b",
        timeoutMs: 15000,
      });
    }
    await host.skills("codex");
    expect(skills).toHaveBeenLastCalledWith(installation, { cwd: homedir(), timeoutMs: 15000 });
    expect(session).not.toHaveBeenCalled();
    runtime.require.mockReturnValue({
      id: "codex",
      installation: async () => ({ kind: "not_found" }),
      skills,
    });
    await expect(host.skills("codex", "/project-b")).rejects.toThrow("not available");
    expect(skills).toHaveBeenCalledTimes(2);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("renews an unstarted Pi binding but never replaces a prompted session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-pi-draft-"));
  const store = new SessionStore(dir);
  const host = new AgentHost({ event: vi.fn(), status: vi.fn(), closed: vi.fn() }, store);
  const installation = { kind: "available", via: "bundled" };
  const session = vi.fn().mockResolvedValue({
    id: "fresh-native",
    capabilities: null,
    rawEvents: () => () => {},
    contextUsage: () => ({ value: null }),
    dispose: vi.fn(),
    prompt: vi.fn().mockRejectedValue(new Error("interrupted before reply")),
  });
  runtime.require.mockReturnValue({ installation: async () => installation, session });
  store.create({
    handle: "project",
    runtime: "pi",
    sessionId: "unpersisted-native",
    cwd: "/workspace",
    model: "model-a",
    title: null,
    openedAt: 1,
    updatedAt: 1,
  });
  try {
    const result = await host.resume("project");
    expect(session).toHaveBeenLastCalledWith(installation, { cwd: "/workspace", model: "model-a" });
    expect(result.handle).toBe("project");
    expect(result.sessionId).toBe("fresh-native");
    expect(store.get("project")?.sessionId).toBe("fresh-native");
    await expect(host.prompt("project", "hello")).rejects.toThrow("interrupted before reply");
    await host.dispose("project");
    session.mockRejectedValueOnce(new Error("native session missing"));
    await expect(host.resume("project")).rejects.toThrow("native session missing");
    expect(session).toHaveBeenLastCalledWith(installation, {
      cwd: "/workspace",
      model: "model-a",
      resume: "fresh-native",
    });
    expect(session).toHaveBeenCalledTimes(2);
  } finally {
    await host.disposeAll();
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("persists raw requests immediately and replays fallback and echo as one input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-raw-"));
  const store = new SessionStore(dir);
  const sink = { event: vi.fn(), status: vi.fn(), closed: vi.fn() };
  const host = new AgentHost(sink, store);
  const pending = Promise.withResolvers<SteerOrQueueResult>();
  let emit: (record: RawEvent) => void = vi.fn();
  const envelope = { sessionId: "native", agentPath: [], receivedAt: 1 };
  const request: ControlResult["request"] = {
    ...envelope,
    seq: 0,
    kind: "request",
    id: "steer",
    direction: "toRuntime",
    body: { kind: "steer", input: "hello", inputId: "logical-input" },
  };
  const session = {
    id: "native",
    capabilities: null,
    contextUsage: () => ({ value: null }),
    dispose: vi.fn(),
    events: vi.fn(),
    rawEvents: vi.fn((listener: (record: RawEvent) => void) => {
      emit = listener;
      return () => {};
    }),
    steerOrQueue: vi.fn(() => {
      emit(request);
      return pending.promise;
    }),
  };
  runtime.require.mockReturnValue({
    installation: async () => ({ kind: "available", via: "bundled" }),
    session: async () => session,
  });
  try {
    const { handle } = await host.open({ runtime: "pi", cwd: dir });
    const sending = host.steerOrQueue(handle, "hello");
    expect(host.events(handle)).toEqual([
      { kind: "record", streamId: expect.any(String), receivedAt: 1, record: request },
    ]);
    expect(session.events).not.toHaveBeenCalled();
    expect(session.rawEvents).toHaveBeenCalledWith(expect.any(Function), {
      sessionId: "native",
      afterSeq: -1,
    });
    const queued: ControlResult = {
      request: {
        ...request,
        seq: 2,
        id: "queue",
        body: { kind: "queue", input: "hello", inputId: "logical-input" },
      },
      response: {
        ...envelope,
        seq: 3,
        kind: "response",
        requestId: "queue",
        body: { kind: "accepted" },
      },
    };
    emit({
      ...envelope,
      seq: 1,
      kind: "response",
      requestId: "steer",
      body: { kind: "rejected", reason: "not_steerable" },
    });
    emit(queued.request);
    emit(queued.response);
    emit({
      ...envelope,
      seq: 4,
      kind: "frame",
      body: {
        type: "echo",
        native: { original: true },
        events: [
          {
            kind: "user_message",
            input: "hello",
            inputId: "logical-input",
            nativeMessageId: "native-message",
            evidence: "acknowledged",
          },
        ],
      },
    });
    pending.resolve({ landed: "queued", result: queued });
    expect(await sending).toEqual({ accepted: true, seq: 2 });
    const log = host.events(handle);
    expect(log).toHaveLength(5);
    expect(sink.event.mock.calls.map(([message]) => message.event)).toEqual(log);
    const replay = log.reduce(appendSessionEvent, emptyTranscriptState());
    expect(replay.items).toHaveLength(1);
    expect(replay.items[0]).toMatchObject({
      kind: "user",
      text: "hello",
      delivery: {
        state: "accepted",
        attempts: [{ state: "rejected" }, { state: "accepted" }],
        observations: [{ nativeMessageId: "native-message" }],
      },
    });
    await host.disposeAll();
    store.dispose();
    const reopened = new SessionStore(dir);
    try {
      expect(
        reopened.readEvents(handle).reduce(appendSessionEvent, emptyTranscriptState()),
      ).toEqual(replay);
    } finally {
      reopened.dispose();
    }
  } finally {
    await host.disposeAll();
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
