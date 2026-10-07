import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  HTTP_APPLICATION_PROFILES,
  getHttpApplicationLoginModes,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
  type HttpApplicationProfile,
} from "../../src/utils/connection/httpApplicationProfiles";
import { PORTUGAL_PORTAL_PROFILES } from "../../src/utils/connection/portugalPortalProfiles";
import { INTERNATIONAL_PORTAL_PROFILES } from "../../src/utils/connection/internationalPortalProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";

// Offline integration contracts for these two lanes only. No live requests,
// production accounts, Google service cases or central catalog count changes.
const profiles = [
  ...PORTUGAL_PORTAL_PROFILES,
  ...INTERNATIONAL_PORTAL_PROFILES,
];
const hostedProfiles = profiles.filter((profile) => profile.hostedLoginUrl);
const tenantProfiles = profiles.filter((profile) => !profile.hostedLoginUrl);
const noLogin = {
  credentials: null,
  upstreamAuthMode: "none",
  autoLogin: false,
};

const connectionFor = (
  profile: HttpApplicationProfile,
): Partial<Connection> => ({
  protocol: "https",
  hostname: profile.hostedLoginUrl
    ? new URL(profile.hostedLoginUrl).hostname
    : "tenant.example.test",
  port: profile.hostedLoginUrl ? 443 : 9443,
  username: "fixture-user",
  password: "fixture-password",
  authType: "basic",
  httpAutoLogin: true,
  httpAutoMfa: { version: 1, enabled: true },
  httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
});

function forbidSecretReads(target: object, keys: readonly string[]) {
  return keys.map((key) => {
    const read = vi.fn(() => {
      throw new Error(`Unexpected secret read: ${key}`);
    });
    Object.defineProperty(target, key, { get: read, enumerable: true });
    return read;
  });
}

