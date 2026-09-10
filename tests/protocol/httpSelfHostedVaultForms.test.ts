import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";

const helper = readFileSync(
  "src-tauri/crates/sorng-protocols/src/bitwarden_autologin_client.js",
  "utf8",
);
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Client = {
  fetchCredsAndRun(nonce: string): Promise<unknown>;
  cancel(): void;
  bootstrap(creds: object, selectors: object): Promise<{ ok: boolean }>;
};
const win = window as unknown as {
  __sorng_autologin: Client;
  __sorng_bitwarden_login: { cancel(): void };
  __autologin_last?: { ok: boolean; reason: string };
};
const continuation = "b".repeat(32);
const credentials = {
  username: "person@example.test",
  password: "synthetic-master-secret",
};
let fetchMock: ReturnType<typeof vi.fn>;
let submitted: ReturnType<typeof vi.fn<(event: Event) => void>>;
function field(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}
function passwordScreen() {
  document.getElementById("email-stage")!.hidden = true;
  document.getElementById("password-stage")!.hidden = false;
}
function show() {
  // Minimal rendered web-v2026.7 template: both stage controls exist, only one is visible.
  document.body.innerHTML = `<form id="vault"><div id="email-stage"><input id="email" type="email" data-testid="login-email-input"><button id="next" type="button" data-testid="login-continue-button">Continue</button></div><div id="password-stage" hidden><input id="masterPassword" type="password" autocomplete="current-password" data-testid="login-master-password-input"><button id="submit" type="submit" data-testid="login-submit-button">Log in</button></div></form><form id="other"><input type="password"></form>`;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => (element.closest("[hidden]") ? null : document.body),
    });
  submitted = vi.fn((event: Event) => event.preventDefault());
  document.querySelector("form")!.addEventListener("submit", submitted);
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("phase=password")
        ? { loginFlow: "bitwarden", password: credentials.password }
        : {
            loginFlow: "bitwarden",
            username: credentials.username,
            continuation,
          },
  }));
  vi.stubGlobal("fetch", fetchMock);
  window.eval(helper);
  window.eval(source);
  show();
});
afterEach(() => {
  win.__sorng_autologin.cancel();
  for (const event of ["pagehide", "unload"])
    window.removeEventListener(event, win.__sorng_autologin.cancel);
  for (const event of ["pagehide", "unload", "hashchange", "popstate"])
    window.removeEventListener(event, win.__sorng_bitwarden_login.cancel);
  Reflect.deleteProperty(win, "__sorng_autologin");
  Reflect.deleteProperty(win, "__sorng_bitwarden_login");
  Reflect.deleteProperty(win, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("real reviewed web-vault client", () => {
  it("releases no password in email stage, then fills and submits once after the reviewed transition", async () => {
    const next = vi.fn();
    document.getElementById("next")!.addEventListener("click", next);
    const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledOnce();
    expect(field("email").value).toBe(credentials.username);
    expect(field("masterPassword").value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    passwordScreen();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    expect(field("masterPassword").value).toBe(credentials.password);
    expect(submitted).toHaveBeenCalledOnce();
    expect(
      (document.querySelector("#other input") as HTMLInputElement).value,
    ).toBe("");
    await win.__sorng_autologin.fetchCredsAndRun("new");
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submitted).toHaveBeenCalledOnce();
  });
  it.each([
    "external-action",
    "same-origin-action",
    "password-node",
    "form-node",
    "duplicate-control",
  ])(
    "refuses %s changes after email without requesting a password",
    async (change) => {
      const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
      await vi.advanceTimersByTimeAsync(0);
      if (change === "external-action")
        document.querySelector("form")!.action = "https://attacker.invalid/";
      if (change === "same-origin-action")
        document.querySelector("form")!.action = "/other-login";
      if (change === "password-node")
        field("masterPassword").replaceWith(
          field("masterPassword").cloneNode(true),
        );
      if (change === "form-node")
        document.querySelector("form")!.outerHTML =
          document.querySelector("form")!.outerHTML;
      if (change === "duplicate-control")
        field("email").after(field("email").cloneNode(true));
      passwordScreen();
      await vi.advanceTimersByTimeAsync(15000);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(submitted).not.toHaveBeenCalled();
      expect(win.__autologin_last?.ok).toBe(false);
    },
  );
  it.each(["pagehide", "hashchange", "popstate", "cancel"])(
    "revokes on %s with no second grant or submit",
    async (event) => {
      const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
      await vi.advanceTimersByTimeAsync(0);
      if (event === "cancel") win.__sorng_autologin.cancel();
      else window.dispatchEvent(new Event(event));
      passwordScreen();
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(submitted).not.toHaveBeenCalled();
    },
  );
  it("times out without retrying when the website rejects email or stays in SSO", async () => {
    const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(win.__autologin_last?.reason).toBe("reviewed-login-timeout");
  });
  it("does not guess an account when starting on a remembered-password screen", async () => {
    passwordScreen();
    await win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
  });
  it("refuses a late password reply after cancellation and scrubs the transport object", async () => {
    let resolve!: (reply: object) => void;
    const reply = { loginFlow: "bitwarden", password: credentials.password };
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        loginFlow: "bitwarden",
        username: credentials.username,
        continuation,
      }),
    }));
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    passwordScreen();
    await vi.advanceTimersByTimeAsync(0);
    win.__sorng_autologin.cancel();
    resolve({ ok: true, json: async () => reply });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(field("masterPassword").value).toBe("");
    expect(reply.password).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
  });
  it("does not fill a changed form when a password response arrives late", async () => {
    let resolve!: (reply: object) => void;
    const reply = { loginFlow: "bitwarden", password: credentials.password };
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        loginFlow: "bitwarden",
        username: credentials.username,
        continuation,
      }),
    }));
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    passwordScreen();
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector("form")!.action = "https://attacker.invalid/collect";
    resolve({ ok: true, json: async () => reply });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(field("masterPassword").value).toBe("");
    expect(reply.password).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
  });
  it("honors native grant refusal without retry", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        loginFlow: "bitwarden",
        username: credentials.username,
        continuation,
      }),
    }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    const pending = win.__sorng_autologin.fetchCredsAndRun("a".repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    passwordScreen();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(field("masterPassword").value).toBe("");
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe("self-hosted profile policy and Nextcloud", () => {
  it.each(["bitwarden-self-hosted", "vaultwarden", "nextcloud"])(
    "keeps %s manual/secret-free until explicit consent and enforces HTTPS",
    (id) => {
      const connection = {
        protocol: "https" as const,
        hostname: "private.example.test",
        ...credentials,
        httpApplication: {
          version: 1 as const,
          id,
          loginMode: "manual" as const,
        },
        httpAutoLogin: true,
      };
      expect(resolveHttpApplicationLogin(connection)).toEqual({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      expect(
        normalizeHttpApplicationSettings({ version: 1, id })?.loginMode,
      ).toBe("manual");
      expect(() =>
        validateHttpApplicationTarget(
          connection,
          "http://private.example.test/",
        ),
      ).toThrow("requires an HTTPS");
      expect(() =>
        validateHttpApplicationTarget(
          connection,
          "https://private.example.test:8443/",
        ),
      ).not.toThrow();
      expect(
        getHttpApplicationExternalTarget(
          connection,
          "https://private.example.test/?secret=never#token",
        )?.url,
      ).not.toMatch(/secret|token/);
      expect(
        getHttpApplicationExternalTarget(
          connection,
          "https://other.example.test/",
        ),
      ).toBeNull();
      expect(
        resolveHttpApplicationLogin({
          ...connection,
          httpApplication: { ...connection.httpApplication, loginMode: "form" },
        }),
      ).toMatchObject({
        autoLogin: true,
        upstreamAuthMode: id === "nextcloud" ? "none" : "bitwarden-form",
      });
    },
  );
  it("fills Nextcloud's POST form once and preserves its request token and unrelated OTP", async () => {
    document.body.innerHTML =
      '<form class="login-form" name="login" method="post"><input id="user" name="user"><input id="password" name="password" type="password"><input type="hidden" name="requesttoken" value="site-managed"><button type="submit">Log in</button></form><form class="totp-form" method="POST"><input name="challenge" autocomplete="one-time-code" inputmode="numeric"><button class="two-factor-submit" type="submit">Verify</button></form>';
    for (const element of document.querySelectorAll("input,button"))
      Object.defineProperty(element, "offsetParent", {
        get: () => document.body,
      });
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    const selectors = getHttpApplicationProfile("nextcloud")!.selectors!;
    const result = await win.__sorng_autologin.bootstrap(
      { ...credentials },
      {
        username: selectors.usernameSelector,
        password: selectors.passwordSelector,
        submit: selectors.submitSelector,
      },
    );
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(field("password").value).toBe(credentials.password);
    expect(
      (document.querySelector('[name="requesttoken"]') as HTMLInputElement)
        .value,
    ).toBe("site-managed");
    expect(
      (document.querySelector('[name="challenge"]') as HTMLInputElement).value,
    ).toBe("");
  });
  it("authenticator selectors exclude email, recovery and enrollment fields", () => {
    for (const id of ["bitwarden-self-hosted", "vaultwarden"]) {
      const selector =
        getHttpApplicationProfile(id)!.totpChallenges![0].codeSelector;
      document.body.innerHTML =
        '<app-two-factor-auth><form><app-two-factor-auth-authenticator><input type="text"></app-two-factor-auth-authenticator><button type="submit">Continue</button></form></app-two-factor-auth>';
      expect(document.querySelector(selector)).not.toBeNull();
      document.body.innerHTML = document.body.innerHTML
        .split("app-two-factor-auth-authenticator")
        .join("app-two-factor-auth-email");
      expect(document.querySelector(selector)).toBeNull();
    }
    const challenge =
      getHttpApplicationProfile("nextcloud")!.totpChallenges![0];
    expect(challenge.paths).toEqual([
      "/login/challenge/totp",
      "/index.php/login/challenge/totp",
    ]);
    document.body.innerHTML =
      '<form method="POST"><input name="challenge" autocomplete="one-time-code" inputmode="numeric"></form>';
    expect(document.querySelector(challenge.codeSelector)).toBeNull();
  });
});
