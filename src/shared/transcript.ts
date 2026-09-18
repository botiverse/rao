/**
 * The transcript consumes OAR's conversation projection over stored records. Pure, so it is
 * unit-testable and replayable from a recorded voyage log.
 *
 * Identity of a tool call is `(agentPath, callId)`: a bare callId is never
 * a global key (docs/spec/runtime-matrix.md, hard spot 1).
 */
import type { ReasoningContent, TurnOutcome } from "@botiverse/oar";

import {
  initialConversation,
  reduceConversation,
  type ConversationInput,
  type ConversationState,
} from "@botiverse/oar/observe";
import type { InputSubmission, SessionEvent, RuntimeHandoff } from "@shared/ipc";

export type TranscriptItem =
  | RuntimeHandoff
  | {
      readonly kind: "user";
      readonly id: string;
      readonly seq?: number;
      readonly text: string;
      readonly submission?: InputSubmission;
      readonly delivery?: ConversationInput;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly source?: string;
      readonly text: string;
    }
  | {
      readonly kind: "reasoning";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly source?: string;
      readonly content: ReasoningContent;
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly seq: number;
      readonly agentPath: readonly string[];
      readonly source?: string;
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
export function appendEvent(
  items: Transcript,
  event: Exclude<SessionEvent, { kind: "record" }>,
  scope = "",
  ordinal = 0,
): Transcript {
  if (event.kind === "runtime_handoff") {
    return items.some((item) => item.id === event.id) ? items : [...items, event];
  }
  if (event.kind === "input_submission") {
    const id = `input:${event.id}`;
    const index = items.findIndex((item) => item.id === id);
    const item: TranscriptItem = { kind: "user", id, text: event.input, submission: event };
    return index === -1
      ? [...items, item]
      : items.map((current, i) => (i === index ? item : current));
  }
  const id = `${scope}${String(event.seq)}:${event.kind}:${String(ordinal)}`;
  switch (event.kind) {
    case "turn_started":
      return [...items, { kind: "user", id, seq: event.seq, text: event.input }];

    case "text_delta": {
      const last = items.at(-1);
      if (
        last?.kind === "assistant" &&
        (last.source ?? "") === scope &&
        samePath(last.agentPath, event.agentPath)
      ) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [
        ...items,
        {
          kind: "assistant",
          id,
          seq: event.seq,
          agentPath: event.agentPath,
          source: scope,
          text: event.text,
        },
      ];
    }

    case "reasoning": {
      const last = items.at(-1);
      if (
        last?.kind === "reasoning" &&
        (last.source ?? "") === scope &&
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
          source: scope,
          content: event.content,
        },
      ];
    }

    case "tool_call_started":
      return [
        ...items,
        {
          kind: "tool",
          id: `${scope}${toolKey(event.agentPath, event.callId)}`,
          seq: event.seq,
          agentPath: event.agentPath,
          source: scope,
          callId: event.callId,
          tool: event.tool,
          ...(event.input === undefined ? {} : { input: event.input }),
          result: "running",
        },
      ];

    case "tool_call_progress":
    case "tool_call_ended": {
      const key = `${scope}${toolKey(event.agentPath, event.callId)}`;
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
            source: scope,
            callId: event.callId,
            tool: "?",
            ...(event.output === undefined ? {} : { output: event.output }),
            result: event.kind === "tool_call_progress" ? "running" : (event.result ?? "ended"),
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
        result: event.kind === "tool_call_progress" ? "running" : (event.result ?? "ended"),
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

    case "compaction_started":
    case "compaction_ended":
    case "retry":
    case "app_request":
    case "app_answered": {
      const text =
        event.kind === "compaction_started"
          ? "Compacting context"
          : event.kind === "compaction_ended"
            ? `Context compaction ${event.outcome}${event.reason ? `: ${event.reason}` : ""}`
            : event.kind === "retry"
              ? `Retry ${event.attempt}${event.maxAttempts === undefined ? "" : `/${event.maxAttempts}`}${event.reason ? `: ${event.reason}` : ""}`
              : event.kind === "app_request"
                ? `Runtime request: ${event.type}`
                : "Runtime request answered";
      return [
        ...items,
        {
          kind: "notice",
          id,
          seq: event.seq,
          tone: event.kind === "compaction_ended" && event.outcome === "failed" ? "error" : "info",
          text,
        },
      ];
    }

    case "user_message":
    case "usage":
    case "model":
      return items;
  }
}

export interface TranscriptState {
  readonly items: Transcript;
  readonly conversation: ConversationState;
}
export function emptyTranscriptState(): TranscriptState {
  return { items: emptyTranscript, conversation: initialConversation() };
}
/** The same OAR reducer drives history replay and incremental updates. */
export function appendSessionEvent(state: TranscriptState, event: SessionEvent): TranscriptState {
  if (event.kind !== "record") return { ...state, items: appendEvent(state.items, event) };
  const conversation = reduceConversation(state.conversation, event.record, event.streamId);
  let items = state.items;
  for (const [ordinal, update] of conversation.updates.entries()) {
    if (update.kind === "event") {
      items = appendEvent(
        items,
        update.event,
        `${event.streamId}:${event.record.sessionId}:`,
        ordinal,
      );
    } else {
      if (
        items.some(
          (item) =>
            item.kind === "runtime_handoff" &&
            update.input.attempts.some(
              (attempt) =>
                attempt.request.id === item.requestId &&
                attempt.request.sessionId === item.sessionId,
            ),
        )
      )
        continue;
      const id = `input:${update.input.id}`;
      const item: TranscriptItem = {
        kind: "user",
        id,
        text: update.input.input,
        delivery: update.input,
      };
      const index = items.findIndex((current) => current.id === id);
      items =
        index === -1 ? [...items, item] : items.map((current, i) => (i === index ? item : current));
    }
  }
  return { items, conversation };
}
