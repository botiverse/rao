import { Plus, X } from "lucide-react";
import { RUNTIME_LABELS } from "@shared/ipc";
import { useStore, type SessionState } from "../store";

function baseName(path: string): string {
  const segments = path.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment !== undefined && segment !== "") {
      return segment;
    }
  }
  return path;
}

function SessionRow({ session, active }: { session: SessionState; active: boolean }) {
  const select = useStore((store) => store.select);
  const deleteSession = useStore((store) => store.deleteSession);
  const { handle, runtime, cwd, title, live } = session.summary;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        void select(handle);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          void select(handle);
        }
      }}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-left no-drag ${
        active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-bg-raised hover:text-fg"
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          !live
            ? "border border-fg-faint"
            : session.state === "busy"
              ? "bg-accent pulse"
              : session.state === "stuck"
                ? "bg-warn pulse"
                : session.state === "error"
                  ? "bg-danger"
                  : "bg-ok"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title ?? baseName(cwd)}</span>
        <span className="block truncate text-[11px] text-fg-faint">
          {RUNTIME_LABELS[runtime]} · {baseName(cwd)}
        </span>
      </span>
      <button
        type="button"
        aria-label="Delete session"
        onClick={(event) => {
          event.stopPropagation();
          void deleteSession(handle);
        }}
        className="hidden rounded p-0.5 text-fg-faint hover:bg-line hover:text-fg group-hover:block"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const order = useStore((store) => store.order);
  const sessions = useStore((store) => store.sessions);
  const active = useStore((store) => store.active);
  const runtimes = useStore((store) => store.runtimes);
  const available = runtimes.filter((runtime) => runtime.installation.kind === "available");

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-bg-sunken">
      <div className="drag-region flex h-12 items-end px-3 pb-2 pl-20">
        <span className="text-[11px] font-medium tracking-wide text-fg-faint uppercase">
          Sessions
        </span>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {order.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-faint">No sessions yet.</p>
        ) : (
          order.map((handle) => {
            const session = sessions[handle];
            return session === undefined ? null : (
              <SessionRow key={handle} session={session} active={handle === active} />
            );
          })
        )}
      </div>
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={onNewSession}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-fg-muted no-drag hover:bg-bg-raised hover:text-fg"
        >
          <Plus size={14} />
          New session
        </button>
        <p className="px-2 pt-1 text-[11px] text-fg-faint">
          {available.length} of {runtimes.length} runtimes installed
        </p>
      </div>
    </aside>
  );
}
