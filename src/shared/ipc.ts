import type { ProjectDetails } from "./projects";
/**
 * The IPC contract between renderer, preload and main. Everything that
 * crosses a process boundary is declared here, once, and typed from oar's
 * own contracts so the renderer speaks the same vocabulary as the runtime.
 *
 * This module is imported by all three processes and must stay free of
 * `electron` and Node imports: type-only imports from oar are erased.
 */
import type {
  AccountUsageSnapshot,
  InventoryResult,
  SkillEntry,
  McpServerEntry,
  ToolEntry,
  ContextUsage,
  SessionUsage,
  SessionGraph,
  RawEvent,
  AgentStatus,
  Event,
  ControlResult,
  InstallationSnapshot,
  ListModelsResult,
  SessionCapabilities,
} from "@botiverse/oar";

export type RuntimeId = "claude" | "codex" | "kimi" | "pi" | "grok";

export const RUNTIME_IDS: readonly RuntimeId[] = ["claude", "codex", "kimi", "pi", "grok"];

export function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && (RUNTIME_IDS as readonly string[]).includes(value);
}

export interface RuntimeInfo {
  readonly id: RuntimeId;
  readonly label: string;
  readonly installation: InstallationSnapshot;
  readonly features: {
    readonly listModels: boolean;
    readonly accountUsage: boolean;
  };
}

export interface OpenSessionRequest {
  readonly project?: ProjectDetails;
  readonly runtime: RuntimeId;
  readonly cwd: string;
  readonly model?: string;
  /** Runtime-native session id to reattach to. */
  readonly resume?: string;
}

/**
 * What rao persists about a session. `handle` is rao's own stable key (also
 * the storage file name); `sessionId` is the runtime-native id used to resume.
 */
export interface SessionRecord {
  readonly handoffId?: string;
  readonly runtimeModels?: Partial<Record<RuntimeId, string>>;
  readonly handle: string;
  readonly runtime: RuntimeId;
  readonly sessionId: string;
  /** Persisted before forwarding any prompt, including failed/interrupted attempts. */
  readonly promptAttempted?: boolean;
  readonly cwd: string;
  /** Model the runtime reported (latest `model` event), when any. */
  readonly model?: string;
  /** First line of the first prompt; null until the first turn. */
  readonly title: string | null;
  readonly openedAt: number;
  readonly updatedAt: number;
}

/** A session as the renderer sees it: the stored record plus live state. */
export interface SessionSummary extends SessionRecord {
  /** Current live context; absent/null until the runtime reports it. */
  readonly context?: ContextUsage | null;
  /** Whether a runtime process is currently attached to this session. */
  readonly live: boolean;
  /** Present only while live. */
  readonly capabilities: SessionCapabilities | null;
}

/** Control answers only "taken over or not"; outcomes arrive as events. */
export type ControlOutcome =
  | { readonly accepted: true; readonly seq: number }
  | { readonly accepted: false; readonly reason: string };

export type AgentState = "idle" | "busy" | "stuck" | "error";

/** Legacy Rao submission log; retained only for reading existing conversations. */
export interface InputSubmission {
  readonly kind: "input_submission";
  readonly id: string;
  readonly input: string;
  readonly receivedAt: number;
  readonly state: "sending" | "steered" | "queued" | "rejected" | "unknown";
  readonly reason?: string;
  readonly result?: ControlResult;
}

/** One native stream instance; seq restarts when a runtime is resumed. */
export interface SessionStreamRecord {
  readonly kind: "record";
  readonly streamId: string;
  readonly receivedAt: number;
  readonly record: RawEvent;
}

/** Application-level handoff marker; never presented as a native runtime event. */
export interface RuntimeHandoff {
  readonly kind: "runtime_handoff";
  readonly id: string;
  readonly receivedAt: number;
  readonly from: RuntimeId;
  readonly to: RuntimeId;
  readonly previousSessionId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly markdown: string;
  readonly model?: string;
  readonly runtimeModels: Partial<Record<RuntimeId, string>>;
}

/** Flat events/submissions are read-only legacy history. New writes contain records. */
export type SessionEvent = Event | InputSubmission | SessionStreamRecord | RuntimeHandoff;

export interface SessionEventMessage {
  readonly handle: string;
  readonly event: SessionEvent;
}

