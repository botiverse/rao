import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
it("rejects unknown projects, invalid IDs and malformed avatars without partial writes", () => {
  const { store } = setup();
  expect(() => store.create("../escape", detail)).toThrow("ID");
  expect(() =>
    store.create("valid", { ...detail, avatar: { icon: "Book", color: "url(x)" } }),
  ).toThrow("avatar");
  expect(() => store.save("unknown", detail)).toThrow("Unknown");
  expect(store.list()).toEqual({});
});
