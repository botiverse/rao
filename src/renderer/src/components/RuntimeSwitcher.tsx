import { useStore, type SessionState } from "../store";
import { runtimeBrands } from "@botiverse/oar/brands";

export function RuntimeSwitcher({ session }: { session: SessionState }) {
  const { runtimes, switching, switchRuntime } = useStore();
  const pending = switching.includes(session.summary.handle);
  const busy = session.state === "busy" || session.state === "stuck";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <select
        aria-label="Project runtime"
        title={
          busy
            ? "Wait for the current turn to finish"
            : "Switch runtime with a fresh session and conversation handoff"
        }
        disabled={pending || busy || session.transcript === null}
        value={session.summary.runtime}
        onChange={(event) => {
          const runtime = runtimes.find((item) => item.id === event.target.value);
          if (runtime) void switchRuntime(session.summary.handle, runtime.id);
        }}
        className="min-w-0 rounded border border-line bg-bg-raised px-2 py-1 disabled:opacity-50"
      >
        {!runtimes.some((item) => item.id === session.summary.runtime) ? (
          <option value={session.summary.runtime}>
            {runtimeBrands[session.summary.runtime].name}
          </option>
        ) : null}
        {runtimes.map((runtime) => (
          <option
            key={runtime.id}
            value={runtime.id}
            disabled={runtime.installation.kind !== "available"}
          >
            {runtime.label}
            {runtime.installation.kind !== "available" ? " · unavailable" : ""}
          </option>
        ))}
      </select>
      {pending ? (
        <span role="status" className="text-fg-muted">
          Handing off…
        </span>
      ) : null}
    </div>
  );
}