export interface SessionStatusMessage {
  readonly context: ContextUsage | null;
  readonly handle: string;
  readonly state: AgentState;
  readonly status: AgentStatus;
  readonly model: string | null;
}

export interface SessionClosedMessage {
  readonly handle: string;
  readonly reason: string;
}

export interface SessionDiagnostics {
  readonly handle: string;
  readonly model: string | null;
  readonly capabilities: SessionCapabilities;
  readonly usage: SessionUsage;
  readonly context: ContextUsage | null;
  readonly graph: SessionGraph;
  readonly recordCount: number;
  /** Most recent 100 records from the current process, not persisted history. */
  readonly recentRecords: readonly RawEvent[];
}

export interface AppVersions {
  readonly app: string;
  readonly electron: string;
  readonly node: string;
  readonly chrome: string;
  readonly platform: NodeJS.Platform;
}

/** Channel names: one place, so main and preload cannot drift. */
export const IPC = {
  projectsList: "projects:list",
  projectsSave: "projects:save",
  runtimesList: "runtimes:list",
  runtimesSkills: "runtimes:skills",
  runtimesMcpServers: "runtimes:mcpServers",
  runtimesTools: "runtimes:tools",
  runtimesAccountUsage: "runtimes:accountUsage",
  sessionDiagnostics: "session:diagnostics",
  runtimesListModels: "runtimes:listModels",
  sessionOpen: "session:open",
  sessionSwitchRuntime: "session:switchRuntime",
  sessionResume: "session:resume",
  sessionList: "session:list",
  sessionEvents: "session:events",
  sessionDelete: "session:delete",
  sessionPrompt: "session:prompt",
  sessionSteerOrQueue: "session:steerOrQueue",
  sessionAbort: "session:abort",
  sessionDispose: "session:dispose",
  sessionEvent: "session:event",
  sessionStatus: "session:status",
  sessionClosed: "session:closed",
  dialogPickDirectory: "dialog:pickDirectory",
  appVersions: "app:versions",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** The API preload exposes on `window.rao`. */
export interface RaoApi {
  readonly projects: {
    list(): Promise<Record<string, ProjectDetails>>;
    save(id: string, details: ProjectDetails): Promise<ProjectDetails>;
  };
  readonly runtimes: {
    list(): Promise<readonly RuntimeInfo[]>;
    skills(runtime: RuntimeId, cwd?: string): Promise<InventoryResult<SkillEntry>>;
    mcpServers(runtime: RuntimeId, cwd?: string): Promise<InventoryResult<McpServerEntry>>;
    tools(runtime: RuntimeId, cwd?: string): Promise<InventoryResult<ToolEntry>>;
    listModels(runtime: RuntimeId): Promise<ListModelsResult>;
    accountUsage(runtime: RuntimeId): Promise<AccountUsageSnapshot>;
  };
  readonly sessions: {
    switchRuntime(handle: string, runtime: RuntimeId): Promise<SessionSummary>;
    diagnostics(): Promise<readonly SessionDiagnostics[]>;
    open(request: OpenSessionRequest): Promise<SessionSummary>;
    /** Reattach a runtime to a stored session via its native resume. */
    resume(handle: string): Promise<SessionSummary>;
    /** Every stored session, most recently updated first, with live state. */
    list(): Promise<readonly SessionSummary[]>;
    /** The persisted event log of one session, for replaying the transcript. */
    events(handle: string): Promise<readonly SessionEvent[]>;
    prompt(handle: string, input: string): Promise<ControlOutcome>;
    steerOrQueue(handle: string, input: string): Promise<ControlOutcome>;
    abort(handle: string): Promise<ControlOutcome>;
    /** Release the runtime but keep the stored session. */
    dispose(handle: string): Promise<void>;
    /** Release the runtime if live and remove the stored session. */
    delete(handle: string): Promise<void>;
    onEvent(listener: (message: SessionEventMessage) => void): () => void;
    onStatus(listener: (message: SessionStatusMessage) => void): () => void;
    onClosed(listener: (message: SessionClosedMessage) => void): () => void;
  };
  readonly dialog: {
    pickDirectory(): Promise<string | null>;
  };
  readonly app: {
    versions(): Promise<AppVersions>;
  };
}
