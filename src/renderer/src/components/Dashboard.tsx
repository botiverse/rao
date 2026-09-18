import { RuntimeLogo } from "./RuntimeLogo";
import { RuntimeInventory } from "./RuntimeInventory";
import { useEffect, useState } from "react";
import { Box, RefreshCw } from "lucide-react";
import type { AccountUsageSnapshot, ListModelsResult } from "@botiverse/oar";
import type { AppVersions, RuntimeInfo, SessionDiagnostics } from "@shared/ipc";
import { accountUsageMessage } from "../lib/account-usage";
import { useStore } from "../store";
import { useProjects } from "../projects";

type Result<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: T };
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function Json({ value }: { value: unknown }) {
  return (
    <pre className="selectable mt-3 max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-bg-sunken p-3 text-[11px] whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Usage({ result }: { result: Result<AccountUsageSnapshot> }) {
  if (result.kind === "loading") return <p className="text-fg-faint">Reading account usage…</p>;
  if (result.kind === "error")
    return (
      <p role="alert" className="text-danger">
        {result.message}
      </p>
    );
  const usage = result.value;
  if (usage.kind !== "available")
    return (
      <p className={usage.kind === "reauth_required" ? "text-warn" : "text-fg-faint"}>
        {accountUsageMessage(usage)}
      </p>
    );
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span>{usage.plan ?? "Plan not reported"}</span>
        {usage.email ? <span className="selectable text-fg-muted">· {usage.email}</span> : null}
        {usage.rateLimited ? (
          <span className="rounded bg-warn/10 px-2 py-0.5 text-warn">Rate limited</span>
        ) : null}
      </div>
      {usage.windows.length === 0 ? (
        <p className="text-fg-faint">No quota windows reported.</p>
      ) : (
        <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {usage.windows.map((window) => (
            <div key={window.label}>
              <div className="mb-1 flex justify-between gap-2">
                <span>{window.label}</span>
                <span className="text-fg-muted">{Math.round(window.usedRatio * 100)}% used</span>
              </div>
              <progress
                aria-label={window.label}
                max={1}
                value={window.usedRatio}
                className="h-1.5 w-full accent-accent"
              />
              <p className="mt-1 text-[11px] text-fg-faint">
                {window.resetsAt
                  ? `Resets ${new Date(window.resetsAt).toLocaleString()}`
                  : "Reset time not reported"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Models({ result }: { result: Result<ListModelsResult> }) {
  const [query, setQuery] = useState("");
  if (result.kind === "loading") return <p className="text-fg-faint">Loading models…</p>;
  if (result.kind === "error")
    return (
      <p role="alert" className="text-danger">
        {result.message}
      </p>
    );
  const list = result.value;
  if (list.kind === "unsupported") return <p className="text-fg-faint">{list.reason}</p>;
  if (list.kind === "unauthenticated")
    return <p className="text-warn">Sign in with this runtime’s CLI. {list.detail}</p>;
  const models = list.models.filter((model) =>
    `${model.id} ${model.displayName ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          aria-label="Filter models"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter models…"
          className="context-input max-w-xs"
        />
        <span className="text-fg-faint">{list.models.length} models</span>
      </div>
      {models.length === 0 ? (
        <p className="text-fg-faint">
          {query ? "No matching models." : "No models reported for the current account."}
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-line">
          <table className="w-full table-fixed text-left">
            <thead className="sticky top-0 bg-bg-raised text-[11px] text-fg-faint">
              <tr>
                <th className="px-3 py-2 font-normal">Model</th>
                <th className="px-3 py-2 font-normal">Reasoning</th>
                <th className="px-3 py-2 font-normal">Availability</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className="border-t border-line">
                  <td className="selectable px-3 py-2">
                    <div>{model.displayName ?? model.id}</div>
                    {model.displayName ? (
                      <div className="text-[10px] text-fg-faint">{model.id}</div>
                    ) : null}
                    {model.resolvedId ? (
                      <div className="text-[10px] text-fg-faint">
                        Resolves to {model.resolvedId}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {model.effortLevels?.join(" · ") || "Not reported"}
                    {model.defaultEffort ? (
                      <div className="text-[10px]">Default: {model.defaultEffort}</div>
                    ) : null}
                  </td>
                  <td className={`px-3 py-2 ${model.disabled ? "text-warn" : "text-ok"}`}>
                    {model.disabled?.reason ?? "Available"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RuntimeCard({ runtime }: { runtime: RuntimeInfo }) {
  const [revision, setRevision] = useState(0);
  const [usage, setUsage] = useState<Result<AccountUsageSnapshot>>({ kind: "loading" });
  const [models, setModels] = useState<Result<ListModelsResult>>({ kind: "loading" });
  const [updated, setUpdated] = useState<string | null>(null);
  const installed = runtime.installation.kind === "available";
  useEffect(() => {
    if (!installed) return;
    let canceled = false;
    const readUsage = runtime.features.accountUsage
      ? window.rao.runtimes.accountUsage(runtime.id)
      : Promise.resolve({
          kind: "unsupported" as const,
          reason: "capability_unavailable" as const,
        });
    const readModels = runtime.features.listModels
      ? window.rao.runtimes.listModels(runtime.id)
      : Promise.resolve<ListModelsResult>({
          kind: "unsupported",
          reason: "Model listing is not supported by this runtime.",
        });
    void Promise.allSettled([
      readUsage.then(
        (value) => {
          if (!canceled) setUsage({ kind: "ready", value });
          return undefined;
        },
        (error: unknown) => {
          if (!canceled) setUsage({ kind: "error", message: message(error) });
          return undefined;
        },
      ),
      readModels.then(
        (value) => {
          if (!canceled) setModels({ kind: "ready", value });
          return undefined;
        },
        (error: unknown) => {
          if (!canceled) setModels({ kind: "error", message: message(error) });
          return undefined;
        },
      ),
    ]).then(() => {
      if (!canceled) setUpdated(new Date().toLocaleTimeString());
      return undefined;
    });
    return () => {
      canceled = true;
    };
    // revision intentionally re-runs the reads when the user requests fresh data.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [runtime.id, runtime.features.accountUsage, runtime.features.listModels, installed, revision]);
  const installation = runtime.installation;
  return (
    <article className="rounded-lg border border-line bg-bg-raised/30">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <RuntimeLogo runtime={runtime.id} size={20} />
          <div>
            <h2 className="text-xs font-medium">{runtime.label}</h2>
            <p className="selectable mt-0.5 break-all text-[10px] text-fg-faint">
              {installation.kind === "available"
                ? installation.via === "bundled"
                  ? "Bundled SDK · No standalone version"
                  : `${installation.version ?? "Version not reported"} · ${installation.command}`
                : installation.kind === "not_found"
                  ? "Not installed"
                  : installation.reason}
            </p>
          </div>
        </div>
        {installed ? (
          <button
            type="button"
            aria-label={`Refresh ${runtime.label}`}
            disabled={usage.kind === "loading" || models.kind === "loading"}
            onClick={() => {
              setUsage({ kind: "loading" });
              setModels({ kind: "loading" });
              setUpdated(null);
              setRevision(revision + 1);
            }}
            title={updated ? `Updated ${updated}` : "Refresh runtime"}
            className="rounded p-1.5 text-fg-muted hover:bg-line disabled:opacity-30"
          >
            <RefreshCw size={14} />
          </button>
        ) : null}
      </header>
      {installed ? (
        <div className="px-4 pb-3 text-xs">
          <section aria-label="Account usage">
            <Usage result={usage} />
          </section>
          <details className="mt-3 border-t border-line pt-2">
            <summary className="cursor-pointer text-[11px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <Box size={12} /> Models
                <span className="text-fg-faint">
                  {models.kind === "loading"
                    ? "Loading…"
                    : models.kind === "error"
                      ? "Query failed"
                      : models.value.kind === "ok"
                        ? `· ${models.value.models.length}`
                        : models.value.kind === "unauthenticated"
                          ? "Sign-in required"
                          : "Unsupported"}
                </span>
              </span>
            </summary>
            <div className="mt-3">
              <Models result={models} />
            </div>
          </details>
          <RuntimeInventory key={revision} runtime={runtime.id} />
        </div>
      ) : null}
    </article>
  );
}

export function Dashboard() {
  const [runtimes, setRuntimes] = useState<readonly RuntimeInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<Result<readonly SessionDiagnostics[]>>({
    kind: "loading",
  });
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const details = useProjects((store) => store.details);
  const sessions = useStore((store) => store.sessions);
  useEffect(() => {
    let canceled = false;
    void Promise.allSettled([
      window.rao.runtimes.list().then(
        (value) => {
          if (!canceled) {
            setRuntimes(value);
            useStore.setState({ runtimes: value });
          }
          return undefined;
        },
        (cause: unknown) => {
          if (!canceled) setError(message(cause));
          return undefined;
        },
      ),
      window.rao.sessions.diagnostics().then(
        (value) => {
          if (!canceled) setDiagnostics({ kind: "ready", value });
          return undefined;
        },
        (cause: unknown) => {
          if (!canceled) setDiagnostics({ kind: "error", message: message(cause) });
          return undefined;
        },
      ),
      window.rao.app.versions().then(
        (value) => {
          if (!canceled) setVersions(value);
          return undefined;
        },
        (cause: unknown) => {
          if (!canceled) setError(message(cause));
          return undefined;
        },
      ),
    ]).then(() => {
      if (!canceled) setLoading(false);
      return undefined;
    });
    return () => {
      canceled = true;
    };
    // revision intentionally re-runs the probes when the user requests fresh data.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [revision]);
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">Dashboard</h1>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setDiagnostics({ kind: "loading" });
              setRevision(revision + 1);
            }}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs disabled:opacity-40"
          >
            <RefreshCw size={14} /> Refresh all
          </button>
        </div>
        {versions ? (
          <p className="mb-3 text-[10px] text-fg-faint">
            Rao {versions.app} · {versions.platform} · Electron {versions.electron} · Node{" "}
            {versions.node} · Chromium {versions.chrome}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 text-xs text-danger">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="mb-2 text-[11px] text-fg-faint">Checking local runtimes…</p>
        ) : null}
        <p className="mb-3 text-[11px] text-fg-faint">Global capabilities</p>
        <div className="space-y-2">
          {runtimes.map((runtime) => (
            <RuntimeCard key={`${revision}:${runtime.id}`} runtime={runtime} />
          ))}
        </div>
        <section className="mt-5">
          <h2 className="mb-3 text-sm font-medium" title="Current process · refresh to update">
            Live sessions
          </h2>
          {diagnostics.kind === "loading" ? (
            <p className="text-xs text-fg-faint">Loading sessions…</p>
          ) : diagnostics.kind === "error" ? (
            <p role="alert" className="text-xs text-danger">
              {diagnostics.message}
            </p>
          ) : diagnostics.value.length === 0 ? (
            <p className="text-xs text-fg-faint">No live agents.</p>
          ) : (
            diagnostics.value.map((item) => (
              <details
                key={item.handle}
                className="mb-2 rounded-lg border border-line px-3 py-2 text-xs"
              >
                <summary className="cursor-pointer">
                  {details[item.handle]?.name ||
                    sessions[item.handle]?.summary.title ||
                    item.handle}{" "}
                  <span className="ml-2 text-fg-faint">{item.model ?? "Model not reported"}</span>
                </summary>
                <div className="mt-4 grid grid-cols-2 gap-3 text-fg-muted">
                  <p>Input tokens: {item.usage.total?.input.toLocaleString() ?? "Not reported"}</p>
                  <p>
                    Output tokens: {item.usage.total?.output.toLocaleString() ?? "Not reported"}
                  </p>
                  <p>
                    Context:{" "}
                    {item.context?.percent === null || item.context?.percent === undefined
                      ? "Not reported"
                      : `${item.context.percent}%`}
                  </p>
                  <p>Attribution: {item.capabilities.attribution}</p>
                  <p>Steer: {item.capabilities.steer ? "Supported" : "Unsupported"}</p>
                  <p>
                    Queue:{" "}
                    {item.capabilities.queue
                      ? item.capabilities.queue.durable
                        ? "Durable"
                        : "In memory"
                      : "Unsupported"}
                  </p>
                </div>
                <details className="mt-4">
                  <summary className="cursor-pointer text-fg-muted">
                    Usage, context & session graph
                  </summary>
                  <Json value={{ usage: item.usage, context: item.context, graph: item.graph }} />
                </details>
                <details className="mt-3">
                  <summary className="cursor-pointer text-fg-muted">
                    Recent records ({Math.min(100, item.recordCount)} of {item.recordCount})
                  </summary>
                  <Json value={item.recentRecords} />
                </details>
              </details>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
