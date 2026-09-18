import type { Event, EventBody } from "@botiverse/oar";
import { describe, expect, it } from "vitest";
import { appendEvent, emptyTranscript, type Transcript } from "./transcript";

let seq = 0;
function event(body: EventBody, agentPath: readonly string[] = []): Event {
  seq += 1;
  return { ...body, sessionId: "s", agentPath, seq, receivedAt: seq };
}

function fold(events: readonly Event[]): Transcript {
  return events.reduce((items, next) => appendEvent(items, next), emptyTranscript);
}

describe("appendEvent", () => {
  it("merges consecutive text deltas of one agent into one assistant item", () => {
    const items = fold([
      event({ kind: "turn_started", requestId: "r1", input: "hi" }),
      event({ kind: "text_delta", text: "Hel" }),
      event({ kind: "text_delta", text: "lo" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: "assistant", text: "Hello" });
  });

  it("keeps sub-agent text apart from the root agent's", () => {
    const items = fold([
      event({ kind: "text_delta", text: "root" }),
      event({ kind: "text_delta", text: "child" }, ["task-1"]),
    ]);
    expect(items.map((item) => (item.kind === "assistant" ? item.text : ""))).toEqual([
      "root",
      "child",
    ]);
  });

  it("closes a tool call by (agentPath, callId), not by callId alone", () => {
    const items = fold([
      event({ kind: "tool_call_started", callId: "c1", tool: "Bash", input: "ls" }),
      event({ kind: "tool_call_started", callId: "c1", tool: "Read" }, ["task-1"]),
      event({ kind: "tool_call_ended", callId: "c1", output: "ok", result: "ok" }, ["task-1"]),
    ]);
    expect(items[0]).toMatchObject({ kind: "tool", tool: "Bash", result: "running" });
    expect(items[1]).toMatchObject({ kind: "tool", tool: "Read", result: "ok", output: "ok" });
  });

  it("ignores usage and model events for the transcript", () => {
    const before = fold([event({ kind: "text_delta", text: "x" })]);
    const after = appendEvent(before, event({ kind: "model", model: "sonnet" }));
    expect(after).toBe(before);
  });

  it("records a turn end with the runtime's own outcome", () => {
    const items = fold([event({ kind: "turn_ended", outcome: { kind: "completed" } })]);
    expect(items[0]).toMatchObject({ kind: "turn_end", outcome: { kind: "completed" } });
  });
});

describe("oar 0.3 events", () => {
  it("keeps partial tool output attributed and lets final output replace it", () => {
    const items = fold([
      event({ kind: "tool_call_started", callId: "c", tool: "Bash" }),
      event({ kind: "tool_call_started", callId: "c", tool: "Read" }, ["child"]),
      event({ kind: "tool_call_progress", callId: "c", output: "partial" }, ["child"]),
    ]);
    expect(items[0]).not.toHaveProperty("output");
    expect(items[1]).toMatchObject({ output: "partial", result: "running" });
    const ended = appendEvent(
      items,
      event({ kind: "tool_call_ended", callId: "c", output: "final", result: "ok" }, ["child"]),
    );
    expect(ended[1]).toMatchObject({ output: "final", result: "ok" });
  });

  it("preserves the transcript across compaction, retry, and app requests", () => {
    const items = fold([
      event({ kind: "text_delta", text: "before" }),
      event({ kind: "compaction_started" }),
      event({ kind: "compaction_ended", outcome: "failed", reason: "limit" }),
      event({ kind: "retry", attempt: 1, maxAttempts: 3, reason: "busy" }),
      event({ kind: "app_request", requestId: "r", type: "approval" }),
      event({ kind: "app_answered", requestId: "r" }),
      event({ kind: "text_delta", text: "after" }),
    ]);
    expect(items).toHaveLength(7);
    expect(items[2]).toMatchObject({ tone: "error", text: "Context compaction failed: limit" });
    expect(items.at(-1)).toMatchObject({ text: "after" });
  });
});

it("keeps repeated steer text distinct and updates the original bubble across agent output", () => {
  const first = {
    kind: "input_submission",
    id: "first",
    input: "same text",
    receivedAt: 1,
    state: "sending",
  } as const;
  const items = appendEvent(
    appendEvent(
      appendEvent(emptyTranscript, first),
      event({ kind: "text_delta", text: "working" }),
    ),
    { ...first, id: "second" },
  );
  const settled = appendEvent(items, { ...first, state: "queued" });
  expect(settled).toHaveLength(3);
  expect(settled[0]).toMatchObject({ id: "input:first", submission: { state: "queued" } });
  expect(settled[1]).toMatchObject({ kind: "assistant", text: "working" });
  expect(settled[2]).toMatchObject({ id: "input:second", submission: { state: "sending" } });
});

it("keeps raw frame blocks and resumed stream identities distinct", async () => {
  const { appendSessionEvent, emptyTranscriptState } = await import("./transcript");
  const raw = {
    kind: "record",
    streamId: "first",
    receivedAt: 1,
    record: {
      kind: "frame",
      seq: 0,
      sessionId: "native",
      agentPath: [],
      receivedAt: 1,
      body: {
        type: "assistant",
        native: {},
        events: [
          { kind: "text_delta", text: "before" },
          { kind: "reasoning", content: { kind: "text", text: "thinking" } },
          { kind: "text_delta", text: "after" },
        ],
      },
    },
  } as const;
  const first = appendSessionEvent(emptyTranscriptState(), raw);
  expect(new Set(first.items.map((item) => item.id)).size).toBe(3);
  const resumed = appendSessionEvent(first, { ...raw, streamId: "second" });
  expect(resumed.items).toHaveLength(6);
  expect(new Set(resumed.items.map((item) => item.id)).size).toBe(6);
});
