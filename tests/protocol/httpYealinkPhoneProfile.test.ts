import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";
import {
  getHttpApplicationLoginModes,
  getHttpApplicationProfile,
  isSafeHttpApplicationLoginPath,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
  YEALINK_SERVLET_UPSTREAM_SUPPORTED,
} from "../../src/utils/auth/httpApplicationLogin";

const CAPABILITIES = "../../src/utils/auth/upstreamAuthCapabilities";
const LOGIN = "../../src/utils/auth/httpApplicationLogin";

const endpoints = readFileSync(
  "src-tauri/crates/sorng-voip-phone/src/endpoints.rs",
  "utf8",
);
const client = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
const profile = getHttpApplicationProfile("voip-phone")!;

/** Phones commonly serve plain HTTP; the profile must not pin HTTPS. */
const connection = (
  loginMode: HttpApplicationSettings["loginMode"] = "form",
  patch: Partial<Connection> = {},
): Partial<Connection> => ({
  protocol: "http",
  hostname: "phone.fixture.test",
  port: 80,
  basicAuthUsername: "admin",
  basicAuthPassword: "fixture-phone-secret",
  httpApplication: { version: 1, id: "voip-phone", loginMode },
  ...patch,
});

/** The attested servlet markup: ids, and a confirm anchor rather than a
 * submit input. Rendered both inside and outside a `<form>`. */
const servletMarkup = (withForm: boolean) =>
  (withForm ? '<form id="idLoginForm" action="/servlet" method="post">' : "") +
  '<input type="text" id="idUsername" name="username" value="" />' +
  '<input type="password" id="idPassword" name="pwd" value="" />' +
  '<input type="hidden" id="idRsakey" name="rsakey" value="" />' +
  '<input type="hidden" id="idRsaiv" name="rsaiv" value="" />' +
  '<a id="idConfirm" href="javascript:void(0)">Confirm</a>' +
  '<a id="idCancel" href="javascript:void(0)">Cancel</a>' +
  (withForm ? "</form>" : "");

/** The older name-only markup the alternates exist for. */
const legacyMarkup =
  '<form name="loginForm" action="/servlet" method="post">' +
  '<input type="text" name="username" value="" />' +
  '<input type="password" name="pwd" value="" />' +
  '<input type="submit" name="login" value="Confirm" />' +
  "</form>";

/** `findSubmitButton` in the production client, in its own order. */
const PLAIN_SUBMIT_SEARCH = [
  "button[type=submit], input[type=submit]",
  "button:not([type])",
  "[role=button][type=submit], button[id*=login i], button[class*=login i], button[id*=signin i]",
];

function rustSelector(name: string): string {
  const match = new RegExp(`pub const ${name}: &str = r#"(.*?)"#;`).exec(
    endpoints,
  );
  if (!match) throw new Error(`${name} is missing from endpoints.rs`);
  return match[1];
}

