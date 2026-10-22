import { describe, expect, it } from "vitest";
import {
  HTTP_APPLICATION_PROFILES,
  HTTP_APPLICATION_CATEGORIES,
  getHttpApplicationLoginModes,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  DECLARATIVE_LOGIN_LEGACY_SUPPORTED,
  DECLARATIVE_LOGIN_SUPPORTED,
} from "../../src/utils/connection/declarativeLoginSupport";
import {
  resolveHttpApplicationLogin,
  getReviewedApplicationProfile,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";
import applicationTargets from "../../src/utils/protocol/originBrowserApplicationTargets.json";
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
    // 149 existing profiles plus Vodafone Smart Router 3, YouTube Studio and
    // the TP-Link managed switch, reviewed EAP login and two Activepieces profiles.
    expect(HTTP_APPLICATION_PROFILES).toHaveLength(158);
    expect(
      new Set(HTTP_APPLICATION_PROFILES.map((profile) => profile.id)).size,
    ).toBe(158);
    for (const profile of HTTP_APPLICATION_PROFILES) {
      expect(HTTP_APPLICATION_CATEGORIES[profile.category]).toBeTruthy();
      expect(profile.category === "native").toBe(profile.capability === "none");
    }
    expect(
      HTTP_APPLICATION_PROFILES.filter(
        (profile) => profile.capability === "known-form",
      ).map((profile) => profile.id),
    ).toEqual([
      "youtube-studio",
      "google-ad-manager",
      "google-adsense",
      "google-forms",
      "google-gemini",
      "google-workspace-admin",
      "google-play-store",
      "google-developers",
      "google-play-console",
      "vodafone-portugal",
      "opnsense",
      "vodafone-smart-router-3",
      "bitwarden-self-hosted",
      "vaultwarden",
      "nextcloud",
      "chatgpt",
      "claude",
      "gitlab-self-hosted",
      "google-account",
      "google-cloud-console",
      "google-analytics",
      "google-tag-manager",
      "google-business-profile",
      "google-search-console",
      "google-ads",
      "instagram",
      "linkedin",
      "youtube",
      "ptisp",
      "freedns",
      "registro-br",
      "sqlpad",
      "gmail",
      "exchange-owa",
      "adobe-admin-console",
      "matomo",
      "plausible",
      "odoo",
      "phpmyadmin",
      "freepbx",
      "porkbun",
      "synology-dsm",
      "portainer",
      "nginxProxyMgr",
      "proxmox",
      "pfsense",
      "cloudflare",
      "tacticalrmm",
      "meshcentral",
      "guacamole",
      "github",
      "gitea",
      "drone-ci",
      "exchange-ecp",
      "brevo",
      "rdweb",
      "wordpress",
      "joomla",
      "drupal",
      "payload-cms",
      "webmin",
      "voip-phone",
      "cpanel",
      "tplink-eap",
      "gdrive",
    ]);
  });
  it("offers reviewed declarative steps in the native engine while keeping legacy steps off", () => {
    expect(DECLARATIVE_LOGIN_SUPPORTED).toBe(true);
    expect(DECLARATIVE_LOGIN_LEGACY_SUPPORTED).toBe(false);
    const declarative = HTTP_APPLICATION_PROFILES.filter(
      (profile) => profile.declarativeLogin,
    );
    expect(declarative).toHaveLength(37);
    const exclusive = declarative.filter(
      (profile) => profile.declarativeLoginMode === "exclusive",
    ).length;
    for (const profile of declarative) {
      expect(
        profile.declarativeLogin?.loginSteps.length,
        profile.id,
      ).toBeGreaterThan(0);
      expect(getHttpApplicationLoginModes(profile), profile.id).toContain(
        "form",
      );
    }
    const offering = (...modes: string[]) =>
      HTTP_APPLICATION_PROFILES.filter(
        (profile) =>
          getHttpApplicationLoginModes(profile).join() === modes.join(),
      ).length;
    // Manual only; native-only; and every profile that offers form login today.
    expect(offering("manual")).toBe(62 - exclusive);
    expect(offering()).toBe(8);
    expect(
      HTTP_APPLICATION_PROFILES.filter((profile) =>
        getHttpApplicationLoginModes(profile).includes("form"),
      ),
    ).toHaveLength(81 + exclusive);
  });
  it("keeps the browser application targets mirror equal to the catalog: same ids in the same order, same entry points", () => {
    // src/utils/protocol/originBrowserApplicationTargets.json is kept by hand
    // and read by the native authority, the capture tool and the corpus check.
    expect(applicationTargets.version).toBe(1);
    expect(Object.keys(applicationTargets.profiles)).toEqual(
      HTTP_APPLICATION_PROFILES.map(({ id }) => id),
    );
    const targets: Record<string, unknown> = applicationTargets.profiles;
    for (const profile of HTTP_APPLICATION_PROFILES)
      expect(targets[profile.id], profile.id).toEqual(
        JSON.parse(
          JSON.stringify({
            hostedLoginUrl: profile.hostedLoginUrl,
            loginPath: profile.loginPath,
            loginFlow: profile.loginFlow,
          }),
        ),
      );
  });
  it("offers the TP-Link managed switch as a named application on generic detection", () => {
    const profile = HTTP_APPLICATION_PROFILES.find(
      ({ id }) => id === "tplink-switch",
    )!;
    expect(profile).toMatchObject({
      label: "TP-Link managed switch",
      category: "networking",
      capability: "generic-form",
    });
    expect(profile.description).toContain("TP-Link managed switch");
    // A device on the user's own network: no hosted address, no HTTPS pin.
    expect(profile.hostedLoginUrl).toBeUndefined();
    expect(profile.requiresHttps).toBeUndefined();
    expect(profile.selectors).toBeUndefined();
    expect(getHttpApplicationLoginModes(profile)).toEqual([
      "manual",
      "form",
      "basic",
      "digest",
    ]);
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "tplink-switch" }),
    ).toEqual({ version: 1, id: "tplink-switch", loginMode: "manual" });
    expect(
      resolveHttpApplicationLogin({
        ...connection("manual"),
        httpApplication: {
          version: 1,
          id: "tplink-switch",
          loginMode: "manual",
        },
      }),
    ).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
  });
  it("keeps Cloudflare manual mode credential-free and rejects imported transport auth", () => {
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
    for (const loginMode of ["basic", "digest"] as const) {
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
  it("resolves Cloudflare form credentials locally or from the vault without transport auth", () => {
    const selected: Partial<Connection> = {
      ...connection(),
      hostname: "dash.cloudflare.com",
      authType: "header",
      httpApplication: { version: 1, id: "cloudflare", loginMode: "form" },
    };
    const mode = {
      upstreamAuthMode: "cloudflare-form",
      loginFlow: "cloudflare",
      autoLogin: true,
    };
    expect(resolveHttpApplicationLogin(selected)).toEqual({
      ...mode,
      credentials: { username: "website-user", password: "fixture-password" },
    });
    const vault = {
      ...selected,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    };
    expect(resolveHttpApplicationLogin(vault)).toEqual({
      ...mode,
      credentials: null,
    });
    const credentials = {
      username: "vault@example.test",
      password: "vault-password",
    };
    expect(resolveHttpApplicationLogin(vault, credentials)).toEqual({
      ...mode,
      credentials,
    });
    expect(() =>
      resolveHttpApplicationLogin({ ...selected, password: "" }),
    ).toThrow(/requires/);
    expect(() =>
      resolveHttpApplicationLogin({
        ...selected,
        httpAutoLoginSelectors: { usernameSelector: "#guessed" },
      }),
    ).toThrow(/does not accept selector overrides/);
  });
  it("emits the Cloudflare capability only for normalized valid profiles", () => {
    for (const loginMode of ["manual", "form"] as const) {
      expect(
        getReviewedApplicationProfile({
          httpApplication: {
            version: 1,
            id: "cloudflare",
            loginMode,
          },
        }),
      ).toBe("cloudflare");
    }
    for (const metadata of [
      null,
      { version: 2, id: "cloudflare", loginMode: "form" },
      { version: 1, id: "cloudflare", loginMode: "basic" },
      { version: 1, id: "cloudflare", loginMode: "digest" },
      { version: 1, id: "cloudflare", loginMode: "form", invalid: true },
      {
        version: 1,
        id: "cloudflare",
        loginMode: "form",
        loginPath: "https://evil.test/",
      },
    ]) {
      expect(
        getReviewedApplicationProfile({
          httpApplication: metadata as Connection["httpApplication"],
        }),
      ).toBeUndefined();
    }
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
    { version: 1, id: "portainer", loginMode: "unknown" },
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
  it("keeps generic transport modes separate from form automation", () => {
    for (const mode of ["basic", "digest"] as const) {
      expect(
        resolveHttpApplicationLogin({
          ...connection(),
          httpApplication: { version: 1, id: `http-${mode}`, loginMode: mode },
        }),
      ).toMatchObject({ upstreamAuthMode: mode, autoLogin: false });
    }
    expect(
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: undefined,
        authType: "digest",
        httpAutoLogin: true,
      }),
    ).toMatchObject({ upstreamAuthMode: "digest", autoLogin: false });
    expect(
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: undefined,
        authType: "header",
        httpAutoLogin: true,
      }),
    ).toEqual({
      credentials: null,
      upstreamAuthMode: "header",
      autoLogin: false,
    });
    expect(() =>
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: { version: 1, id: "http-digest", loginMode: "form" },
      }),
    ).toThrow(/invalid/);
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
  it("keeps iLO generic and refuses automatic modes for native apps", () => {
    expect(
      resolveHttpApplicationLogin({
        ...connection(),
        httpApplication: { version: 1, id: "ilo", loginMode: "form" },
      }).selectors,
    ).toBeUndefined();
    for (const id of ["exchange", "mssql"])
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
