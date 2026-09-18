import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContextUsageIndicator } from "./ContextUsageIndicator";

const render = (
  tokens: number | null,
  contextWindow: number | null,
  percent: number | null,
  live = true,
) =>
  renderToStaticMarkup(
    createElement(ContextUsageIndicator, { usage: { tokens, contextWindow, percent }, live }),
  );

it("shows reported context, derives percentages only from current context tokens, and preserves unknowns", () => {
  expect(render(32000, 100000, 32)).toContain("32% used (68% left)");
  expect(render(32000, 100000, null)).toContain("32% used (68% left)");
  expect(render(0, 100000, null)).toContain("0% used (100% left)");
  expect(render(32000, null, null)).toContain("32k tokens used");
  expect(render(null, null, null)).toContain("Context window: usage unavailable");
  expect(render(32000, 100000, 32, false)).toContain("Context window: usage unavailable");
  expect(render(32000, 100000, 32)).toContain("32k / 100k tokens used");
});
