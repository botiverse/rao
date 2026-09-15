import type { AgentStatus } from "@botiverse/oar";
import { create } from "zustand";
import type { AgentState, OpenSessionRequest, RuntimeInfo, SessionSummary } from "@shared/ipc";
import { appendEvent, emptyTranscript, type Transcript } from "./lib/transcript";

export interface SessionState {
  readonly summary: SessionSummary;
  /** Null until the stored log has been replayed (lazy, on first selection). */
  readonly transcript: Transcript | null;
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
  readonly openSession: (request: OpenSessionRequest) => Promise<void>;
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
    try {
      const [runtimes, summaries] = await Promise.all([api.runtimes.list(), api.sessions.list()]);
      const sessions: Record<string, SessionState> = {};
      for (const summary of summaries) {
        sessions[summary.handle] = fresh(summary, null);
      }
      set({ runtimes, sessions, order: summaries.map((summary) => summary.handle), loaded: true });
    } catch (error) {
      set({ error: messageOf(error), loaded: true });
    }
  },

  async openSession(request) {
    try {
      const summary = await api.sessions.open(request);
      set((store) => ({
        sessions: { ...store.sessions, [summary.handle]: fresh(summary, emptyTranscript) },
        order: [summary.handle, ...store.order],
        active: summary.handle,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async deleteSession(handle) {
    try {
      await api.sessions.delete(handle);
    } catch (error) {
      set({ error: messageOf(error) });
      return;
    }
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
      const transcript = events.reduce(appendEvent, emptyTranscript);
      set((store) => {
        const current = store.sessions[handle];
        // Live events may have arrived meanwhile; they were folded onto null, so the replay wins.
        return current === undefined
          ? store
          : { sessions: { ...store.sessions, [handle]: { ...current, transcript } } };
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
        const summary =
          event.kind === "turn_started" && session.summary.title === null
            ? { ...session.summary, title: event.input.split("\n")[0] ?? event.input }
            : session.summary;
        const transcript =
          session.transcript === null ? null : appendEvent(session.transcript, event);
        if (transcript === session.transcript && summary === session.summary) {
          return store;
        }
        return { sessions: { ...store.sessions, [handle]: { ...session, transcript, summary } } };
      });
    });
    const offStatus = api.sessions.onStatus(({ handle, state, status, model }) => {
      set((store) => {
        const session = store.sessions[handle];
        return session === undefined
          ? store
          : {
              sessions: {
                ...store.sessions,
                [handle]: { ...session, state, status, model: model ?? session.model },
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
                  summary: { ...session.summary, live: false, capabilities: null },
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
