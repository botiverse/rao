import { RuntimeLogo } from "./RuntimeLogo";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RuntimeId } from "@shared/ipc";
import { AvatarPicker, defaultAvatar } from "./ProjectAvatar";
import type { ProjectAvatarValue } from "../lib/projects";
import { folderName } from "../lib/projects";
import { useStore } from "../store";

export function NewSession({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (handle: string, name: string, avatar: ProjectAvatarValue) => void;
}) {
  const runtimes = useStore((store) => store.runtimes);
  const openSession = useStore((store) => store.openSession);
  const firstAvailable = runtimes.find((info) => info.installation.kind === "available");
  const [runtime, setRuntime] = useState<RuntimeId | null>(firstAvailable?.id ?? null);
  const [cwd, setCwd] = useState("");
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [name, setName] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const canOpen = runtime !== null && cwd.trim().length > 0 && !opening;

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector("input")?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const pickDirectory = async (): Promise<void> => {
    try {
      const picked = await window.rao.dialog.pickDirectory();
      if (picked !== null) setCwd(picked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = async (): Promise<void> => {
    if (runtime === null || !canOpen) return;
    setOpening(true);
    const projectName = name.trim() || folderName(cwd.trim());
    const handle = await openSession({
      runtime,
      cwd: cwd.trim(),
      project: { name: projectName, note: "", avatar },
    });
    setOpening(false);
    if (handle !== null) {
      onCreated(handle, projectName, avatar);
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-work-title"
        className="create-project-dialog w-full max-w-[540px] rounded-2xl border border-line-strong bg-bg shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !opening) onClose();
          if (event.key === "Tab") {
            const elements = dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input, textarea, select:not(:disabled)",
            );
            const first = elements?.[0];
            const last = elements?.[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="relative px-6 pt-5">
          <h2 id="new-work-title" className="text-lg font-medium">
            Create Project
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={opening}
            onClick={onClose}
            className="absolute top-4 right-4 rounded p-1 text-fg-muted hover:bg-bg-raised hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col items-center px-6 pt-9 pb-8">
            <div className="mb-3">
              <AvatarPicker value={avatar} onChange={setAvatar} disabled={opening} />
            </div>
            <input
              aria-label="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New Project"
              className="w-full bg-transparent text-center text-2xl tracking-tight outline-none placeholder:text-fg-faint"
            />
          </div>
          <div className="px-6 pb-6">
            <div className="flex min-h-14 items-center justify-between gap-6 border-b border-line py-3">
              <span className="text-sm">Workspace</span>
              <button
                type="button"
                onClick={() => {
                  void pickDirectory();
                }}
                disabled={opening}
                title={cwd || "Choose a folder"}
                className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-sm text-fg-muted hover:text-fg"
              >
                <span className="truncate">{cwd ? folderName(cwd) : "Choose folder"}</span>
                <ChevronDown size={14} className="shrink-0" />
              </button>
            </div>
            <div className="flex min-h-14 items-center justify-between gap-6 py-3">
              <label htmlFor="project-agent" className="text-sm">
                Agent
              </label>
              <div className="relative flex min-w-0 items-center gap-1">
                {runtime ? <RuntimeLogo runtime={runtime} /> : null}
                <select
                  id="project-agent"
                  value={runtime ?? ""}
                  disabled={opening}
                  onChange={(event) => {
                    const selected = runtimes.find((info) => info.id === event.target.value);
                    if (selected) setRuntime(selected.id);
                  }}
                  className="max-w-full appearance-none rounded bg-transparent py-1 pr-6 pl-2 text-right text-sm text-fg-muted outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  {runtime === null ? (
                    <option value="" disabled>
                      No agents installed
                    </option>
                  ) : null}
                  {runtimes.map((info) => (
                    <option
                      key={info.id}
                      value={info.id}
                      disabled={info.installation.kind !== "available"}
                    >
                      {info.label}
                      {info.installation.kind !== "available" ? " · unavailable" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute top-2 right-0 text-fg-faint"
                />
              </div>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="flex justify-end border-t border-line px-4 py-3">
            <button
              type="submit"
              disabled={!canOpen}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
            >
              {opening ? "Starting…" : "Create Project"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
