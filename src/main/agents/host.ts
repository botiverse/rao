/**
 * AgentHost: the one place in main that talks to oar. It probes runtimes,
 * opens and resumes sessions, forwards the record stream to the renderer as
 * flat events, and appends the same events to the SessionStore. It knows
 * nothing about Electron windows: it pushes to a `Sink`.
 *
 * Kept as a plain class so it can later move into a `utilityProcess`
 * without touching the IPC layer.
 */
import {
  observeAgent,
  runtimes,
  simpleStateOf,
  type AgentObserver,
  type ControlResult,
  type Event,
  type ListModelsResult,
  type Runtime,
  type Session,
} from "@botiverse/oar";
import type {
  ControlOutcome,
  OpenSessionRequest,
  RuntimeId,
  RuntimeInfo,
  SessionClosedMessage,
  SessionEventMessage,
  SessionRecord,
  SessionStatusMessage,
  SessionSummary,
} from "@shared/ipc";
import { RUNTIME_IDS, RUNTIME_LABELS } from "@shared/ipc";
import type { SessionStore } from "../sessions/store";

export interface Sink {
  event(message: SessionEventMessage): void;
  status(message: SessionStatusMessage): void;
  closed(message: SessionClosedMessage): void;
}

interface Live {
  readonly session: Session;
  readonly observer: AgentObserver;
  readonly unsubscribe: () => void;
}

const STALL_AFTER_MS = 30_000;

export class AgentHost {
  readonly #sink: Sink;
  readonly #store: SessionStore;
  readonly #live = new Map<string, Live>();

  constructor(sink: Sink, store: SessionStore) {
    this.#sink = sink;
    this.#store = store;
  }

  async listRuntimes(): Promise<readonly RuntimeInfo[]> {
    return Promise.all(
      RUNTIME_IDS.map(async (id): Promise<RuntimeInfo> => {
        const runtime = runtimes.require(id);
        const installation =
          runtime.installation === undefined
            ? { kind: "unsupported" as const, reason: "runtime has no installation probe" }
            : await runtime.installation().catch((error: unknown) => ({
                kind: "unsupported" as const,
                reason: errorMessage(error),
              }));
        return {
          id,
          label: RUNTIME_LABELS[id],
          installation,
          features: {
            listModels: runtime.listModels !== undefined,
            accountUsage: runtime.accountUsage !== undefined,
          },
        };
      }),
    );
  }

  async listModels(id: RuntimeId): Promise<ListModelsResult> {
    const runtime = runtimes.require(id);
    if (runtime.listModels === undefined) {
      return { kind: "unsupported", reason: `${id} does not enumerate models` };
    }
    const installation = await requireAvailable(runtime);
    return runtime.listModels(installation, { timeoutMs: 15_000 });
  }

  async open(request: OpenSessionRequest): Promise<SessionSummary> {
    const runtime = runtimes.require(request.runtime);
    const installation = await requireAvailable(runtime);
    const session = await runtime.session(installation, {
      cwd: request.cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
    });
    const now = Date.now();
    const record: SessionRecord = {
      handle: crypto.randomUUID(),
      runtime: request.runtime,
      sessionId: session.id,
      cwd: request.cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
      title: null,
      openedAt: now,
      updatedAt: now,
    };
    this.#store.create(record);
    this.#attach(record.handle, session);
    return this.#summary(record);
  }

  /** Reattach a runtime to a stored session through the runtime's native resume. */
  async resume(handle: string): Promise<SessionSummary> {
    const record = this.#requireRecord(handle);
    if (this.#live.has(handle)) {
      return this.#summary(record);
    }
    const runtime = runtimes.require(record.runtime);
    const installation = await requireAvailable(runtime);
    const session = await runtime.session(installation, {
      cwd: record.cwd,
      resume: record.sessionId,
      ...(record.model === undefined ? {} : { model: record.model }),
    });
    this.#attach(handle, session);
    return this.#summary(record);
  }

