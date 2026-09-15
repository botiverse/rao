import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event, EventBody } from "@botiverse/oar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionRecord } from "@shared/ipc";
import { EVENTS_FORMAT, SessionStore } from "./store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rao-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const record = (handle: string, at: number): SessionRecord => ({
  handle,
  runtime: "claude",
  sessionId: `native-${handle}`,
  cwd: "/tmp/project",
  title: null,
  openedAt: at,
  updatedAt: at,
});

const event = (body: EventBody, seq: number, at: number): Event => ({
  ...body,
  sessionId: "native-a",
  agentPath: [],
  seq,
  receivedAt: at,
});

describe("SessionStore", () => {
  it("persists records and event logs across instances", () => {
    const store = new SessionStore(dir);
    store.create(record("a", 1));
    store.append(
      "a",
      event({ kind: "turn_started", requestId: "r", input: "  hello world\nmore" }, 0, 2),
    );
    store.append("a", event({ kind: "text_delta", text: "hi" }, 1, 3));
    store.append("a", event({ kind: "model", model: "sonnet" }, 2, 4));
    store.dispose();

    const reopened = new SessionStore(dir);
    expect(reopened.list()).toEqual([
      expect.objectContaining({ handle: "a", title: "hello world", model: "sonnet", updatedAt: 4 }),
    ]);
    expect(reopened.readEvents("a").map((item) => item.kind)).toEqual([
      "turn_started",
      "text_delta",
      "model",
    ]);
  });

  it("starts every events file with a format header", () => {
    const store = new SessionStore(dir);
    store.create(record("a", 1));
    store.dispose();
    const [first] = readFileSync(join(dir, "a.events.jsonl"), "utf8").split("\n");
    expect(JSON.parse(first ?? "")).toMatchObject({ kind: "header", format: EVENTS_FORMAT });
  });

  it("lists most recently updated first", () => {
    const store = new SessionStore(dir);
    store.create(record("old", 1));
    store.create(record("new", 2));
    store.append("old", event({ kind: "text_delta", text: "x" }, 0, 10));
    expect(store.list().map((item) => item.handle)).toEqual(["old", "new"]);
    store.dispose();
  });

  it("removes the record and its log", () => {
    const store = new SessionStore(dir);
    store.create(record("a", 1));
    store.append("a", event({ kind: "text_delta", text: "x" }, 0, 2));
    store.remove("a");
    expect(store.list()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))).toEqual([]);
    expect(() => store.readEvents("a")).toThrow(/unknown stored session/);
    store.dispose();
  });

  it("skips corrupt lines instead of failing the whole replay", () => {
    const store = new SessionStore(dir);
    store.create(record("a", 1));
    store.append("a", event({ kind: "text_delta", text: "ok" }, 0, 2));
    store.dispose();

    const path = join(dir, "a.events.jsonl");
    writeFileSync(path, `${readFileSync(path, "utf8")}{not json\n{"kind":"text_delta"}\n`);

    const reopened = new SessionStore(dir);
    expect(reopened.readEvents("a")).toHaveLength(1);
    reopened.dispose();
  });
});
