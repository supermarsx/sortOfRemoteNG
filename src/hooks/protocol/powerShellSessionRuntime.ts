import type { Connection } from "../../types/connection/connection";
import type { PowerShellRemotingSettings } from "../../types/powershellRemoting";

export type PowerShellSessionPhase =
  | "ready"
  | "running"
  | "cancelling"
  | "closing"
  | "closed"
  | "failed";

export type PowerShellStreamKind =
  | "output"
  | "error"
  | "warning"
  | "verbose"
  | "debug"
  | "information"
  | "progress"
  | "pipeline_state"
  | "session_state";

export interface PowerShellProgress {
  activity?: string | null;
  activityId?: number | null;
  statusDescription?: string | null;
  currentOperation?: string | null;
  parentActivityId?: number | null;
  percentComplete?: number | null;
  secondsRemaining?: number | null;
  recordType?: number | null;
}

export interface PowerShellSessionEvent {
  sessionId: string;
  sequence: number;
  timestampMs: number;
  pipelineId?: string | null;
  kind: PowerShellStreamKind;
  text: string;
  value?: unknown;
  progress?: PowerShellProgress | null;
  pipelineState?: string | null;
}

export interface PowerShellEventEnvelope {
  event: PowerShellSessionEvent;
  replayed: boolean;
}

export interface PowerShellEventReplay {
  sessionId: string;
  oldestSequence: number;
  nextSequence: number;
  truncated: boolean;
  evictedEvents: number;
  events: PowerShellSessionEvent[];
}

export interface PowerShellSessionCapabilities {
  transport: "ssh";
  persistentRunspace: boolean;
  pipelineInput: boolean;
  pipelineCancellation: boolean;
  allStreams: boolean;
  progressRecords: boolean;
  boundedReplay: boolean;
  uiReattach: boolean;
  transportReconnect: boolean;
  wsmanAvailable: boolean;
  maxConcurrentPipelines: number;
}

export interface PowerShellSessionStats {
  openedAtMs: number;
  lastActivityAtMs: number;
  closedAtMs?: number | null;
  pipelinesStarted: number;
  pipelinesCompleted: number;
  pipelinesFailed: number;
  pipelinesCancelled: number;
  inputObjectsSent: number;
  eventsEmitted: number;
  deliveryFailures: number;
  replayEvictions: number;
}

export interface PowerShellSessionDiagnostics {
  transport: "ssh";
  hostKeyVerification: string;
  authentication: string;
  runspaceHealth: string;
  activePipeline?: string | null;
  limitations: string[];
}

export interface PowerShellBackendSession {
  id: string;
  connectionId?: string | null;
  host: string;
  port: number;
  username: string;
  runspaceId: string;
  phase: PowerShellSessionPhase;
  activePipelineId?: string | null;
  inputOpen: boolean;
  terminalErrorCode?: string | null;
  capabilities: PowerShellSessionCapabilities;
  stats: PowerShellSessionStats;
  diagnostics: PowerShellSessionDiagnostics;
}

export interface PowerShellPipelineStarted {
  sessionId: string;
  pipelineId: string;
  inputOpen: boolean;
}

export type PowerShellPipelineInput =
  | { type: "null" }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "integer"; value: number }
  | { type: "float"; value: number };

export type PowerShellSshSessionOptions = {
  host: string;
  port: number;
  username: string;
  auth:
    | { type: "password"; password: string }
    | { type: "private_key"; path: string; passphrase?: string | null };
  hostKeyPolicy:
    | { type: "pinned_sha256"; fingerprint: string }
    | { type: "known_hosts"; path: string };
  connectionId: string;
  subsystem: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  eventCapacity: number;
  commandQueueCapacity: number;
  queueWaitTimeoutMs: number;
};

const secondsToMs = (value: number, fallback: number): number =>
  Math.max(1_000, Math.min(300_000, Math.round((value || fallback) * 1_000)));