  list(): readonly SessionSummary[] {
    return this.#store.list().map((record) => this.#summary(record));
  }

  events(handle: string): readonly Event[] {
    return this.#store.readEvents(handle);
  }

  async prompt(handle: string, input: string): Promise<ControlOutcome> {
    return toOutcome(await this.#requireLive(handle).session.prompt(input));
  }

  async steerOrQueue(handle: string, input: string): Promise<ControlOutcome> {
    const landed = await this.#requireLive(handle).session.steerOrQueue(input);
    return landed.landed === "rejected"
      ? { accepted: false, reason: landed.reason }
      : toOutcome(landed.result);
  }

  async abort(handle: string): Promise<ControlOutcome> {
    return toOutcome(await this.#requireLive(handle).session.abort());
  }

  /** Release the runtime; the stored session stays and can be resumed. */
  async dispose(handle: string): Promise<void> {
    const live = this.#live.get(handle);
    if (live === undefined) {
      return;
    }
    this.#release(handle, live);
    await live.session.dispose();
    this.#sink.closed({ handle, reason: "disposed" });
  }

  /** Release the runtime if live and remove the stored session. */
  async delete(handle: string): Promise<void> {
    await this.dispose(handle);
    if (this.#store.get(handle) !== undefined) {
      this.#store.remove(handle);
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.#live.keys()].map(async (handle) => this.dispose(handle)));
  }

  #attach(handle: string, session: Session): void {
    // Flat events for the transcript and the store; the native frames stay
    // reachable in session.records() should a debug view want them later.
    const unsubscribe = session.events((event) => {
      this.#store.append(handle, event);
      this.#sink.event({ handle, event });
      if (event.kind === "exited") {
        const live = this.#live.get(handle);
        if (live !== undefined) {
          this.#release(handle, live);
        }
        this.#sink.closed({ handle, reason: `runtime exited (code ${String(event.code)})` });
      }
    });

    // Status is a fold over the same records plus a clock; observeAgent
    // pushes on every record and on the silence edge.
    const observer = observeAgent(session, { stallAfterMs: STALL_AFTER_MS });
    observer.subscribe((view) => {
      this.#sink.status({
        handle,
        state: simpleStateOf(view),
        status: view.status,
        model: session.model().value,
      });
    });

    this.#live.set(handle, { session, observer, unsubscribe });
  }

  #release(handle: string, live: Live): void {
    this.#live.delete(handle);
    live.observer.dispose();
    live.unsubscribe();
    this.#store.close(handle);
  }

  #summary(record: SessionRecord): SessionSummary {
    const live = this.#live.get(record.handle);
    return {
      ...record,
      live: live !== undefined,
      capabilities: live?.session.capabilities ?? null,
    };
  }

  #requireRecord(handle: string): SessionRecord {
    const record = this.#store.get(handle);
    if (record === undefined) {
      throw new Error(`unknown session: ${handle}`);
    }
    return record;
  }

  #requireLive(handle: string): Live {
    const live = this.#live.get(handle);
    if (live === undefined) {
      throw new Error(`session is not running: ${handle}`);
    }
    return live;
  }
}

async function requireAvailable(runtime: Runtime) {
  if (runtime.installation === undefined) {
    throw new Error(`${runtime.id} has no installation probe`);
  }
  const snapshot = await runtime.installation();
  if (snapshot.kind !== "available") {
    const detail = snapshot.kind === "unsupported" ? `: ${snapshot.reason}` : "";
    throw new Error(`${runtime.id} is not available (${snapshot.kind}${detail})`);
  }
  return snapshot;
}

function toOutcome(result: ControlResult): ControlOutcome {
  const { body } = result.response;
  switch (body.kind) {
    case "accepted":
      return { accepted: true, seq: result.request.seq };
    case "rejected":
      return { accepted: false, reason: body.reason };
    case "answered":
    case "exited":
      return { accepted: false, reason: body.kind };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
