import { useId } from "react";
import type { ContextUsage } from "@botiverse/oar";

function valid(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

const percentage = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const tokensLabel = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function ContextUsageIndicator({
  usage,
  live,
}: {
  usage: ContextUsage | null;
  live: boolean;
}) {
  const tooltipId = useId();
  const tokens = live ? valid(usage?.tokens) : null;
  const capacity = live ? valid(usage?.contextWindow) : null;
  const reported = live ? valid(usage?.percent) : null;
  const percent =
    reported ??
    (tokens !== null && capacity !== null && capacity > 0 ? (tokens / capacity) * 100 : null);
  const used = percent === null ? null : percentage.format(percent);
  const remaining = percent === null ? null : percentage.format(Math.max(0, 100 - percent));
  const tokenDetail =
    tokens !== null
      ? `${tokensLabel.format(tokens).toLowerCase()}${capacity !== null ? ` / ${tokensLabel.format(capacity).toLowerCase()}` : ""} tokens used`
      : capacity !== null
        ? `${tokensLabel.format(capacity).toLowerCase()} token capacity`
        : null;
  const unavailable = live ? "Not reported by this runtime" : "Agent is not running";
  return (
    <span className="group/context relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={
          used !== null ? `Context window: ${used}% used` : "Context window: usage unavailable"
        }
        aria-describedby={tooltipId}
        className="flex size-7 items-center justify-center rounded-md text-fg-muted outline-none hover:bg-bg-raised hover:text-fg focus-visible:ring-1 focus-visible:ring-accent"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-20"
          />
          {percent !== null ? (
            <circle
              cx="10"
              cy="10"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${Math.min(percent, 100)} 100`}
              transform="rotate(-90 10 10)"
            />
          ) : (
            <text x="10" y="13" textAnchor="middle" fill="currentColor" fontSize="9">
              ?
            </text>
          )}
        </svg>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-max max-w-64 rounded-xl border border-line bg-bg-raised px-4 py-2.5 text-center text-xs leading-6 text-fg opacity-0 shadow-lg transition-opacity group-hover/context:opacity-100 group-focus-within/context:opacity-100"
      >
        <span className="block text-fg-muted">Context window:</span>
        <span className="block">
          {used !== null ? `${used}% used (${remaining}% left)` : unavailable}
        </span>
        {tokenDetail ? <span className="block">{tokenDetail}</span> : null}
      </span>
    </span>
  );
}
