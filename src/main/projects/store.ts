import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseProjectDetails, projectId, type ProjectDetails } from "@shared/projects";

/** Phase one: ID equals the Rao session handle; details remain a validated JSON document. */
export class ProjectStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
      const version = this.#db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error("Unsupported project database version");
      if (version === 0)
        this.#transaction(() => {
          this.#db.exec(`CREATE TABLE projects (
            id TEXT PRIMARY KEY, details TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
            current_session TEXT, created_at INTEGER NOT NULL DEFAULT 0,
            creating INTEGER NOT NULL DEFAULT 0, cleanup_pending INTEGER NOT NULL DEFAULT 0
          ); PRAGMA user_version = 1;`);
        });
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }
  list(): Record<string, ProjectDetails> {
    return Object.fromEntries(
      this.#db
        .prepare("SELECT id, details FROM projects WHERE deleted = 0 AND creating = 0")
        .all()
        .map((row) => [String(row.id), parseProjectDetails(JSON.parse(String(row.details)))]),
    );
  }
  create(id: string, details: ProjectDetails): void {
    const parsed = parseProjectDetails(details);
    const now = Date.now();
    this.#db
      .prepare(
        "INSERT INTO projects (id, current_session, details, created_at, updated_at, creating) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run(projectId(id), id, JSON.stringify(parsed), now, now);
  }
  finishCreate(id: string): void {
    this.#db
      .prepare("UPDATE projects SET creating = 0 WHERE id = ? AND deleted = 0")
      .run(projectId(id));
  }
  save(id: string, details: ProjectDetails): ProjectDetails {
    const parsed = parseProjectDetails(details);
    const result = this.#db
      .prepare(
        "UPDATE projects SET details = ?, updated_at = ? WHERE id = ? AND deleted = 0 AND creating = 0",
      )
      .run(JSON.stringify(parsed), Date.now(), projectId(id));
    if (result.changes !== 1) throw new Error("Unknown or deleted project");
    return parsed;
  }
  has(id: string): boolean {
    return (
      this.#db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId(id)) !== undefined
    );
  }
  remove(id: string): void {
    const now = Date.now();
    // Durable intent precedes JSONL deletion. Keep the tombstone after cleanup.
    this.#db
      .prepare(`INSERT INTO projects (id, current_session, details, deleted, created_at, updated_at, cleanup_pending)
      VALUES (?, ?, '{}', 1, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET deleted = 1, cleanup_pending = 1, updated_at = excluded.updated_at`)
      .run(projectId(id), id, now, now);
  }
  finishRemove(id: string): void {
    this.#db
      .prepare("UPDATE projects SET cleanup_pending = 0, creating = 0 WHERE id = ? AND deleted = 1")
      .run(projectId(id));
  }
  pending(): readonly { id: string; deleting: boolean }[] {
    return this.#db
      .prepare("SELECT id, deleted FROM projects WHERE creating = 1 OR cleanup_pending = 1")
      .all()
      .map((row) => ({ id: String(row.id), deleting: row.deleted === 1 }));
  }
  #transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  dispose(): void {
    this.#db.close();
  }
}
