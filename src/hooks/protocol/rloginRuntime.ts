import type { Channel } from "@tauri-apps/api/core";
import type { RloginSettings } from "../../types/connection/rloginSettings";
import {
  isRloginPlaintextAcknowledged,
  parseRloginEscapeCharacter,
} from "../../utils/rlogin/rloginSettings";

export type RloginLifecycle =
  | "connecting"
  | "connected"
  | "closing"
  | "closed"
  | "error";
export type RloginTerminalMode = "cooked" | "raw";

export interface RloginStats {
  handshakeBytesSent: number;
  terminalBytesSent: number;
  terminalBytesReceived: number;
  protocolBytesSent: number;
  resizeFramesSent: number;
  urgentControlsReceived: number;
  discardedOutputBytes: number;
}

export interface RloginCapabilities {
  directRoute: boolean;
  proxyRoutes: boolean;
  reservedSourcePort: boolean;
  outOfBandControl: boolean;
  limitationMessages: string[];
}

export const RLOGIN_RUNTIME_CAPABILITIES: RloginCapabilities = {
  directRoute: true,
  proxyRoutes: false,
  reservedSourcePort: false,
  outOfBandControl: false,
  limitationMessages: [
    "Only direct TCP routes are available in the current RLogin adapter.",
    "Reserved client ports 512-1023 are not allocated by the current adapter.",
    "TCP urgent/OOB control extraction is unavailable; ordinary stream bytes are never interpreted as urgent controls.",
  ],
};

export interface RloginBackendSession {
  id: string;
  connectionId?: string | null;
  host: string;
  port: number;
  localUsername: string;
  remoteUsername: string;
  terminalType: string;
  terminalSpeed: number;
  connected: boolean;
  lifecycle: RloginLifecycle;
  terminalMode: RloginTerminalMode;
  windowUpdatesEnabled: boolean;
  localAddress: string;
  remoteAddress: string;
  sourcePortFallback: boolean;
  capabilities: RloginCapabilities;
  stats: RloginStats;
  connectedAtMs: number;
  disconnectedAtMs?: number | null;
  terminalReason?: unknown;
}

export interface RloginOutputFrame {
  sequence: number;
  data: number[] | Uint8Array;
  prefixTruncated: boolean;
}

export interface RloginReplaySnapshot {
  frames: RloginOutputFrame[];
  firstAvailableSequence?: number | null;
  nextSequence: number;
  truncated: boolean;
}

export interface RloginOutputMetadata {
  sessionId: string;
  sequence: number;
  byteLength: number;
  prefixTruncated: boolean;
  replayed: boolean;
}

export interface RloginDeliveredOutput extends RloginOutputMetadata {
  data: Uint8Array;
}

export type RloginEvent =
  | { type: "connected"; session: RloginBackendSession }
  | { type: "output"; frame: RloginOutputMetadata }
  | {
      type: "replay_started";
      sessionId: string;
      frameCount: number;
      truncated: boolean;
    }
  | {
      type: "replay_completed";
      sessionId: string;
      nextSequence: number;
    }
  | {
      type: "lifecycle_changed";
      sessionId: string;
      lifecycle: RloginLifecycle;
    }
  | {
      type: "capability_notice";
      sessionId: string;
      capabilities: RloginCapabilities;
      sourcePortFallback: boolean;
    }
  | { type: "disconnected"; session: RloginBackendSession; reason: unknown };

const copyBytes = (value: ArrayBuffer | Uint8Array | number[]): Uint8Array => {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return Uint8Array.from(value);
};

/** Pairs the native raw-output channel with its independently typed metadata. */
export class RloginChannelAssembler {
  private readonly dataQueue: Uint8Array[] = [];
  private readonly metadataQueue: RloginOutputMetadata[] = [];

  constructor(
    private readonly deliver: (output: RloginDeliveredOutput) => void,
    private readonly maxPending = 128,
  ) {}

  acceptData(value: ArrayBuffer | Uint8Array | number[]): void {
    this.dataQueue.push(copyBytes(value));
    this.trim(this.dataQueue);
    this.flush();
  }

