export const RAW_SOCKET_SETTINGS_VERSION = 1 as const;

export const RAW_SOCKET_PROTOCOL_ALIASES = [
  "raw",
  "raw-tcp",
  "raw_tcp",
  "raw-udp",
  "raw_udp",
] as const;

export type RawSocketProtocolAlias =
  (typeof RAW_SOCKET_PROTOCOL_ALIASES)[number];
export type RawSocketTransport = "tcp" | "udp";
export type RawSocketAddressFamily =
  | "any"
  | "prefer_ipv4"
  | "prefer_ipv6"
  | "ipv4_only"
  | "ipv6_only";
export type RawSocketPayloadEncoding = "text" | "hex" | "base64";
export type RawSocketLineEnding = "none" | "lf" | "crlf";
export type RawSocketTlsMode = "disabled" | "direct" | "starttls_manual";
export type RawSocketTrustPolicy = "system" | "tofu" | "always_trust";
export type RawSocketNetworkRouteKind =
  | "direct"
  | "http_connect"
  | "socks4"
  | "socks5"
  | "ssh_jump"
  | "unknown";

export interface RawSocketNoFraming {
  mode: "none";
}

export interface RawSocketDelimiterFraming {
  mode: "delimiter";
  delimiterHex: string;
  includeDelimiter: boolean;
  maxFrameBytes: number;
}

export interface RawSocketFixedLengthFraming {
  mode: "fixed_length";
  frameBytes: number;
}

export interface RawSocketLengthPrefixFraming {
  mode: "length_prefix";
  prefixBytes: 1 | 2 | 4;
  endian: "big" | "little";
  lengthIncludesPrefix: boolean;
  includePrefix: boolean;
  maxFrameBytes: number;
}

export type RawSocketTcpFraming =
  | RawSocketNoFraming
  | RawSocketDelimiterFraming
  | RawSocketFixedLengthFraming
  | RawSocketLengthPrefixFraming;

export interface RawSocketSettingsV1 {
  version: typeof RAW_SOCKET_SETTINGS_VERSION;
  connection: {
    transport: RawSocketTransport;
    addressFamily: RawSocketAddressFamily;
    localBindAddress: string;
    localBindPort: number;
  };
  data: {
    inputEncoding: RawSocketPayloadEncoding;
    displayEncoding: RawSocketPayloadEncoding;
    lineEnding: RawSocketLineEnding;
    tcpFraming: RawSocketTcpFraming;
  };
  tls: {
    mode: RawSocketTlsMode;
    serverName: string;
    trustPolicy: RawSocketTrustPolicy;
  };
  advanced: {
    connectTimeoutMs: number;
    writeTimeoutMs: number;
    idleTimeoutMs: number;
    tcpNoDelay: boolean;
    tcpKeepaliveMs: number | null;
    commandQueueCapacity: number;
    queueWaitTimeoutMs: number;
    replayFrames: number;
    replayBytes: number;
    readChunkBytes: number;
    maxSendBytes: number;
  };
}

export interface RawSocketProtocolMigration {
  protocol: "raw";
  settings: RawSocketSettingsV1;
  sourceProtocol: RawSocketProtocolAlias;
  migrated: boolean;
}

export interface RawSocketCapability {
  compatible: boolean;
  runtimeSupported: boolean;
  message: string;
}

export const RAW_SOCKET_LIMITS = {
  timeoutMs: { min: 1, max: 86_400_000 },
  localBindPort: { min: 0, max: 65_535 },
  commandQueueCapacity: { min: 1, max: 256 },
  queueWaitTimeoutMs: { min: 1, max: 60_000 },
  replayFrames: { min: 0, max: 4_096 },
  replayBytes: { min: 0, max: 8 * 1024 * 1024 },
  readChunkBytes: { min: 1, max: 64 * 1024 },
  tcpSendBytes: { min: 1, max: 1024 * 1024 },
  udpDatagramBytes: { min: 1, max: 65_507 },
  frameBytes: { min: 1, max: 1024 * 1024 },
  delimiterBytes: { min: 1, max: 64 },
} as const;

const DEFAULT_TCP_FRAMING: RawSocketNoFraming = { mode: "none" };

