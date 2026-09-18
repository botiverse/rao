import { randomUUID } from "node:crypto";
import type { AgentHost } from "../agents/host";
import type { OpenSessionRequest, SessionSummary } from "@shared/ipc";
import type { ProjectStore } from "./store";

/** Durable intent in SQLite makes the two-store operations restartable. */
export class ProjectService {
  constructor(
    readonly host: AgentHost,
    readonly projects: ProjectStore,
  ) {}
  async create(request: OpenSessionRequest): Promise<SessionSummary> {
    const id = randomUUID();
    this.projects.create(id, request.project ?? { name: "", note: "" });
    try {
      const summary = await this.host.open(request, id);
      this.projects.finishCreate(id);
      return summary;
    } catch (error) {
      try {
        await this.remove(id);
      } catch {
        throw new Error(`Project creation failed; recovery for ${id} will retry at startup`, {
          cause: error,
        });
      }
      throw error;
    }
  }
  async remove(id: string): Promise<void> {
    this.projects.remove(id);
    await this.host.delete(id);
    this.projects.finishRemove(id);
  }
  async recover(): Promise<void> {
    const sessions = new Set(this.host.list().map((item) => item.handle));
    for (const pending of this.projects.pending()) {
      if (!pending.deleting && sessions.has(pending.id)) this.projects.finishCreate(pending.id);
      else {
        // Finish each cross-store operation before starting another recovery.
        // eslint-disable-next-line no-await-in-loop
        await this.remove(pending.id);
      }
    }
  }
}
