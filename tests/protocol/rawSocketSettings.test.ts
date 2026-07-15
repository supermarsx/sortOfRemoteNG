import { describe, expect, it } from "vitest";
import {
  RAW_SOCKET_LIMITS,
  createDefaultRawSocketSettings,
  getRawSocketRouteCapability,
  getRawSocketTlsCapability,
  isRawSocketProtocolAlias,
  migrateRawSocketProtocol,
  normalizeRawSocketSettings,
  withRawSocketTransport,
} from "../../src/types/protocols/rawSocket";
import {
  RAW_SOCKET_EDITOR_SEARCH_FIELDS,
  RAW_SOCKET_EDITOR_SECTIONS,
} from "../../src/components/connectionEditor/rawSocket/searchMetadata";

describe("RawSocketSettingsV1", () => {
  it("creates fresh, bounded TCP and UDP defaults", () => {
    const first = createDefaultRawSocketSettings();
    const second = createDefaultRawSocketSettings();
    expect(first).not.toBe(second);
    expect(first.version).toBe(1);
    expect(first.connection.transport).toBe("tcp");
    expect(first.advanced.tcpNoDelay).toBe(true);
    expect(createDefaultRawSocketSettings("udp")).toMatchObject({
      connection: { transport: "udp" },
      tls: { mode: "disabled" },
      advanced: { tcpNoDelay: false, tcpKeepaliveMs: null },
    });
  });

  it("clamps malformed legacy input and normalizes delimiters", () => {
    const settings = normalizeRawSocketSettings({
      transport: "tcp",
      localBindPort: 999_999,
      data: {
        tcpFraming: {
          mode: "delimiter",
          delimiterHex: "not hex",
          maxFrameBytes: Number.POSITIVE_INFINITY,
        },
      },
      advanced: {
        commandQueueCapacity: -10,
        replayFrames: 999_999,
        replayBytes: -1,
        readChunkBytes: 999_999,
        maxSendBytes: 999_999_999,
      },
    });
    expect(settings.connection.localBindPort).toBe(65_535);
    expect(settings.data.tcpFraming).toEqual({
      mode: "delimiter",
      delimiterHex: "0a",
      includeDelimiter: false,
      maxFrameBytes: 65_536,
    });
    expect(settings.advanced).toMatchObject({
      commandQueueCapacity: RAW_SOCKET_LIMITS.commandQueueCapacity.min,
      replayFrames: RAW_SOCKET_LIMITS.replayFrames.max,
      replayBytes: RAW_SOCKET_LIMITS.replayBytes.min,
      readChunkBytes: RAW_SOCKET_LIMITS.readChunkBytes.max,
      maxSendBytes: RAW_SOCKET_LIMITS.tcpSendBytes.max,
    });
  });

  it("enforces UDP incompatibilities without preserving a misleading TLS mode", () => {
    const settings = normalizeRawSocketSettings(
      {
        connection: { transport: "udp" },
        tls: { mode: "dtls", serverName: "udp.example.test" },
        data: { tcpFraming: { mode: "fixed_length", frameBytes: 10 } },
        advanced: {
          tcpNoDelay: true,
          tcpKeepaliveMs: 100,
          maxSendBytes: 1_000_000,
        },
      },
      "udp",
    );
    expect(settings.tls.mode).toBe("disabled");
    expect(settings.data.tcpFraming).toEqual({ mode: "none" });
    expect(settings.advanced.tcpNoDelay).toBe(false);
    expect(settings.advanced.tcpKeepaliveMs).toBeNull();
    expect(settings.advanced.maxSendBytes).toBe(65_507);
  });

  it.each([
    ["raw-tcp", "tcp"],
    ["raw_tcp", "tcp"],
    ["raw-udp", "udp"],
    ["raw_udp", "udp"],
  ] as const)("migrates %s to canonical raw/%s", (alias, transport) => {
    const result = migrateRawSocketProtocol(alias, {
      connection: { transport: transport === "tcp" ? "udp" : "tcp" },
    });
    expect(result).toMatchObject({
      protocol: "raw",
      sourceProtocol: alias,
      migrated: true,
      settings: { connection: { transport } },
    });
  });

  it("retains raw's explicit transport but never claims Telnet or generic TCP/UDP", () => {
    expect(migrateRawSocketProtocol("raw", { transport: "udp" })).toMatchObject(
      {
        migrated: false,
        settings: { connection: { transport: "udp" } },
      },
    );
    for (const protocol of ["telnet", "tcp", "udp", "rlogin", "raw-ip"]) {
      expect(isRawSocketProtocolAlias(protocol)).toBe(false);
      expect(migrateRawSocketProtocol(protocol, {})).toBeNull();
    }
  });

  it("re-enables sensible TCP options when switching back from UDP", () => {
    const udp = createDefaultRawSocketSettings("udp");
    const tcp = withRawSocketTransport(udp, "tcp");
    expect(tcp.connection.transport).toBe("tcp");
    expect(tcp.advanced.tcpNoDelay).toBe(true);
    expect(tcp.advanced.tcpKeepaliveMs).toBe(60_000);
  });

  it("reports route and TLS capability boundaries without downgrade", () => {
    expect(getRawSocketRouteCapability("tcp", "direct")).toMatchObject({
      compatible: true,
      runtimeSupported: true,
    });
    expect(getRawSocketRouteCapability("udp", "socks5")).toMatchObject({
      compatible: true,
      runtimeSupported: false,
    });
    expect(getRawSocketRouteCapability("udp", "http_connect").message).toMatch(
      /fails closed/i,
    );
    expect(getRawSocketTlsCapability("udp", "direct")).toMatchObject({
      compatible: false,
      runtimeSupported: false,
    });
    expect(getRawSocketTlsCapability("udp", "direct").message).toMatch(/DTLS/i);
    expect(getRawSocketTlsCapability("tcp", "starttls_manual").message).toMatch(
      /user-triggered/i,
    );
  });

  it("exports stable, unique editor sections and exact search focus metadata", () => {
    expect(RAW_SOCKET_EDITOR_SECTIONS.map((section) => section.id)).toEqual([
      "connection",
      "data",
      "tls",
      "network-path",
      "advanced",
    ]);
    const ids = RAW_SOCKET_EDITOR_SEARCH_FIELDS.map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of RAW_SOCKET_EDITOR_SEARCH_FIELDS) {
      expect(field.focusId).toBeTruthy();
      expect(field.protocols).toContain("raw");
      expect(field.protocolSubtabId).toBeTruthy();
    }
  });
});
