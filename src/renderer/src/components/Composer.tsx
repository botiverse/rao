import { ArrowUp, Square } from "lucide-react";
import { useState } from "react";
import type { AgentState } from "@shared/ipc";

export function Composer({
  state,
  live,
  canSteer,
  onSend,
  onAbort,
}: {
  state: AgentState;
  live: boolean;
  canSteer: boolean;
  onSend: (input: string) => void;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const busy = state === "busy" || state === "stuck";
  const trimmed = value.trim();

  const send = (): void => {
    if (trimmed === "") {
      return;
    }
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-line px-8 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-bg-raised p-2 focus-within:border-line-strong">
        <textarea
          value={value}
          rows={1}
          placeholder={
            !live
              ? "Message to resume this session"
              : busy
                ? canSteer
                  ? "Steer the running turn…"
                  : "Queue for the next turn…"
                : "Message the agent"
          }
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          className="selectable max-h-48 min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1 outline-none placeholder:text-fg-faint"
          style={{ fieldSizing: "content" }}
        />
        {busy ? (
          <button
            type="button"
            onClick={onAbort}
            aria-label="Abort turn"
            className="rounded-lg bg-danger/15 p-1.5 text-danger hover:bg-danger/25"
          >
            <Square size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={send}
          disabled={trimmed === ""}
          aria-label="Send"
          className="rounded-lg bg-accent p-1.5 text-bg disabled:opacity-30"
        >
          <ArrowUp size={14} />
        </button>
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[11px] text-fg-faint">
        Enter to send · Shift+Enter for a new line · runtimes run with permission prompts disabled
      </p>
    </div>
  );
}
