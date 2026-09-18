import { create } from "zustand";
import type { ProjectDetails } from "./lib/projects";

interface ProjectsStore {
  readonly details: Record<string, ProjectDetails>;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly saving: string | null;
  readonly error: string | null;
  readonly load: () => Promise<void>;
  readonly remove: (handle: string) => void;
  readonly remember: (handle: string, details: ProjectDetails) => void;
  readonly update: (handle: string, patch: Partial<ProjectDetails>) => Promise<void>;
}
// Serialize reads and mutations so an older snapshot or save cannot overwrite a newer one.
let pending: Promise<unknown> = Promise.resolve();
let cacheRevision = 0;
function ordered<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}
export const useProjects = create<ProjectsStore>((set, get) => ({
  details: {},
  loaded: false,
  loading: false,
  saving: null,
  error: null,
  async load() {
    await ordered(async () => {
      set({ loading: true, error: null });
      try {
        let revision: number;
        let details: Record<string, ProjectDetails>;
        do {
          revision = cacheRevision;
          // A project may be created or deleted while this snapshot is in flight.
          // eslint-disable-next-line no-await-in-loop
          details = await window.rao.projects.list();
        } while (revision !== cacheRevision);
        set({ details, loaded: true });
      } catch (error) {
        set({ error: messageOf(error), loaded: false });
      } finally {
        set({ loading: false });
      }
    });
  },
  remove(handle) {
    cacheRevision += 1;
    set((store) => {
      const { [handle]: _removed, ...details } = store.details;
      return { details };
    });
  },
  remember(handle, details) {
    cacheRevision += 1;
    set((store) => ({ details: { ...store.details, [handle]: details } }));
  },
  async update(handle, patch) {
    await ordered(async () => {
      set({ saving: handle, error: null });
      try {
        const current = get().details[handle];
        if (!current) throw new Error("Unknown project");
        const saved = await window.rao.projects.save(handle, { ...current, ...patch });
        get().remember(handle, saved);
      } catch (error) {
        set({ error: messageOf(error) });
        throw error;
      } finally {
        set({ saving: null });
      }
    });
  },
}));
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
