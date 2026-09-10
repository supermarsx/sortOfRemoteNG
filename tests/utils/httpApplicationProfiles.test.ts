import { describe, expect, it } from "vitest";
import {
  HTTP_APPLICATION_PROFILES,
  HTTP_APPLICATION_CATEGORIES,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";
import { buildPortainerWebUiConnection } from "../../src/components/integrations/portainer/webUiLaunch";
import { buildNpmWebUiConnection } from "../../src/components/integrations/nginxProxyMgr/webUiLaunch";
import { buildProxmoxWebUiConnection } from "../../src/components/integrations/proxmox/webUiLaunch";
import { buildPfsenseWebUiConnection } from "../../src/components/integrations/pfsense/webUiLaunch";

const connection = (
  loginMode: HttpApplicationSettings["loginMode"] = "form",
): Partial<Connection> => ({
  protocol: "https",
  hostname: "fixture.example.test",
  port: 443,
  username: "website-user",
  password: "fixture-password",
  httpApplication: { version: 1, id: "portainer", loginMode },
});

describe("HTTP application profile policy", () => {
  it("categorizes the existing applications plus Custom, Webmin, and Cloudflare, with non-web integrations separate", () => {
    expect(HTTP_APPLICATION_PROFILES).toHaveLength(43);
    expect(
      new Set(HTTP_APPLICATION_PROFILES.map((profile) => profile.id)).size,
    ).toBe(43);
    for (const profile of HTTP_APPLICATION_PROFILES) {
      expect(HTTP_APPLICATION_CATEGORIES[profile.category]).toBeTruthy();
      expect(profile.category === "native").toBe(profile.capability === "none");
    }
    expect(
      HTTP_APPLICATION_PROFILES.filter(
        (profile) => profile.capability === "known-form",
      ).map((profile) => profile.id),
    ).toEqual([
      "portainer",
      "nginxProxyMgr",
      "proxmox",
      "pfsense",
      "tacticalrmm",
      "meshcentral",
      "guacamole",
      "wordpress",
      "joomla",
      "drupal",
      "payload-cms",
      "webmin",
    ]);
  });
  it("makes Cloudflare manual-only and ignores retained website credentials, API headers, and automatic selectors", () => {
    const selected = {
      ...connection(),
      httpAutoLogin: true,
      httpAutoLoginSelectors: { usernameSelector: "#old" },
      httpApplication: {
        version: 1 as const,
        id: "cloudflare",
        loginMode: "manual" as const,
      },
    };
    expect(resolveHttpApplicationLogin(selected)).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    for (const loginMode of ["form", "basic"] as const) {
      expect(
        normalizeHttpApplicationSettings({
          ...selected.httpApplication,
          loginMode,
        })?.invalid,
      ).toBe(true);
      expect(() =>
        resolveHttpApplicationLogin({
          ...selected,
          httpApplication: { ...selected.httpApplication, loginMode },
        }),
      ).toThrow(/invalid/);
    }
    expect(() =>
      validateHttpApplicationTarget(
        selected,
        "https://dash.cloudflare.com/account/path?tab=dns#settings",
      ),
    ).not.toThrow();
    for (const target of [
      "http://dash.cloudflare.com/",
      "https://dash.cloudflare.com:8443/",
      "https://dash.cloudflare.com.example.test/",
      "https://example.test/",
      "https://user:secret@dash.cloudflare.com/",
      "https://dash.cloudflare.com./",
      "not a URL",
    ]) {
      expect(() => validateHttpApplicationTarget(selected, target)).toThrow(
        /requires HTTPS/,
      );
    }
    expect(() =>
      validateHttpApplicationTarget(
        connection("manual"),
        "https://fixture.example.test/",
      ),
    ).not.toThrow();
  });
  it("requires three explicit selectors for Custom and never falls back to generic detection", () => {
    const custom = {
      ...connection(),
      httpApplication: {
        version: 1 as const,
        id: "custom",
        loginMode: "form" as const,
      },
    };
    expect(() => resolveHttpApplicationLogin(custom)).toThrow(
      /requires explicit/,
    );
    expect(() =>
      resolveHttpApplicationLogin({
        ...custom,
        httpAutoLoginSelectors: {
          usernameSelector: "#user",
          passwordSelector: "#password",
        },
      }),
    ).toThrow(/requires explicit/);
    expect(
      resolveHttpApplicationLogin({
        ...custom,
        httpAutoLoginSelectors: {
          usernameSelector: "#user",
          passwordSelector: "#password",
          submitSelector: "#submit",
        },
      }),
    ).toMatchObject({
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: {
        usernameSelector: "#user",
        passwordSelector: "#password",
        submitSelector: "#submit",
      },
    });
  });
  it("preserves valid CSS child combinators and quoted values while trimming whitespace", () => {
    const input = {
      ...connection(),
      httpApplication: {
        version: 1 as const,
        id: "custom",
        loginMode: "form" as const,
      },
      httpAutoLoginSelectors: {
        usernameSelector: ' form#login > input[name="user name"] ',
        passwordSelector: 'input[data-label="a>b"]',
        submitSelector: 'form#login > button[type="submit"]',
      },
    };
    expect(resolveHttpApplicationLogin(input).selectors).toEqual({
      ...input.httpAutoLoginSelectors,
      usernameSelector: 'form#login > input[name="user name"]',
    });
    expect(() =>
      resolveHttpApplicationLogin({
        ...input,
        httpAutoLoginSelectors: {
          ...input.httpAutoLoginSelectors,
          submitSelector: "   ",
        },
      }),
    ).toThrow(/requires explicit/);
  });
  it.each([
    null,
    [],
    1,
    "portainer",
    {},
    { version: 2, id: "portainer" },
    { version: 1, id: "unknown" },
    { version: 1, id: "portainer", loginMode: "digest" },
  ])("fails closed on malformed present profile %j", (value) => {
    expect(normalizeHttpApplicationSettings(value)?.invalid).toBe(true);
    expect(() =>
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: value as HttpApplicationSettings,
      }),
    ).toThrow(/Review Application/);
  });
  it("keeps absence legacy-compatible, while an omitted mode defaults manual", () => {
    expect(normalizeHttpApplicationSettings(undefined)).toBeUndefined();
    expect(normalizeHttpApplicationSettings({ version: 1, id: "ilo" })).toEqual(
      { version: 1, id: "ilo", loginMode: "manual" },
    );
    expect(
      resolveHttpApplicationLogin({
        username: "old-user",
        password: "old-password",
        httpAutoLogin: true,
      }),
    ).toEqual({
      credentials: { username: "old-user", password: "old-password" },
      autoLogin: true,
      selectors: undefined,
    });
  });
  it("strips injected secret fields from the non-secret metadata", () => {
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "proxmox",
        loginMode: "form",
        realm: "pve",
        password: "not-profile-data",
        providerSecrets: { token: "no" },
      }),
    ).toEqual({ version: 1, id: "proxmox", loginMode: "form", realm: "pve" });
  });
  it("keeps manual credentials absent and Basic explicit", () => {
    expect(resolveHttpApplicationLogin(connection("manual"))).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(resolveHttpApplicationLogin(connection("basic"))).toMatchObject({
      credentials: { username: "website-user", password: "fixture-password" },
      upstreamAuthMode: "basic",
      autoLogin: false,
    });
    expect(resolveHttpApplicationLogin(connection())).toMatchObject({
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: { usernameSelector: "input#username" },
    });
  });
  it.each(["[", "input\u0000", "<script>", "a".repeat(513)])(
    "rejects malformed selector before proxy use",
    (selector) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...connection(),
          httpAutoLoginSelectors: { usernameSelector: selector },
        }),
      ).toThrow(/selector/);
    },
  );
  it("qualifies Proxmox at runtime without mutating the saved credential", () => {
    const input = {
      ...connection(),
      httpApplication: {
        version: 1 as const,
        id: "proxmox",
        loginMode: "form" as const,
        realm: "pve",
      },
    };
    const before = structuredClone(input);
    expect(resolveHttpApplicationLogin(input).credentials?.username).toBe(
      "website-user@pve",
    );
    expect(input).toEqual(before);
    expect(
      resolveHttpApplicationLogin({ ...input, username: "someone@pam" })
        .credentials?.username,
    ).toBe("someone@pam");
  });
  it("keeps one credential pair and never borrows a generic password", () => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...connection(),
        basicAuthUsername: "different-user",
        basicAuthPassword: "",
      }),
    ).toThrow(/both/);
  });
  it("keeps iLO generic and refuses automatic modes for manual-only/native apps", () => {
    expect(
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: { version: 1, id: "ilo", loginMode: "form" },
      }).selectors,
    ).toBeUndefined();
    for (const id of ["gdrive", "exchange", "mssql"])
      expect(() =>
        resolveHttpApplicationLogin({
          ...connection(),
          httpApplication: { version: 1, id, loginMode: "form" },
        }),
      ).toThrow(/invalid/);
  });
  it("routes all four existing password web launchers into form-only auth", () => {
    const fixtures = [
      buildPortainerWebUiConnection({
        baseUrl: "https://fixture.example.test",
        authMode: "password",
        username: "user",
        password: "password",
      }),
      buildNpmWebUiConnection({
        baseUrl: "https://fixture.example.test",
        authMode: "password",
        email: "user@example.test",
        password: "password",
      }),
      buildProxmoxWebUiConnection({
        host: "fixture.example.test",
        authMode: "password",
        username: "user",
        password: "password",
      }),
      buildPfsenseWebUiConnection({
        host: "fixture.example.test",
        port: 443,
        useTls: true,
        autoLogin: true,
        username: "user",
        password: "password",
      }),
    ];
    for (const fixture of fixtures)
      expect(resolveHttpApplicationLogin(fixture)).toMatchObject({
        upstreamAuthMode: "none",
        autoLogin: true,
      });
  });
  it("never turns API-token or non-opted-in launchers into form credentials", () => {
    const fixtures = [
      buildPortainerWebUiConnection({
        baseUrl: "https://fixture.example.test",
        authMode: "apiKey",
        username: "ignored",
        password: "ignored",
      }),
      buildNpmWebUiConnection({
        baseUrl: "https://fixture.example.test",
        authMode: "token",
        email: "ignored",
        password: "ignored",
      }),
      buildProxmoxWebUiConnection({
        host: "fixture.example.test",
        authMode: "apitoken",
        username: "ignored",
        password: "ignored",
      }),
      buildPfsenseWebUiConnection({
        host: "fixture.example.test",
        port: 443,
        useTls: true,
        autoLogin: false,
        username: "ignored",
        password: "ignored",
      }),
    ];
    for (const fixture of fixtures) {
      expect(fixture.password).toBeUndefined();
      expect(resolveHttpApplicationLogin(fixture)).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
    }
  });
});
