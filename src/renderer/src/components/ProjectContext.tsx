import { RuntimeInventory } from "./RuntimeInventory";
import { BookOpen, Folder } from "lucide-react";
import { useState } from "react";
import type { Project } from "../lib/projects";
import { useProjects } from "../projects";

export function ProjectContext({ project }: { project: Project }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const update = useProjects((store) => store.update);
  const [nameDraft, setName] = useState<string | null>(null);
  const name = nameDraft ?? project.name;
  const [noteDraft, setNote] = useState<string | null>(null);
  const note = noteDraft ?? project.note;
  const dirty = name !== project.name || note !== project.note;
  return (
    <aside className="context-panel w-72 shrink-0 overflow-y-auto overflow-x-hidden border-l border-line bg-bg-sunken/40 p-5">
      <div className="mb-6 flex items-center gap-2 text-xs font-medium">
        <BookOpen size={14} /> Project note
      </div>
      <label htmlFor="project-name" className="context-label">
        Name
      </label>
      <input
        disabled={saving}
        id="project-name"
        className="context-input mb-6"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="project-note" className="context-label">
        Note <span className="text-fg-faint">@note</span>
      </label>
      <textarea
        disabled={saving}
        id="project-note"
        rows={14}
        className="context-input"
        placeholder="Write a note…"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button
        type="button"
        disabled={!dirty || !name.trim() || saving}
        onClick={() => {
          setSaving(true);
          setError(null);
          void update(project.id, { name: name.trim(), note })
            .then(() => {
              setName(null);
              setNote(null);
              return undefined;
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setSaving(false));
        }}
        className="mt-3 w-full rounded-md border border-line-strong bg-bg-raised py-1.5 text-xs hover:border-accent disabled:opacity-40"
      >
        {saving ? "Saving…" : dirty || error ? "Save note" : "Note saved"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-7 border-t border-line pt-5">
        <div className="context-label">
          <Folder size={12} /> Workspace
        </div>
        <p className="selectable break-all font-mono text-[11px] leading-relaxed text-fg-muted">
          {project.cwd}
        </p>
      </div>
      <details
        className="mt-5 border-t border-line pt-3 text-xs"
        onToggle={(event) => setInventoryOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-fg-muted">Skills, MCP servers &amp; tools</summary>
        {inventoryOpen ? (
          <>
            <RuntimeInventory
              key={JSON.stringify([project.id, project.cwd, project.session.summary.runtime])}
              runtime={project.session.summary.runtime}
              cwd={project.cwd}
            />
          </>
        ) : null}
      </details>
    </aside>
  );
}
