import { useEffect, useState } from "react";
import { RUNTIME_LABELS } from "@shared/ipc";
import { Composer } from "./components/Composer";
import { NewSession } from "./components/NewSession";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { Transcript } from "./components/Transcript";
import { useStore } from "./store";

export function App() {
  const connect = useStore((store) => store.connect);
  const load = useStore((store) => store.load);
  const loaded = useStore((store) => store.loaded);
  const active = useStore((store) => store.active);
  const session = useStore((store) =>
    store.active === null ? null : store.sessions[store.active],
  );
  const error = useStore((store) => store.error);
  const dismissError = useStore((store) => store.dismissError);
  const send = useStore((store) => store.send);
  const abort = useStore((store) => store.abort);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const disconnect = connect();
    void load();
    return disconnect;
  }, [connect, load]);

  return (
    <div className="relative flex h-full">
      <Sidebar
        onNewSession={() => {
          setCreating(true);
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
          {session === null || session === undefined ? (
            <span className="text-sm text-fg-faint">Rao</span>
          ) : (
            <>
              <div className="min-w-0">
                <span className="text-sm">{RUNTIME_LABELS[session.summary.runtime]}</span>
                <span className="ml-2 truncate font-mono text-[11px] text-fg-faint">
                  {session.summary.cwd}
                </span>
              </div>
              <StatusPill
                live={session.summary.live}
                state={session.state}
                status={session.status}
              />
            </>
          )}
        </header>

        {session === null || session === undefined ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-faint">
            <p className="text-lg text-fg-muted">Rao</p>
            <p className="max-w-sm text-center text-xs">
              One window for Claude Code, Codex, Kimi Code, Pi and Grok. Open a session to start.
            </p>
            <button
              type="button"
              disabled={!loaded}
              onClick={() => {
                setCreating(true);
              }}
              className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg no-drag disabled:opacity-40"
            >
              New session
            </button>
          </div>
        ) : (
          <>
            {session.transcript === null ? (
              <div className="flex flex-1 items-center justify-center text-xs text-fg-faint">
                Loading transcript…
              </div>
            ) : (
              <Transcript items={session.transcript} />
            )}
            <Composer
              state={session.state}
              live={session.summary.live}
              canSteer={session.summary.capabilities?.steer ?? false}
              onSend={(input) => {
                if (active !== null) {
                  void send(active, input);
                }
              }}
              onAbort={() => {
                if (active !== null) {
                  void abort(active);
                }
              }}
            />
          </>
        )}
      </main>

      {creating ? (
        <NewSession
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}

      {error === null ? null : (
        <button
          type="button"
          onClick={dismissError}
          className="absolute right-4 bottom-4 z-30 max-w-md rounded-lg border border-danger/40 bg-bg-raised px-3 py-2 text-left text-xs text-danger shadow-xl"
        >
          {error}
        </button>
      )}
    </div>
  );
}
