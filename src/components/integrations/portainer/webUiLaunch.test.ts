import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPortainerWebUiConnection,
  launchPortainerWebUi,
  parsePortainerWebUiTarget,
  PORTAINER_AUTO_LOGIN_SELECTORS,
  PORTAINER_OPEN_WEB_UI_EVENT,
  type OpenRuntimeConnectionDetail,
} from "./webUiLaunch";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../../utils/session/runtimeConnectionRegistry";

describe("parsePortainerWebUiTarget", () => {
  it("parses https with explicit port", () => {
    expect(parsePortainerWebUiTarget("https://pt.example.com:9443/")).toEqual({
      protocol: "https",
      hostname: "pt.example.com",
      port: 9443,
      useSsl: true,
    });
  });

  it("parses http with explicit port", () => {
    expect(parsePortainerWebUiTarget("http://127.0.0.1:19000")).toEqual({
      protocol: "http",
      hostname: "127.0.0.1",
      port: 19000,
      useSsl: false,
    });
  });

  it("defaults to https:9443 without scheme/port and http:9000 for http", () => {
    expect(parsePortainerWebUiTarget("portainer.lan")).toMatchObject({
      protocol: "https",
      port: 9443,
      useSsl: true,
    });
    expect(parsePortainerWebUiTarget("http://portainer.lan")).toMatchObject({
      protocol: "http",
      port: 9000,
      useSsl: false,
    });
  });

  it("rejects empty and non-http schemes", () => {
    expect(() => parsePortainerWebUiTarget("   ")).toThrow(/empty/);
    expect(() => parsePortainerWebUiTarget("ftp://x")).toThrow(/scheme/);
  });
});

describe("buildPortainerWebUiConnection", () => {
  const base = {
    baseUrl: "https://pt.example.com:9443",
    id: "fixed-id",
    now: () => "2026-08-26T00:00:00.000Z",
  };

  it("arms auto-login with Portainer selectors in password mode", () => {
    const c = buildPortainerWebUiConnection({
      ...base,
      authMode: "password",
      username: "admin",
      password: "s3cret-password",
    });
    expect(c).toMatchObject({
      id: "fixed-id",
      protocol: "https",
      hostname: "pt.example.com",
      port: 9443,
      isGroup: false,
      username: "admin",
      password: "s3cret-password",
      httpAutoLogin: true,
      httpAutoLoginSelectors: {
        usernameSelector: "input#username",
        passwordSelector: "input#password",
        submitSelector: "button[type=submit]",
      },
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    expect(c.name).toBe("Portainer (pt.example.com)");
    expect(c.httpVerifySsl).toBeUndefined();
  });

  it("exposes the selectors constant used above", () => {
    expect(PORTAINER_AUTO_LOGIN_SELECTORS).toEqual({
      usernameSelector: "input#username",
      passwordSelector: "input#password",
      submitSelector: "button[type=submit]",
    });
    expect(Object.isFrozen(PORTAINER_AUTO_LOGIN_SELECTORS)).toBe(true);
  });

  it("never carries a password and does not auto-login in apiKey mode", () => {
    const c = buildPortainerWebUiConnection({
      ...base,
      authMode: "apiKey",
      username: "admin",
      password: "should-not-leak",
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.password).toBeUndefined();
    expect(c.username).toBeUndefined();
    expect(c.httpAutoLoginSelectors).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain("should-not-leak");
  });

  it("does not auto-login when password-mode credentials are incomplete", () => {
    const c = buildPortainerWebUiConnection({
      ...base,
      authMode: "password",
      username: "admin",
      password: "",
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.password).toBeUndefined();
  });

  it("maps the self-signed toggle to httpVerifySsl=false only over https", () => {
    const tls = buildPortainerWebUiConnection({
      ...base,
      authMode: "apiKey",
      skipTlsVerify: true,
    });
    expect(tls.httpVerifySsl).toBe(false);
    const plain = buildPortainerWebUiConnection({
      ...base,
      baseUrl: "http://pt.example.com:9000",
      authMode: "apiKey",
      skipTlsVerify: true,
    });
    expect(plain.httpVerifySsl).toBeUndefined();
  });

  it("uses a custom name when given", () => {
    const c = buildPortainerWebUiConnection({
      ...base,
      authMode: "apiKey",
      name: "  Prod Portainer ",
    });
    expect(c.name).toBe("Prod Portainer");
  });
});

describe("launchPortainerWebUi", () => {
  beforeEach(() => clearRuntimeConnectionsForTests());
  afterEach(() => clearRuntimeConnectionsForTests());

  it("registers the runtime connection and dispatches the open event", () => {
    const listener = vi.fn();
    window.addEventListener(PORTAINER_OPEN_WEB_UI_EVENT, listener);
    try {
      const c = launchPortainerWebUi({
        baseUrl: "https://pt.example.com:9443",
        authMode: "password",
        username: "admin",
        password: "pw-pw-pw-pw-pw",
        id: "launch-1",
      });
      expect(resolveRuntimeConnection([], "launch-1")).toBe(c);
      expect(listener).toHaveBeenCalledTimes(1);
      const detail = (listener.mock.calls[0][0] as CustomEvent)
        .detail as OpenRuntimeConnectionDetail;
      expect(detail.source).toBe("portainer");
      expect(detail.connection).toBe(c);
      expect(detail.connection.httpAutoLogin).toBe(true);
    } finally {
      window.removeEventListener(PORTAINER_OPEN_WEB_UI_EVENT, listener);
    }
  });
});
