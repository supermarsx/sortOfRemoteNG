import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  createDefaultRawSocketSettings,
  RAW_SOCKET_SETTINGS_VERSION,
} from "../../src/types/protocols/rawSocket";
import { createDefaultPowerShellRemotingSettings } from "../../src/utils/powershell/normalizePowerShellRemoting";
import {
  acknowledgeRloginPlaintext,
  createDefaultRloginSettings,
} from "../../src/utils/rlogin/rloginSettings";
import {
  ADVANCED_PROTOCOL_PORTABILITY_VERSION,
  formatPortableProtocolLabel,
  mapPortableProtocol,
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForClone,
  prepareConnectionForExport,
  serializeConnectionsToNativeXml,
  serializeDatasetsToNativeCsv,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import {
  importFromCSV,
  importFromJSON,
  importFromMRemoteNG,
  importFromPuTTY,
  importFromXML,
} from "../../src/components/ImportExport/utils";

interface PortabilityFixtureConnection extends Connection {
  proxyConfig?: {
    type: string;
    host: string;
    proxyPassword?: string;
  };
  httpHeaders?: Record<string, string>;
  backendSessionId?: string;
  shellId?: string;
  terminalBuffer?: string;
  transcript?: string[];
  replay?: { frames: string[] };
}

const baseConnection = (
  patch: Partial<Connection> & Pick<Connection, "protocol">,
): Connection => ({
  id: `connection-${patch.protocol}`,
  name: `${patch.protocol} connection`,
  hostname: "example.internal",
  port: 23,
  isGroup: false,
  tags: ["portable"],
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:01:00.000Z",
  ...patch,
});

const advancedConnections = (): Connection[] => {
  const raw = createDefaultRawSocketSettings("udp");
  raw.connection.addressFamily = "ipv6_only";
  raw.connection.localBindAddress = "::1";
  raw.data.displayEncoding = "hex";
  raw.advanced.idleTimeoutMs = 42_000;

  const rlogin = acknowledgeRloginPlaintext(
    {
      ...createDefaultRloginSettings(),
      localUsername: "local-user",
      remoteUsername: "remote-user",
      terminalType: "vt220",
      encoding: "iso-8859-1",
      sourcePortMode: "auto",
    },
    new Date("2026-07-15T10:02:00.000Z"),
  );

  const powerShell = createDefaultPowerShellRemotingSettings();
  powerShell.transport = "ssh";
  powerShell.credential.source = "vault";
  powerShell.credential.username = "ps-user";
  powerShell.credential.vaultRef = {
    integrationId: "vault-1",
    secretId: "secret-1",
  };
  powerShell.ssh.port = 2222;
  powerShell.ssh.privateKeyCredentialRef = "key-ref";
  powerShell.session.idleTimeoutSec = 900;

  return [
    baseConnection({ protocol: "raw", port: 9000, rawSocketSettings: raw }),
    baseConnection({ protocol: "rlogin", port: 513, rloginSettings: rlogin }),
    baseConnection({
      protocol: "winrm",
      port: 5985,
      powerShellRemoting: powerShell,
    }),
  ];
};

describe("advanced protocol portability", () => {
  it("maps protocol names without guessing RLogin", () => {
    expect(mapPortableProtocol("RAW")).toEqual({
      protocol: "raw",
      rawTransport: "tcp",
    });
    expect(mapPortableProtocol("RAW/UDP")).toEqual({
      protocol: "raw",
      rawTransport: "udp",
    });
    expect(mapPortableProtocol("PowerShell Remoting")).toEqual({
      protocol: "winrm",
    });
    expect(mapPortableProtocol("RLogin")).toEqual({ protocol: "rlogin" });
    expect(mapPortableProtocol("remote-login-shell").protocol).not.toBe(
      "rlogin",
    );
  });

  it("uses precise user-facing labels", () => {
    const [rawUdp, rlogin, powerShell] = advancedConnections();
    expect(formatPortableProtocolLabel(rawUdp)).toBe("RAW/UDP");
    expect(formatPortableProtocolLabel(rlogin)).toBe("RLogin");
    expect(formatPortableProtocolLabel(powerShell)).toBe("PowerShell Remoting");
    expect(
      formatPortableProtocolLabel({
        protocol: "raw",
        rawSocketSettings: createDefaultRawSocketSettings("tcp"),
      }),
    ).toBe("RAW/TCP");
  });

  it.each(["json", "xml", "csv"] as const)(
    "round-trips every non-secret versioned setting through native %s",
    async (format) => {
      const source = advancedConnections();
      let imported: Connection[];
      if (format === "json") {
        imported = await importFromJSON(
          JSON.stringify({ connections: source }),
        );
      } else if (format === "xml") {
        imported = await importFromXML(serializeConnectionsToNativeXml(source));
      } else {
        imported = await importFromCSV(
          serializeDatasetsToNativeCsv([
            {
              databaseId: "db-1",
              databaseName: "Portable",
              connections: source,
            },
          ]),
        );
      }

      expect(imported).toHaveLength(3);
      const raw = imported.find((connection) => connection.protocol === "raw")!;
      const rlogin = imported.find(
        (connection) => connection.protocol === "rlogin",
      )!;
      const powerShell = imported.find(
        (connection) => connection.protocol === "winrm",
      )!;

      expect(raw.rawSocketSettings).toEqual(source[0].rawSocketSettings);
      expect(rlogin.rloginSettings).toMatchObject({
        ...source[1].rloginSettings,
        plaintextAcknowledgement: {
          version: 1,
          scope: "rlogin-plaintext-v1",
          acknowledged: false,
        },
      });
      expect(powerShell.powerShellRemoting).toEqual(
        source[2].powerShellRemoting,
      );
    },
  );

  it("migrates legacy aliases and unknown settings versions safely", async () => {
    const [raw] = await importFromJSON(
      JSON.stringify([
        {
          ...baseConnection({ protocol: "raw" }),
          protocol: "raw_udp",
          rawSocketSettings: {
            version: 99,
            transport: "tcp",
            displayEncoding: "base64",
          },
        },
      ]),
    );
    expect(raw.protocol).toBe("raw");
    expect(raw.rawSocketSettings).toMatchObject({
      version: RAW_SOCKET_SETTINGS_VERSION,
      connection: { transport: "udp" },
      data: { displayEncoding: "base64" },
    });

    const migratedRlogin = normalizeImportedAdvancedProtocolConnection(
      baseConnection({
        protocol: "rlogin",
        rloginSettings: {
          version: 99,
          remote_username: "legacy-user",
          encoding: "cp1252",
          plaintextAcknowledgement: {
            version: 1,
            scope: "rlogin-plaintext-v1",
            acknowledged: true,
            acknowledgedAt: "2026-07-15T10:02:00.000Z",
          },
        } as never,
      }),
    );
    expect(migratedRlogin.rloginSettings).toMatchObject({
      version: 1,
      remoteUsername: "legacy-user",
      encoding: "windows-1252",
      plaintextAcknowledgement: { acknowledged: false },
    });

    const migratedPowerShell = normalizeImportedAdvancedProtocolConnection(
      baseConnection({
        protocol: "winrm",
        powerShellRemoting: {
          schemaVersion: 42,
          transport: "https",
          username: "legacy-ps",
          port: 5986,
        } as never,
      }),
    );
    expect(migratedPowerShell.powerShellRemoting).toMatchObject({
      schemaVersion: 1,
      transport: "wsman",
      credential: { username: "legacy-ps" },
      wsman: { scheme: "https", port: 5986 },
    });
  });

  it("resets consent and applies the credential policy to exports", () => {
    const [, rlogin, powerShell] = advancedConnections();
    const secretBearing = {
      ...powerShell,
      password: "top-secret",
      proxyConfig: {
        type: "http",
        host: "proxy.internal",
        proxyPassword: "proxy-secret",
      },
      httpHeaders: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "X-Api-Key": "header-secret",
      },
      privateKey: "inline-key",
      passphrase: "key-passphrase",
    } as PortabilityFixtureConnection;

    const redacted = prepareConnectionForExport(
      secretBearing,
      false,
    ) as PortabilityFixtureConnection;
    expect(redacted.password).toBe("***ENCRYPTED***");
    expect(redacted.privateKey).toBeUndefined();
    expect(redacted.passphrase).toBeUndefined();
    expect(redacted.proxyConfig?.proxyPassword).toBe("***ENCRYPTED***");
    expect(redacted.httpHeaders).toEqual({ Accept: "application/json" });
    expect(redacted.powerShellRemoting?.credential.vaultRef).toBeUndefined();
    expect(
      redacted.powerShellRemoting?.ssh.privateKeyCredentialRef,
    ).toBeUndefined();
    expect(redacted.powerShellRemoting?.session.idleTimeoutSec).toBe(900);

    const exportedRlogin = prepareConnectionForExport(rlogin, true);
    expect(
      exportedRlogin.rloginSettings?.plaintextAcknowledgement.acknowledged,
    ).toBe(false);
  });

  it("deep-copies clones and always removes operational state", () => {
    const [raw, rlogin, powerShell] = advancedConnections();
    const source = {
      ...powerShell,
      password: "saved-password",
      backendSessionId: "backend-1",
      shellId: "shell-1",
      terminalBuffer: "sensitive output",
      transcript: ["Get-Secret"],
      replay: { frames: ["secret frame"] },
      httpHeaders: { Authorization: "Bearer credential" },
    } as PortabilityFixtureConnection;

    const withCredentials = prepareConnectionForClone(
      source,
      true,
    ) as PortabilityFixtureConnection;
    expect(withCredentials.password).toBe("saved-password");
    expect(withCredentials.powerShellRemoting?.credential.vaultRef).toEqual({
      integrationId: "vault-1",
      secretId: "secret-1",
    });
    expect(withCredentials.httpHeaders?.Authorization).toBe(
      "Bearer credential",
    );
    expect(withCredentials.backendSessionId).toBeUndefined();
    expect(withCredentials.shellId).toBeUndefined();
    expect(withCredentials.terminalBuffer).toBeUndefined();
    expect(withCredentials.transcript).toBeUndefined();
    expect(withCredentials.replay).toBeUndefined();

    const withoutCredentials = prepareConnectionForClone(
      source,
      false,
    ) as PortabilityFixtureConnection;
    expect(withoutCredentials.password).toBeUndefined();
    expect(
      withoutCredentials.powerShellRemoting?.credential.vaultRef,
    ).toBeUndefined();
    expect(withoutCredentials.httpHeaders).toEqual({});

    const rloginClone = prepareConnectionForClone(rlogin, true);
    expect(
      rloginClone.rloginSettings?.plaintextAcknowledgement.acknowledged,
    ).toBe(false);

    const rawClone = prepareConnectionForClone(raw, true);
    rawClone.rawSocketSettings!.connection.localBindAddress = "127.0.0.2";
    expect(raw.rawSocketSettings!.connection.localBindAddress).toBe("::1");
    expect(rawClone.rawSocketSettings!.advanced.replayFrames).toBe(
      raw.rawSocketSettings!.advanced.replayFrames,
    );
  });

  it("correctly maps vendor RAW, UDP, RLogin, and PowerShell fixtures", async () => {
    const mRemote = await importFromMRemoteNG(`<?xml version="1.0"?>
      <Connections>
        <Node Name="Raw TCP" Type="Connection" Protocol="RAW" Hostname="tcp.test" Port="7000" />
        <Node Name="Raw UDP" Type="Connection" Protocol="RAW/UDP" Hostname="udp.test" Port="7001" />
        <Node Name="Remote Login" Type="Connection" Protocol="Rlogin" Hostname="rlogin.test" Port="513" Username="operator" />
        <Node Name="PowerShell" Type="Connection" Protocol="PowerShell" Hostname="ps.test" Port="5985" />
        <Node Name="Not RLogin" Type="Connection" Protocol="RemoteShell" Hostname="shell.test" Port="514" />
      </Connections>`);
    expect(mRemote.map(formatPortableProtocolLabel)).toEqual([
      "RAW/TCP",
      "RAW/UDP",
      "RLogin",
      "PowerShell Remoting",
      "RDP",
    ]);
    expect(mRemote[2].rloginSettings?.remoteUsername).toBe("operator");

    const putty = await importFromPuTTY(String.raw`
[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\Raw%20TCP]
"HostName"="tcp.putty"
"Protocol"="raw"
"PortNumber"=dword:00001b58

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\RLogin]
"HostName"="rlogin.putty"
"Protocol"="rlogin"
"PortNumber"=dword:00000201
`);
    expect(putty.map(formatPortableProtocolLabel)).toEqual([
      "RAW/TCP",
      "RLogin",
    ]);
  });

  it("keeps unaffected native fields stable", async () => {
    const source = baseConnection({
      protocol: "ssh",
      port: 2222,
      username: "operator",
      description: 'comma, quote " and ampersand &',
      tags: ["one", "two"],
    });
    const xml = serializeConnectionsToNativeXml([source]);
    const csv = serializeDatasetsToNativeCsv([
      { databaseId: "db", databaseName: "Main", connections: [source] },
    ]);
    const [fromXml] = await importFromXML(xml);
    const [fromCsv] = await importFromCSV(csv);
    for (const imported of [fromXml, fromCsv]) {
      expect(imported).toMatchObject({
        id: source.id,
        name: source.name,
        protocol: "ssh",
        hostname: source.hostname,
        port: 2222,
        username: "operator",
        description: source.description,
        tags: source.tags,
      });
    }
    expect(csv).toContain(
      `AdvancedSettingsVersion,RawSocketSettings,RloginSettings,PowerShellRemotingSettings`,
    );
    expect(csv).toContain(String(ADVANCED_PROTOCOL_PORTABILITY_VERSION));
  });
});
