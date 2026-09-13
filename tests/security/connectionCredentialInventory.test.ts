import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  connectionCredentialInventory,
  connectionCredentialMatches,
  type ConnectionCredentialKind,
} from "../../src/utils/security/connectionCredentialInventory";

const SECRET = "NEVER_DISPLAY_SEARCH_EXPORT";
const connection = (patch: Partial<Connection> = {}): Connection => ({
  id: "connection-a",
  name: "Saved server",
  protocol: "ssh",
  hostname: SECRET,
  port: 22,
  isGroup: false,
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
  ...patch,
});
// Explicit saved field contracts, not a recursive secret-key-name heuristic.
const cases: Array<[string, Partial<Connection>, ConnectionCredentialKind]> = [
  ["account", { username: SECRET, domain: SECRET }, "account"],
  ["password", { password: SECRET }, "password"],
  ["RustDesk", { rustdeskPassword: SECRET }, "password"],
  ["private key", { privateKey: SECRET }, "privateKey"],
  ["passphrase", { passphrase: SECRET }, "passphrase"],
  ["legacy TOTP", { totpSecret: SECRET }, "totp"],
  [
    "TOTP",
    {
      totpConfigs: [
        {
          secret: SECRET,
          issuer: SECRET,
          account: SECRET,
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ],
    },
    "totp",
  ],
  [
    "backup codes",
    {
      totpConfigs: [
        {
          secret: "",
          backupCodes: [SECRET],
          issuer: SECRET,
          account: SECRET,
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ],
    },
    "recovery",
  ],
  [
    "answers",
    { securityQuestions: [{ question: SECRET, answer: SECRET }] },
    "recovery",
  ],
  [
    "recovery",
    { recoveryInfo: { seedPhrase: SECRET, alternativeEmail: SECRET } },
    "recovery",
  ],
  ["Basic auth", { basicAuthPassword: SECRET }, "webAuth"],
  ["custom headers", { httpHeaders: { [SECRET]: SECRET } }, "webHeaders"],
  [
    "query",
    {
      httpProxyPolicy: {
        version: 1,
        pageScripts: "allow",
        httpsOnly: false,
        sameOriginOnly: false,
        cacheMode: "normal",
        queryParameters: [{ name: SECRET, value: SECRET }],
      },
    },
    "webParameters",
  ],
  [
    "form",
    {
      httpFormAutomation: {
        version: 1,
        fields: [{ selector: SECRET, value: SECRET }],
        fillDelayMs: 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 100,
        submit: false,
      },
    },
    "webParameters",
  ],
  ["Mongo URI", { mongoConnectionString: SECRET }, "databaseUri"],
  ["cloud JSON", { protocol: "gcp", password: SECRET }, "cloud"],
  [
    "legacy cloud",
    {
      cloudProvider: {
        provider: "ovhcloud",
        serviceAccountKey: SECRET,
        consumerKey: SECRET,
        appSecret: SECRET,
      },
    },
    "cloud",
  ],
  [
    "gateway token",
    { rdpSettings: { gateway: { accessToken: SECRET } } },
    "gateway",
  ],
  [
    "proxy",
    {
      security: {
        proxy: {
          type: "socks5",
          host: SECRET,
          port: 1,
          enabled: false,
          password: SECRET,
          sshKeyPassphrase: SECRET,
          tunnelKey: SECRET,
          customHeaders: { [SECRET]: SECRET },
        },
      },
    },
    "proxy",
  ],
  [
    "route proxy",
    {
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "proxy",
            enabled: false,
            proxy: {
              proxyType: "https",
              host: SECRET,
              port: 1,
              password: SECRET,
            },
          },
        ],
      },
    },
    "proxy",
  ],
  [
    "route SSH proxy password",
    {
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "ssh-tunnel",
            enabled: true,
            sshTunnel: {
              forwardType: "local",
              proxyCommand: { proxyPassword: SECRET },
            },
          },
        ],
      },
    },
    "sshHop",
  ],
  [
    "route VPN key",
    {
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "wireguard",
            enabled: true,
            vpn: { presharedKey: SECRET },
          },
        ],
      },
    },
    "vpn",
  ],
  [
    "route mesh",
    {
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "tailscale",
            enabled: true,
            mesh: { authKey: SECRET },
          },
        ],
      },
    },
    "vpn",
  ],
  [
    "route token",
    {
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "cloudflared",
            enabled: true,
            tunnel: { authToken: SECRET },
          },
        ],
      },
    },
    "tunnel",
  ],
  [
    "SSH ProxyCommand",
    { sshConnectionConfigOverride: { proxyCommandPassword: SECRET } },
    "proxy",
  ],
  [
    "SSH mixed hop",
    {
      sshConnectionConfigOverride: {
        mixedChain: {
          hops: [
            {
              type: "ssh_jump",
              host: SECRET,
              port: 1,
              username: "",
              keyboardInteractiveResponses: [SECRET],
            },
          ],
        },
      },
    },
    "sshHop",
  ],
  ["SPICE proxy URI", { spiceProxyUri: SECRET }, "proxy"],
  ["PostgreSQL key file", { postgresClientKeyPath: SECRET }, "clientKey"],
  ["MySQL key file", { mysqlTls: { clientKeyPath: SECRET } }, "clientKey"],
  ["Mongo client key", { mongoTls: { certKeyPath: SECRET } }, "clientKey"],
  [
    "vault reference",
    {
      credentialSource: { kind: "vault", credentialId: SECRET, totpId: SECRET },
    },
    "vault",
  ],
  [
    "integration references",
    {
      integration: {
        descriptorKey: "pfsense",
        credentialRefId: SECRET,
        credentialRefIds: { [SECRET]: SECRET },
      },
    },
    "integration",
  ],
];

