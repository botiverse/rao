import type { AgentStatus } from "@botiverse/oar";
import type { AgentState } from "@shared/ipc";

const TONE: Record<AgentState, string> = {
  idle: "bg-fg-faint",
  busy: "bg-accent pulse",
  stuck: "bg-warn pulse",
  error: "bg-danger",
};

export function phaseLabel(state: AgentState, status: AgentStatus): string {
  if (status.kind === "idle") {
    if (state === "error" && status.lastTurnOutcome?.kind === "failed") {
      return `failed: ${status.lastTurnOutcome.failure}`;
    }
    return "idle";
  }
  if (state === "stuck") {
    return "no output for a while";
  }
  const { phase } = status;
  if (typeof phase === "string") {
    return { waiting_model: "waiting for model", thinking: "thinking", responding: "responding" }[
      phase
    ];
  }
  return `running ${phase.tool}`;
}

export function StatusPill({
  live,
  state,
  status,
}: {
  live: boolean;
  state: AgentState;
  status: AgentStatus;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <span className={`size-1.5 rounded-full ${live ? TONE[state] : "border border-fg-faint"}`} />
      {live ? phaseLabel(state, status) : "not running"}
    </span>
  );
}
