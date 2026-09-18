import type * as Oar from "@botiverse/oar";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ControlResult, RawEvent, SessionOptions, RuntimeEventBody } from "@botiverse/oar";
import { SessionStore } from "../sessions/store";
import { appendSessionEvent, emptyTranscriptState } from "@shared/transcript";

const requireRuntime = vi.hoisted(() => vi.fn());
vi.mock("@botiverse/oar", async (importOriginal) => {
  const actual = await importOriginal<typeof Oar>();
  return { ...actual, runtimes: { require: requireRuntime } };
});
import { AgentHost } from "./host";

function native(id: string, finish = true) {
  const records: RawEvent[] = [];
  const listeners = new Set<(record: RawEvent) => void>();
  const emit = (record: RawEvent) => {
    records.push(record);
    for (const listener of listeners) listener(record);
  };
  const envelope = () => ({
    sessionId: id,
    agentPath: [],
    receivedAt: Date.now(),
    seq: records.length,
  });
  const frame = (...events: RuntimeEventBody[]) =>
    emit({ ...envelope(), kind: "frame", body: { type: "test", native: {}, events } });
  return {
    id,
    records: () => records,
    capabilities: { steer: false, queue: null, attribution: "none" },
    model: () => ({ value: `${id}-model`, seq: 0 }),
    contextUsage: () => ({ value: null, seq: 0 }),
    rawEvents: (listener: (record: RawEvent) => void, cursor?: { afterSeq: number }) => {
      if (cursor) for (const record of records) if (record.seq > cursor.afterSeq) listener(record);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    frame,
    prompt: vi.fn(async (input: string): Promise<ControlResult> => {
      const request: ControlResult["request"] = {
        ...envelope(),
        kind: "request",
        id: `${id}-request-${records.length}`,
        direction: "toRuntime",
        body: { kind: "prompt", input },
      };
      emit(request);
      const response: ControlResult["response"] = {
        ...envelope(),
        kind: "response",
        requestId: request.id,
        body: { kind: "accepted" },
      };
      emit(response);
      if (finish)
        frame(
          { kind: "text_delta", text: `${id} reply` },
          { kind: "turn_ended", outcome: { kind: "completed" } },
        );
      return { request, response };
    }),
    dispose: vi.fn(async () => {}),
  };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});
