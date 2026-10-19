import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { configuredHttpCredentialOrigin } from "../../src/utils/auth/httpCredentialTransport";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { HTTP_APPLICATION_PROFILES } from "../../src/utils/connection/httpApplicationProfiles";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../../src/utils/connection/httpAutoMfa";

const saved = {
  protocol: "http",
  hostname: "mail.example.test",
  port: 8080,
  username: "fixture-user",
  password: "fixture-password",
} as const;

describe("configured HTTP credential transport", () => {
  it.each([
    ["mail.example.test", undefined, "http://mail.example.test"],
    ["mail.example.test", 8080, "http://mail.example.test:8080"],
    ["mail.example.test:8080", undefined, "http://mail.example.test:8080"],
    ["192.0.2.10:8080", 80, "http://192.0.2.10:8080"],
    ["http://mail.example.test:80/login", 80, "http://mail.example.test"],
    [
      "http://mail.example.test:8080/login?q=private#step",
      8080,
      "http://mail.example.test:8080",
    ],
    ["[::1]", 8080, "http://[::1]:8080"],
  ])("uses the saved authority only: %s / %s", (hostname, port, expected) => {
    expect(configuredHttpCredentialOrigin({ ...saved, hostname, port })).toBe(
      expected,
    );
  });

  it.each([
    { protocol: "https" },
    { hostname: "https://mail.example.test:8080/" },
    { hostname: "http://mail.example.test:8081/" },
    { hostname: "mail.example.test:80" },
    { hostname: "http://user:secret@mail.example.test:8080/" },
    { hostname: "http://mail.example.test%2fattacker/" },
    { hostname: "//mail.example.test" },
    { hostname: "" },
    { port: -1 },
    { port: 0 },
    { port: NaN },
    { port: 65536 },
  ] satisfies Partial<Connection>[])(
    "rejects conflicting or unsafe configuration: %j",
    (change) => {
      expect(
        configuredHttpCredentialOrigin({ ...saved, ...change }),
      ).toBeNull();
    },
  );

  it.each([
    "synology-dsm",
    "exchange-owa",
    "exchange-ecp",
    "opnsense",
    "rdweb",
    "vaultwarden",
    "bitwarden-self-hosted",
    "nextcloud",
    "tacticalrmm",
  ])("allows %s only at its explicitly configured HTTP origin", (id) => {
    const connection: Partial<Connection> = {
      ...saved,
      httpApplication: { version: 1, id, loginMode: "form" },
    };
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "http://mail.example.test:8080/login",
      ),
    ).not.toThrow();
    for (const target of [
      "http://mail.example.test/login",
      "http://mail.example.test:8081/login",
      "http://other.example.test:8080/login",
      "http://mail.example.test.attacker.test:8080/login",
      "http://user:secret@mail.example.test:8080/login",
    ]) {
      expect(() => validateHttpApplicationTarget(connection, target)).toThrow();
    }
    expect(() =>
      validateHttpApplicationTarget(
        { ...connection, protocol: "https" },
        "http://mail.example.test:8080/login",
      ),
    ).toThrow();
    expect(() =>
      validateHttpApplicationTarget(
        {
          ...connection,
          httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
        },
        "http://mail.example.test:8080/login",
      ),
    ).toThrow();
  });

  it.each(
    HTTP_APPLICATION_PROFILES.filter((profile) => profile.hostedLoginUrl),
  )(
    "keeps fixed hosted $id HTTPS even when HTTP is saved explicitly",
    (profile) => {
      const target = new URL(profile.hostedLoginUrl!);
      const connection: Partial<Connection> = {
        ...saved,
        hostname: target.hostname,
        port: 80,
        httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
      };
      target.protocol = "http:";
      expect(() =>
        validateHttpApplicationTarget(connection, target.href),
      ).toThrow(/HTTPS/);
    },
  );

  it.each(["manual", "form"] as const)(
    "preserves HTTP %s consent during normalization",
    (loginMode) => {
      const connection = {
        ...saved,
        httpAutoLogin: false,
        httpApplication: { version: 1, id: "exchange-owa", loginMode },
        httpAutoMfa: { version: 1, enabled: false },
      };
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(JSON.stringify(connection)),
      );
      expect(restored).toEqual(connection);
      expect(resolveHttpApplicationLogin(restored)).toMatchObject({
        autoLogin: loginMode === "form",
        credentials:
          loginMode === "form"
            ? { username: saved.username, password: saved.password }
            : null,
      });
    },
  );

  it("preserves legacy HTTP auto-login opt-in and keeps automatic MFA HTTPS-only", () => {
    const connection = normalizeAdvancedProtocolConnection({
      ...saved,
      httpAutoLogin: true,
    });
    expect(resolveHttpApplicationLogin(connection).autoLogin).toBe(true);
    expect(() => getHttpAutoMfaOrigin(saved)).toThrow(/requires HTTPS/);
    expect(() =>
      normalizeHttpAutoMfa({
        version: 1,
        enabled: true,
        totpConfigId: "authenticator",
        challengeId: "challenge",
        origin: "http://mail.example.test:8080",
      }),
    ).toThrow(/HTTPS origin/);
  });
});
