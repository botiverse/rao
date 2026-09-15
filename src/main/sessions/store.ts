/**
 * SessionStore: rao's own persistence. One append-only JSONL of oar `Event`s
 * per session plus an index.json of metadata. Events are the flat consumer
 * face, so a stored log replays into exactly the transcript the live
 * subscription produced; nothing here interprets them.
 *
 * Event lines go through synchronous fd writes so their order, and
 * everything written so far, survives a crashing process. The index is
 * rewritten atomically (tmp + rename) and flushed on a short debounce.
 */
import {
  closeSync,
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
import type { Event } from "@botiverse/oar";
import { isRuntimeId, type SessionRecord } from "@shared/ipc";

const INDEX_FILE = "index.json";
/** First line of every events file; bump when the stored Event vocabulary changes incompatibly. */
export const EVENTS_FORMAT = "rao-events/1";
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
  append(handle: string, event: Event): void {
    const record = this.#require(handle);
    let fd = this.#fds.get(handle);
    if (fd === undefined) {
      fd = openSync(this.#eventsPath(handle), "a");
      this.#fds.set(handle, fd);
    }
    writeSync(fd, `${JSON.stringify(event)}\n`);

    let next: SessionRecord = { ...record, updatedAt: event.receivedAt };
    if (event.kind === "turn_started" && record.title === null) {
      next = { ...next, title: titleOf(event.input) };
    }
    if (event.kind === "model") {
      next = { ...next, model: event.model };
    }
    this.#records.set(handle, next);
    this.#scheduleFlush();
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

  readEvents(handle: string): readonly Event[] {
    this.#require(handle);
    const path = this.#eventsPath(handle);
    if (!existsSync(path)) {
      return [];
    }
    // The header line and any line that is not a well-formed Event (a corrupt
    // tail after a crash, a kind from a newer format) are skipped, never fatal.
    const events: Event[] = [];
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
    this.#records.delete(handle);
    rmSync(this.#eventsPath(handle), { force: true });
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
    if (!Array.isArray(parsed)) {
      return;
    }
    for (const entry of parsed) {
      if (isSessionRecord(entry)) {
        this.#records.set(entry.handle, entry);
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

function isEvent(value: unknown): value is Event {
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
