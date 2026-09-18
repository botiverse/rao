import { expect, it } from "vitest";
import type { EventBody, RawEvent } from "@botiverse/oar";
import type { RuntimeHandoff, SessionEvent } from "./ipc";
import { handoffMarkdown, MAX_HANDOFF_BYTES } from "./handoff";
import { appendSessionEvent, emptyTranscriptState } from "./transcript";

function event(body: EventBody, seq: number): SessionEvent {
  return { ...body, seq, sessionId: "old", agentPath: [], receivedAt: seq };
}
const history = [
  event({ kind: "turn_started", requestId: "legacy-request", input: "用户目标" }, 1),
  event({ kind: "text_delta", text: "Before tool" }, 2),
  event({ kind: "reasoning", content: { kind: "text", text: "PRIVATE_REASONING" } }, 3),
  event({ kind: "tool_call_started", callId: "1", tool: "read", input: "src/app.ts" }, 4),
  event({ kind: "tool_call_ended", callId: "1", output: "SECRET_TOOL_RESULT", result: "ok" }, 5),
  event({ kind: "text_delta", text: "After tool" }, 6),
];
const marker: RuntimeHandoff = {
  kind: "runtime_handoff",
  id: "handoff",
  from: "claude",
  to: "codex",
  previousSessionId: "old",
  sessionId: "new",
  requestId: "handoff-request",
  markdown: "OLD_HANDOFF_PAYLOAD",
  receivedAt: 7,
  runtimeModels: {},
};
const request: RawEvent = {
  kind: "request",
  id: "handoff-request",
  direction: "toRuntime",
  sessionId: "new",
  agentPath: [],
  seq: 0,
  receivedAt: 8,
  body: { kind: "prompt", input: marker.markdown, inputId: "handoff-input" },
};
it("exports Unicode user/assistant text in order and omits tool calls, results and reasoning", () => {
  const result = handoffMarkdown(history, "保存的 note");
  expect(result).toContain("保存的 note");
  expect(result).toContain("用户目标");
  expect(result.indexOf("Before tool")).toBeLessThan(result.indexOf("After tool"));
  expect(result).not.toContain("src/app.ts");
  expect(result).not.toContain("SECRET_TOOL_RESULT");
  expect(result).not.toContain("PRIVATE_REASONING");
});
it("replays a handoff once and never nests its injected prompt into the next handoff", () => {
  const records: SessionEvent[] = [
    marker,
    marker,
    { kind: "record", streamId: "new-stream", receivedAt: 8, record: request },
    {
      kind: "record",
      streamId: "new-stream",
      receivedAt: 9,
      record: {
        kind: "response",
        sessionId: "new",
        agentPath: [],
        seq: 1,
        receivedAt: 9,
        requestId: request.id,
        body: { kind: "accepted" },
      },
    },
    event({ kind: "turn_started", requestId: "legacy-request", input: "Follow-up" }, 10),
  ];
  const all = [...history, ...records];
  const replay = all.reduce(appendSessionEvent, emptyTranscriptState());
  expect(replay.items.filter((item) => item.kind === "runtime_handoff")).toHaveLength(1);
  const markdown = handoffMarkdown(all, "new note");
  expect(markdown).not.toContain(marker.markdown);
  expect(markdown.match(/用户目标/g)).toHaveLength(1);
  expect(markdown).toContain("Follow-up");
  expect(markdown).toContain("claude → codex");
});
it("rejects oversized payloads without truncating and measures Unicode bytes", () => {
  expect(() => handoffMarkdown([], "汉".repeat(MAX_HANDOFF_BYTES / 2))).toThrow("512 KB");
});