describe("Yealink phone web-login profile", () => {
  it("resolves the reviewed staged flow and carries the reviewed selectors", () => {
    expect(profile.capability).toBe("known-form");
    expect(profile.loginFlow).toBe("yealink");
    expect(resolveHttpApplicationLogin(connection())).toEqual({
      credentials: { username: "admin", password: "fixture-phone-secret" },
      // Gated: "yealink-servlet" only once the backend knows the variant.
      upstreamAuthMode: YEALINK_SERVLET_UPSTREAM_SUPPORTED
        ? "yealink-servlet"
        : "none",
      loginFlow: "yealink",
      autoLogin: true,
      selectors: {
        usernameSelector: '#idUsername, input[name="username"]',
        passwordSelector: '#idPassword, input[name="pwd"][type="password"]',
        submitSelector: '#idConfirm, input[type="submit"][name="login"]',
      },
    });
    // A copy: the shared profile metadata must not become mutable session state.
    expect(resolveHttpApplicationLogin(connection()).selectors).not.toBe(
      profile.selectors,
    );
  });

  it("emits the servlet mode now that the backend can deserialize it", async () => {
    // Shipped state since t96-e2: `UpstreamAuthMode::YealinkServlet` exists in
    // `sorng-protocols/src/http.rs`, so the reviewed flow sends its own mode
    // and the proxy signs the phone in before the frame loads.
    expect(YEALINK_SERVLET_UPSTREAM_SUPPORTED).toBe(true);
    expect(resolveHttpApplicationLogin(connection())).toMatchObject({
      upstreamAuthMode: "yealink-servlet",
      loginFlow: "yealink",
      autoLogin: true,
    });
    // The gate is Yealink-only: the other staged flows never pass through it.
    expect(
      resolveHttpApplicationLogin({
        ...connection(),
        protocol: "https",
        port: 443,
        httpApplication: { version: 1, id: "synology-dsm", loginMode: "form" },
      }).upstreamAuthMode,
    ).toBe("synology-form");
    try {
      // The degraded half stays live: an older backend that cannot place the
      // mode keeps a saved connection resolving to "none" rather than emitting
      // a string it would answer with no Authorization header at all.
      vi.resetModules();
      vi.doMock(CAPABILITIES, () => ({
        YEALINK_SERVLET_UPSTREAM_SUPPORTED: false,
      }));
      const gated = (await import(
        LOGIN
      )) as typeof import("../../src/utils/auth/httpApplicationLogin");
      expect(gated.YEALINK_SERVLET_UPSTREAM_SUPPORTED).toBe(false);
      expect(gated.resolveHttpApplicationLogin(connection())).toMatchObject({
        upstreamAuthMode: "none",
        loginFlow: "yealink",
        autoLogin: true,
        selectors: profile.selectors,
      });
      expect(
        gated.resolveHttpApplicationLogin({
          ...connection(),
          protocol: "https",
          port: 443,
          httpApplication: {
            version: 1,
            id: "synology-dsm",
            loginMode: "form",
          },
        }).upstreamAuthMode,
      ).toBe("synology-form");
    } finally {
      vi.doUnmock(CAPABILITIES);
      vi.resetModules();
    }
  });

  it("names a mode the Rust enum actually carries", () => {
    // The two halves must land together: this string IS the serde rename.
    // Asserted through a boolean so a mismatch reports one line rather than
    // printing the whole of http.rs.
    const http = readFileSync(
      "src-tauri/crates/sorng-protocols/src/http.rs",
      "utf8",
    );
    const mode = resolveHttpApplicationLogin(connection()).upstreamAuthMode;
    expect(mode).toBe("yealink-servlet");
    expect(
      new RegExp(`serde\\(rename = "${mode}"\\)\\]\\s*YealinkServlet`).test(
        http,
      ),
    ).toBe(true);
    // The unknown-mode fallback must resolve to no Authorization header, never
    // to the #[default] Basic — a skew that injects Basic at a device that
    // never asked for it is worse than the failed connect it replaces.
    expect(/#\[serde\(other\)\]\s*Unknown,/.test(http)).toBe(true);
  });

  it("refuses selector overrides exactly as the other staged flows do", () => {
    for (const override of [
      { submitSelector: "#mine" },
      { usernameSelector: "#user", passwordSelector: "#pass" },
    ])
      expect(() =>
        resolveHttpApplicationLogin(
          connection("form", { httpAutoLoginSelectors: override }),
        ),
      ).toThrow(/does not accept selector overrides/);
    // An empty override object is absence, not an override.
    expect(
      resolveHttpApplicationLogin(
        connection("form", { httpAutoLoginSelectors: {} }),
      ).loginFlow,
    ).toBe("yealink");
  });

  it("keeps Basic for the legacy generation and manual browsing inert", () => {
    expect(resolveHttpApplicationLogin(connection("basic"))).toEqual({
      credentials: { username: "admin", password: "fixture-phone-secret" },
      upstreamAuthMode: "basic",
      autoLogin: false,
    });
    expect(resolveHttpApplicationLogin(connection("manual"))).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(profile.description).toMatch(/ConfigManApp/);
  });

  it("keeps every previously accepted saved setting valid without a migration", () => {
    expect(getHttpApplicationLoginModes(profile)).toEqual([
      "manual",
      "form",
      "basic",
      "digest",
    ]);
    for (const loginMode of ["manual", "form", "basic", "digest"] as const)
      expect(
        normalizeHttpApplicationSettings({
          version: 1,
          id: "voip-phone",
          loginMode,
        }),
      ).toEqual({ version: 1, id: "voip-phone", loginMode });
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "voip-phone" }),
    ).toEqual({ version: 1, id: "voip-phone", loginMode: "manual" });
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "voip-phone",
        loginMode: "form",
        password: "not-profile-data",
      }),
    ).toEqual({ version: 1, id: "voip-phone", loginMode: "form" });
  });

  it("does not pin HTTPS or a hosted origin for a plain-HTTP phone", () => {
    expect(profile.requiresHttps).toBeUndefined();
    expect(profile.hostedLoginUrl).toBeUndefined();
    expect(profile.totpChallenges).toBeUndefined();
    expect(() =>
      validateHttpApplicationTarget(connection(), "http://phone.fixture.test/"),
    ).not.toThrow();
  });

  it("carries no login path and leaves the pathname-only validator unwidened", () => {
    expect(profile.loginPath).toBeUndefined();
    for (const path of [
      "/servlet?m=mod_listener&p=login&q=loginForm",
      "/servlet?p=login&q=loginForm&jumpto=status",
      "/servlet#login",
    ])
      expect(isSafeHttpApplicationLoginPath(path)).toBe(false);
    const imported = normalizeHttpApplicationSettings({
      version: 1,
      id: "voip-phone",
      loginMode: "form",
      loginPath: "/servlet",
    });
    expect(imported?.invalid).toBe(true);
    expect(imported).not.toHaveProperty("loginPath");
  });

  it("matches each role exactly once in both attested markups", () => {
    for (const markup of [
      servletMarkup(true),
      servletMarkup(false),
      legacyMarkup,
    ]) {
      document.body.innerHTML = markup;
      for (const selector of Object.values(profile.selectors!))
        expect(document.querySelectorAll(selector!)).toHaveLength(1);
    }
  });

  it("reaches an anchor confirm control that no submit-button search finds", () => {
    for (const selector of PLAIN_SUBMIT_SEARCH)
      expect(client).toContain(`"${selector}"`);
    // The override path accepts an anchor; the plain search never returns one.
    expect(client).toContain("/^(BUTTON|INPUT|A)$/");
    document.body.innerHTML = servletMarkup(true);
    const submit = profile.selectors!.submitSelector!;
    expect(document.querySelector(submit)!.tagName).toBe("A");
    for (const selector of PLAIN_SUBMIT_SEARCH)
      expect(document.querySelector(selector)).toBeNull();
    document.body.innerHTML = legacyMarkup;
    expect(document.querySelector(submit)!.tagName).toBe("INPUT");
  });

  it("keeps the selectors equal to the native driver's constants", () => {
    expect(profile.selectors).toEqual({
      usernameSelector: rustSelector("SEL_USERNAME"),
      passwordSelector: rustSelector("SEL_PASSWORD"),
      submitSelector: rustSelector("SEL_SUBMIT"),
    });
  });

  it("promises no automatic sign-in the embedded viewer cannot yet deliver", () => {
    expect(profile.description).toMatch(
      /stays incomplete until the embedded viewer's page-script compatibility update ships/,
    );
    expect(profile.description).toMatch(/remains a manual step/);
    expect(profile.description).toMatch(/one web session at a time/);
    expect(profile.description).toMatch(/never retried/);
  });
});
