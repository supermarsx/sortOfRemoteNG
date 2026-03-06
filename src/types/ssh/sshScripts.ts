// ── src/types/sshScripts.ts ──────────────────────────────────────────────────
// TypeScript types matching the sorng-ssh-scripts Rust crate.
// These provide full type safety for the Tauri IPC layer.

// ── Enums ────────────────────────────────────────────────────────────────────

export type ScriptLanguage =
  | "bash"
  | "sh"
  | "powershell"
  | "python"
  | "perl"
  | "batch"
  | "javascript"
  | "raw";

export type ExecutionMode = "exec" | "shell" | "upload" | "local";

export type OnFailure = "continue" | "retry" | "abort" | { runFallback: string };

export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"
  | "skipped";

export type FileWatchType = "modified" | "created" | "deleted" | "any";

// ── Trigger ──────────────────────────────────────────────────────────────────

export type ScriptTrigger =
  | { type: "login"; delayMs: number }
  | { type: "logout"; runOnError: boolean }
  | { type: "reconnect" }
  | { type: "connectionError"; retryCount?: number }
  | { type: "interval"; intervalMs: number }
  | { type: "cron"; expression: string }
  | {
      type: "outputMatch";
      pattern: string;
      maxTriggers?: number;
      cooldownMs: number;
    }
  | { type: "idle"; idleMs: number; repeat: boolean }
  | { type: "fileWatch"; path: string; watchType: FileWatchType }
  | { type: "resize" }
  | { type: "manual" }
  | { type: "scheduled"; time: string }
  | { type: "envChange"; variableName: string }
  | {
      type: "metricThreshold";
      metric: string;
      thresholdCommand: string;
      thresholdValue: number;
      cooldownMs: number;
    }
  | { type: "afterScript"; scriptId: string; requireSuccess: boolean }
  | { type: "keepaliveFailed"; consecutiveFailures: number }
  | { type: "portForwardChange" }
  | { type: "hostKeyChanged" };

// ── Conditions ───────────────────────────────────────────────────────────────

export type ScriptCondition =
  | { type: "osMatch"; os: string }
  | { type: "commandSucceeds"; command: string }
  | { type: "commandOutputMatches"; command: string; pattern: string }
  | { type: "fileExists"; path: string }
  | { type: "envEquals"; variable: string; value: string }
  | { type: "timeWindow"; afterHour: number; beforeHour: number }
  | { type: "sessionAge"; minMs: number; maxMs?: number }
  | { type: "variableEquals"; name: string; value: string }
  | { type: "previousExitCode"; code: number }
  | { type: "all"; conditions: ScriptCondition[] }
  | { type: "any"; conditions: ScriptCondition[] }
  | { type: "not"; condition: ScriptCondition };

// ── Variables ────────────────────────────────────────────────────────────────

export type VariableSource =
  | { type: "static"; value: string }
  | { type: "prompt"; message: string }
  | { type: "remoteCommand"; command: string }
  | { type: "remoteFile"; path: string }
  | { type: "remoteEnv"; variableName: string }
  | { type: "connectionMeta"; field: string }
  | { type: "previousOutput"; scriptId: string }
  | { type: "timestamp"; format: string };

export interface ScriptVariable {
  name: string;
  source: VariableSource;
  defaultValue: string;
  sensitive: boolean;
  cacheMs: number;
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface ScriptNotification {
  onSuccess: boolean;
  onFailure: boolean;
  channels: string[];
  webhookUrl?: string;
  customMessage?: string;
}

// ── Main Script Definition ───────────────────────────────────────────────────

export interface SshEventScript {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  content: string;
  language: ScriptLanguage;
  executionMode: ExecutionMode;
  trigger: ScriptTrigger;
  conditions: ScriptCondition[];
  variables: ScriptVariable[];
  timeoutMs: number;
  onFailure: OnFailure;
  maxRetries: number;
  retryDelayMs: number;
  runAsUser?: string;
  workingDirectory?: string;
  environment: Record<string, string>;
  notifications?: ScriptNotification;
  tags: string[];
  category: string;
  priority: number;
  connectionIds: string[];
  hostPatterns: string[];
  createdAt: string;
  updatedAt: string;
  author: string;
  version: number;
}

// ── Chains ───────────────────────────────────────────────────────────────────

export interface ChainStep {
  scriptId: string;
  continueOnFailure: boolean;
  delayMs: number;
  overrideVariables: Record<string, string>;
}

export interface ScriptChain {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: ChainStep[];
  abortOnFailure: boolean;
  tags: string[];
  category: string;
  createdAt: string;
  updatedAt: string;
}

// ── Execution Records ────────────────────────────────────────────────────────

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  scriptName: string;
  sessionId?: string;
  connectionId?: string;
  triggerType: string;
  status: ExecutionStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  attempt: number;
  variables: Record<string, string>;
  environment: Record<string, string>;
  host?: string;
  username?: string;
}

