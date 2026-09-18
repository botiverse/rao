import { useEffect, useRef, useState } from "react";
import { Pencil, Smile, Trash2, X } from "lucide-react";
import type { Project } from "../lib/projects";
import { useProjects } from "../projects";
import { useStore } from "../store";
import { AvatarPicker } from "./ProjectAvatar";

export function ProjectMenu({
  project,
  x,
  y,
  onClose,
}: {
  project: Project;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"menu" | "rename" | "avatar" | "delete">("menu");
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = useProjects((store) => store.update);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector<HTMLElement>("input, button")?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (!busy && event.target instanceof Node && !root.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose, busy]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(mode === "rename" ? "input" : "button")?.focus();
  }, [mode]);
  const saveName = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await update(project.id, { name: name.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    setBusy(true);
    await useStore.getState().deleteSession(project.id);
    if (!useStore.getState().sessions[project.id]) {
      useProjects.getState().remove(project.id);
      const active = useStore.getState().active;
      if (active !== null) {
        const valid = useProjects.getState().details;
        await useStore
          .getState()
          .select(
            valid[active]
              ? active
              : (useStore.getState().order.find((handle) => valid[handle]) ?? null),
          );
      }
      onClose();
    } else setBusy(false);
  };
  return (
    <div
      ref={root}
      role={mode === "menu" ? "menu" : "dialog"}
      aria-label={mode === "menu" ? `Actions for ${project.name}` : `${mode} project`}
      className="fixed z-40 rounded-lg border border-line-strong bg-bg-raised p-1 shadow-2xl"
      style={{
        width: mode === "avatar" ? 384 : 224,
        left: Math.max(8, Math.min(x, window.innerWidth - (mode === "avatar" ? 392 : 232))),
        top: Math.max(8, Math.min(y, window.innerHeight - 240)),
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
        if (mode === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
          );
          const index = items.findIndex((item) => item === document.activeElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      {mode === "menu" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("rename")}
            className="project-menu-item"
          >
            <Pencil size={14} /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("avatar")}
            className="project-menu-item"
          >
            <Smile size={14} /> Change avatar
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("delete")}
            className="project-menu-item text-danger"
          >
            <Trash2 size={14} /> Delete project…
          </button>
        </>
      ) : (
        <div className="p-2">
          <div className="mb-3 flex items-center justify-between text-xs font-medium">
            <span>
              {mode === "rename"
                ? "Rename project"
                : mode === "avatar"
                  ? "Project avatar"
                  : "Delete project?"}
            </span>
            <button type="button" aria-label="Close project menu" disabled={busy} onClick={onClose}>
              <X size={14} />
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {mode === "rename" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveName();
              }}
            >
              <input
                aria-label="Project name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="context-input"
              />
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="mt-3 rounded bg-accent px-3 py-1 text-xs text-bg disabled:opacity-40"
              >
                Save
              </button>
            </form>
          ) : mode === "avatar" ? (
            <div className="flex justify-center">
              <AvatarPicker
                value={project.avatar}
                onChange={async (avatar) => {
                  await update(project.id, { avatar });
                }}
              />
            </div>
          ) : (
            <>
              <p className="text-xs leading-5 text-fg-muted">
                This removes “{project.name}”, its conversation and note, and stops its agent.
                Workspace files are kept.
              </p>
              <div className="mt-3 flex justify-end gap-3">
                <button type="button" disabled={busy} onClick={onClose} className="text-xs">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void remove();
                  }}
                  className="rounded bg-danger px-3 py-1 text-xs text-bg"
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
