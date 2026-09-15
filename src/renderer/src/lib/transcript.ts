/**
 * The transcript is a fold over oar's flat event stream. Pure, so it is
 * unit-testable and replayable from a recorded voyage log.
 *
 * Identity of a tool call is `(agentPath, callId)`: a bare callId is never
 * a global key (docs/spec/runtime-matrix.md, hard spot 1).
 */
import type { Event, ReasoningContent, TurnOutcome } from "@botiverse/oar";

export type TranscriptItem =
  | { readonly kind: "user"; readonly id: string; readonly seq: number; readonly text: string }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly text: string;
    }
  | {
      readonly kind: "reasoning";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly content: ReasoningContent;
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly callId: string;
      readonly tool: string;
      readonly input?: string;
      readonly output?: string;
      readonly result: "running" | "ok" | "failed" | "ended";
    }
  | {
      readonly kind: "turn_end";
      readonly id: string;
      readonly seq: number;
      readonly outcome: TurnOutcome;
    }
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly seq: number;
      readonly tone: "info" | "error";
      readonly text: string;
    };

export type Transcript = readonly TranscriptItem[];

export const emptyTranscript: Transcript = [];

function toolKey(agentPath: readonly string[], callId: string): string {
  return `${agentPath.join("/")}#${callId}`;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/** Append one event; returns the same array when the event adds nothing visible. */
export function appendEvent(items: Transcript, event: Event): Transcript {
  const id = `${String(event.seq)}:${event.kind}`;
  switch (event.kind) {
    case "turn_started":
      return [...items, { kind: "user", id, seq: event.seq, text: event.input }];

    case "text_delta": {
      const last = items.at(-1);
      if (last?.kind === "assistant" && samePath(last.agentPath, event.agentPath)) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [
        ...items,
        { kind: "assistant", id, seq: event.seq, agentPath: event.agentPath, text: event.text },
      ];
    }

    case "reasoning": {
      const last = items.at(-1);
      if (
        last?.kind === "reasoning" &&
        samePath(last.agentPath, event.agentPath) &&
        last.content.kind === "text" &&
        event.content.kind === "text"
      ) {
        return [
          ...items.slice(0, -1),
          { ...last, content: { kind: "text", text: last.content.text + event.content.text } },
        ];
      }
      return [
        ...items,
        {
          kind: "reasoning",
          id,
          seq: event.seq,
          agentPath: event.agentPath,
          content: event.content,
        },
      ];
    }

    case "tool_call_started":
      return [
        ...items,
        {
          kind: "tool",
          id: toolKey(event.agentPath, event.callId),
          seq: event.seq,
          agentPath: event.agentPath,
          callId: event.callId,
          tool: event.tool,
          ...(event.input === undefined ? {} : { input: event.input }),
          result: "running",
        },
      ];

    case "tool_call_ended": {
      const key = toolKey(event.agentPath, event.callId);
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === key);
      if (index === -1) {
        // An end without a start: the consumer subscribed mid-turn. Still a fact.
        return [
          ...items,
          {
            kind: "tool",
            id: key,
            seq: event.seq,
            agentPath: event.agentPath,
            callId: event.callId,
            tool: "?",
            ...(event.output === undefined ? {} : { output: event.output }),
            result: event.result ?? "ended",
          },
        ];
      }
      const current = items[index];
      if (current?.kind !== "tool") {
        return items;
      }
      const updated: TranscriptItem = {
        ...current,
        ...(event.output === undefined ? {} : { output: event.output }),
        result: event.result ?? "ended",
      };
      return [...items.slice(0, index), updated, ...items.slice(index + 1)];
    }

    case "turn_ended":
      return [...items, { kind: "turn_end", id, seq: event.seq, outcome: event.outcome }];

    case "control_rejected":
      return [
        ...items,
        {
          kind: "notice",
          id,
          seq: event.seq,
          tone: "error",
          text: `${event.action} rejected: ${event.reason}`,
        },
      ];

    case "exited":
      return [
        ...items,
        {
          kind: "notice",
          id,
          seq: event.seq,
          tone: event.code === 0 ? "info" : "error",
          text: `runtime exited with code ${String(event.code)}`,
        },
      ];

    case "usage":
    case "model":
      return items;
  }
}
