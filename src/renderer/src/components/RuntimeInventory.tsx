import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { InventoryResult, SkillEntry, McpServerEntry, ToolEntry } from "@botiverse/oar";
import type { RuntimeId } from "@shared/ipc";

type Category = "skills" | "mcpServers" | "tools";
type Entry = SkillEntry | McpServerEntry | ToolEntry;
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: InventoryResult<Entry> };
const categories: readonly [Category, string][] = [
  ["skills", "Skills"],
  ["mcpServers", "MCP servers"],
  ["tools", "Tools"],
];
const views = {
  discovered: "Discovered",
  context: "Context skills",
  registered: "Registered tools",
  "mcp-only": "MCP tools only",
} as const;

function summary(result: State): string {
  if (result.kind === "loading") return "…";
  if (result.kind === "error") return "· Failed";
  if (result.value.kind === "ok")
    return `· ${result.value.items.length}${result.value.partial ? " (partial)" : ""}`;
  return result.value.kind === "unsupported" ? "· Unsupported" : "· Failed";
}

function states(entry: Entry): string[] {
  const values: string[] = [];
  if ("status" in entry && entry.status !== undefined) values.push(entry.status);
  if ("authStatus" in entry && entry.authStatus !== undefined)
    values.push(`Auth: ${entry.authStatus}`);
  if (entry.enabled !== undefined) values.push(entry.enabled ? "Enabled" : "Disabled");
  if ("active" in entry && entry.active !== undefined)
    values.push(entry.active ? "Active" : "Inactive");
  if ("loaded" in entry && entry.loaded !== undefined)
    values.push(entry.loaded ? "Loaded" : "Not loaded");
  if ("disableModelInvocation" in entry && entry.disableModelInvocation)
    values.push("Manual invocation only");
  return values;
}

function InventoryRows({
  value,
  query,
}: {
  value: Extract<InventoryResult<Entry>, { kind: "ok" }>;
  query: string;
}) {
  const entries = value.items.filter((entry) =>
    [entry.name, entry.source, "description" in entry ? entry.description : ""]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-fg-faint">
        <span>
          {value.items.length} entries · {views[value.view]}
        </span>
        {value.partial ? (
          <span className="text-warn">Partial results — some sources are pending or failed</span>
        ) : null}
        <span>Checked {new Date(value.observedAt).toLocaleTimeString()}</span>
      </div>
      {value.view === "mcp-only" ? (
        <p className="mb-2 text-[10px] text-fg-muted">Built-in tools are not included.</p>
      ) : null}
      {entries.length === 0 ? (
        <p className="py-2 text-fg-faint">
          {query
            ? "No matching entries."
            : value.partial
              ? "No entries available yet."
              : "No entries reported."}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto overflow-x-hidden rounded border border-line">
          {entries.map((entry) => (
            <details
              key={JSON.stringify([
                entry.name,
                entry.source,
                "path" in entry ? entry.path : null,
                "mcpServerId" in entry ? entry.mcpServerId : null,
              ])}
              className="border-b border-line px-2.5 py-2 last:border-b-0"
            >
              <summary className="cursor-pointer">
                <span className="selectable break-all">{entry.name}</span>
                <span className="ml-2 text-[10px] text-fg-faint">{states(entry).join(" · ")}</span>
              </summary>
              <div className="selectable mt-2 space-y-1 break-words text-[11px] text-fg-muted">
                {"description" in entry && entry.description ? <p>{entry.description}</p> : null}
                {entry.source ? <p className="break-all">Source: {entry.source}</p> : null}
                {"path" in entry && entry.path ? <p className="break-all">{entry.path}</p> : null}
                {"toolCount" in entry && entry.toolCount !== undefined ? (
                  <p>{entry.toolCount} tools</p>
                ) : null}
                {"mcpServerId" in entry && entry.mcpServerId ? (
                  <p>Server: {entry.mcpServerId}</p>
                ) : null}
                {"error" in entry && entry.error ? (
                  <p className="text-warn">{entry.error}</p>
                ) : null}
                {"inputSchema" in entry && entry.inputSchema ? (
                  <details>
                    <summary className="cursor-pointer">Parameters</summary>
                    <pre className="mt-1 max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all text-[10px]">
                      {JSON.stringify(entry.inputSchema, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

export function RuntimeInventory({ runtime, cwd }: { runtime: RuntimeId; cwd?: string }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [results, setResults] = useState<Record<Category, State>>({
    skills: { kind: "loading" },
    mcpServers: { kind: "loading" },
    tools: { kind: "loading" },
  });
  const state = category ? results[category] : { kind: "loading" as const };
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let canceled = false;
    void Promise.allSettled(
      categories.map(async ([key]) => {
        try {
          const value = await window.rao.runtimes[key](runtime, cwd || undefined);
          if (!canceled)
            setResults((previous) => ({ ...previous, [key]: { kind: "ready", value } }));
        } catch (error) {
          if (!canceled)
            setResults((previous) => ({
              ...previous,
              [key]: {
                kind: "error",
                message: error instanceof Error ? error.message : String(error),
              },
            }));
        }
      }),
    );
    return () => {
      canceled = true;
    };
    // revision explicitly refreshes the selected native query.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [runtime, cwd, revision]);
  return (
    <section aria-label="Runtime inventories" className="mt-3 border-t border-line pt-2">
      <div className="flex flex-wrap items-center gap-1">
        {categories.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={category === key}
            title={`Show ${label.toLowerCase()}`}
            onClick={() => {
              setCategory(category === key ? null : key);
              setQuery("");
            }}
            className={`rounded px-2 py-1 text-[11px] disabled:opacity-40 ${category === key ? "bg-line text-fg" : "text-fg-muted hover:bg-line"}`}
          >
            {label} <span className="text-fg-faint">{summary(results[key])}</span>
          </button>
        ))}
        {category ? (
          <button
            type="button"
            aria-label="Refresh inventory"
            disabled={state.kind === "loading"}
            onClick={() => {
              setResults({
                skills: { kind: "loading" },
                mcpServers: { kind: "loading" },
                tools: { kind: "loading" },
              });
              setRevision(revision + 1);
            }}
            className="ml-auto rounded p-1 text-fg-muted hover:bg-line disabled:opacity-30"
          >
            <RefreshCw size={12} />
          </button>
        ) : null}
      </div>
      {category ? (
        <div className="mt-2" aria-live="polite">
          {state.kind === "loading" ? (
            <p className="text-fg-faint">Loading…</p>
          ) : state.kind === "error" ? (
            <p role="alert" className="text-danger">
              {state.message}
            </p>
          ) : state.value.kind !== "ok" ? (
            <p
              role={state.value.kind === "unavailable" ? "alert" : undefined}
              className={state.value.kind === "unavailable" ? "text-warn" : "text-fg-faint"}
            >
              {state.value.kind === "unsupported"
                ? "Not supported"
                : state.value.code === "timeout"
                  ? "Query timed out"
                  : "Query failed"}{" "}
              · {state.value.reason}
            </p>
          ) : (
            <>
              <input
                aria-label="Filter inventory"
                placeholder="Filter…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="context-input mb-2 max-w-xs"
              />
              <InventoryRows value={state.value} query={query} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