function setup(finish = true) {
  const dir = mkdtempSync(join(tmpdir(), "rao-handoff-"));
  const store = new SessionStore(dir);
  const sink = { event: vi.fn(), status: vi.fn(), closed: vi.fn() };
  const host = new AgentHost(sink, store);
  const old = native("old", finish);
  const next = native("next");
  const factory = vi
    .fn<(_installation: unknown, options: SessionOptions) => Promise<ReturnType<typeof native>>>()
    .mockResolvedValueOnce(old)
    .mockResolvedValue(next);
  requireRuntime.mockReturnValue({
    installation: async () => ({ kind: "available", via: "bundled" }),
    session: factory,
  });
  cleanups.push(async () => {
    await host.disposeAll();
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, sink, host, old, next, factory };
}
it("hands off A → B → A into fresh native sessions while preserving project history and note", async () => {
  const { host, old, next, factory } = setup();
  const initial = await host.open({ runtime: "claude", cwd: "/workspace", model: "claude-model" });
  await host.prompt(initial.handle, "Original goal");
  const switched = await host.switchRuntime(initial.handle, "codex", "Project note");
  expect(switched).toMatchObject({
    handle: initial.handle,
    runtime: "codex",
    sessionId: "next",
    cwd: "/workspace",
    live: true,
  });
  expect(old.dispose).toHaveBeenCalledOnce();
  expect(factory.mock.calls[1]?.[1]).toEqual({ cwd: "/workspace" });
  expect(next.prompt.mock.calls[0]?.[0]).toContain("Original goal");
  expect(next.prompt.mock.calls[0]?.[0]).toContain("Project note");
  const third = native("third");
  factory.mockResolvedValueOnce(third);
  const returned = await host.switchRuntime(initial.handle, "claude", "Updated note");
  expect(returned.sessionId).toBe("third");
  expect(factory.mock.calls[2]?.[1]).toEqual({ cwd: "/workspace", model: "claude-model" });
  const payload = third.prompt.mock.calls[0]?.[0] ?? "";
  expect(payload.match(/# Project handoff/g)).toHaveLength(1);
  expect(payload.match(/Original goal/g)).toHaveLength(1);
  expect(payload).toContain("next reply");
  const replay = host.events(initial.handle).reduce(appendSessionEvent, emptyTranscriptState());
  expect(replay.items.filter((item) => item.kind === "runtime_handoff")).toHaveLength(2);
  expect(replay.items.filter((item) => item.kind === "user")).toHaveLength(1);
});
it("rejects busy sessions and competing input/deletion while a handoff is preparing", async () => {
  const { host, old, factory, next } = setup(false);
  const { handle } = await host.open({ runtime: "claude", cwd: "/workspace" });
  await host.prompt(handle, "Keep running");
  await expect(host.switchRuntime(handle, "codex", "")).rejects.toThrow("finish");
  old.frame({ kind: "turn_ended", outcome: { kind: "completed" } });
  const waiting = Promise.withResolvers<ReturnType<typeof native>>();
  factory.mockReturnValueOnce(waiting.promise);
  const switching = host.switchRuntime(handle, "codex", "");
  await expect(host.prompt(handle, "racing input")).rejects.toThrow("in progress");
  await expect(host.delete(handle)).rejects.toThrow("in progress");
  await expect(host.switchRuntime(handle, "pi", "")).rejects.toThrow("in progress");
  waiting.resolve(next);
  await switching;
});
it("keeps the original binding and runtime when target creation or prompt fails", async () => {
  const { host, factory, old, next } = setup();
  const initial = await host.open({ runtime: "claude", cwd: "/workspace" });
  factory.mockRejectedValueOnce(new Error("not authenticated"));
  await expect(host.switchRuntime(initial.handle, "codex", "")).rejects.toThrow(
    "not authenticated",
  );
  next.prompt.mockRejectedValueOnce(new Error("context too large"));
  await expect(host.switchRuntime(initial.handle, "codex", "")).rejects.toThrow(
    "context too large",
  );
  expect(host.list()[0]).toMatchObject({ runtime: "claude", sessionId: "old", live: true });
  expect(old.dispose).not.toHaveBeenCalled();
  expect(next.dispose).toHaveBeenCalledOnce();
  expect(
    host.events(initial.handle).filter((item) => item.kind === "runtime_handoff"),
  ).toHaveLength(0);
});
it("recovers a committed handoff from JSONL even if the session index was not flushed", async () => {
  const { host, store, dir } = setup();
  const { handle } = await host.open({ runtime: "claude", cwd: "/workspace" });
  const stale = readFileSync(join(dir, "index.json"));
  await host.switchRuntime(handle, "codex", "Keep this note");
  await host.disposeAll();
  store.dispose();
  writeFileSync(join(dir, "index.json"), stale);
  const reopened = new SessionStore(dir);
  try {
    expect(reopened.get(handle)).toMatchObject({
      runtime: "codex",
      sessionId: "next",
      promptAttempted: true,
    });
    expect(
      reopened.readEvents(handle).filter((item) => item.kind === "runtime_handoff"),
    ).toHaveLength(1);
  } finally {
    reopened.dispose();
  }
});

it("does not commit a rejected handoff or one whose source changes during preparation", async () => {
  const { host, next, old } = setup();
  const { handle } = await host.open({ runtime: "claude", cwd: "/workspace" });
  const accepted = next.prompt.getMockImplementation();
  if (!accepted) throw new Error("Missing prompt implementation");
  next.prompt.mockImplementationOnce(async (input) => {
    const result = await accepted(input);
    return {
      ...result,
      response: { ...result.response, body: { kind: "rejected", reason: "too large" } },
    };
  });
  await expect(host.switchRuntime(handle, "codex", "")).rejects.toThrow("Handoff rejected");
  next.prompt.mockImplementationOnce(async (input) => {
    old.frame({ kind: "text_delta", text: "late source output" });
    return accepted(input);
  });
  await expect(host.switchRuntime(handle, "codex", "")).rejects.toThrow("conversation changed");
  expect(old.dispose).not.toHaveBeenCalled();
  expect(host.list()[0]?.runtime).toBe("claude");
});

it("refuses oversize transfers before starting a runtime and resumes only the new binding after restart", async () => {
  const { host, factory, dir, store } = setup();
  const { handle } = await host.open({ runtime: "claude", cwd: "/workspace" });
  await expect(host.switchRuntime(handle, "codex", "x".repeat(512_001))).rejects.toThrow("512 KB");
  expect(factory).toHaveBeenCalledTimes(1);
  await host.switchRuntime(handle, "codex", "");
  await host.disposeAll();
  store.dispose();
  const reopened = new SessionStore(dir);
  const rehost = new AgentHost({ event: vi.fn(), status: vi.fn(), closed: vi.fn() }, reopened);
  try {
    await rehost.resume(handle);
    expect(factory.mock.calls.at(-1)?.[1]).toMatchObject({ resume: "next", cwd: "/workspace" });
  } finally {
    await rehost.disposeAll();
    reopened.dispose();
  }
});