describe("Portugal and international portal core integration", () => {
  it("registers every exported profile exactly once without replacing its metadata", () => {
    expect(PORTUGAL_PORTAL_PROFILES.length).toBeGreaterThan(0);
    expect(INTERNATIONAL_PORTAL_PROFILES.length).toBeGreaterThan(0);
    expect(new Set(profiles.map(({ id }) => id)).size).toBe(profiles.length);
    for (const profile of profiles) {
      expect(
        HTTP_APPLICATION_PROFILES.filter(({ id }) => id === profile.id),
      ).toEqual([profile]);
      expect(getHttpApplicationProfile(profile.id)).toBe(profile);
    }
  });

  it.each(profiles)(
    "$id normalizes to manual and never reads local or resolved vault secrets",
    (profile) => {
      const normalized = normalizeHttpApplicationSettings({
        version: 1,
        id: profile.id,
      });
      expect(normalized).toEqual({
        version: 1,
        id: profile.id,
        loginMode: "manual",
      });
      expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
      for (const source of ["local", "vault"] as const) {
        const connection = connectionFor(profile);
        connection.httpApplication = normalized;
        connection.credentialSource =
          source === "local"
            ? { kind: "local" }
            : {
                kind: "vault",
                credentialId: "00000000-0000-4000-8000-000000000001",
              };
        const localReads = forbidSecretReads(connection, [
          "username",
          "password",
          "basicAuthUsername",
          "basicAuthPassword",
          "httpHeaders",
          "totpConfigs",
          "httpAutoLoginSelectors",
          "httpFormAutomation",
        ]);
        const vault = { username: "", password: "" };
        const vaultReads = forbidSecretReads(vault, ["username", "password"]);
        expect(resolveHttpApplicationLogin(connection)).toEqual(noLogin);
        expect(resolveHttpApplicationLogin(connection, vault)).toEqual(noLogin);
        for (const read of [...localReads, ...vaultReads]) {
          expect(read).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(profiles)(
    "$id rejects imported form and transport authentication",
    (profile) => {
      const modes = getHttpApplicationLoginModes(profile);
      const connection = connectionFor(profile);
      expect(profile.requiresHttps).toBe(true);
      expect(profile.capability).toBe("manual");
      expect(modes).toEqual(["manual"]);
      expect(profile.selectors).toBeUndefined();
      expect(profile.totpChallenges).toBeUndefined();
      expect(profile.loginFlow).toBeUndefined();

      const rejectedModes = ["basic", "digest", "form"] as const;
      for (const loginMode of rejectedModes.filter(
        (mode) => !modes.includes(mode),
      )) {
        connection.httpApplication = { version: 1, id: profile.id, loginMode };
        expect(
          normalizeHttpApplicationSettings(connection.httpApplication)?.invalid,
        ).toBe(true);
        expect(() => resolveHttpApplicationLogin(connection)).toThrow(
          /invalid|unavailable/,
        );
      }
    },
  );

  it.each(hostedProfiles)(
    "$id validates the exact public origin and rejects lookalikes, other portals and credentials",
    (profile) => {
      const connection = connectionFor(profile);
      const canonical = new URL(profile.hostedLoginUrl!);
      for (const target of [
        canonical.href,
        `${canonical.origin}/another/page`,
      ]) {
        expect(() =>
          validateHttpApplicationTarget(connection, target),
        ).not.toThrow();
      }
      const otherOrigins = hostedProfiles
        .map((other) => new URL(other.hostedLoginUrl!).origin)
        .filter((origin) => origin !== canonical.origin);
      for (const target of [
        ...otherOrigins,
        `http://${canonical.hostname}${canonical.pathname}`,
        `https://${canonical.hostname}:8443/`,
        `https://${canonical.hostname}.attacker.test/`,
        `https://attacker.test/?next=${encodeURIComponent(canonical.href)}`,
        `https://fixture-user:fixture-password@${canonical.hostname}/`,
        "not a URL",
      ]) {
        expect(() =>
          validateHttpApplicationTarget(connection, target),
        ).toThrow();
      }
    },
  );

  it.each(hostedProfiles)(
    "$id hands off only its clean public entry on the saved origin without reading credentials",
    (profile) => {
      const connection = connectionFor(profile);
      const before = structuredClone(connection);
      const canonical = new URL(profile.hostedLoginUrl!);
      expect(
        getHttpApplicationExternalTarget(
          connection,
          `${canonical.origin}/session?token=fixture-session-token#state`,
        ),
      ).toEqual({ label: profile.label, url: canonical.href });
      expect(connection).toEqual(before);
      for (const [candidate, target] of [
        [connection, "https://attacker.test/"],
        [connection, `https://${canonical.hostname}:8443/`],
        [connection, `https://user:secret@${canonical.hostname}/`],
        [{ ...connection, hostname: "custom.example.test" }, canonical.href],
        [{ ...connection, protocol: "http" as const }, canonical.href],
        [{ ...connection, port: 8443 }, canonical.href],
      ] as const) {
        expect(getHttpApplicationExternalTarget(candidate, target)).toBeNull();
      }
      const reads = forbidSecretReads(connection, [
        "username",
        "password",
        "basicAuthPassword",
        "httpHeaders",
        "totpConfigs",
      ]);
      expect(
        getHttpApplicationExternalTarget(connection, canonical.href),
      ).toEqual({ label: profile.label, url: canonical.href });
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(tenantProfiles)(
    "$id accepts a configured HTTPS tenant and keeps external handoff on its exact origin",
    (profile) => {
      const origin = "https://tenant.example.test:9443";
      const savedPath = "/deployment/frontend/";
      const connection = {
        ...connectionFor(profile),
        hostname: `${origin}${savedPath}?private=fixture#saved-tab`,
      };
      const before = structuredClone(connection);
      expect(() =>
        validateHttpApplicationTarget(connection, origin),
      ).not.toThrow();
      expect(() =>
        validateHttpApplicationTarget(
          connection,
          "http://tenant.example.test/",
        ),
      ).toThrow();
      expect(
        getHttpApplicationExternalTarget(
          connection,
          "https://other.example.test/",
        ),
      ).toBeNull();
      expect(
        getHttpApplicationExternalTarget(
          connection,
          "https://tenant.example.test/",
        ),
      ).toBeNull();
      // A full saved deployment URL wins over the profile's default path,
      // including Zabbix with no universal path; session URLs never win.
      expect(
        getHttpApplicationExternalTarget(
          connection,
          `${origin}/current?token=fixture`,
        ),
      ).toEqual({
        label: profile.label,
        url: `${origin}${savedPath}`,
      });
      expect(connection).toEqual(before);
      expect(
        getHttpApplicationExternalTarget(
          { ...connection, hostname: "tenant.example.test" },
          `${origin}/current?token=fixture`,
        ),
      ).toEqual({
        label: profile.label,
        url: `${origin}${profile.loginPath ?? "/"}`,
      });
    },
  );

  it.each(tenantProfiles)(
    "$id preserves an explicit saved root with query/hash while removing those secrets from handoff",
    (profile) => {
      const origin = "https://tenant.example.test:9443";
      const connection = {
        ...connectionFor(profile),
        hostname: `${origin}/?private=fixture#saved-tab`,
      };
      // buildTargetUrl treats a saved root with query/hash as an explicit
      // initial page, even when the profile normally opens /login/ or /dashboard.
      expect(
        getHttpApplicationExternalTarget(connection, `${origin}/current`),
      ).toEqual({ label: profile.label, url: `${origin}/` });
    },
  );
});
