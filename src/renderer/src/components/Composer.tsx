import { ArrowUp, Square, FileText } from "lucide-react";
import { useRef, useState } from "react";
import { mentionsNote } from "../lib/projects";
import type { AgentState } from "@shared/ipc";

export function Composer({
  disabled = false,
  state,
  live,
  canSteer,
  note,
  onSend,
  onAbort,
}: {
  disabled?: boolean;
  state: AgentState;
  live: boolean;
  canSteer: boolean;
  note: string;
  onSend: (input: string) => void;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const suggestNote = /(?:^|\s)@(?:n(?:o(?:t(?:e)?)?)?)?$/.test(value);
  const hasNote = mentionsNote(value);
  const busy = state === "busy" || state === "stuck";
  const trimmed = value.trim();

  const send = (): void => {
    if (disabled || trimmed === "") {
      return;
    }
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-line px-8 py-3">
      {suggestNote ? (
        <button
          type="button"
          onClick={() => {
            setValue(value.replace(/@[^@\s]*$/, "@note "));
            textarea.current?.focus();
          }}
          className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-lg border border-line bg-bg-raised px-3 py-2 text-left text-xs hover:border-accent"
        >
          <FileText size={14} /> @note{" "}
          <span className="text-fg-faint">{note.trim() ? "Attach note" : "Empty note"}</span>
        </button>
      ) : null}
      {hasNote ? (
        <p className="mx-auto mb-2 max-w-3xl text-[11px] text-fg-muted">
          {note.trim() ? "@note attached" : "@note is empty"}
        </p>
      ) : null}
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-bg-raised p-2 focus-within:border-line-strong">
        <textarea
          disabled={disabled}
          ref={textarea}
          value={value}
          rows={1}
          placeholder={
            !live
              ? "Message…"
              : busy
                ? canSteer
                  ? "Steer the running turn…"
                  : "Queue for the next turn…"
                : "Message…"
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
            disabled={disabled}
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
          disabled={disabled || trimmed === ""}
          aria-label="Send"
          className="rounded-lg bg-accent p-1.5 text-bg disabled:opacity-30"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}
