import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProjectStore } from "./store";

const dirs: string[] = [];
const stores: ProjectStore[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rao-projects-test-"));
  dirs.push(dir);
  const path = join(dir, "rao.sqlite");
  const store = new ProjectStore(path);
  stores.push(store);
  return { dir, path, store };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const envelope = (details: unknown) => JSON.stringify({ version: 1, state: { details } });
const detail = {
  name: "中文项目",
  note: "第一行\n📝 第二行",
  avatar: { icon: "Book", color: "#86afe5" },
};
it("persists metadata and stable session mapping across reopen", () => {
  const { store, path } = setup();
  store.create("project", detail);
  store.finishCreate("project");
  store.save("project", { ...detail, note: "修改后的笔记" });
  store.dispose();
  stores.pop();
  const reopened = new ProjectStore(path);
  stores.push(reopened);
  expect(reopened.list()).toEqual({ project: { ...detail, note: "修改后的笔记" } });
  const db = new DatabaseSync(path);
  expect(db.prepare("SELECT current_session, created_at FROM projects").get()).toMatchObject({
    current_session: "project",
    created_at: expect.any(Number),
  });
  expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
  db.close();
});
it("backs up imports, migrates goal/context, and never overwrites or resurrects across origins", () => {
  const { store, dir } = setup();
  const sessions = new Set(["a", "b"]);
  const text = envelope({
    a: { name: "旧项目", goal: "目标", context: "知识", avatar: detail.avatar },
    b: detail,
  });
  expect(store.importLegacy("http://localhost:5173", text, sessions)).toEqual({
    imported: 2,
    skipped: 0,
  });
  const backup = readdirSync(join(dir, "project-import-backups"))[0];
  expect(readFileSync(join(dir, "project-import-backups", backup ?? ""), "utf8")).toBe(text);
  expect(store.list().a?.note).toBe("目标\n\n知识");
  store.save("a", { name: "新名", note: "新笔记" });
  store.remove("b");
  store.finishRemove("b");
  expect(store.importLegacy("file://", text, new Set(["a"]))).toEqual({ imported: 0, skipped: 2 });
  expect(store.importLegacy("http://localhost:5173", text, sessions).imported).toBe(0);
  expect(store.list()).toEqual({ a: { name: "新名", note: "新笔记" } });
});
it("rolls back a failed batch and completion marker, then retries the same source", () => {
  const { store, path } = setup();
  const sessions = new Set(["a", "b"]);
  expect(store.importLegacy("file://", envelope({}), sessions).imported).toBe(0);
  expect(() =>
    store.importLegacy(
      "file://",
      envelope({ a: detail, b: { name: "invalid", note: 3 } }),
      sessions,
    ),
  ).toThrow();
  expect(store.list()).toEqual({});
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TRIGGER fail_b BEFORE INSERT ON projects WHEN NEW.id = 'b' BEGIN SELECT RAISE(ABORT, 'disk test'); END;",
  );
  const text = envelope({ a: detail, b: detail });
  expect(() => store.importLegacy("file://", text, sessions)).toThrow("disk test");
  expect(store.list()).toEqual({});
  expect(db.prepare("SELECT count(*) AS n FROM legacy_imports").get()?.n).toBe(0);
  db.exec("DROP TRIGGER fail_b");
  db.close();
  expect(store.importLegacy("file://", text, sessions).imported).toBe(2);
});
it("rejects unknown sessions, invalid IDs and malformed avatars without partial writes", () => {
  const { store } = setup();
  expect(() => store.importLegacy("file://", envelope({ missing: detail }), new Set())).toThrow(
    "No saved conversation",
  );
  expect(() => store.create("../escape", detail)).toThrow("ID");
  expect(() =>
    store.create("valid", { ...detail, avatar: { icon: "Book", color: "url(x)" } }),
  ).toThrow("avatar");
  expect(() => store.save("unknown", detail)).toThrow("Unknown");
  expect(store.list()).toEqual({});
});
it("upgrades the initial phase-zero database without dropping details or tombstones", () => {
  const { path, store } = setup();
  store.dispose();
  stores.pop();
  rmSync(path);
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE projects (id TEXT PRIMARY KEY, details TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL); CREATE TABLE legacy_imports (source TEXT PRIMARY KEY, imported_at INTEGER NOT NULL);",
  );
  db.prepare("INSERT INTO projects VALUES ('old', ?, 0, 123)").run(JSON.stringify(detail));
  db.close();
  const migrated = new ProjectStore(path);
  stores.push(migrated);
  expect(migrated.list()).toEqual({ old: detail });
});