function assertConnectionSecretSource(
  settings: PowerShellRemotingSettings,
  secretDescription: string,
): void {
  if (settings.credential.source === "prompt") {
    throw new Error(
      `${secretDescription} must be prompted at connect time; refusing to reuse a saved connection secret.`,
    );
  }
  if (settings.credential.source === "vault") {
    throw new Error(
      `${secretDescription} must be resolved from the selected vault reference; refusing to reuse a saved connection secret.`,
    );
  }
  if (settings.credential.savedCredentialId) {
    throw new Error(
      `${secretDescription} must be resolved from the selected saved credential; refusing to reuse the connection-level secret.`,
    );
  }
}

/** Build the strict, secret-bearing invoke payload without retaining it. */
export function buildPowerShellSshSessionOptions(
  connection: Connection,
  settings: PowerShellRemotingSettings,
): PowerShellSshSessionOptions {
  if (settings.transport !== "ssh") {
    throw new Error(
      "WSMan is unavailable in the live PowerShell session viewer. Select PowerShell over SSH.",
    );
  }

  const username =
    settings.credential.username.trim() || connection.username?.trim() || "";
  if (!username) throw new Error("A PowerShell SSH username is required.");

  let auth: PowerShellSshSessionOptions["auth"];
  if (settings.ssh.authMethod === "password") {
    assertConnectionSecretSource(settings, "The PowerShell SSH password");
    if (!connection.password) {
      throw new Error(
        "A saved or prompted password is required for PowerShell SSH authentication.",
      );
    }
    auth = { type: "password", password: connection.password };
  } else if (settings.ssh.authMethod === "privateKey") {
    if (settings.ssh.privateKeyCredentialRef) {
      throw new Error(
        "The PowerShell SSH private-key credential reference must be resolved at connect time; refusing to reuse the connection-level private key.",
      );
    }
    let path = settings.ssh.privateKeyPath?.trim();
    if (!path && connection.privateKey) {
      assertConnectionSecretSource(settings, "The PowerShell SSH private key");
      path = connection.privateKey;
    }
    if (!path) {
      throw new Error("A private-key path is required for PowerShell SSH.");
    }
    const passphrase = connection.passphrase || null;
    if (passphrase) {
      assertConnectionSecretSource(
        settings,
        "The PowerShell SSH private-key passphrase",
      );
    }
    auth = {
      type: "private_key",
      path,
      passphrase,
    };
  } else {
    throw new Error(
      "SSH agent authentication is not available in the strict PowerShell adapter yet.",
    );
  }

  let hostKeyPolicy: PowerShellSshSessionOptions["hostKeyPolicy"];
  if (settings.ssh.hostTrust.mode === "pinned") {
    const fingerprint = settings.ssh.hostTrust.fingerprint?.trim();
    if (!fingerprint) {
      throw new Error("A pinned SHA256 SSH host-key fingerprint is required.");
    }
    hostKeyPolicy = { type: "pinned_sha256", fingerprint };
  } else if (settings.ssh.hostTrust.mode === "strict") {
    const path = connection.sshKnownHostsPath?.trim();
    if (!path) {
      throw new Error(
        "A known_hosts path is required for strict PowerShell SSH verification.",
      );
    }
    hostKeyPolicy = { type: "known_hosts", path };
  } else {
    throw new Error(
      "Trust-on-first-use is not available in the strict PowerShell adapter. Use known_hosts or a pinned fingerprint.",
    );
  }

  return {
    host: connection.hostname,
    port: settings.ssh.port || connection.port || 22,
    username,
    auth,
    hostKeyPolicy,
    connectionId: connection.id,
    subsystem: settings.ssh.subsystem || "powershell",
    connectTimeoutMs: secondsToMs(settings.session.connectTimeoutSec, 30),
    requestTimeoutMs: secondsToMs(settings.session.operationTimeoutSec, 180),
    eventCapacity: 2_048,
    commandQueueCapacity: 64,
    queueWaitTimeoutMs: 2_000,
  };
}

export class PowerShellSequenceCursor {
  private current = 0;

  accept(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.current)
      return false;
    this.current = sequence;
    return true;
  }

  reset(sequence = 0): void {
    this.current = Math.max(0, Math.trunc(sequence));
  }

  get value(): number {
    return this.current;
  }
}