export interface ChainExecutionRecord {
  id: string;
  chainId: string;
  chainName: string;
  sessionId?: string;
  connectionId?: string;
  status: ExecutionStatus;
  stepResults: ExecutionRecord[];
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
}

// ── Events (from backend) ────────────────────────────────────────────────────

export type ScriptEvent =
  | {
      type: "started";
      executionId: string;
      scriptId: string;
      scriptName: string;
    }
  | {
      type: "completed";
      executionId: string;
      scriptId: string;
      status: ExecutionStatus;
      durationMs: number;
    }
  | { type: "output"; executionId: string; data: string; isStderr: boolean }
  | { type: "nextRun"; scriptId: string; nextRunAt: string }
  | {
      type: "conditionResult";
      scriptId: string;
      conditionIndex: number;
      result: boolean;
    }
  | {
      type: "variableResolved";
      scriptId: string;
      name: string;
      value: string;
    }
  | {
      type: "schedulerTick";
      firedCount: number;
      nextDue?: string;
    };

// ── Scheduler ────────────────────────────────────────────────────────────────

export interface SchedulerEntry {
  scriptId: string;
  scriptName: string;
  sessionId: string;
  triggerType: string;
  nextRunAt?: string;
  intervalMs?: number;
  paused: boolean;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface ScriptStats {
  totalRuns: number;
  successes: number;
  failures: number;
  timeouts: number;
  averageDurationMs: number;
  lastRunAt?: string;
  lastStatus?: ExecutionStatus;
}

// ── Lifecycle Events (sent to backend) ───────────────────────────────────────

export type SshLifecycleEventType =
  | "connected"
  | "disconnected"
  | "reconnected"
  | "connectionError"
  | "keepaliveFailed"
  | "idle"
  | "resize"
  | "portForwardEstablished"
  | "portForwardClosed"
  | "hostKeyChanged"
  | "outputMatch";

export interface SshLifecycleEvent {
  sessionId: string;
  connectionId?: string;
  host?: string;
  username?: string;
  port?: number;
  eventType: SshLifecycleEventType;
  detail?: string;
  timestamp: string;
}

// ── Request / Response Types ─────────────────────────────────────────────────

export interface CreateScriptRequest {
  name: string;
  description?: string;
  content: string;
  language: ScriptLanguage;
  executionMode?: ExecutionMode;
  trigger: ScriptTrigger;
  conditions?: ScriptCondition[];
  variables?: ScriptVariable[];
  timeoutMs?: number;
  onFailure?: OnFailure;
  maxRetries?: number;
  retryDelayMs?: number;
  runAsUser?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  notifications?: ScriptNotification;
  tags?: string[];
  category?: string;
  priority?: number;
  connectionIds?: string[];
  hostPatterns?: string[];
  author?: string;
}

export interface UpdateScriptRequest {
  name?: string;
  description?: string;
  content?: string;
  language?: ScriptLanguage;
  executionMode?: ExecutionMode;
  trigger?: ScriptTrigger;
  conditions?: ScriptCondition[];
  variables?: ScriptVariable[];
  timeoutMs?: number;
  onFailure?: OnFailure;
  maxRetries?: number;
  retryDelayMs?: number;
  runAsUser?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  notifications?: ScriptNotification;
  tags?: string[];
  category?: string;
  priority?: number;
  connectionIds?: string[];
  hostPatterns?: string[];
}

export interface CreateChainRequest {
  name: string;
  description?: string;
  steps: ChainStep[];
  abortOnFailure?: boolean;
  tags?: string[];
  category?: string;
}

export interface UpdateChainRequest {
  name?: string;
  description?: string;
  steps?: ChainStep[];
  abortOnFailure?: boolean;
  enabled?: boolean;
  tags?: string[];
  category?: string;
}

export interface RunScriptRequest {
  scriptId: string;
  sessionId?: string;
  connectionId?: string;
  variableOverrides?: Record<string, string>;
}

export interface RunChainRequest {
  chainId: string;
  sessionId?: string;
  connectionId?: string;
  variableOverrides?: Record<string, string>;
}

export interface HistoryQuery {
  scriptId?: string;
  sessionId?: string;
  connectionId?: string;
  status?: ExecutionStatus;
  triggerType?: string;
  fromDate?: string;
  toDate?: string;
  offset: number;
  limit: number;
}

export interface HistoryResponse {
  records: ExecutionRecord[];
  total: number;
  offset: number;
  limit: number;
}

// ── Import/Export ─────────────────────────────────────────────────────────────

export interface ScriptBundle {
  version: string;
  exportedAt: string;
  scripts: SshEventScript[];
  chains: ScriptChain[];
}

export interface ImportResult {
  scriptsImported: number;
  chainsImported: number;
  scriptsSkipped: number;
  chainsSkipped: number;
}

// ── Pending Execution (from engine) ──────────────────────────────────────────

export interface PendingExecution {
  executionId: string;
  scriptId: string;
  scriptName: string;
  sessionId: string;
  connectionId?: string;
  triggerType: string;
  content: string;
  language: ScriptLanguage;
  executionMode: ExecutionMode;
  timeoutMs: number;
  runAsUser?: string;
  workingDirectory?: string;
  environment: Record<string, string>;
  resolvedVariables: Record<string, string>;
  onFailure: OnFailure;
  maxRetries: number;
  retryDelayMs: number;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface SshScriptsSummary {
  totalScripts: number;
  enabledScripts: number;
  disabledScripts: number;
  totalChains: number;
  categories: number;
  tags: number;
  triggerCounts: Record<string, number>;
  activeSessions: number;
}

// ── Trigger Descriptors (for UI) ─────────────────────────────────────────────

export const TRIGGER_TYPES = [
  { value: "login", label: "Login", description: "Runs when an SSH session connects" },
  { value: "logout", label: "Logout", description: "Runs when an SSH session disconnects" },
  { value: "reconnect", label: "Reconnect", description: "Runs after an SSH session reconnects" },
  {
    value: "connectionError",
    label: "Connection Error",
    description: "Runs when a connection error occurs",
  },
  {
    value: "interval",
    label: "Interval",
    description: "Runs repeatedly at a fixed interval",
  },
  { value: "cron", label: "Cron", description: "Runs on a cron schedule" },
  {
    value: "outputMatch",
    label: "Output Match",
    description: "Runs when terminal output matches a pattern",
  },
  {
    value: "idle",
    label: "Idle",
    description: "Runs after the session is idle for a specified duration",
  },
  {
    value: "fileWatch",
    label: "File Watch",
    description: "Runs when a remote file changes",
  },
  { value: "resize", label: "Resize", description: "Runs when the terminal is resized" },
  { value: "manual", label: "Manual", description: "Only runs when manually triggered" },
  {
    value: "scheduled",
    label: "Scheduled",
    description: "Runs at a specific time (HH:MM:SS or ISO 8601)",
  },
  {
    value: "envChange",
    label: "Env Change",
    description: "Runs when a remote environment variable changes",
  },
  {
    value: "metricThreshold",
    label: "Metric Threshold",
    description: "Runs when a metric command output exceeds a threshold",
  },
  {
    value: "afterScript",
    label: "After Script",
    description: "Runs after another script finishes",
  },
  {
    value: "keepaliveFailed",
    label: "Keepalive Failed",
    description: "Runs after consecutive keepalive failures",
  },
  {
    value: "portForwardChange",
    label: "Port Forward Change",
    description: "Runs when port forwarding state changes",
  },
  {
    value: "hostKeyChanged",
    label: "Host Key Changed",
    description: "Runs when the remote host key changes",
  },
] as const;

export const SCRIPT_LANGUAGES: {
  value: ScriptLanguage;
  label: string;
  extension: string;
}[] = [
  { value: "bash", label: "Bash", extension: ".sh" },
  { value: "sh", label: "Shell (POSIX)", extension: ".sh" },
  { value: "powershell", label: "PowerShell", extension: ".ps1" },
  { value: "python", label: "Python", extension: ".py" },
  { value: "perl", label: "Perl", extension: ".pl" },
  { value: "batch", label: "Batch (Windows)", extension: ".bat" },
  { value: "javascript", label: "JavaScript", extension: ".js" },
  { value: "raw", label: "Raw (send as-is)", extension: ".txt" },
];

export const EXECUTION_MODES: { value: ExecutionMode; label: string; description: string }[] = [
  { value: "exec", label: "Exec", description: "Run via SSH exec channel" },
  { value: "shell", label: "Shell", description: "Send through interactive shell" },
  { value: "upload", label: "Upload & Execute", description: "Upload script file then execute" },
  { value: "local", label: "Local", description: "Run on the local machine" },
];
