import { FolderOpen, X } from "lucide-react";
import { useState } from "react";
import type { RuntimeId } from "@shared/ipc";
import { useStore } from "../store";

export function NewSession({ onClose }: { onClose: () => void }) {
  const runtimes = useStore((store) => store.runtimes);
  const openSession = useStore((store) => store.openSession);
  const firstAvailable = runtimes.find((info) => info.installation.kind === "available");
  const [runtime, setRuntime] = useState<RuntimeId | null>(firstAvailable?.id ?? null);
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [opening, setOpening] = useState(false);

  const canOpen = runtime !== null && cwd.length > 0 && !opening;

  const pickDirectory = async (): Promise<void> => {
    const picked = await window.rao.dialog.pickDirectory();
    if (picked !== null) {
      setCwd(picked);
    }
  };

  const submit = async (): Promise<void> => {
    if (runtime === null || !canOpen) {
      return;
    }
    setOpening(true);
    await openSession({ runtime, cwd, ...(model.trim() === "" ? {} : { model: model.trim() }) });
    setOpening(false);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
      <div className="w-[440px] rounded-xl border border-line bg-bg-raised p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">New session</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-fg-faint hover:bg-line hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>

        <label className="mb-1 block text-[11px] text-fg-muted">Runtime</label>
        <div className="mb-4 grid grid-cols-3 gap-1.5">
          {runtimes.map((info) => {
            const installed = info.installation.kind === "available";
            const version =
              info.installation.kind === "available" && info.installation.via === "executable"
                ? info.installation.version
                : undefined;
            return (
              <button
                key={info.id}
                type="button"
                disabled={!installed}
                onClick={() => {
                  setRuntime(info.id);
                }}
                className={`rounded-md border px-2 py-1.5 text-left text-xs ${
                  runtime === info.id
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line text-fg-muted hover:border-line-strong"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="block">{info.label}</span>
                <span className="block text-[10px] text-fg-faint">
                  {installed ? (version ?? "installed") : info.installation.kind}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mb-1 block text-[11px] text-fg-muted">Working directory</label>
        <div className="mb-4 flex gap-1.5">
          <input
            value={cwd}
            onChange={(event) => {
              setCwd(event.target.value);
            }}
            placeholder="/path/to/project"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => {
              void pickDirectory();
            }}
            className="rounded-md border border-line px-2 text-fg-muted hover:border-line-strong hover:text-fg"
            aria-label="Choose folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>

        <label className="mb-1 block text-[11px] text-fg-muted">Model (optional)</label>
        <input
          value={model}
          onChange={(event) => {
            setModel(event.target.value);
          }}
          placeholder="runtime default"
          className="mb-5 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => {
              void submit();
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-40"
          >
            {opening ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
