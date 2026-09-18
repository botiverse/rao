/* oxlint-disable typescript/no-unsafe-type-assertion -- Narrow AgentHost doubles exercise only project lifecycle methods. */
import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentHost } from "../agents/host";
import { ProjectStore } from "./store";
import { ProjectService } from "./service";

it("recovers interrupted creation and retries failed deletion without legacy resurrection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-lifecycle-"));
  const projects = new ProjectStore(join(dir, "rao.sqlite"));
  const deleted = vi
    .fn()
    .mockRejectedValueOnce(new Error("file busy"))
    .mockResolvedValue(undefined);
  const host = { list: () => [{ handle: "created" }], delete: deleted } as unknown as AgentHost;
  const service = new ProjectService(host, projects);
  try {
    projects.create("created", { name: "Created", note: "" });
    await service.recover();
    expect(projects.list().created?.name).toBe("Created");
    await expect(service.remove("created")).rejects.toThrow("file busy");
    expect(projects.list()).toEqual({});
    expect(projects.pending()).toEqual([{ id: "created", deleting: true }]);
    await service.recover();
    expect(projects.pending()).toEqual([]);
    expect(deleted).toHaveBeenCalledTimes(2);
  } finally {
    projects.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("cleans up a created session if final metadata persistence fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rao-create-"));
  const projects = new ProjectStore(join(dir, "rao.sqlite"));
  const deleted = vi.fn().mockResolvedValue(undefined);
  const host = {
    open: vi.fn().mockResolvedValue({ handle: "irrelevant" }),
    delete: deleted,
  } as unknown as AgentHost;
  const service = new ProjectService(host, projects);
  try {
    vi.spyOn(projects, "finishCreate").mockImplementationOnce(() => {
      throw new Error("save failed");
    });
    await expect(service.create({ runtime: "pi", cwd: "/tmp" })).rejects.toThrow("save failed");
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(projects.list()).toEqual({});
    expect(projects.pending()).toEqual([]);
  } finally {
    projects.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