  acceptMetadata(metadata: RloginOutputMetadata): void {
    this.metadataQueue.push(metadata);
    this.trim(this.metadataQueue);
    this.flush();
  }

  clear(): void {
    this.dataQueue.length = 0;
    this.metadataQueue.length = 0;
  }

  private trim<T>(queue: T[]): void {
    while (queue.length > this.maxPending) queue.shift();
  }

  private flush(): void {
    while (this.dataQueue.length > 0 && this.metadataQueue.length > 0) {
      const data = this.dataQueue.shift()!;
      const metadata = this.metadataQueue.shift()!;
      this.deliver({ ...metadata, data });
    }
  }
}

export class RloginSequenceCursor {
  private sequence = 0;

  accept(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.sequence) {
      return false;
    }
    this.sequence = sequence;
    return true;
  }

  reset(sequence = 0): void {
    this.sequence = Math.max(0, Math.trunc(sequence));
  }

  get value(): number {
    return this.sequence;
  }
}

export interface RloginConnectOptions {
  host: string;
  port: number;
  localUsername: string;
  remoteUsername: string;
  terminalType: string;
  terminalSpeed: number;
  encoding: string;
  handshakeTimeoutMs: number;
  writeTimeoutMs: number;
  idleTimeoutMs: number;
  replayCapacityBytes: number;
  localFlowControl: boolean;
  escapeEnabled: boolean;
  escapeByte: number;
  initialWindow: {
    rows: number;
    columns: number;
    widthPixels: number;
    heightPixels: number;
  };
  connectionId: string;
  route: { kind: "direct" };
  addressFamily: "any";
  localBindAddress: null;
  sourcePortMode: RloginSettings["sourcePortMode"];
  reservedPortStart: number;
  reservedPortEnd: number;
  connectTimeoutMs: number;
  tcpNoDelay: boolean;
  tcpKeepaliveSeconds: number | null;
  plaintextAcknowledged: boolean;
}

export function buildRloginConnectOptions(
  connectionId: string,
  host: string,
  port: number,
  settings: RloginSettings,
): RloginConnectOptions {
  return {
    host,
    port,
    localUsername: settings.localUsername,
    remoteUsername: settings.remoteUsername,
    terminalType: settings.terminalType,
    terminalSpeed: settings.terminalSpeed,
    encoding: settings.encoding,
    handshakeTimeoutMs: settings.handshakeTimeoutMs,
    writeTimeoutMs: settings.writeTimeoutMs,
    idleTimeoutMs: settings.idleTimeoutMs,
    replayCapacityBytes: 1024 * 1024,
    localFlowControl: settings.localFlowControl,
    escapeEnabled: settings.escapeEnabled,
    escapeByte: parseRloginEscapeCharacter(settings.escapeCharacter) ?? 0x7e,
    initialWindow: {
      rows: settings.initialRows,
      columns: settings.initialColumns,
      widthPixels: 0,
      heightPixels: 0,
    },
    connectionId,
    route: { kind: "direct" },
    addressFamily: "any",
    localBindAddress: null,
    sourcePortMode: settings.sourcePortMode,
    reservedPortStart: settings.reservedPortStart,
    reservedPortEnd: settings.reservedPortEnd,
    connectTimeoutMs: settings.connectTimeoutMs,
    tcpNoDelay: settings.tcpNoDelay,
    tcpKeepaliveSeconds: settings.tcpKeepAlive
      ? settings.tcpKeepAliveSeconds
      : null,
    plaintextAcknowledged: isRloginPlaintextAcknowledged(settings),
  };
}

export interface RloginDiagnosis {
  compatible: boolean;
  requestedRoute: "direct" | string;
  sourcePortMode: RloginSettings["sourcePortMode"];
  capabilities: RloginCapabilities;
  blockers: string[];
  warnings: string[];
}

export interface RloginChannels {
  dataChannel: Channel<ArrayBuffer>;
  eventChannel: Channel<RloginEvent>;
}
