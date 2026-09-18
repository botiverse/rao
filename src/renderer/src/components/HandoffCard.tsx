import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, X } from "lucide-react";
import { runtimeBrands } from "@botiverse/oar/brands";
import type { RuntimeHandoff } from "@shared/ipc";

function HandoffDialog({ handoff, onClose }: { handoff: RuntimeHandoff; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label="Runtime handoff"
      className="fixed inset-0 m-auto max-h-[80vh] w-[min(720px,90vw)] rounded-xl border border-line-strong bg-bg p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-medium">
            {runtimeBrands[handoff.from].name} → {runtimeBrands[handoff.to].name}
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            {new Date(handoff.receivedAt).toLocaleString()} · Full handoff text
          </p>
        </div>
        <button
          type="button"
          aria-label="Close handoff"
          onClick={onClose}
          className="rounded p-1.5 hover:bg-bg-raised"
        >
          <X size={16} />
        </button>
      </div>
      <pre className="selectable max-h-[60vh] overflow-auto p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {handoff.markdown}
      </pre>
    </dialog>,
    document.body,
  );
}

export function HandoffCard({ handoff }: { handoff: RuntimeHandoff }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-4 flex w-full items-center gap-3 rounded-lg border border-line-strong bg-bg-raised px-4 py-3 text-left hover:border-accent"
      >
        <ArrowRightLeft size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">
            {runtimeBrands[handoff.from].name} → {runtimeBrands[handoff.to].name}
          </span>
          <span className="mt-1 block text-[11px] text-fg-muted">New session · View handoff</span>
        </span>
      </button>
      {open ? <HandoffDialog handoff={handoff} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
