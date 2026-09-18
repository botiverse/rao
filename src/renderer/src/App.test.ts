import { initialConversation } from "@botiverse/oar/observe";
// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SessionState } from "./store";

const session = (handle: string, text: string): SessionState => ({
  summary: {
    handle,
    runtime: "claude",
    sessionId: handle,
    cwd: "/same/workspace",
    title: null,
    openedAt: 1,
    updatedAt: 1,
    live: true,
    capabilities: null,
  },
  conversation: initialConversation(),
  buffered: [],
  transcript: text ? [{ kind: "assistant", id: "1:text_delta", seq: 1, agentPath: [], text }] : [],
  state: "idle",
  status: { kind: "idle" },
  model: null,
});

it("removes the previous project's DOM when switching repeatedly, including empty projects", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("rao", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  const { useStore } = await import("./store");
  const { useProjects } = await import("./projects");
  const { App } = await import("./App");
  useStore.setState({
    loaded: true,
    active: "a",
    order: ["a", "b", "empty"],
    sessions: {
      a: session("a", "ONLY_PROJECT_A"),
      b: session("b", "ONLY_PROJECT_B"),
      empty: session("empty", ""),
    },
    connect: () => () => {},
    load: async () => {},
  });
  useProjects.setState({
    loaded: true,
    load: async () => {},
    details: {
      a: { name: "Project A", note: "" },
      b: { name: "Project B", note: "" },
      empty: { name: "Empty project", note: "" },
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(App));
    });
    for (const handle of ["b", "empty", "a", "empty", "b", "a"]) {
      // Switching must finish before checking the DOM and selecting the next project.
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await useStore.getState().select(handle);
      });
      const text = container.textContent ?? "";
      expect(text.includes("ONLY_PROJECT_A")).toBe(handle === "a");
      expect(text.includes("ONLY_PROJECT_B")).toBe(handle === "b");
      expect(text).not.toContain("What would you like to move forward?");
      expect(container.querySelectorAll('section[aria-label="Project conversation"]')).toHaveLength(
        1,
      );
      expect(container.querySelectorAll('textarea[placeholder="Message…"]')).toHaveLength(1);
    }
    const row = container.querySelector<HTMLButtonElement>('button[title="Project B"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).not.toContain("Claude Code");
    await act(async () => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 120 }),
      );
    });
    expect(useStore.getState().active).toBe("a");
    const rename = container.querySelector<HTMLButtonElement>('[role="menuitem"]');
    await act(async () => {
      rename?.click();
    });
    expect(container.querySelector('[role="dialog"][aria-label="rename project"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('[role="dialog"] input')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"][aria-label="rename project"]')).toBeNull();
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});
