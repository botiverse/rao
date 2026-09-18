import { expect, it } from "vitest";
import { dataDirectory } from "./data-directory";
it("uses the same default for development and packaging while respecting test overrides", () => {
  expect(dataDirectory("/app-data", "", [])).toBe("/app-data/Rao");
  expect(dataDirectory("/app-data", "/test-data", [])).toBe("/test-data");
  expect(dataDirectory("/app-data", "", ["--user-data-dir=/explicit"])).toBe("/explicit");
});
