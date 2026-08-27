import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import {
  buildVoipPhoneConfig,
  buildVoipPhoneWebUiConnection,
  normalizeVoipPhoneStatus,
  normalizeWebLoginHint,
  voipPhoneRuntimeAdapter,
} from "../../src/utils/session/voipPhoneRuntimeAdapter";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "phone-1",
  name: "Reception phone",
  protocol: "voip-phone",
  hostname: "10.0.0.50",
  port: 80,
  username: "admin",
  password: "s3cret-sentinel",
  isGroup: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  voipPhoneSettings: { vendor: "yealink" },
  ...overrides,
});

describe("voipPhoneRuntimeAdapter", () => {
  beforeEach(() => invoke.mockReset());

  it("builds the connect payload from the saved connection with defaults", () => {
    expect(buildVoipPhoneConfig(connection())).toEqual({
      host: "10.0.0.50",
      port: 80,
      useSsl: false,
      verifyCert: true,
      vendor: "yealink",
      username: "admin",
      password: "s3cret-sentinel",
      timeoutSecs: 15,
      authMode: "auto",
      actionUriEnabled: false,
    });
    expect(
      buildVoipPhoneConfig(
        connection({
          port: 8443,
          voipPhoneSettings: {
            vendor: "yealink",
            useSsl: true,
            verifyCert: false,
            authMode: "form",
            actionUriEnabled: true,
            timeoutSecs: 5,
          },
        }),
      ),
    ).toMatchObject({
      port: 8443,
      useSsl: true,
      verifyCert: false,
      authMode: "form",
      actionUriEnabled: true,
      timeoutSecs: 5,
    });
  });

  it("invokes the voip_phone_* commands keyed by the session id", async () => {
    invoke.mockResolvedValueOnce({
      id: "sess",
      host: "10.0.0.50",
      vendor: "yealink",
      generation: "servlet",
      authShape: "form-plain",
      webUiUrl: "http://10.0.0.50:80/",
    });
    const summary = await voipPhoneRuntimeAdapter.connect("sess", connection());
    expect(invoke).toHaveBeenCalledWith("voip_phone_connect", {
      id: "sess",
      config: expect.objectContaining({
        host: "10.0.0.50",
        password: "s3cret-sentinel",
      }),
    });
    expect(summary.generation).toBe("servlet");

    invoke.mockResolvedValueOnce(undefined);
    await voipPhoneRuntimeAdapter.disconnect("sess");
    expect(invoke).toHaveBeenLastCalledWith("voip_phone_disconnect", {
      id: "sess",
    });

    invoke.mockResolvedValueOnce({ method: "web-form", accepted: true });
    await expect(voipPhoneRuntimeAdapter.reboot("sess")).resolves.toEqual({
      method: "web-form",
      accepted: true,
    });
    expect(invoke).toHaveBeenLastCalledWith("voip_phone_reboot", {
      id: "sess",
    });

    invoke.mockResolvedValueOnce({
      formLogin: true,
      loginUrl: "http://10.0.0.50/servlet?m=mod_listener&p=login&q=loginForm",
      usernameSelector: "input[name=username]",
      passwordSelector: "input[name=pwd]",
      submitSelector: null,
      note: null,
    });
    await expect(voipPhoneRuntimeAdapter.webLoginHint("sess")).resolves.toEqual(
      {
        formLogin: true,
        loginUrl: "http://10.0.0.50/servlet?m=mod_listener&p=login&q=loginForm",
        note: undefined,
        selectors: {
          usernameSelector: "input[name=username]",
          passwordSelector: "input[name=pwd]",
          submitSelector: undefined,
        },
      },
    );
    expect(invoke).toHaveBeenLastCalledWith("voip_phone_web_login_hint", {
      id: "sess",
    });
  });

  it("normalises status payloads and tolerates missing fields", async () => {
    invoke.mockResolvedValueOnce({
      vendor: "yealink",
      model: " SIP-T21P_E2 ",
      firmware: "52.84.0.15",
      mac: "00:15:65:AA:BB:CC",
      ip: "10.0.0.50",
      generation: "servlet",
      authShape: "form-rsa",
      accounts: [
        { index: 1, label: "Account 1", user: "201", registered: true },
        { label: "Account 2", registered: "yes" },
      ],
      rawFields: { "Product Name": "SIP-T21P_E2", Empty: "" },
    });
    const status = await voipPhoneRuntimeAdapter.loadStatus("sess");
    expect(invoke).toHaveBeenCalledWith("voip_phone_get_status", {
      id: "sess",
    });
    expect(status.model).toBe("SIP-T21P_E2");
    expect(status.uptime).toBeUndefined();
    expect(status.accounts).toEqual([
      expect.objectContaining({ index: 1, user: "201", registered: true }),
      expect.objectContaining({ index: 2, registered: false }),
    ]);
    expect(status.rawFields).toEqual({ "Product Name": "SIP-T21P_E2" });

    expect(() => normalizeVoipPhoneStatus(null)).toThrow(/invalid status/);
    expect(
      normalizeVoipPhoneStatus({ generation: "bogus", authShape: "bogus" }),
    ).toMatchObject({ generation: "legacy", authShape: "basic", accounts: [] });
  });

  it("builds a form-login web UI connection with selectors and no basic pair", () => {
    const hint = normalizeWebLoginHint({
      formLogin: true,
      usernameSelector: "input[name=username]",
      passwordSelector: "input[name=pwd]",
      submitSelector: "#login",
    });
    const web = buildVoipPhoneWebUiConnection(connection(), hint);
    expect(web.id).not.toBe("phone-1");
    expect(web).toMatchObject({
      protocol: "http",
      hostname: "10.0.0.50",
      port: 80,
      username: "admin",
      password: "s3cret-sentinel",
      httpAutoLogin: true,
      httpAutoLoginSelectors: {
        usernameSelector: "input[name=username]",
        passwordSelector: "input[name=pwd]",
        submitSelector: "#login",
      },
      httpVerifySsl: true,
    });
    expect(web.authType).toBeUndefined();
    expect(web.basicAuthUsername).toBeUndefined();
  });

  it("builds a basic-auth https web UI connection for legacy firmware", () => {
    const web = buildVoipPhoneWebUiConnection(
      connection({
        port: 443,
        voipPhoneSettings: {
          vendor: "yealink",
          useSsl: true,
          verifyCert: false,
        },
      }),
      normalizeWebLoginHint({ formLogin: false }),
    );
    expect(web).toMatchObject({
      protocol: "https",
      port: 443,
      authType: "basic",
      basicAuthUsername: "admin",
      basicAuthPassword: "s3cret-sentinel",
      httpAutoLogin: false,
      httpVerifySsl: false,
    });
    expect(web.httpAutoLoginSelectors).toBeUndefined();
  });
});
