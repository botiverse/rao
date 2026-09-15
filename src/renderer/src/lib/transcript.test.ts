import type { Event, EventBody } from "@botiverse/oar";
import { describe, expect, it } from "vitest";
import { appendEvent, emptyTranscript, type Transcript } from "./transcript";

let seq = 0;
function event(body: EventBody, agentPath: readonly string[] = []): Event {
  seq += 1;
  return { ...body, sessionId: "s", agentPath, seq, receivedAt: seq };
}

function fold(events: readonly Event[]): Transcript {
  return events.reduce(appendEvent, emptyTranscript);
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
