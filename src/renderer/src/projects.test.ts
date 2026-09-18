// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
});
it("loads SQLite projects without reading localStorage and retries failed loads", async () => {
  const old = "invalid obsolete data";
  localStorage.setItem("rao-projects-v2", old);
  const read = vi.spyOn(Storage.prototype, "getItem");
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValue({ a: { name: "A", note: "" } });
  vi.stubGlobal("rao", { projects: { list } });
  const { useProjects } = await import("./projects");
  await useProjects.getState().load();
  expect(useProjects.getState()).toMatchObject({
    loaded: false,
    error: "read failed",
    details: {},
  });
  await useProjects.getState().load();
  expect(useProjects.getState()).toMatchObject({
    loaded: true,
    details: { a: { name: "A", note: "" } },
  });
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
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
