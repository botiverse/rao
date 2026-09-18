/**
 * SessionStore: rao's own persistence. One append-only JSONL per session
 * plus an index.json of metadata. New entries retain complete OAR
 * records and a stream-instance ID. Legacy flat events remain readable.
 * The renderer uses the same conversation reducer live and on replay.
 *
 * Event lines go through synchronous fd writes so their order, and
 * everything written so far, survives a crashing process. The index is
 * rewritten atomically (tmp + rename) and flushed on a short debounce.
 */
import {
  closeSync,
  fsyncSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { eventsOf } from "@botiverse/oar/observe";
import {
  isRuntimeId,
  type SessionRecord,
  type SessionEvent,
  type RuntimeHandoff,
} from "@shared/ipc";

const INDEX_FILE = "index.json";
/** First line of every events file; bump when the stored Event vocabulary changes incompatibly. */
export const EVENTS_FORMAT = "rao-events/2";
const FLUSH_DELAY_MS = 500;
const TITLE_MAX = 80;

export class SessionStore {
  readonly #dir: string;
  readonly #records = new Map<string, SessionRecord>();
  readonly #fds = new Map<string, number>();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
    this.#load();
  }

  /** Every record, most recently updated first. */
  list(): readonly SessionRecord[] {
    return [...this.#records.values()].toSorted((a, b) => b.updatedAt - a.updatedAt);
  }

  get(handle: string): SessionRecord | undefined {
    return this.#records.get(handle);
  }

  create(record: SessionRecord): void {
    if (this.#records.has(record.handle)) {
      throw new Error(`session already stored: ${record.handle}`);
    }
    this.#records.set(record.handle, record);
    const fd = openSync(this.#eventsPath(record.handle), "a");
    this.#fds.set(record.handle, fd);
    writeSync(
      fd,
      `${JSON.stringify({ kind: "header", format: EVENTS_FORMAT, handle: record.handle, runtime: record.runtime, sessionId: record.sessionId, createdAt: record.openedAt })}\n`,
    );
    this.#flushNow();
  }

  /** Append one event; updates `updatedAt`, and `title` / `model` when the event carries them. */
  append(handle: string, event: SessionEvent): void {
    const record = this.#require(handle);
    let fd = this.#fds.get(handle);
    if (fd === undefined) {
      fd = openSync(this.#eventsPath(handle), "a");
      this.#fds.set(handle, fd);
    }
    writeSync(fd, `${JSON.stringify(event)}\n`);

    if (event.kind === "runtime_handoff") fsyncSync(fd);
    const next: SessionRecord =
      event.kind === "runtime_handoff"
        ? bindHandoff(record, event)
        : { ...record, updatedAt: event.receivedAt };
    for (const fact of event.kind === "record" ? eventsOf(event.record) : [event]) {
      if (fact.kind === "turn_started" && next.title === null)
        Object.assign(next, { title: titleOf(fact.input) });
      if (fact.kind === "model") Object.assign(next, { model: fact.model });
    }
    this.#records.set(handle, next);
    this.#scheduleFlush();
  }

  /** Only startup metadata may exist; conversation history must never be replaced. */
  isUnstarted(handle: string): boolean {
    const record = this.#require(handle);
    return (
      record.title === null &&
      record.promptAttempted !== true &&
      this.readEvents(handle).every((event) => {
        if (event.kind !== "record") return event.kind === "model" || event.kind === "exited";
        const raw = event.record;
        if (raw.kind === "request") return raw.body.kind === "dispose";
        return raw.kind === "response" || raw.body.events.every((fact) => fact.kind === "model");
      })
    );
  }

  markPromptAttempted(handle: string): void {
    const record = this.#require(handle);
    if (record.promptAttempted === true) return;
    this.#records.set(handle, { ...record, promptAttempted: true });
    this.#flushNow();
  }

  /** Keep the project handle and startup log; update its current native binding. */
  bindUnstarted(handle: string, sessionId: string): SessionRecord {
    if (!this.isUnstarted(handle))
      throw new Error("Cannot replace a session after conversation has started");
    const record = { ...this.#require(handle), sessionId };
    this.#records.set(handle, record);
    this.#flushNow();
    return record;
  }

  /** Release the event file handle; the record stays. */
  close(handle: string): void {
    const fd = this.#fds.get(handle);
    if (fd !== undefined) {
      closeSync(fd);
      this.#fds.delete(handle);
    }
    this.#flushNow();
  }

  readEvents(handle: string): readonly SessionEvent[] {
    this.#require(handle);
    const path = this.#eventsPath(handle);
    if (!existsSync(path)) {
      return [];
    }
    // The header line and any line that is not a well-formed Event (a corrupt
    // tail after a crash, a kind from a newer format) are skipped, never fatal.
    const events: SessionEvent[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line === "") {
        continue;
      }
      const parsed = parseJson(line);
      if (isEvent(parsed)) {
        events.push(parsed);
      }
    }
    return events;
  }

  remove(handle: string): void {
    this.close(handle);
    rmSync(this.#eventsPath(handle), { force: true });
    this.#records.delete(handle);
    this.#flushNow();
  }

  /** Close every file and write the index; call before the process exits. */
  dispose(): void {
    for (const fd of this.#fds.values()) {
      closeSync(fd);
    }
    this.#fds.clear();
    this.#flushNow();
  }

  #require(handle: string): SessionRecord {
    const record = this.#records.get(handle);
    if (record === undefined) {
      throw new Error(`unknown stored session: ${handle}`);
    }
    return record;
  }

  #eventsPath(handle: string): string {
    return join(this.#dir, `${handle}.events.jsonl`);
  }

  #load(): void {
    const path = join(this.#dir, INDEX_FILE);
    if (!existsSync(path)) {
      return;
    }
    const parsed = parseJson(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(isSessionRecord)) {
      throw new Error("Invalid session index; restore its backup before opening Rao");
    }
    for (const entry of parsed) {
      this.#records.set(entry.handle, entry);
      const events = this.readEvents(entry.handle);
      const last = events.findLastIndex((event) => event.kind === "runtime_handoff");
      const handoff = events[last];
      if (handoff?.kind === "runtime_handoff" && entry.handoffId !== handoff.id) {
        // The journal is the commit point; recover if index flush was interrupted.
        const current = bindHandoff(entry, handoff);
        for (const event of events.slice(last + 1)) {
          for (const fact of event.kind === "record" ? eventsOf(event.record) : [event]) {
            if (fact.kind === "model") Object.assign(current, { model: fact.model });
          }
        }
        this.#records.set(entry.handle, current);
      }
    }
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) {
      return;
    }
    this.#flushTimer = setTimeout(() => {
      this.#flushNow();
    }, FLUSH_DELAY_MS);
  }

  #flushNow(): void {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    const path = join(this.#dir, INDEX_FILE);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.#records.values()], null, 2));
    renameSync(tmp, path);
  }
}

