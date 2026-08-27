import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
}));

import {
  buildProxmoxWebUiConnection,
  buildProxmoxWebUiUrl,
  launchProxmoxWebUi,
  openProxmoxWebUiExternal,
  qualifyUsername,
  PROXMOX_AUTO_LOGIN_SELECTORS,
  PROXMOX_OPEN_WEB_UI_EVENT,
} from "./webUiLaunch";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../../utils/session/runtimeConnectionRegistry";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  clearRuntimeConnectionsForTests();
});

describe("qualifyUsername", () => {
  it("appends the realm (pam default) unless the username already has one", () => {
    expect(qualifyUsername("root", undefined)).toBe("root@pam");
    expect(qualifyUsername("ops", "pve")).toBe("ops@pve");
    expect(qualifyUsername("ops@ldap", "pve")).toBe("ops@ldap");
    expect(qualifyUsername("", "pve")).toBe("");
  });
});

describe("buildProxmoxWebUiUrl", () => {
  it("builds the base URL and deep links", () => {
    expect(buildProxmoxWebUiUrl("pve.lab")).toBe("https://pve.lab:8006/");
    expect(buildProxmoxWebUiUrl("::1", 8006)).toBe("https://[::1]:8006/");
    expect(
      buildProxmoxWebUiUrl("pve.lab", 8006, { kind: "qemu", id: "100" }),
    ).toBe("https://pve.lab:8006/#v1:0:=qemu%2F100");
    expect(() => buildProxmoxWebUiUrl("", 8006)).toThrow();
    expect(() => buildProxmoxWebUiUrl("pve.lab", 70000)).toThrow();
  });
});

describe("buildProxmoxWebUiConnection", () => {
  it("arms auto-login with PVE selectors in password mode", () => {
    const c = buildProxmoxWebUiConnection({
      host: "pve.lab",
      port: 8006,
      authMode: "password",
      username: "root",
      realm: "pam",
      password: "pw",
      insecure: true,
      id: "fixed",
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(c).toMatchObject({
      id: "fixed",
      name: "Proxmox VE (pve.lab)",
      protocol: "https",
      hostname: "pve.lab",
      port: 8006,
      username: "root@pam",
      password: "pw",
      httpAutoLogin: true,
      httpVerifySsl: false,
      httpAutoLoginSelectors: PROXMOX_AUTO_LOGIN_SELECTORS,
      isGroup: false,
    });
  });

  it("opens without auto-login and without a password in API-token mode", () => {
    const c = buildProxmoxWebUiConnection({
      host: "pve.lab",
      authMode: "apitoken",
      username: "automation@pve!ci",
      password: "should-not-leak",
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.password).toBeUndefined();
    expect(c.username).toBeUndefined();
    expect(c.httpAutoLoginSelectors).toBeUndefined();
    expect(c.httpVerifySsl).toBeUndefined();
  });

  it("does not auto-login when the password is missing", () => {
    const c = buildProxmoxWebUiConnection({
      host: "pve.lab",
      authMode: "password",
      username: "root@pam",
      password: "",
    });
    expect(c.httpAutoLogin).toBe(false);
    expect(c.password).toBeUndefined();
  });
});

describe("launchProxmoxWebUi", () => {
  it("registers the runtime connection and dispatches the open event", () => {
    const seen: CustomEvent[] = [];
    const listener = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    try {
      const c = launchProxmoxWebUi({
        host: "pve.lab",
        authMode: "password",
        username: "root@pam",
        password: "pw",
      });
      expect(resolveRuntimeConnection([], c.id)).toBe(c);
      expect(seen).toHaveLength(1);
      expect(seen[0].detail).toEqual({ connection: c, source: "proxmox" });
    } finally {
      window.removeEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    }
  });
});

describe("openProxmoxWebUiExternal", () => {
  it("hands the URL to open_url_external", async () => {
    await openProxmoxWebUiExternal("pve.lab", 8006, { kind: "lxc", id: "200" });
    expect(invokeMock).toHaveBeenCalledWith("open_url_external", {
      url: "https://pve.lab:8006/#v1:0:=lxc%2F200",
    });
  });
});
