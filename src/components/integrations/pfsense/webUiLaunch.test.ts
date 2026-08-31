import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPfsenseWebUiConnection,
  launchPfsenseWebUi,
  PFSENSE_AUTO_LOGIN_SELECTORS,
  PFSENSE_OPEN_WEB_UI_EVENT,
  type PfsenseOpenRuntimeConnectionDetail,
} from "./webUiLaunch";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../../utils/session/runtimeConnectionRegistry";

describe("pfSense WebGUI launch", () => {
  beforeEach(() => clearRuntimeConnectionsForTests());
  afterEach(() => clearRuntimeConnectionsForTests());

  it("hard-wires the pfSense login form selectors", () => {
    expect(PFSENSE_AUTO_LOGIN_SELECTORS).toEqual({
      usernameSelector: "input#usernamefld",
      passwordSelector: "input#passwordfld",
      submitSelector: 'input[type="submit"][name="login"]',
    });
    expect(Object.isFrozen(PFSENSE_AUTO_LOGIN_SELECTORS)).toBe(true);
  });

  it("builds an HTTPS auto-login connection without persisting it", () => {
    const connection = buildPfsenseWebUiConnection({
      host: "fw.example.test",
      port: 8443,
      useTls: true,
      username: "admin",
      password: "web-secret",
      autoLogin: true,
      acceptInvalidCerts: true,
      id: "web-one",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    expect(connection).toMatchObject({
      id: "web-one",
      protocol: "https",
      hostname: "fw.example.test",
      port: 8443,
      icon: "pfsense",
      username: "admin",
      password: "web-secret",
      httpAutoLogin: true,
      httpVerifySsl: false,
      httpAutoLoginSelectors: PFSENSE_AUTO_LOGIN_SELECTORS,
    });
  });

  it("supports manual login without carrying incomplete credentials", () => {
    const connection = buildPfsenseWebUiConnection({
      host: "fw.example.test",
      port: 80,
      useTls: false,
      username: "admin",
      password: "",
      autoLogin: false,
    });
    expect(connection.httpAutoLogin).toBe(false);
    expect(connection.username).toBeUndefined();
    expect(connection.password).toBeUndefined();
  });

  it("registers and announces the ephemeral browser connection", () => {
    const listener = vi.fn();
    window.addEventListener(PFSENSE_OPEN_WEB_UI_EVENT, listener);
    try {
      const connection = launchPfsenseWebUi({
        host: "fw.example.test",
        port: 443,
        useTls: true,
        username: "admin",
        password: "web-secret",
        autoLogin: true,
        id: "web-runtime",
      });
      expect(resolveRuntimeConnection([], "web-runtime")).toBe(connection);
      const detail = (listener.mock.calls[0][0] as CustomEvent)
        .detail as PfsenseOpenRuntimeConnectionDetail;
      expect(detail.source).toBe("pfsense");
      expect(detail.connection).toBe(connection);
    } finally {
      window.removeEventListener(PFSENSE_OPEN_WEB_UI_EVENT, listener);
    }
  });
});
