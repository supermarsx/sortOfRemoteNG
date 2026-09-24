import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

// Minimal rendered controls from the official sources listed in docs/http-application-logins.md.
// These fixtures validate our selectors/client contract, not live deployment acceptance.
const forms = {
  tacticalrmm:
    '<form><input autocomplete="username"><input autocomplete="current-password" type="password"><button type="submit">Login</button></form><div class="q-dialog"><form><input autocomplete="one-time-code" inputmode="numeric"><button type="submit">Verify</button></form></div>',
  wordpress:
    '<form id="loginform" method="post"><input id="user_login" name="log"><input id="user_pass" name="pwd" type="password"><input id="wp-submit" type="submit"></form>',
  joomla:
    '<form id="form-login" method="post"><input id="mod-login-username" name="username"><input id="mod-login-password" name="passwd" type="password"><button id="btn-login-submit" type="submit">Login</button></form>',
  drupal:
    '<form data-drupal-selector="user-login-form" method="post"><input name="name"><input name="pass" type="password"><input type="submit"></form>',
  "payload-cms":
    '<form class="login__form" method="post"><input name="email" type="email"><input name="password" type="password"><button type="submit">Login</button></form>',
  meshcentral:
    '<div id="loginpanel"><form method="post"><input type="hidden" name="action" value="login"><input id="username" name="username"><input id="password" name="password" type="password"><input id="loginButton" type="submit"></form></div>',
  guacamole:
    '<form class="login-form"><input name="username"><input name="password" type="password"><input class="login" name="login" type="submit"></form>',
  github:
    '<form action="/session" method="post"><input id="login_field" name="login"><input id="password" name="password" type="password"><input name="commit" type="submit"></form>',
  gitea:
    '<form action="/user/login" method="post"><input id="user_name" name="user_name"><input id="password" name="password" type="password"><button class="ui primary">Login</button></form>',
  brevo:
    '<form><input id="email" name="email"><input id="password" name="password" type="password"><button id="eyeIcon" type="button">Show</button><button data-testid="submit-button" type="button">Login</button></form>',
  cpanel:
    '<form novalidate id="login_form" action="/login/" method="post"><input name="user" id="user" type="text"><input name="pass" id="pass" type="password"><button name="login" type="submit" id="login_submit">Log in</button></form>',
};
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Client = {
  bootstrap(
    credentials: { username: string | null; password: string | null },
    selectors: object,
  ): Promise<{ ok: boolean; reason: string }>;
  cancel(): void;
};
let client: Client;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  window.eval(source);
  client = (window as unknown as { __sorng_autologin: Client })
    .__sorng_autologin;
});
afterEach(() => {
  client.cancel();
  window.removeEventListener("pagehide", client.cancel);
  window.removeEventListener("unload", client.cancel);
  Reflect.deleteProperty(window, "__sorng_autologin");
  Reflect.deleteProperty(window, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("reviewed HTTP application login forms", () => {
  it.each(["manual", "form"] as const)(
    "marks only a valid Tactical RMM %s profile for proxy routing",
    (loginMode) => {
      expect(
        getReviewedApplicationProfile({
          httpApplication: { version: 1, id: "tacticalrmm", loginMode },
        }),
      ).toBe("tacticalrmm");
    },
  );

  it.each(["manual", "form"] as const)(
    "marks a valid cPanel %s profile for its guarded login readiness path",
    (loginMode) => {
      expect(
        getReviewedApplicationProfile({
          httpApplication: { version: 1, id: "cpanel", loginMode },
        }),
      ).toBe("cpanel");
    },
  );

  it.each([
    undefined,
    null,
    { version: 1, id: "generic-form", loginMode: "form" },
    { version: 1, id: "tacticalrmm", loginMode: "unknown" },
    { version: 1, id: "tacticalrmm", loginMode: "form", invalid: true },
    { version: 1, id: "unknown", loginMode: "form" },
  ] as const)(
    "does not mark a generic or invalid application profile %j",
    (httpApplication) => {
      expect(
        getReviewedApplicationProfile({
          httpApplication: httpApplication as never,
        }),
      ).toBeUndefined();
    },
  );

  it.each(Object.keys(forms) as (keyof typeof forms)[])(
    "fills only the primary %s form with the real injected client",
    async (id) => {
      const profile = getHttpApplicationProfile(id)!;
      document.body.innerHTML =
        forms[id] +
        '<form id="unrelated"><input name="username"><input type="password"><button type="submit">Other</button></form>';
      for (const element of document.querySelectorAll("input,button"))
        Object.defineProperty(element, "offsetParent", {
          get: () => document.body,
        });
      const submit = vi.fn((event: Event) => event.preventDefault());
      document.addEventListener("submit", submit);
      const spaLogin = vi.fn();
      if (id === "brevo")
        document
          .querySelector('[data-testid="submit-button"]')!
          .addEventListener("click", spaLogin);
      const credentials = {
        username: "fixture-user@example.test",
        password: "fixture-password",
      };
      const result = await client.bootstrap(credentials, {
        username: profile.selectors!.usernameSelector,
        password: profile.selectors!.passwordSelector,
        submit: profile.selectors!.submitSelector,
      });
      expect(result).toMatchObject({ ok: true, reason: "submitted" });
      if (id === "brevo") {
        expect(spaLogin).toHaveBeenCalledOnce();
        expect(submit).not.toHaveBeenCalled();
      } else expect(submit).toHaveBeenCalledOnce();
      expect(
        (
          document.querySelector(
            profile.selectors!.usernameSelector!,
          ) as HTMLInputElement
        ).value,
      ).toBe("fixture-user@example.test");
      expect(
        (
          document.querySelector(
            profile.selectors!.passwordSelector!,
          ) as HTMLInputElement
        ).value,
      ).toBe("fixture-password");
      expect(
        (
          document.querySelector(
            '#unrelated input[type="password"]',
          ) as HTMLInputElement
        ).value,
      ).toBe("");
      expect(
        (
          document.querySelector(
            '[autocomplete="one-time-code"]',
          ) as HTMLInputElement | null
        )?.value ?? "",
      ).toBe("");
      expect(credentials).toEqual({ username: null, password: null });
      document.removeEventListener("submit", submit);
    },
  );
  it.each(Object.keys(forms))(
    "%s is manual until explicit form consent and never converts API headers",
    (id) => {
      const connection = {
        httpApplication: {
          version: 1 as const,
          id,
          loginMode: "manual" as const,
        },
        username: "fixture",
        password: "fixture",
        httpAutoLogin: true,
        httpHeaders: { Authorization: "Bearer api-token" },
      };
      expect(resolveHttpApplicationLogin(connection)).toEqual({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      expect(
        resolveHttpApplicationLogin({
          ...connection,
          httpApplication: { ...connection.httpApplication, loginMode: "form" },
        }),
      ).toMatchObject({
        autoLogin: true,
        upstreamAuthMode: "none",
        selectors: getHttpApplicationProfile(id)!.selectors,
      });
    },
  );
  it("requires actual Tactical target HTTPS including stale session targets", () => {
    const connection = {
      protocol: "https" as const,
      hostname: "rmm.example.test",
      httpApplication: {
        version: 1 as const,
        id: "tacticalrmm",
        loginMode: "manual" as const,
      },
    };
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://rmm.example.test:8443/login",
      ),
    ).not.toThrow();
    for (const url of [
      "http://rmm.example.test/login",
      "https://user:password@rmm.example.test/",
      "not-url",
    ])
      expect(() => validateHttpApplicationTarget(connection, url)).toThrow(
        /Tactical RMM requires/,
      );
  });
  it("WordPress TOTP does not match email, backup or enrollment forms", () => {
    const challenge =
      getHttpApplicationProfile("wordpress")!.totpChallenges![0];
    document.body.innerHTML =
      '<form name="validate_2fa_form" method="post"><input name="provider" value="Two_Factor_Totp" type="hidden"><input id="authcode" autocomplete="one-time-code"><input id="submit" type="submit"></form>';
    expect(document.querySelector(challenge.codeSelector)).not.toBeNull();
    (document.querySelector('[name="provider"]') as HTMLInputElement).value =
      "Two_Factor_Email";
    expect(document.querySelector(challenge.codeSelector)).toBeNull();
    document.body.innerHTML =
      '<form><input id="two-factor-totp-authcode" autocomplete="one-time-code"></form>';
    expect(document.querySelector(challenge.codeSelector)).toBeNull();
  });
  it("Guacamole TOTP excludes enrollment", () => {
    const challenge =
      getHttpApplicationProfile("guacamole")!.totpChallenges![0];
    document.body.innerHTML =
      '<form class="login-form"><div class="totp-code-field"><div class="totp-enroll ng-hide"></div><div class="totp-code"><input name="guac-totp"></div></div><input class="continue-login" name="login" type="submit"></form>';
    expect(document.querySelector(challenge.codeSelector)).not.toBeNull();
    document.querySelector(".totp-enroll")!.classList.remove("ng-hide");
    expect(document.querySelector(challenge.codeSelector)).toBeNull();
  });
  it("Gitea TOTP excludes scratch recovery codes and account enrollment", () => {
    const challenge = getHttpApplicationProfile("gitea")!.totpChallenges![0];
    document.body.innerHTML =
      '<form action="/user/two_factor" method="post"><input id="passcode" name="passcode" autocomplete="one-time-code"><button class="ui primary">Verify</button></form>';
    expect(document.querySelector(challenge.codeSelector)).not.toBeNull();
    for (const action of [
      "/user/two_factor/scratch",
      "/user/settings/security/two_factor/enroll",
    ]) {
      document.querySelector("form")!.setAttribute("action", action);
      expect(document.querySelector(challenge.codeSelector)).toBeNull();
    }
  });
});
