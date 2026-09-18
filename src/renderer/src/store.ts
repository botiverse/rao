import type { AgentStatus } from "@botiverse/oar";
import { useProjects } from "./projects";
import { create } from "zustand";
import type {
  AgentState,
  OpenSessionRequest,
  RuntimeInfo,
  SessionSummary,
  SessionEvent,
} from "@shared/ipc";
import {
  appendSessionEvent,
  emptyTranscriptState,
  type Transcript,
  type TranscriptState,
} from "./lib/transcript";

export interface SessionState {
  readonly summary: SessionSummary;
  /** Null until the stored log has been replayed (lazy, on first selection). */
  readonly transcript: Transcript | null;
  readonly conversation: TranscriptState["conversation"];
  readonly buffered: readonly SessionEvent[];
  readonly state: AgentState;
  readonly status: AgentStatus;
  readonly model: string | null;
}

interface Store {
  readonly runtimes: readonly RuntimeInfo[];
  readonly loaded: boolean;
  readonly sessions: Readonly<Record<string, SessionState>>;
  /** Handles in display order: most recently updated first, new sessions on top. */
  readonly order: readonly string[];
  readonly active: string | null;
  readonly error: string | null;

  readonly load: () => Promise<void>;
  readonly openSession: (request: OpenSessionRequest) => Promise<string | null>;
  readonly deleteSession: (handle: string) => Promise<void>;
  readonly select: (handle: string | null) => Promise<void>;
  readonly send: (handle: string, input: string) => Promise<void>;
  readonly abort: (handle: string) => Promise<void>;
  readonly dismissError: () => void;
  /** Wire the push channels once; returns the teardown. */
  readonly connect: () => () => void;
}

const api = window.rao;

function fresh(summary: SessionSummary, transcript: Transcript | null): SessionState {
  return {
    summary,
    transcript,
    conversation: emptyTranscriptState().conversation,
    buffered: [],
    state: "idle",
    status: { kind: "idle" },
    model: summary.model ?? null,
  };
}

export const useStore = create<Store>((set, get) => ({
  runtimes: [],
  loaded: false,
  sessions: {},
  order: [],
  active: null,
  error: null,

  async load() {
    set({ loaded: false, error: null });
    try {
      const [runtimes, summaries] = await Promise.all([api.runtimes.list(), api.sessions.list()]);
      const sessions: Record<string, SessionState> = {};
      for (const summary of summaries) {
        const current = get().sessions[summary.handle];
        sessions[summary.handle] = current ? { ...current, summary } : fresh(summary, null);
      }
      set({ runtimes, sessions, order: summaries.map((summary) => summary.handle), loaded: true });
    } catch (error) {
      set({ error: messageOf(error), loaded: false });
    }
  },

  async openSession(request) {
    try {
      const summary = await api.sessions.open(request);
      useProjects.getState().remember(summary.handle, request.project ?? { name: "", note: "" });
      set((store) => ({
        sessions: { ...store.sessions, [summary.handle]: fresh(summary, null) },
        order: [summary.handle, ...store.order],
        active: summary.handle,
      }));
      await get().select(summary.handle);
      return summary.handle;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  async deleteSession(handle) {
    try {
      await api.sessions.delete(handle);
    } catch (error) {
      set({ error: messageOf(error) });
      return;
    }
    useProjects.getState().remove(handle);
    set((store) => {
      const { [handle]: _removed, ...sessions } = store.sessions;
      const order = store.order.filter((item) => item !== handle);
      const active = store.active === handle ? (order[0] ?? null) : store.active;
      return { sessions, order, active };
    });
  },

  async select(handle) {
    set({ active: handle });
    if (handle === null) {
      return;
    }
    const session = get().sessions[handle];
    if (session === undefined || session.transcript !== null) {
      return;
    }
    try {
      const events = await api.sessions.events(handle);
      const replay = events.reduce(appendSessionEvent, emptyTranscriptState());
      set((store) => {
        const current = store.sessions[handle];
        if (current === undefined || current.transcript !== null) return store;
        // Fold pushes that arrived while loading; OAR cursors deduplicate overlap.
        const merged = (current?.buffered ?? []).reduce(appendSessionEvent, replay);
        return current === undefined
          ? store
          : {
              sessions: {
                ...store.sessions,
                [handle]: {
                  ...current,
                  transcript: merged.items,
                  conversation: merged.conversation,
                  buffered: [],
                },
              },
            };
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async send(handle, input) {
    const session = get().sessions[handle];
    if (session === undefined) {
      return;
    }
    try {
      if (!session.summary.live) {
        const summary = await api.sessions.resume(handle);
        set((store) => {
          const current = store.sessions[handle];
          return current === undefined
            ? store
            : { sessions: { ...store.sessions, [handle]: { ...current, summary } } };
        });
      }
      // Busy: steer if the runtime can, else queue; the outcome lands in the stream.
      const outcome =
        session.state === "idle" || session.state === "error"
          ? await api.sessions.prompt(handle, input)
          : await api.sessions.steerOrQueue(handle, input);
      if (!outcome.accepted) {
        set({ error: `Input not taken: ${outcome.reason}` });
      }
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async abort(handle) {
    const outcome = await api.sessions.abort(handle);
    if (!outcome.accepted) {
      set({ error: `Abort not taken: ${outcome.reason}` });
    }
  },

  dismissError() {
    set({ error: null });
  },

  connect() {
    const offEvent = api.sessions.onEvent(({ handle, event }) => {
      set((store) => {
        const session = store.sessions[handle];
        if (session === undefined) {
          return store;
        }
        if (session.transcript === null) {
          return {
            sessions: {
              ...store.sessions,
              [handle]: { ...session, buffered: [...session.buffered, event] },
            },
          };
        }
        const next = appendSessionEvent(
          { items: session.transcript, conversation: session.conversation },
          event,
        );
        const firstInput = next.items.find((item) => item.kind === "user");
        const summary =
          session.summary.title === null && firstInput?.kind === "user"
            ? { ...session.summary, title: firstInput.text.split("\n")[0] ?? firstInput.text }
            : session.summary;
        return {
          sessions: {
            ...store.sessions,
            [handle]: {
              ...session,
              transcript: next.items,
              conversation: next.conversation,
              summary,
            },
          },
        };
      });
    });
    const offStatus = api.sessions.onStatus(({ handle, state, status, model, context }) => {
      set((store) => {
        const session = store.sessions[handle];
        return session === undefined
          ? store
          : {
              sessions: {
                ...store.sessions,
                [handle]: {
                  ...session,
                  state,
                  status,
                  model: model ?? session.model,
                  summary: { ...session.summary, context },
                },
              },
            };
      });
    });
    const offClosed = api.sessions.onClosed(({ handle }) => {
      set((store) => {
        const session = store.sessions[handle];
        return session === undefined
          ? store
          : {
              sessions: {
                ...store.sessions,
                [handle]: {
                  ...session,
                  summary: { ...session.summary, live: false, capabilities: null, context: null },
                  state: "idle",
                  status: { kind: "idle" },
                },
              },
            };
      });
    });
    return () => {
      offEvent();
      offStatus();
      offClosed();
    };
  },
}));

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
