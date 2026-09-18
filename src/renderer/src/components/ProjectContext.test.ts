import { initialConversation } from "@botiverse/oar/observe";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Project } from "../lib/projects";

it("loads the current project's runtime and cwd only when its inventory section is expanded", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  const result = { kind: "unsupported", reason: "No native query" };
  const skills = vi.fn().mockResolvedValue(result);
  const mcpServers = vi.fn().mockResolvedValue(result);
  const tools = vi.fn().mockResolvedValue(result);
  vi.stubGlobal("rao", { runtimes: { skills, mcpServers, tools } });
  const project: Project = {
    id: "a",
    name: "Project A",
    note: "",
    cwd: "/work/a",
    session: {
      summary: {
        handle: "a",
        runtime: "codex",
        sessionId: "native-a",
        cwd: "/work/a",
        title: null,
        openedAt: 0,
        updatedAt: 0,
        live: false,
        capabilities: null,
      },
      conversation: initialConversation(),
      buffered: [],
      transcript: null,
      state: "idle",
      status: { kind: "idle" },
      model: null,
    },
  };
  const { ProjectContext } = await import("./ProjectContext");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(ProjectContext, { project, key: project.id }));
    });
    expect(skills).not.toHaveBeenCalled();
    await act(async () => {
      const panel = container.querySelector("details");
      if (panel) {
        panel.open = true;
        panel.dispatchEvent(new Event("toggle"));
      }
    });
    for (const query of [skills, mcpServers, tools]) {
      expect(query).toHaveBeenCalledExactlyOnceWith("codex", "/work/a");
    }
    expect(container.textContent).toContain("Skills, MCP servers & tools");
    const next: Project = {
      ...project,
      id: "b",
      cwd: "/work/b",
      session: {
        ...project.session,
        summary: { ...project.session.summary, runtime: "claude", handle: "b", cwd: "/work/b" },
      },
    };
    await act(async () => {
      root.render(createElement(ProjectContext, { project: next, key: next.id }));
    });
    expect(container.querySelector("details")?.open).toBe(false);
    expect(skills).toHaveBeenCalledTimes(1);
    await act(async () => {
      const panel = container.querySelector("details");
      if (panel) {
        panel.open = true;
        panel.dispatchEvent(new Event("toggle"));
      }
    });
    for (const query of [skills, mcpServers, tools]) {
      expect(query).toHaveBeenLastCalledWith("claude", "/work/b");
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