function titleOf(input: string): string {
  const firstLine = input.split("\n").find((line) => line.trim() !== "") ?? input;
  const trimmed = firstLine.trim();
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEvent(value: unknown): value is SessionEvent {
  if (isRecordObject(value) && value.kind === "runtime_handoff") {
    return (
      typeof value.id === "string" &&
      typeof value.receivedAt === "number" &&
      isRuntimeId(value.from) &&
      isRuntimeId(value.to) &&
      typeof value.previousSessionId === "string" &&
      typeof value.sessionId === "string" &&
      typeof value.requestId === "string" &&
      typeof value.markdown === "string" &&
      (value.model === undefined || typeof value.model === "string") &&
      isRecordObject(value.runtimeModels) &&
      Object.entries(value.runtimeModels).every(
        ([runtime, model]) => isRuntimeId(runtime) && typeof model === "string",
      )
    );
  }
  if (isRecordObject(value) && value["kind"] === "record") {
    const raw = value["record"];
    return (
      typeof value["streamId"] === "string" &&
      typeof value["receivedAt"] === "number" &&
      isRecordObject(raw) &&
      typeof raw["sessionId"] === "string" &&
      Array.isArray(raw["agentPath"]) &&
      typeof raw["seq"] === "number" &&
      typeof raw["receivedAt"] === "number" &&
      isRecordObject(raw["body"]) &&
      (raw["kind"] === "frame"
        ? Array.isArray(raw["body"]["events"])
        : raw["kind"] === "request"
          ? typeof raw["id"] === "string"
          : raw["kind"] === "response" && typeof raw["requestId"] === "string")
    );
  }
  if (isRecordObject(value) && value["kind"] === "input_submission") {
    return (
      typeof value["id"] === "string" &&
      typeof value["input"] === "string" &&
      typeof value["receivedAt"] === "number" &&
      ["sending", "steered", "queued", "rejected", "unknown"].includes(String(value["state"]))
    );
  }
  return (
    isRecordObject(value) &&
    typeof value["kind"] === "string" &&
    typeof value["sessionId"] === "string" &&
    Array.isArray(value["agentPath"]) &&
    typeof value["seq"] === "number" &&
    typeof value["receivedAt"] === "number"
  );
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isRecordObject(value) &&
    typeof value["handle"] === "string" &&
    isRuntimeId(value["runtime"]) &&
    typeof value["sessionId"] === "string" &&
    typeof value["cwd"] === "string" &&
    (value["title"] === null || typeof value["title"] === "string") &&
    typeof value["openedAt"] === "number" &&
    typeof value["updatedAt"] === "number"
  );
}

function bindHandoff(record: SessionRecord, event: RuntimeHandoff): SessionRecord {
  const { model: _previousModel, ...rest } = record;
  return {
    ...rest,
    runtime: event.to,
    sessionId: event.sessionId,
    handoffId: event.id,
    runtimeModels: event.runtimeModels,
    promptAttempted: true,
    updatedAt: event.receivedAt,
    ...(event.model === undefined ? {} : { model: event.model }),
  };
}
