// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RuntimeInfo } from "@shared/ipc";

it("shows independent runtime results, auth states and quota usage without opening agents", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  const runtimes: RuntimeInfo[] = [
    {
      id: "claude",
      label: "Claude Code",
      installation: {
        kind: "available",
        via: "executable",
        command: "/bin/claude",
        version: "1.2.3",
      },
      features: { accountUsage: true, listModels: true },
    },
    {
      id: "codex",
      label: "Codex",
      installation: { kind: "available", via: "executable", command: "/bin/codex" },
      features: { accountUsage: true, listModels: true },
    },
    {
      id: "pi",
      label: "Pi",
      installation: { kind: "available", via: "bundled" },
      features: { accountUsage: false, listModels: false },
    },
    {
      id: "grok",
      label: "Grok",
      installation: { kind: "not_found" },
      features: { accountUsage: true, listModels: true },
    },
  ];
  const open = vi.fn();
  const accountUsage = vi.fn(async (id: string) =>
    id === "claude"
      ? {
          kind: "available",
          plan: "Pro",
          email: "test@example.com",
          rateLimited: true,
          windows: [{ label: "Weekly", usedRatio: 0.42 }],
        }
      : { kind: "reauth_required", reason: "credentials_rejected" },
  );
  const listModels = vi.fn(async (id: string) => {
    if (id === "codex") throw new Error("Model service unavailable");
    return {
      kind: "ok",
      models: [
        {
          id: "sonnet",
          displayName: "Sonnet",
          effortLevels: ["low", "high"],
          defaultEffort: "low",
        },
      ],
    };
  });
  const skills = vi.fn().mockResolvedValue({ kind: "unsupported", reason: "No query" });
  const mcpServers = vi.fn().mockResolvedValue({ kind: "unsupported", reason: "No query" });
  const tools = vi.fn().mockResolvedValue({ kind: "unsupported", reason: "No query" });
  vi.stubGlobal("rao", {
    runtimes: {
      list: async () => runtimes,
      accountUsage,
      listModels,
      skills,
      mcpServers,
      tools,
    },
    sessions: { diagnostics: async () => [], open },
    app: {
      versions: async () => ({
        app: "0.1",
        platform: "darwin",
        node: "24",
        electron: "44",
        chrome: "140",
      }),
    },
  });
  const { Dashboard } = await import("./Dashboard");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(Dashboard));
    });
    const text = container.textContent ?? "";
    for (const expected of [
      "1.2.3",
      "42% used",
      "Pro",
      "Rate limited",
      "Sonnet",
      "Sign in again",
      "Model service unavailable",
      "No standalone version",
      "does not provide account usage queries",
      "Not installed",
      "No live agents",
    ])
      expect(text).toContain(expected);
    expect(accountUsage).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    for (const query of [skills, mcpServers, tools]) {
      expect(query.mock.calls).toEqual([
        ["claude", undefined],
        ["codex", undefined],
        ["pi", undefined],
      ]);
    }
    expect(text).toContain("Global capabilities");
    expect(text).not.toContain("Choose a folder");
    expect(container.querySelector('button[title="Choose a folder to query"]')).toBeNull();
    expect(container.querySelector("progress")?.value).toBe(0.42);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});
