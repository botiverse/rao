// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Project } from "../lib/projects";
import { initialConversation } from "@botiverse/oar/observe";

it("keeps the note draft on failure and shows saved only after retry succeeds", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockImplementation(async (_id: string, value: unknown) => value);
  vi.stubGlobal("rao", { projects: { save } });
  const { useProjects } = await import("../projects");
  const { ProjectContext } = await import("./ProjectContext");
  const project: Project = {
    id: "a",
    name: "A",
    note: "old",
    cwd: "/tmp",
    session: {
      summary: {
        handle: "a",
        runtime: "pi",
        sessionId: "a",
        cwd: "/tmp",
        title: null,
        openedAt: 1,
        updatedAt: 1,
        live: false,
        capabilities: null,
      },
      conversation: initialConversation(),
      buffered: [],
      transcript: [],
      state: "idle",
      status: { kind: "idle" },
      model: null,
    },
  };
  useProjects.getState().remember("a", { name: "A", note: "old" });
  function View() {
    const details = useProjects((state) => state.details.a);
    return createElement(ProjectContext, { project: { ...project, ...details } });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(View)));
    const input = container.querySelector<HTMLTextAreaElement>("#project-note");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        input,
        "new draft",
      );
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>("aside > button")?.click());
    expect(input?.value).toBe("new draft");
    expect(container.textContent).toContain("disk full");
    expect(container.textContent).not.toContain("Note saved");
    expect(useProjects.getState().details.a?.note).toBe("old");
    await act(async () => container.querySelector<HTMLButtonElement>("aside > button")?.click());
    expect(container.textContent).toContain("Note saved");
    expect(input?.value).toBe("new draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
