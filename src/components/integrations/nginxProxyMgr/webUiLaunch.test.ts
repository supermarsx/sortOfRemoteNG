import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NPM_AUTO_LOGIN_SELECTORS,
  NPM_OPEN_WEB_UI_EVENT,
  buildNpmWebUiConnection,
  launchNpmWebUi,
  parseNpmWebUiTarget,
} from "./webUiLaunch";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../../utils/session/runtimeConnectionRegistry";
import { LOGIN_FORM_VARIANTS } from "../../../../scripts/ci/e2e-npm-fixture.mjs";

describe("parseNpmWebUiTarget", () => {
  it("defaults to http and port 81 when the scheme/port are omitted", () => {
    expect(parseNpmWebUiTarget("npm.example.com")).toEqual({
      protocol: "http",
      hostname: "npm.example.com",
      port: 81,
      useSsl: false,
    });
  });

  it("keeps an explicit port and strips a trailing path", () => {
    expect(parseNpmWebUiTarget("http://10.0.0.5:8181/")).toEqual({
      protocol: "http",
      hostname: "10.0.0.5",
      port: 8181,
      useSsl: false,
    });
  });

  it("uses port 443 for https without a port", () => {
    expect(parseNpmWebUiTarget("https://npm.example.com")).toMatchObject({
      protocol: "https",
      port: 443,
      useSsl: true,
    });
  });

  it("rejects empty and non-http schemes", () => {
    expect(() => parseNpmWebUiTarget("  ")).toThrow(/empty/);
    expect(() => parseNpmWebUiTarget("ftp://x")).toThrow(/Unsupported/);
  });
});

describe("NPM_AUTO_LOGIN_SELECTORS", () => {
  it("targets the modern (react) form first and the legacy (backbone) one as a fallback", () => {
    expect(NPM_AUTO_LOGIN_SELECTORS).toEqual({
      usernameSelector: 'input[name="email"], input[name="identity"]',
      passwordSelector: 'input[name="password"], input[name="secret"]',
      submitSelector: 'button[type="submit"]',
    });
    expect(Object.isFrozen(NPM_AUTO_LOGIN_SELECTORS)).toBe(true);
  });

  // The CI fixture's variant table is the source of truth for "which login
  // forms NPM ships". Deriving the expectation from it means a new NPM UI
  // shape added there fails HERE too, instead of only when a live container is
  // available.
  it.each(LOGIN_FORM_VARIANTS)(
    "covers the $id variant ($since)",
    ({ usernameSelector, passwordSelector, submitSelector }) => {
      const listed = (selectors: string | undefined) =>
        (selectors ?? "").split(",").map((part) => part.trim());
      expect(listed(NPM_AUTO_LOGIN_SELECTORS.usernameSelector)).toContain(
        usernameSelector,
      );
      expect(listed(NPM_AUTO_LOGIN_SELECTORS.passwordSelector)).toContain(
        passwordSelector,
      );
      expect(listed(NPM_AUTO_LOGIN_SELECTORS.submitSelector)).toContain(
        submitSelector,
      );
    },
  );

  it("resolves to the right input on each form and to nothing on neither", () => {
    const query = (html: string, selectors: string | undefined) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      const found = host.querySelector(selectors ?? "");
      return found ? (found as HTMLInputElement).name : null;
    };
    const react = `<form><input name="email" /><input name="password" type="password" /></form>`;
    const backbone = `<form><input name="identity" /><input name="secret" type="password" /></form>`;
    const unknown = `<form><input name="user" /><input name="pass" type="password" /></form>`;

    expect(query(react, NPM_AUTO_LOGIN_SELECTORS.usernameSelector)).toBe(
      "email",
    );
    expect(query(react, NPM_AUTO_LOGIN_SELECTORS.passwordSelector)).toBe(
      "password",
    );
    expect(query(backbone, NPM_AUTO_LOGIN_SELECTORS.usernameSelector)).toBe(
      "identity",
    );
    expect(query(backbone, NPM_AUTO_LOGIN_SELECTORS.passwordSelector)).toBe(
      "secret",
    );
    expect(
      query(unknown, NPM_AUTO_LOGIN_SELECTORS.usernameSelector),
    ).toBeNull();
  });
});

describe("buildNpmWebUiConnection", () => {
  const now = () => "2026-08-26T00:00:00.000Z";

  it("arms auto-login with credentials and selectors in password mode", () => {
    const c = buildNpmWebUiConnection({
      baseUrl: "http://npm.local:81",
      authMode: "password",
      email: "admin@example.com",
      password: "pw",
      id: "fixed",
      now,
    });
    expect(c).toMatchObject({
      id: "fixed",
      name: "Nginx Proxy Manager (npm.local)",
      protocol: "http",
      hostname: "npm.local",
      port: 81,
      isGroup: false,
      httpAutoLogin: true,
      username: "admin@example.com",
      password: "pw",
      httpAutoLoginSelectors: NPM_AUTO_LOGIN_SELECTORS,
      createdAt: now(),
    });
    expect(c.httpVerifySsl).toBeUndefined();
  });

  it("never carries a password or selectors in token mode", () => {
    const c = buildNpmWebUiConnection({
      baseUrl: "https://npm.local",
      authMode: "token",
      email: "admin@example.com",
      password: "should-not-leak",
      skipTlsVerify: true,
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.username).toBeUndefined();
    expect(c.password).toBeUndefined();
    expect(c.httpAutoLoginSelectors).toBeUndefined();
    expect(c.httpVerifySsl).toBe(false);
  });

  it("does not arm auto-login when password-mode credentials are blank", () => {
    const c = buildNpmWebUiConnection({
      baseUrl: "http://npm.local",
      authMode: "password",
      email: "",
      password: "",
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.password).toBeUndefined();
  });

  it("only disables TLS verification for https targets", () => {
    const c = buildNpmWebUiConnection({
      baseUrl: "http://npm.local",
      authMode: "password",
      skipTlsVerify: true,
    });
    expect(c.httpVerifySsl).toBeUndefined();
  });
});

describe("launchNpmWebUi", () => {
  beforeEach(() => clearRuntimeConnectionsForTests());
  afterEach(() => clearRuntimeConnectionsForTests());

  it("registers the runtime connection and dispatches the shared open event", () => {
    const listener = vi.fn();
    window.addEventListener(NPM_OPEN_WEB_UI_EVENT, listener);
    try {
      const c = launchNpmWebUi({
        baseUrl: "http://npm.local:81",
        authMode: "password",
        email: "a@b.c",
        password: "pw",
        id: "npm-1",
      });
      expect(resolveRuntimeConnection([], "npm-1")).toBe(c);
      expect(listener).toHaveBeenCalledTimes(1);
      const evt = listener.mock.calls[0][0] as CustomEvent;
      expect(evt.detail).toEqual({ connection: c, source: "nginxProxyMgr" });
    } finally {
      window.removeEventListener(NPM_OPEN_WEB_UI_EVENT, listener);
    }
  });
});
