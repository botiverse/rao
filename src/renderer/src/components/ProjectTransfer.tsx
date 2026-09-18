import { useState } from "react";
import { useProjects } from "../projects";
import { useStore } from "../store";

/** Explicit one-time transfer between Chromium origins; imported originals are backed up. */
export function ProjectTransfer() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: "import" | "export"): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (kind === "export") {
        const legacy = !useProjects.getState().loaded
          ? (localStorage.getItem("rao-projects-v2") ?? undefined)
          : undefined;
        if (await window.rao.projects.export(legacy)) setStatus("Projects exported");
      } else {
        const result = await window.rao.projects.importFile();
        if (result) {
          await Promise.all([useProjects.getState().load(), useStore.getState().load()]);
          setStatus(`Imported ${result.imported}; skipped ${result.skipped}`);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-3 text-xs text-fg-muted">
      <div className="flex gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run("import");
          }}
        >
          Import projects…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run("export");
          }}
        >
          Export projects…
        </button>
      </div>
      {status ? (
        <p role="status" className="mt-2">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
