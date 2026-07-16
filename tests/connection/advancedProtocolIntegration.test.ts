import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { POWERSHELL_REMOTING_SCHEMA_VERSION } from "../../src/types/powershellRemoting";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { getDefaultPort } from "../../src/utils/discovery/defaultPorts";
import { getProtocolDefaultIconKey } from "../../src/utils/icons/resolveConnectionIcon";

const connection = (
  overrides: Partial<Connection> & { protocol?: string } = {},
) =>
  ({
    id: "connection-id",
    name: "Advanced protocol",
    protocol: "ssh",
    hostname: "host.example.test",
    port: 22,
    isGroup: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  }) as Connection;

describe("advanced protocol connection integration", () => {
  it("canonicalizes legacy Raw TCP and UDP aliases idempotently", () => {
    const tcp = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "raw-tcp" as Connection["protocol"],
        username: "must-not-persist",
        password: "must-not-persist",
        rawSocketSettings: {
          transport: "tcp",
          connectTimeoutMs: 50,
        } as never,
      }),
    );
    const udp = normalizeAdvancedProtocolConnection(
      connection({ protocol: "raw_udp" as Connection["protocol"] }),
    );

    expect(tcp).toMatchObject({
      protocol: "raw",
      rawSocketSettings: {
        version: 1,
        connection: { transport: "tcp" },
      },
    });
    expect(tcp.username).toBeUndefined();
    expect(tcp.password).toBeUndefined();
    expect(udp).toMatchObject({
      protocol: "raw",
      rawSocketSettings: { connection: { transport: "udp" } },
    });
    expect(normalizeAdvancedProtocolConnection(tcp)).toEqual(tcp);
  });

  it("migrates the legacy RLogin username without retaining credentials", () => {
    const normalized = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "rlogin",
        port: 513,
        username: "remote-user",
        password: "not-an-rlogin-handshake-field",
      }),
    );

    expect(normalized.rloginSettings).toMatchObject({
      version: 1,
      remoteUsername: "remote-user",
      sourcePortMode: "ephemeral",
      plaintextAcknowledgement: { acknowledged: false },
    });
    expect(normalized.username).toBeUndefined();
    expect(normalized.password).toBeUndefined();
    expect(normalizeAdvancedProtocolConnection(normalized)).toEqual(normalized);

    const invalidV3Fallback = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "ard",
        username: "stale-username",
        password: "stale-password",
        ardSettings: {
          version: 3,
          authMode: "appleAccountNative",
          crossPlatformFallback: {
            enabled: true,
            authMode: "appleAccountNative",
          },
        } as never,
      }),
    );
    expect(invalidV3Fallback.ardSettings?.crossPlatformFallback.enabled).toBe(
      false,
    );
    expect(invalidV3Fallback.username).toBeUndefined();
    expect(invalidV3Fallback.password).toBeUndefined();
  });

  it("migrates ARD v2 settings without persisting Apple Account credentials", () => {
    const normalized = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "ard",
        port: 5900,
        username: "apple-account@example.test",
        password: "must-not-be-an-embedded-ard-secret",
        ardSettings: {
          version: 2,
          authMode: "appleAccountNative",
          appleAccountIdentifier: " \u0000owner\n@example.test\u007f ",
          crossPlatformFallback: {
            enabled: true,
            authMode: "macOsAccount",
          },
          autoReconnect: true,
          curtainOnConnect: false,
          localCursor: true,
          viewOnly: false,
        } as never,
      }),
    );

    expect(normalized.ardSettings).toMatchObject({
      version: 3,
      authMode: "appleAccountNative",
      appleAccountIdentifier: "owner@example.test",
      crossPlatformFallback: {
        enabled: false,
        authMode: "macOsAccount",
      },
      autoReconnect: true,
    });
    expect(normalized.username).toBeUndefined();
    expect(normalized.password).toBeUndefined();
    expect(normalizeAdvancedProtocolConnection(normalized)).toEqual(normalized);
  });

  it("preserves only explicitly enabled cross-platform fallback credentials", () => {
    const remoteMacFallback = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "ard",
        port: 5900,
        username: "portable-operator",
        password: "remote-mac-password",
        ardSettings: {
          version: 3,
          authMode: "appleAccountNative",
          appleAccountIdentifier: "owner@example.test",
          crossPlatformFallback: {
            enabled: true,
            authMode: "macOsAccount",
          },
          autoReconnect: true,
          curtainOnConnect: false,
          localCursor: true,
          viewOnly: false,
        },
      }),
    );

    expect(remoteMacFallback.username).toBe("portable-operator");
    expect(remoteMacFallback.password).toBe("remote-mac-password");
    expect(normalizeAdvancedProtocolConnection(remoteMacFallback)).toEqual(
      remoteMacFallback,
    );

    const vncFallback = normalizeAdvancedProtocolConnection(
      connection({
        ...remoteMacFallback,
        username: "must-not-survive-vnc-mode",
        password: "dedicated-vnc-password",
        ardSettings: {
          ...remoteMacFallback.ardSettings!,
          crossPlatformFallback: {
            enabled: true,
            authMode: "vncPassword",
          },
        },
      }),
    );
    expect(vncFallback.username).toBeUndefined();
    expect(vncFallback.password).toBe("dedicated-vnc-password");
  });

  it("migrates WinRM-shaped settings into versioned PowerShell Remoting settings", () => {
    const normalized = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "winrm",
        port: 5985,
        username: "Administrator",
        domain: "CONTOSO",
        winrmSettings: {
          preferSsl: true,
          httpsPort: 7443,
          authMethod: "negotiate",
        },
      }),
    );

    expect(normalized.protocol).toBe("winrm");
    expect(normalized.winrmSettings?.httpsPort).toBe(7443);
    expect(normalized.powerShellRemoting).toMatchObject({
      schemaVersion: POWERSHELL_REMOTING_SCHEMA_VERSION,
      transport: "wsman",
      credential: { username: "Administrator", domain: "CONTOSO" },
      wsman: { scheme: "https", port: 7443 },
    });
    expect(normalizeAdvancedProtocolConnection(normalized)).toEqual(normalized);
  });

  it("does not initialize protocol settings on folders", () => {
    const normalized = normalizeAdvancedProtocolConnection(
      connection({ protocol: "rlogin", isGroup: true }),
    );
    expect(normalized.rloginSettings).toBeUndefined();
  });

  it("canonicalizes the legacy postgres alias for saved query sessions", () => {
    const normalized = normalizeAdvancedProtocolConnection(
      connection({
        protocol: "postgres" as Connection["protocol"],
        port: 5432,
        database: "inventory",
      }),
    );

    expect(normalized).toMatchObject({
      protocol: "postgresql",
      port: 5432,
      database: "inventory",
    });
    expect(normalizeAdvancedProtocolConnection(normalized)).toEqual(normalized);
  });

  it("publishes stable picker defaults for all advanced protocol families", () => {
    expect(getDefaultPort("raw")).toBe(23);
    expect(getDefaultPort("rlogin")).toBe(513);
    expect(getDefaultPort("winrm")).toBe(5985);
    expect(getDefaultPort("ard")).toBe(5900);
    expect(getDefaultPort("postgresql")).toBe(5432);
    expect(getDefaultPort("spice")).toBe(5900);
    expect(getDefaultPort("xdmcp")).toBe(177);
    expect(getDefaultPort("x2go")).toBe(22);
    expect(getDefaultPort("nx")).toBe(4000);
    expect(getProtocolDefaultIconKey("raw")).toBe("cable");
    expect(getProtocolDefaultIconKey("rlogin")).toBe("phone");
    expect(getProtocolDefaultIconKey("winrm")).toBe("server");
    expect(getProtocolDefaultIconKey("ard")).toBe("eye");
    expect(getProtocolDefaultIconKey("postgresql")).toBe("database");
    expect(getProtocolDefaultIconKey("spice")).toBe("monitor");
    expect(getProtocolDefaultIconKey("xdmcp")).toBe("monitor");
    expect(getProtocolDefaultIconKey("x2go")).toBe("monitor");
    expect(getProtocolDefaultIconKey("nx")).toBe("monitor");
  });

  it("initializes native display handoffs with only supported safe defaults", () => {
    expect(
      normalizeAdvancedProtocolConnection(
        connection({
          protocol: "spice",
          port: 0,
          spiceRequireTls: true,
          spiceAllowSelfSigned: true,
          spiceShareClipboard: false,
        }),
      ),
    ).toMatchObject({
      port: 5900,
      spiceRequireTls: true,
      spiceTlsPort: 5901,
      spiceAllowSelfSigned: false,
      spiceShareClipboard: true,
    });
    expect(
      normalizeAdvancedProtocolConnection(
        connection({
          protocol: "xdmcp",
          port: 0,
          xdmcpColorDepth: 8,
          password: "must-be-cleared",
        }),
      ),
    ).toMatchObject({
      port: 177,
      xdmcpColorDepth: 24,
      xdmcpAcknowledgeInsecureTransport: false,
    });
    expect(
      normalizeAdvancedProtocolConnection(
        connection({ protocol: "x2go", port: 0, password: "must-be-cleared" }),
      ),
    ).toMatchObject({ port: 22, x2goSessionType: "Xfce" });
    expect(
      normalizeAdvancedProtocolConnection(
        connection({ protocol: "nx", port: 0, password: "must-be-cleared" }),
      ),
    ).toMatchObject({
      port: 4000,
      nxConnectionService: "nx",
      nxClipboardEnabled: true,
    });
  });
});
