/**
 * The IPC contract between renderer, preload and main. Everything that
 * crosses a process boundary is declared here, once, and typed from oar's
 * own contracts so the renderer speaks the same vocabulary as the runtime.
 *
 * This module is imported by all three processes and must stay free of
 * `electron` and Node imports: type-only imports from oar are erased.
 */
import type {
  AgentStatus,
  Event,
  InstallationSnapshot,
  ListModelsResult,
  SessionCapabilities,
} from "@botiverse/oar";

export type RuntimeId = "claude" | "codex" | "kimi" | "pi" | "grok";

export const RUNTIME_IDS: readonly RuntimeId[] = ["claude", "codex", "kimi", "pi", "grok"];

export const RUNTIME_LABELS: Readonly<Record<RuntimeId, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  kimi: "Kimi Code",
  pi: "Pi",
  grok: "Grok Build",
};

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
  readonly handle: string;
  readonly runtime: RuntimeId;
  readonly sessionId: string;
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

export interface SessionEventMessage {
  readonly handle: string;
  readonly event: Event;
}

export interface SessionStatusMessage {
  readonly handle: string;
  readonly state: AgentState;
  readonly status: AgentStatus;
  readonly model: string | null;
}

export interface SessionClosedMessage {
  readonly handle: string;
  readonly reason: string;
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
  runtimesList: "runtimes:list",
  runtimesListModels: "runtimes:listModels",
  sessionOpen: "session:open",
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
  readonly runtimes: {
    list(): Promise<readonly RuntimeInfo[]>;
    listModels(runtime: RuntimeId): Promise<ListModelsResult>;
  };
  readonly sessions: {
    open(request: OpenSessionRequest): Promise<SessionSummary>;
    /** Reattach a runtime to a stored session via its native resume. */
    resume(handle: string): Promise<SessionSummary>;
    /** Every stored session, most recently updated first, with live state. */
    list(): Promise<readonly SessionSummary[]>;
    /** The persisted event log of one session, for replaying the transcript. */
    events(handle: string): Promise<readonly Event[]>;
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
