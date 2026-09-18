// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeInventory } from "./RuntimeInventory";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const skills = vi.fn().mockResolvedValue(ok([]));
  const tools = vi.fn().mockResolvedValue(ok([]));
  const mcpServers = vi.fn().mockResolvedValue(ok([]));
  vi.stubGlobal("rao", { runtimes: { skills, tools, mcpServers } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (cwd = "/project-a") => {
    await act(async () => {
      root.render(createElement(RuntimeInventory, { runtime: "codex", cwd, key: cwd }));
    });
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.startsWith(label) || item.getAttribute("aria-label") === label,
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
  };
  const dispose = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { skills, tools, mcpServers, container, render, click, dispose };
}
const ok = (items: unknown[], extra = {}) => ({
  kind: "ok",
  scope: { kind: "workspace", cwd: "/project-a" },
  observedAt: "2026-09-16T12:00:00Z",
  view: "discovered",
  partial: false,
  items,
  ...extra,
});

it("loads global inventories by default and shows partial MCP-only tools with schemas", async () => {
  const view = harness();
  view.tools.mockResolvedValue(
    ok(
      [
        {
          name: "read_file",
          description: "Read a file",
          source: "mcp",
          mcpServerId: "files",
          inputSchema: { type: "object" },
        },
        { name: "write_file", active: false },
      ],
      { view: "mcp-only", partial: true },
    ),
  );
  try {
    await view.render("");
    expect(view.tools).toHaveBeenCalledExactlyOnceWith("codex", undefined);
    expect(view.skills).toHaveBeenCalledExactlyOnceWith("codex", undefined);
    expect(view.mcpServers).toHaveBeenCalledExactlyOnceWith("codex", undefined);
    await view.click("Tools");
    expect(view.container.textContent).toContain("MCP tools only");
    expect(view.container.textContent).toContain("Partial results");
    expect(view.container.textContent).toContain("Built-in tools are not included");
    expect(view.container.textContent).toContain("Parameters");
    expect(view.container.textContent).toContain("Inactive");
    const input = view.container.querySelector("input");
    await act(async () => {
      if (input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          "read_file",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(view.container.textContent).not.toContain("write_file");
    expect(view.container.textContent).toContain("read_file");
  } finally {
    await view.dispose();
  }
});

it("ignores late results after changing category and folder", async () => {
  const view = harness();
  const late = Promise.withResolvers<unknown>();
  view.skills
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue(ok([{ name: "new-project-skill" }]));
  view.tools.mockResolvedValue(ok([{ name: "current-tool" }]));
  view.mcpServers.mockResolvedValue(ok([]));
  try {
    await view.render();
    await view.click("Skills");
    await view.click("Tools");
    expect(view.container.textContent).toContain("current-tool");
    await view.render("/project-b");
    expect(view.container.textContent).not.toContain("current-tool");
    await view.click("MCP servers");
    await act(async () => {
      late.resolve(ok([{ name: "old-project-skill" }]));
    });
    expect(view.container.textContent).not.toContain("old-project-skill");
    expect(view.container.textContent).toContain("No entries reported");
    expect(view.mcpServers).toHaveBeenLastCalledWith("codex", "/project-b");
    await view.click("Skills");
    expect(view.container.textContent).toContain("new-project-skill");
    expect(view.container.textContent).not.toContain("old-project-skill");
  } finally {
    await view.dispose();
  }
});

it("distinguishes unsupported, unavailable, failure and successful empty results, with retry", async () => {
  const view = harness();
  view.skills.mockResolvedValue({
    kind: "unsupported",
    code: "transport_unavailable",
    reason: "No native query",
  });
  view.mcpServers.mockResolvedValue({ kind: "unavailable", code: "timeout", reason: "Timed out" });
  view.tools.mockRejectedValueOnce(new Error("IPC failed")).mockResolvedValue(ok([]));
  try {
    await view.render();
    await view.click("Skills");
    expect(view.container.textContent).toContain("Not supported");
    expect(view.container.textContent).not.toContain("No entries");
    await view.click("MCP servers");
    expect(view.container.textContent).toContain("Query timed out");
    await view.click("Tools");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("IPC failed");
    await view.click("Refresh inventory");
    expect(view.container.textContent).toContain("No entries reported");
    expect(view.tools).toHaveBeenCalledTimes(2);
  } finally {
    await view.dispose();
  }
});
