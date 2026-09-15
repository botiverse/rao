import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranscriptItem } from "../lib/transcript";

function Collapsible({
  summary,
  children,
  tone = "text-fg-faint",
}: {
  summary: string;
  children: React.ReactNode;
  tone?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={`flex items-center gap-1 text-xs ${tone} hover:text-fg`}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="truncate font-mono">{summary}</span>
      </button>
      {open ? <div className="mt-1 ml-4">{children}</div> : null}
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="selectable max-h-72 overflow-auto rounded-md border border-line bg-bg-sunken p-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
      {text}
    </pre>
  );
}

function AgentTag({ path }: { path: readonly string[] }) {
  return path.length === 0 ? null : (
    <span className="mr-2 rounded bg-line px-1 font-mono text-[10px] text-fg-faint">
      {path.join(" › ")}
    </span>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="my-4 flex justify-end">
          <div className="selectable max-w-[75%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 whitespace-pre-wrap text-fg">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="selectable my-2 max-w-[85%] whitespace-pre-wrap leading-relaxed">
          <AgentTag path={item.agentPath} />
          {item.text}
        </div>
      );
    case "reasoning":
      return (
        <Collapsible
          summary={
            item.content.kind === "text"
              ? `thinking · ${String(item.content.text.length)} chars`
              : `thinking · ${item.content.kind}`
          }
        >
          {item.content.kind === "text" ? <Pre text={item.content.text} /> : null}
        </Collapsible>
      );
    case "tool": {
      const tone =
        item.result === "failed"
          ? "text-danger"
          : item.result === "running"
            ? "text-accent"
            : "text-fg-faint";
      const detail = item.input === undefined ? "" : ` ${item.input.split("\n")[0] ?? ""}`;
      return (
        <Collapsible summary={`${item.tool}${detail}`} tone={tone}>
          <AgentTag path={item.agentPath} />
          {item.input === undefined ? null : <Pre text={item.input} />}
          {item.output === undefined ? null : <Pre text={item.output} />}
        </Collapsible>
      );
    }
    case "turn_end":
      return (
        <div className="my-3 flex items-center gap-2 text-[11px] text-fg-faint">
          <span className="h-px flex-1 bg-line" />
          {item.outcome.kind === "completed"
            ? "done"
            : item.outcome.kind === "aborted"
              ? "aborted"
              : `failed (${item.outcome.failure}): ${item.outcome.reason}`}
          <span className="h-px flex-1 bg-line" />
        </div>
      );
    case "notice":
      return (
        <div
          className={`my-2 rounded-md border px-3 py-1.5 text-xs ${
            item.tone === "error" ? "border-danger/40 text-danger" : "border-line text-fg-muted"
          }`}
        >
          {item.text}
        </div>
      );
  }
}

export function Transcript({ items }: { items: readonly TranscriptItem[] }) {
  const bottom = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Runs after every render: the transcript re-renders exactly when items change.
  useEffect(() => {
    if (pinned.current) {
      bottom.current?.scrollIntoView({ block: "end" });
    }
  });

  return (
    <div
      ref={container}
      onScroll={() => {
        const element = container.current;
        if (element !== null) {
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }
      }}
      className="flex-1 overflow-y-auto px-8 py-4"
    >
      <div className="mx-auto max-w-3xl">
        {items.length === 0 ? (
          <p className="mt-24 text-center text-sm text-fg-faint">
            Session open. Say something to the agent.
          </p>
        ) : (
          items.map((item) => <Item key={item.id} item={item} />)
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}
