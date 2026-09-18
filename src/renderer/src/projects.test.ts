// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
});
it("imports current-origin legacy data before loading and exposes retryable startup failures", async () => {
  const old = JSON.stringify({ state: { details: { a: { name: "A", note: "" } } }, version: 1 });
  localStorage.setItem("rao-projects-v2", old);
  const order: string[] = [];
  const importLegacy = vi
    .fn()
    .mockRejectedValueOnce(new Error("backup failed"))
    .mockImplementation(async () => {
      order.push("import");
    });
  const list = vi.fn(async () => {
    order.push("list");
    return { a: { name: "A", note: "" } };
  });
  vi.stubGlobal("rao", { projects: { importLegacy, list } });
  const { useProjects } = await import("./projects");
  await useProjects.getState().load();
  expect(useProjects.getState()).toMatchObject({
    loaded: false,
    error: "backup failed",
    details: {},
  });
  expect(list).not.toHaveBeenCalled();
  await useProjects.getState().load();
  expect(order).toEqual(["import", "list"]);
  expect(useProjects.getState().loaded).toBe(true);
  expect(localStorage.getItem("rao-projects-v2")).toBe(old);
});
it("serializes saves and later loads, merging patches only after persistence acknowledgement", async () => {
  const { promise: first, resolve: release } = Promise.withResolvers<{
    name: string;
    note: string;
  }>();
  const save = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockImplementation(async (_id: string, value: unknown) => value);
  const list = vi.fn().mockResolvedValue({ a: { name: "New", note: "Second" } });
  vi.stubGlobal("rao", { projects: { save, list } });
  const { useProjects } = await import("./projects");
  useProjects.getState().remember("a", { name: "Old", note: "Original" });
  const one = useProjects.getState().update("a", { name: "New" });
  const two = useProjects.getState().update("a", { note: "Second" });
  const load = useProjects.getState().load();
  await Promise.resolve();
  expect(useProjects.getState().details.a?.name).toBe("Old");
  expect(save).toHaveBeenCalledTimes(1);
  release({ name: "New", note: "Original" });
  await Promise.all([one, two, load]);
  expect(save).toHaveBeenLastCalledWith("a", { name: "New", note: "Second" });
  expect(useProjects.getState().details.a).toEqual({ name: "New", note: "Second" });
});
