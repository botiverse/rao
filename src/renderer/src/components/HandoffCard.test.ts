// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RuntimeHandoff } from "@shared/ipc";
import { HandoffCard } from "./HandoffCard";

it("opens the full handoff in a modal, treats content as text, and closes on Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const handoff: RuntimeHandoff = {
    kind: "runtime_handoff",
    id: "h",
    receivedAt: 1,
    from: "claude",
    to: "codex",
    previousSessionId: "a",
    sessionId: "b",
    requestId: "r",
    runtimeModels: {},
    markdown:
      "# Project handoff\n\n中文 note\n\n<script>not executable</script>\n\n" +
      "Long history\n".repeat(100),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(HandoffCard, { handoff })));
    expect(container.textContent).toContain("Claude Code → Codex");
    expect(container.textContent).not.toContain("Long history");
    await act(async () => container.querySelector("button")?.click());
    const dialog = document.querySelector<HTMLDialogElement>(
      'dialog[aria-label="Runtime handoff"]',
    );
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector("pre")?.textContent).toBe(handoff.markdown);
    expect(dialog?.querySelector("script")).toBeNull();
    await act(async () => {
      dialog?.dispatchEvent(new Event("cancel", { bubbles: true }));
    });
    expect(document.querySelector("dialog")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
