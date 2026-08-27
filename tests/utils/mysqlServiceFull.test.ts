import { describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  buildMysqlConnectionConfig,
  buildMysqlTlsConfig,
  detectMysqlDialect,
  encodeMysqlUrlValue,
  getUnsupportedMysqlRouteReason,
  isMissingMysqlSessionError,
  mysqlDialectLabel,
  mysqlErrorMessage,
  quoteMysqlIdentifier,
} from "../../src/utils/services/mysqlService";

const password = "p@ss:w/ord%23#42";
const connection: Connection = {
  id: "connection-mysql-1",
  name: "Shop database",
  protocol: "mysql",
  hostname: "db.example.test",
  port: 3307,
  username: "shop@app",
  password,
  database: "shop",
  timeout: 25,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const session: ConnectionSession = {
  id: "frontend-mysql-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "mysql",
  hostname: connection.hostname,
};

const withTls = (mysqlTls: Record<string, unknown>): Connection =>
  ({ ...connection, mysqlTls }) as Connection;

describe("buildMysqlConnectionConfig", () => {
  it("builds the exact snake_case DTO with raw credentials and no tunnel", () => {
    const config = buildMysqlConnectionConfig(connection, session);
    expect(config).toEqual({
      host: "db.example.test",
      port: 3307,
      username: "shop@app",
      password,
      database: "shop",
      ssh_tunnel: null,
      tls: null,
      max_connections: 5,
      connect_timeout_secs: 25,
      idle_timeout_secs: 300,
      charset: "utf8mb4",
      timezone: null,
    });
    expect(config).not.toHaveProperty("connectTimeoutSecs");
  });

  it("applies defaults for port, username, database, and timeout", () => {
    const config = buildMysqlConnectionConfig(
      { ...connection, port: 0, username: "  ", database: "", timeout: 0 },
      session,
    );
    expect(config.port).toBe(3306);
    expect(config.username).toBe("root");
    expect(config.database).toBeNull();
    expect(config.connect_timeout_secs).toBe(10);
  });

  it("prefers the dedicated connection timeout and caps it", () => {
    const config = buildMysqlConnectionConfig(
      { ...connection, mysqlConnectionTimeoutSecs: 9_999 } as Connection,
      session,
    );
    expect(config.connect_timeout_secs).toBe(600);
  });

  it("falls back to the session hostname and rejects URI-shaped hosts", () => {
    expect(
      buildMysqlConnectionConfig({ ...connection, hostname: "" }, session).host,
    ).toBe("db.example.test");
    expect(() =>
      buildMysqlConnectionConfig(
        { ...connection, hostname: "mysql://root:x@evil" },
        session,
      ),
    ).toThrow(/not a connection URI/i);
    expect(() =>
      buildMysqlConnectionConfig(
        { ...connection, hostname: "  " },
        { ...session, hostname: "" },
      ),
    ).toThrow(/hostname is required/i);
  });
});

describe("buildMysqlTlsConfig", () => {
  it("sends no TLS block for preferred (driver default)", () => {
    expect(buildMysqlTlsConfig(connection)).toBeNull();
    expect(buildMysqlTlsConfig(withTls({ mode: "preferred" }))).toBeNull();
  });

  it("maps disabled to enabled:false", () => {
    expect(buildMysqlTlsConfig(withTls({ mode: "disabled" }))).toEqual({
      enabled: false,
      ca_cert: null,
      client_cert: null,
      client_key: null,
      skip_verify: false,
      verify_hostname: false,
    });
  });

  it("maps required to enabled + skip_verify", () => {
    expect(buildMysqlTlsConfig(withTls({ mode: "required" }))).toMatchObject({
      enabled: true,
      skip_verify: true,
      verify_hostname: false,
      ca_cert: null,
    });
  });

  it("maps verify-ca and verify-identity with the CA path", () => {
    expect(
      buildMysqlTlsConfig(withTls({ mode: "verify-ca", caPath: "C:\\ca.pem" })),
    ).toEqual({
      enabled: true,
      ca_cert: "C:\\ca.pem",
      client_cert: null,
      client_key: null,
      skip_verify: false,
      verify_hostname: false,
    });
    expect(
      buildMysqlTlsConfig(
        withTls({
          mode: "verify-identity",
          caPath: "/ca.pem",
          clientCertPath: "/c.pem",
          clientKeyPath: "/k.pem",
        }),
      ),
    ).toEqual({
      enabled: true,
      ca_cert: "/ca.pem",
      client_cert: "/c.pem",
      client_key: "/k.pem",
      skip_verify: false,
      verify_hostname: true,
    });
  });

  it("rejects unsafe or incomplete certificate combinations", () => {
    expect(() => buildMysqlTlsConfig(withTls({ mode: "verify-ca" }))).toThrow(
      /require a CA certificate path/i,
    );
    expect(() =>
      buildMysqlTlsConfig(
        withTls({ mode: "required", clientCertPath: "/c.pem" }),
      ),
    ).toThrow(/both a client certificate path and a client key path/i);
    expect(() =>
      buildMysqlTlsConfig(withTls({ mode: "preferred", caPath: "/ca.pem" })),
    ).toThrow(/Required, Verify CA, or Verify Identity/i);
  });
});

describe("getUnsupportedMysqlRouteReason", () => {
  it("fails closed for chain ids and inline routes", () => {
    const routed: Connection[] = [
      { ...connection, proxyChainId: "proxy-chain" },
      { ...connection, connectionChainId: "connection-chain" },
      { ...connection, tunnelChainId: "tunnel-chain" },
      {
        ...connection,
        security: {
          proxy: {
            type: "socks5",
            host: "proxy.test",
            port: 1080,
            enabled: true,
          },
        },
      },
      {
        ...connection,
        security: { openvpn: { enabled: true, configId: "vpn" } },
      },
      {
        ...connection,
        security: {
          sshTunnel: {
            enabled: true,
            connectionId: "jump",
            localPort: 0,
            remoteHost: connection.hostname,
            remotePort: connection.port,
          },
        },
      },
      {
        ...connection,
        security: {
          tunnelChain: [{ id: "inline", type: "wireguard", enabled: true }],
        },
      },
    ];
    for (const candidate of routed) {
      expect(getUnsupportedMysqlRouteReason(candidate)).toMatch(
        /direct connections only/i,
      );
    }
  });

  it("allows direct connections and disabled routes", () => {
    expect(getUnsupportedMysqlRouteReason(connection)).toBeNull();
    expect(
      getUnsupportedMysqlRouteReason({
        ...connection,
        security: {
          proxy: { type: "socks5", host: "p", port: 1, enabled: false },
          tunnelChain: [{ id: "off", type: "wireguard", enabled: false }],
        },
      }),
    ).toBeNull();
  });
});

describe("mysqlErrorMessage", () => {
  it("redacts raw, URL-encoded, and URI-embedded credentials", () => {
    const encoded = encodeMysqlUrlValue(password);
    const message = mysqlErrorMessage(
      `connect failed: mysql://shop:${encoded}@db.example.test/shop?password=${encoded} raw=${password}`,
      connection,
    );
    expect(message).toContain("[redacted]");
    expect(message).not.toContain(password);
    expect(message).not.toContain(encoded);
    expect(message).not.toContain("shop:");
  });

  it("redacts URI userinfo and mariadb schemes even without a connection", () => {
    expect(mysqlErrorMessage("mariadb://someone:secret@host/db")).toBe(
      "mariadb://[redacted]@host/db",
    );
    expect(mysqlErrorMessage(new Error("boom?pwd=hunter2&x=1"))).toContain(
      "pwd=[redacted]",
    );
  });
});

describe("helpers", () => {
  it("detects missing-session errors from the backend wording", () => {
    expect(isMissingMysqlSessionError("No active MySQL connection")).toBe(true);
    expect(isMissingMysqlSessionError(new Error("Session abc not found"))).toBe(
      true,
    );
    expect(isMissingMysqlSessionError("[mysql:not_connected] gone")).toBe(true);
    expect(isMissingMysqlSessionError("syntax error near SELECT")).toBe(false);
    expect(isMissingMysqlSessionError(42)).toBe(false);
  });

  it("detects the dialect from backend tags or version strings", () => {
    expect(detectMysqlDialect("MariaDb")).toBe("mariadb");
    expect(detectMysqlDialect("mariadb")).toBe("mariadb");
    expect(detectMysqlDialect("MySql")).toBe("mysql");
    expect(detectMysqlDialect(null, "11.4.2-MariaDB-ubu2404")).toBe("mariadb");
    expect(detectMysqlDialect(undefined, "8.0.36")).toBe("mysql");
    expect(detectMysqlDialect(undefined, undefined)).toBe("mysql");
    expect(mysqlDialectLabel("mariadb")).toBe("MariaDB");
    expect(mysqlDialectLabel("mysql")).toBe("MySQL");
  });

  it("quotes identifiers with backticks and escapes embedded backticks", () => {
    expect(quoteMysqlIdentifier("people")).toBe("`people`");
    expect(quoteMysqlIdentifier("we`ird")).toBe("`we``ird`");
  });

  it("encodes RFC 3986 reserved characters", () => {
    expect(encodeMysqlUrlValue("a/b?c#d!'()*")).toBe(
      "a%2Fb%3Fc%23d%21%27%28%29%2A",
    );
  });
});