export function createDefaultRawSocketSettings(
  transport: RawSocketTransport = "tcp",
): RawSocketSettingsV1 {
  return {
    version: RAW_SOCKET_SETTINGS_VERSION,
    connection: {
      transport,
      addressFamily: "any",
      localBindAddress: "",
      localBindPort: 0,
    },
    data: {
      inputEncoding: "text",
      displayEncoding: "text",
      lineEnding: "none",
      tcpFraming: { ...DEFAULT_TCP_FRAMING },
    },
    tls: {
      mode: "disabled",
      serverName: "",
      trustPolicy: "system",
    },
    advanced: {
      connectTimeoutMs: 10_000,
      writeTimeoutMs: 10_000,
      idleTimeoutMs: 5 * 60_000,
      tcpNoDelay: transport === "tcp",
      tcpKeepaliveMs: transport === "tcp" ? 60_000 : null,
      commandQueueCapacity: 64,
      queueWaitTimeoutMs: 2_000,
      replayFrames: 512,
      replayBytes: 2 * 1024 * 1024,
      readChunkBytes: 16 * 1024,
      maxSendBytes: 65_507,
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;

const boundedInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const boundedString = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeDelimiterHex = (value: unknown): string => {
  if (typeof value !== "string") return "0a";
  const compact = value.replace(/[\s:_-]/g, "").toLowerCase();
  if (
    compact.length < RAW_SOCKET_LIMITS.delimiterBytes.min * 2 ||
    compact.length > RAW_SOCKET_LIMITS.delimiterBytes.max * 2 ||
    compact.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(compact)
  ) {
    return "0a";
  }
  return compact;
};

function normalizeFraming(
  input: unknown,
  transport: RawSocketTransport,
): RawSocketTcpFraming {
  if (transport === "udp") return { mode: "none" };
  const framing = asRecord(input);
  const mode = enumValue(
    framing.mode,
    ["none", "delimiter", "fixed_length", "length_prefix"] as const,
    "none",
  );
  switch (mode) {
    case "delimiter":
      return {
        mode,
        delimiterHex: normalizeDelimiterHex(framing.delimiterHex),
        includeDelimiter: booleanValue(framing.includeDelimiter, false),
        maxFrameBytes: boundedInteger(
          framing.maxFrameBytes,
          64 * 1024,
          RAW_SOCKET_LIMITS.frameBytes.min,
          RAW_SOCKET_LIMITS.frameBytes.max,
        ),
      };
    case "fixed_length":
      return {
        mode,
        frameBytes: boundedInteger(
          framing.frameBytes,
          1,
          RAW_SOCKET_LIMITS.frameBytes.min,
          RAW_SOCKET_LIMITS.frameBytes.max,
        ),
      };
    case "length_prefix": {
      const prefix = boundedInteger(framing.prefixBytes, 2, 1, 4);
      return {
        mode,
        prefixBytes: prefix === 1 || prefix === 4 ? prefix : 2,
        endian: enumValue(framing.endian, ["big", "little"] as const, "big"),
        lengthIncludesPrefix: booleanValue(framing.lengthIncludesPrefix, false),
        includePrefix: booleanValue(framing.includePrefix, false),
        maxFrameBytes: boundedInteger(
          framing.maxFrameBytes,
          64 * 1024,
          RAW_SOCKET_LIMITS.frameBytes.min,
          RAW_SOCKET_LIMITS.frameBytes.max,
        ),
      };
    }
    default:
      return { mode: "none" };
  }
}

const normalizeTlsMode = (value: unknown): RawSocketTlsMode => {
  if (value === "direct" || value === "tls" || value === "implicit") {
    return "direct";
  }
  if (
    value === "starttls_manual" ||
    value === "manual_starttls" ||
    value === "starttls"
  ) {
    return "starttls_manual";
  }
  return "disabled";
};

export function normalizeRawSocketSettings(
  input: unknown,
  forcedTransport?: RawSocketTransport,
): RawSocketSettingsV1 {
  const root = asRecord(input);
  const connection = asRecord(root.connection);
  const data = asRecord(root.data);
  const tls = asRecord(root.tls);
  const advanced = asRecord(root.advanced);
  const inferredTransport = enumValue(
    connection.transport ?? root.transport ?? root.protocol,
    ["tcp", "udp"] as const,
    "tcp",
  );
  const transport = forcedTransport ?? inferredTransport;
  const defaults = createDefaultRawSocketSettings(transport);
  const timeout = RAW_SOCKET_LIMITS.timeoutMs;
  const maxSend =
    transport === "udp"
      ? RAW_SOCKET_LIMITS.udpDatagramBytes
      : RAW_SOCKET_LIMITS.tcpSendBytes;
  const requestedTlsMode = normalizeTlsMode(tls.mode ?? root.tlsMode);

  return {
    version: RAW_SOCKET_SETTINGS_VERSION,
    connection: {
      transport,
      addressFamily: enumValue(
        connection.addressFamily ?? root.addressFamily,
        [
          "any",
          "prefer_ipv4",
          "prefer_ipv6",
          "ipv4_only",
          "ipv6_only",
        ] as const,
        defaults.connection.addressFamily,
      ),
      localBindAddress: boundedString(
        connection.localBindAddress ?? root.localBindAddress,
        64,
      ),
      localBindPort: boundedInteger(
        connection.localBindPort ?? root.localBindPort,
        defaults.connection.localBindPort,
        RAW_SOCKET_LIMITS.localBindPort.min,
        RAW_SOCKET_LIMITS.localBindPort.max,
      ),
    },
    data: {
      inputEncoding: enumValue(
        data.inputEncoding ?? root.inputEncoding,
        ["text", "hex", "base64"] as const,
        defaults.data.inputEncoding,
      ),
      displayEncoding: enumValue(
        data.displayEncoding ?? root.displayEncoding,
        ["text", "hex", "base64"] as const,
        defaults.data.displayEncoding,
      ),
      lineEnding: enumValue(
        data.lineEnding ?? root.lineEnding,
        ["none", "lf", "crlf"] as const,
        defaults.data.lineEnding,
      ),
      tcpFraming: normalizeFraming(
        data.tcpFraming ?? root.tcpFraming,
        transport,
      ),
    },
    tls: {
      mode: transport === "tcp" ? requestedTlsMode : "disabled",
      serverName: boundedString(tls.serverName ?? root.tlsServerName, 253),
      trustPolicy: enumValue(
        tls.trustPolicy ?? root.trustPolicy,
        ["system", "tofu", "always_trust"] as const,
        defaults.tls.trustPolicy,
      ),
    },
    advanced: {
      connectTimeoutMs: boundedInteger(
        advanced.connectTimeoutMs ?? root.connectTimeoutMs,
        defaults.advanced.connectTimeoutMs,
        timeout.min,
        timeout.max,
      ),
      writeTimeoutMs: boundedInteger(
        advanced.writeTimeoutMs ?? root.writeTimeoutMs,
        defaults.advanced.writeTimeoutMs,
        timeout.min,
        timeout.max,
      ),
      idleTimeoutMs: boundedInteger(
        advanced.idleTimeoutMs ?? root.idleTimeoutMs,
        defaults.advanced.idleTimeoutMs,
        timeout.min,
        timeout.max,
      ),
      tcpNoDelay:
        transport === "tcp"
          ? booleanValue(
              advanced.tcpNoDelay ?? root.tcpNoDelay,
              defaults.advanced.tcpNoDelay,
            )
          : false,
      tcpKeepaliveMs:
        transport === "tcp" &&
        (advanced.tcpKeepaliveMs ?? root.tcpKeepaliveMs) !== null
          ? boundedInteger(
              advanced.tcpKeepaliveMs ?? root.tcpKeepaliveMs,
              defaults.advanced.tcpKeepaliveMs ?? 60_000,
              timeout.min,
              timeout.max,
            )
          : null,
      commandQueueCapacity: boundedInteger(
        advanced.commandQueueCapacity ?? root.commandQueueCapacity,
        defaults.advanced.commandQueueCapacity,
        RAW_SOCKET_LIMITS.commandQueueCapacity.min,
        RAW_SOCKET_LIMITS.commandQueueCapacity.max,
      ),
      queueWaitTimeoutMs: boundedInteger(
        advanced.queueWaitTimeoutMs ?? root.queueWaitTimeoutMs,
        defaults.advanced.queueWaitTimeoutMs,
        RAW_SOCKET_LIMITS.queueWaitTimeoutMs.min,
        RAW_SOCKET_LIMITS.queueWaitTimeoutMs.max,
      ),
      replayFrames: boundedInteger(
        advanced.replayFrames ?? root.replayFrames,
        defaults.advanced.replayFrames,
        RAW_SOCKET_LIMITS.replayFrames.min,
        RAW_SOCKET_LIMITS.replayFrames.max,
      ),
      replayBytes: boundedInteger(
        advanced.replayBytes ?? root.replayBytes,
        defaults.advanced.replayBytes,
        RAW_SOCKET_LIMITS.replayBytes.min,
        RAW_SOCKET_LIMITS.replayBytes.max,
      ),
      readChunkBytes: boundedInteger(
        advanced.readChunkBytes ?? root.readChunkBytes,
        defaults.advanced.readChunkBytes,
        RAW_SOCKET_LIMITS.readChunkBytes.min,
        RAW_SOCKET_LIMITS.readChunkBytes.max,
      ),
      maxSendBytes: boundedInteger(
        advanced.maxSendBytes ?? root.maxSendBytes,
        defaults.advanced.maxSendBytes,
        maxSend.min,
        maxSend.max,
      ),
    },
  };
}

export function withRawSocketTransport(
  settings: RawSocketSettingsV1,
  transport: RawSocketTransport,
): RawSocketSettingsV1 {
  const normalized = normalizeRawSocketSettings(settings, transport);
  if (settings.connection.transport === "udp" && transport === "tcp") {
    normalized.advanced.tcpNoDelay = true;
    normalized.advanced.tcpKeepaliveMs = 60_000;
  }
  return normalized;
}

export function isRawSocketProtocolAlias(
  protocol: string,
): protocol is RawSocketProtocolAlias {
  return RAW_SOCKET_PROTOCOL_ALIASES.includes(
    protocol.trim().toLowerCase() as RawSocketProtocolAlias,
  );
}

export function migrateRawSocketProtocol(
  protocol: string,
  input: unknown,
): RawSocketProtocolMigration | null {
  const sourceProtocol = protocol.trim().toLowerCase();
  if (!isRawSocketProtocolAlias(sourceProtocol)) return null;
  const forcedTransport = sourceProtocol.includes("udp")
    ? "udp"
    : sourceProtocol.includes("tcp")
      ? "tcp"
      : undefined;
  return {
    protocol: "raw",
    settings: normalizeRawSocketSettings(input, forcedTransport),
    sourceProtocol,
    migrated: sourceProtocol !== "raw",
  };
}

export function getRawSocketRouteCapability(
  transport: RawSocketTransport,
  route: RawSocketNetworkRouteKind,
): RawSocketCapability {
  if (route === "direct") {
    return {
      compatible: true,
      runtimeSupported: true,
      message: `Direct ${transport.toUpperCase()} is supported by the native socket runtime.`,
    };
  }
  if (transport === "udp") {
    return {
      compatible: route === "socks5",
      runtimeSupported: false,
      message:
        route === "socks5"
          ? "SOCKS5 UDP Associate is not implemented yet; the connection fails closed instead of bypassing the proxy."
          : "This route cannot carry UDP datagrams in the current runtime. The connection fails closed instead of going direct.",
    };
  }
  return {
    compatible: route !== "unknown",
    runtimeSupported: false,
    message:
      "The current Raw TCP runtime supports direct routing only. Configured proxy and SSH-hop routes fail closed until their transport adapters are available.",
  };
}

export function getRawSocketTlsCapability(
  transport: RawSocketTransport,
  mode: RawSocketTlsMode,
): RawSocketCapability {
  if (mode === "disabled") {
    return {
      compatible: true,
      runtimeSupported: true,
      message: "Plain application payload transport is selected.",
    };
  }
  if (transport === "udp") {
    return {
      compatible: false,
      runtimeSupported: false,
      message:
        "TLS and STARTTLS are TCP-only. DTLS is not supported and is never silently substituted.",
    };
  }
  return {
    compatible: true,
    runtimeSupported: false,
    message:
      mode === "direct"
        ? "Direct TLS is configurable for TCP, but the current native socket runtime rejects the TLS route until its TLS adapter is enabled."
        : "Manual STARTTLS is TCP-only and intentionally user-triggered; the current native socket runtime rejects upgrade requests until its TLS adapter is enabled.",
  };
}
