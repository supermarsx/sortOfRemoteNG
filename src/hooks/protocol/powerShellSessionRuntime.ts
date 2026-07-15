import type { Connection } from "../../types/connection/connection";
import type { PowerShellRemotingSettings } from "../../types/powershellRemoting";
import { canonicalPowerShellEndpoint } from "../../utils/powershell/normalizePowerShellRemoting";

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
  transport: "ssh" | "wsman" | "multiple";
  supportedTransports: Array<"ssh" | "wsman">;
  persistentRunspace: boolean;
  pipelineInput: boolean;
  pipelineCancellation: boolean;
  allStreams: boolean;
  progressRecords: boolean;
  boundedReplay: boolean;
  uiReattach: boolean;
  transportReconnect: boolean;
  wsmanAvailable: boolean;
  wsmanContractVerified: boolean;
  wsmanLiveWindowsVerified: boolean;
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
  transport: "ssh" | "wsman";
  hostKeyVerification: string;
  authentication: string;
  runspaceHealth: string;
  activePipeline?: string | null;
  contractVerification: string;
  liveInteroperability: string;
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

export type PowerShellSshSessionDetails = {
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

export type PowerShellWsmanSessionDetails = {
  endpoint: string;
  username: string;
  password: string;
  domain?: string | null;
  authentication: "basic" | "ntlm";
  tlsTrust: "trust_center";
  networkPath: "direct";
  connectionId: string;
  configurationName: string;
  culture: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  idleTimeoutSec: number;
  maxEnvelopeBytes: number;
  maxResponseBytes: number;
  maxAuthRounds: number;
  maxEmptyReceives: number;
  eventCapacity: number;
  commandQueueCapacity: number;
  queueWaitTimeoutMs: number;
};

export type PowerShellSessionOptions =
  | { transport: "ssh"; options: PowerShellSshSessionDetails }
  | { transport: "wsman"; options: PowerShellWsmanSessionDetails };

const secondsToMs = (value: number, fallback: number): number =>
  Math.max(1_000, Math.min(300_000, Math.round((value || fallback) * 1_000)));

const boundedInteger = (
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  Math.max(
    minimum,
    Math.min(maximum, Math.round(Number.isFinite(value) ? value : fallback)),
  );

const megabytesToBytes = (
  value: number,
  fallback: number,
  maximumBytes: number,
): number =>
  Math.min(maximumBytes, boundedInteger(value, fallback, 1, 64) * 1024 * 1024);

const requireDirectNetworkPath = (
  settings: PowerShellRemotingSettings,
): void => {
  if (settings.networkPath.mode !== "direct") {
    throw new Error(
      "Live PowerShell sessions currently require a direct Network Path. Connection paths remain fail-closed.",
    );
  }
};

/** Build the strict, secret-bearing invoke payload without retaining it. */
export function buildPowerShellSessionOptions(
  connection: Connection,
  settings: PowerShellRemotingSettings,
): PowerShellSessionOptions {
  requireDirectNetworkPath(settings);
  if (settings.transport === "wsman") {
    if (settings.wsman.proxy.mode !== "none") {
      throw new Error(
        "Explicit WSMan proxies are not materialized by the live-session adapter. Select a direct endpoint.",
      );
    }
    if (
      settings.wsman.authMethod !== "basic" &&
      settings.wsman.authMethod !== "ntlm"
    ) {
      throw new Error(
        `${settings.wsman.authMethod} authentication is not supported by the live WSMan adapter. Select Basic over HTTPS or NTLM explicitly.`,
      );
    }
    if (
      settings.wsman.tls.skipHostnameCheck ||
      settings.wsman.tls.skipRevocationCheck
    ) {
      throw new Error(
        "WSMan TLS verification bypasses are blocked. Use the Trust Center without skip flags.",
      );
    }
    if (settings.wsman.tls.trustMode === "alwaysTrust") {
      throw new Error(
        "Always-trust TLS is blocked for live WSMan sessions. Use the Trust Center.",
      );
    }
    if (settings.wsman.tls.trustMode === "pinned") {
      throw new Error(
        "Inline WSMan certificate pins are not materialized. Register the endpoint identity in the Trust Center first.",
      );
    }
    if (settings.wsman.tls.clientCertificateRef) {
      throw new Error(
        "Certificate authentication is not supported by the live WSMan adapter.",
      );
    }
    const endpoint = canonicalPowerShellEndpoint(settings, connection.hostname);
    const endpointScheme = new URL(endpoint).protocol.replace(/:$/, "");
    if (settings.wsman.authMethod === "basic" && endpointScheme !== "https") {
      throw new Error(
        "Basic authentication is blocked unless the canonical WSMan endpoint uses HTTPS.",
      );
    }
    const username =
      settings.credential.username.trim() || connection.username?.trim() || "";
    if (!username) throw new Error("A PowerShell WSMan username is required.");
    if (connection.password === undefined || connection.password === null) {
      throw new Error(
        "A resolved password is required for PowerShell WSMan authentication.",
      );
    }
    return {
      transport: "wsman",
      options: {
        endpoint,
        username,
        password: connection.password,
        domain: settings.credential.domain?.trim() || null,
        authentication: settings.wsman.authMethod,
        tlsTrust: "trust_center",
        networkPath: "direct",
        connectionId: connection.id,
        configurationName:
          settings.wsman.configurationName.trim() || "Microsoft.PowerShell",
        culture: "en-US",
        connectTimeoutMs: secondsToMs(settings.session.connectTimeoutSec, 30),
        requestTimeoutMs: secondsToMs(
          settings.session.operationTimeoutSec,
          180,
        ),
        idleTimeoutSec: boundedInteger(
          settings.session.idleTimeoutSec,
          7_200,
          1,
          604_800,
        ),
        maxEnvelopeBytes: megabytesToBytes(
          settings.session.maxReceivedObjectSizeMb,
          1,
          8 * 1024 * 1024,
        ),
        maxResponseBytes: megabytesToBytes(
          settings.session.maxReceivedDataSizeMb,
          8,
          64 * 1024 * 1024,
        ),
        maxAuthRounds: 3,
        maxEmptyReceives: 32,
        eventCapacity: 2_048,
        commandQueueCapacity: 64,
        queueWaitTimeoutMs: 2_000,
      },
    };
  }

  if (settings.transport !== "ssh") {
    throw new Error(
      "The selected PowerShell transport is unavailable in the live session viewer.",
    );
  }

  const username =
    settings.credential.username.trim() || connection.username?.trim() || "";
  if (!username) throw new Error("A PowerShell SSH username is required.");

  let auth: PowerShellSshSessionDetails["auth"];
  if (settings.ssh.authMethod === "password") {
    if (!connection.password) {
      throw new Error(
        "A saved or prompted password is required for PowerShell SSH authentication.",
      );
    }
    auth = { type: "password", password: connection.password };
  } else if (settings.ssh.authMethod === "privateKey") {
    const path = settings.ssh.privateKeyPath?.trim() || connection.privateKey;
    if (!path) {
      throw new Error("A private-key path is required for PowerShell SSH.");
    }
    auth = {
      type: "private_key",
      path,
      passphrase: connection.passphrase || null,
    };
  } else {
    throw new Error(
      "SSH agent authentication is not available in the strict PowerShell adapter yet.",
    );
  }

  let hostKeyPolicy: PowerShellSshSessionDetails["hostKeyPolicy"];
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
    transport: "ssh",
    options: {
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
    },
  };
}

/** Compatibility alias for callers compiled against the SSH-only milestone. */
export const buildPowerShellSshSessionOptions = buildPowerShellSessionOptions;

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
