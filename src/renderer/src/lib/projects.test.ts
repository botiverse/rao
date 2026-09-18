import { initialConversation } from "@botiverse/oar/observe";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../store";
import { listProjects, projectPrompt } from "./projects";

function session(handle: string, cwd = "/work/rao"): SessionState {
  return {
    summary: {
      handle,
      cwd,
      runtime: "claude",
      sessionId: handle,
      title: null,
      openedAt: 1,
      updatedAt: 1,
      live: false,
      capabilities: null,
    },
    conversation: initialConversation(),
    buffered: [],
    transcript: null,
    state: "idle",
    status: { kind: "idle" },
    model: null,
  };
}

describe("one project per agent", () => {
  it("keeps agents in the same workspace as independent projects", () => {
    const projects = listProjects([session("first"), session("second"), session("legacy")], {
      first: { name: "Design", note: "UI decisions" },
      second: { name: "Tests", note: "Test commands" },
    });
    expect(projects.map((project) => [project.id, project.session.summary.handle])).toEqual([
      ["first", "first"],
      ["second", "second"],
    ]);
    expect(projects.map((project) => project.note)).toEqual(["UI decisions", "Test commands"]);
    expect(projects[0]?.cwd).toBe(projects[1]?.cwd);
  });

  it("excludes sessions without project metadata and never substitutes another agent", () => {
    expect(listProjects([session("legacy")], {})).toEqual([]);
    expect(
      listProjects([session("other")], {
        missing: { name: "Rao", note: "" },
      }),
    ).toEqual([]);
  });
});

it("only attaches a note when explicitly mentioned, once per message", () => {
  const project = { note: "Use pnpm" };
  expect(projectPrompt("Fix the tests", project)).toBe("Fix the tests");
  expect(projectPrompt("Use @note please", project)).toBe(
    "Use @note please\n\n--- Referenced note (@note) ---\nUse pnpm",
  );
  expect(projectPrompt("@note @note", project).split("Use pnpm")).toHaveLength(2);
  expect(projectPrompt("@note", { note: " " })).toBe("@note");
  for (const input of ["user@note.com", "@notebook", "@notes", "https://host/@note"]) {
    expect(projectPrompt(input, project)).toBe(input);
  }
  expect(projectPrompt("Read @note。", project)).toContain("Use pnpm");
});