describe("connection-backed credential metadata", () => {
  it("indicates an RDP routing cookie without displaying it", () => {
    const [row] = connectionCredentialInventory([
      connection({
        rdpSettings: { negotiation: { loadBalancingInfo: SECRET } },
      }),
    ]);
    expect(row.kinds).toEqual(["rdpRouting"]);
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });
  it.each(cases)(
    "covers %s without copying or indexing its value",
    (_name, patch, kind) => {
      const source = connection(patch);
      const before = JSON.stringify(source);
      const rows = connectionCredentialInventory([source]);
      expect(rows).toHaveLength(1);
      expect(rows[0].kinds).toContain(kind);
      expect(JSON.stringify(rows)).not.toContain(SECRET);
      expect(connectionCredentialMatches(rows[0], SECRET)).toBe(false);
      expect(JSON.stringify(source)).toBe(before);
      expect(Object.keys(rows[0]).sort()).toEqual(
        [
          "id",
          "name",
          "protocol",
          "kinds",
          "storage",
          "localValuesIgnored",
        ].sort(),
      );
    },
  );

  it("includes PowerShell store references without resolving or displaying IDs", () => {
    const source = connection({
      powerShellRemoting: {
        credential: {
          source: "vault",
          username: "",
          savedCredentialId: SECRET,
          vaultRef: { secretId: SECRET },
        },
        wsman: {
          tls: { clientCertificateRef: SECRET },
          proxy: { credentialRef: SECRET },
        },
        ssh: { privateKeyCredentialRef: SECRET, privateKeyPath: SECRET },
      } as Connection["powerShellRemoting"],
    });
    const [row] = connectionCredentialInventory([source]);
    expect(row.kinds).toEqual(["external", "clientKey"]);
    expect(row.storage).toEqual(["external"]);
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("does not parse unknown payloads, launch-only integration secrets, sessions, scripts or shared route stores", () => {
    const source = connection({
      integration: {
        descriptorKey: "example",
        providerFields: { password: SECRET },
        authToken: SECRET,
        password: SECRET,
        apiKey: SECRET,
        providerSecrets: { password: SECRET },
      } as Connection["integration"],
      description: SECRET,
      scripts: { onConnect: [SECRET] },
      proxyChainId: SECRET,
      tunnelChainId: SECRET,
      sshConnectionConfigOverride: { environment: { password: SECRET } },
    });
    expect(connectionCredentialInventory([source])).toEqual([]);
  });

  it("keeps retained local fields visible beside a vault link without resolving it", () => {
    const [row] = connectionCredentialInventory([
      connection({
        password: SECRET,
        credentialSource: { kind: "vault", credentialId: SECRET },
      }),
    ]);
    expect(row.storage).toEqual(["embedded", "vault"]);
    expect(row.localValuesIgnored).toBe(true);
    expect(connectionCredentialMatches(row, "database vault link")).toBe(true);
    expect(connectionCredentialMatches(row, "ssh")).toBe(true);
  });

  it("counts connections, not fields, and retains an explicitly empty account password", () => {
    expect(connectionCredentialInventory([connection()])).toEqual([]);
    const [row] = connectionCredentialInventory([
      connection({ username: SECRET, password: "", privateKey: SECRET }),
    ]);
    expect(row.kinds).toEqual(["account", "password", "privateKey"]);
  });
});
