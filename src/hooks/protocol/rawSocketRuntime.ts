import type { Channel } from "@tauri-apps/api/core";
import type {
  RawSocketSettingsV1,
  RawSocketTransport,
} from "../../types/protocols/rawSocket";

export type RawSocketStatus =
  | "connected"
  | "write_closed"
  | "closing"
  | "disconnected"
  | "failed";

export type RawSocketDirection = "inbound" | "outbound";

export interface RawSocketStats {
  bytesSent: number;
  bytesReceived: number;
  framesSent: number;
  framesReceived: number;
  datagramsSent: number;
  datagramsReceived: number;
  deliveryFailures: number;
  replayEvictions: number;
  connectedAtMs: number;
  lastActivityAtMs: number;
  disconnectedAtMs?: number | null;
}

export interface RawSocketBackendSession {
  id: string;
  connectionId?: string | null;
  host: string;
  port: number;
  transport: RawSocketTransport;
  status: RawSocketStatus;
  localAddress: string;
  remoteAddress: string;
  stats: RawSocketStats;
  terminalReason?: unknown;
}

export interface RawSocketBackendFrame {
  sequence: number;
  timestampMs: number;
  direction: RawSocketDirection;
  datagram: boolean;
  data: number[] | Uint8Array;
}

export interface RawSocketReplay {
  sessionId: string;
  frames: RawSocketBackendFrame[];
  evictedFrames: number;
}

export interface RawSocketFrameMetadata {
  sessionId: string;
  sequence: number;
  timestampMs: number;
  direction: RawSocketDirection;
  datagram: boolean;
  byteLength: number;
  replayed: boolean;
}

export type RawSocketEvent =
  | { type: "connected"; session: RawSocketBackendSession }
  | { type: "data"; frame: RawSocketFrameMetadata }
  | { type: "write_closed"; sessionId: string }
  | { type: "replay_started"; sessionId: string; frameCount: number }
  | { type: "replay_completed"; sessionId: string; frameCount: number }
  | { type: "detached"; sessionId: string }
  | {
      type: "disconnected";
      session: RawSocketBackendSession;
      reason: unknown;
    };

export interface RawSocketDeliveredFrame extends RawSocketFrameMetadata {
  data: Uint8Array;
}

const asBytes = (value: ArrayBuffer | Uint8Array | number[]): Uint8Array => {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return Uint8Array.from(value);
};

/**
 * Tauri raw response bodies and typed metadata travel over separate channels.
 * This bounded FIFO pairs them without decoding or coalescing chunks, thereby
 * preserving TCP receive chunks and UDP datagram boundaries exactly.
 */
export class RawSocketChannelAssembler {
  private readonly dataQueue: Uint8Array[] = [];
  private readonly metadataQueue: RawSocketFrameMetadata[] = [];

  constructor(
    private readonly deliver: (frame: RawSocketDeliveredFrame) => void,
    private readonly maxPending = 128,
  ) {}

  acceptData(value: ArrayBuffer | Uint8Array | number[]): void {
    this.dataQueue.push(asBytes(value));
    this.trim(this.dataQueue);
    this.flush();
  }

  acceptMetadata(metadata: RawSocketFrameMetadata): void {
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

/** Monotonic replay cursor used to deduplicate attach results and channels. */
export class RawSocketSequenceCursor {
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

export interface RawSocketConnectOptions {
  host: string;
  port: number;
  transport: RawSocketTransport;
  connectionId: string;
  route: { kind: "direct" | "tls" | "start_tls" };
  addressFamily: RawSocketSettingsV1["connection"]["addressFamily"];
  localBindAddress: string | null;
  localBindPort: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  idleTimeoutMs: number;
  tcpNoDelay: boolean;
  tcpKeepaliveMs: number | null;
  limits: {
    commandQueueCapacity: number;
    queueWaitTimeoutMs: number;
    replayFrames: number;
    replayBytes: number;
    readChunkBytes: number;
    maxSendBytes: number;
  };
}

export function buildRawSocketConnectOptions(
  connectionId: string,
  host: string,
  port: number,
  settings: RawSocketSettingsV1,
): RawSocketConnectOptions {
  const route =
    settings.tls.mode === "direct"
      ? ({ kind: "tls" } as const)
      : settings.tls.mode === "starttls_manual"
        ? ({ kind: "start_tls" } as const)
        : ({ kind: "direct" } as const);
  return {
    host,
    port,
    transport: settings.connection.transport,
    connectionId,
    route,
    addressFamily: settings.connection.addressFamily,
    localBindAddress: settings.connection.localBindAddress.trim() || null,
    localBindPort: settings.connection.localBindPort,
    connectTimeoutMs: settings.advanced.connectTimeoutMs,
    writeTimeoutMs: settings.advanced.writeTimeoutMs,
    idleTimeoutMs: settings.advanced.idleTimeoutMs,
    tcpNoDelay: settings.advanced.tcpNoDelay,
    tcpKeepaliveMs: settings.advanced.tcpKeepaliveMs,
    limits: {
      commandQueueCapacity: settings.advanced.commandQueueCapacity,
      queueWaitTimeoutMs: settings.advanced.queueWaitTimeoutMs,
      replayFrames: settings.advanced.replayFrames,
      replayBytes: settings.advanced.replayBytes,
      readChunkBytes: settings.advanced.readChunkBytes,
      maxSendBytes: settings.advanced.maxSendBytes,
    },
  };
}

export interface RawSocketChannels {
  dataChannel: Channel<ArrayBuffer>;
  eventChannel: Channel<RawSocketEvent>;
}
