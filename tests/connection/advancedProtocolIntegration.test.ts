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

  it("publishes stable picker defaults for all three protocol families", () => {
    expect(getDefaultPort("raw")).toBe(23);
    expect(getDefaultPort("rlogin")).toBe(513);
    expect(getDefaultPort("winrm")).toBe(5985);
    expect(getProtocolDefaultIconKey("raw")).toBe("cable");
    expect(getProtocolDefaultIconKey("rlogin")).toBe("phone");
    expect(getProtocolDefaultIconKey("winrm")).toBe("server");
  });
});
