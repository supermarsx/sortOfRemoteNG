import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import { DEFAULT_HTTP_FORM_AUTOMATION } from "../../src/utils/connection/httpFormAutomation";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  resolveCredential: vi.fn(),
  connections: [] as Connection[],
  settings: {} as GlobalSettings,
  ready: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mocks.connections, sessions: [] },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: mocks.settings, settingsReady: mocks.ready }),
}));
vi.mock("../../src/hooks/security/useRuntimeCredentialVault", () => ({
  useRuntimeCredentialVault: () => mocks.resolveCredential,
}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => "http://proxy.example.test:3128",
}));
// Isolate the secondary consumer from the main browser's unrelated hooks.
vi.mock("../../src/hooks/protocol/useWebBrowser", () => ({
  validateProtectedProxyUrl: (response: { proxy_url: string }) =>
    response.proxy_url,
}));

import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";

const session: ConnectionSession = {
  id: "compatibility-tab",
  connectionId: "compatibility-site",
  name: "Website",
  hostname: "site.example.test",
  protocol: "https",
  status: "connected",
  startTime: new Date(),
};

const starts = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === "start_basic_auth_proxy",
  );
const config = () => {
  const calls = starts();
  return calls[calls.length - 1][1].config;
};
const browserSettings = (value: unknown) => {
  mocks.settings = { webBrowser: value } as GlobalSettings;
};

async function connected() {
  const hook = renderHook(() => useHTTPViewer(session));
  await waitFor(() => expect(hook.result.current.status).toBe("connected"));
  return hook;
}

beforeEach(() => {
  mocks.ready = true;
  mocks.settings = {} as GlobalSettings;
  mocks.connections = [
    {
      id: session.connectionId,
      name: session.name,
      hostname: session.hostname,
      protocol: "https",
      port: 443,
      httpVerifySsl: true,
      httpHeaders: { "uSeR-aGeNt": "Saved-Identity/1", "X-Client": "fixture" },
      isGroup: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  mocks.dispatch.mockReset();
  mocks.resolveCredential.mockReset().mockResolvedValue(null);
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "start_basic_auth_proxy")
      return {
        session_id: "compatibility-proxy",
        local_port: 43081,
        proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
      };
    if (command === "stop_basic_auth_proxy") return;
    throw new Error(`Unexpected native command: ${command}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HTTP viewer browser compatibility", () => {
  it("defaults to native identity without changing saved headers or proxy/TLS settings", async () => {
    const saved = mocks.connections[0];
    saved.authType = "header";
    saved.httpHeaders!.Authorization = "Bearer fixture";
    Object.freeze(saved.httpHeaders);
    Object.freeze(saved);
    await connected();
    expect(config()).toMatchObject({
      custom_headers: {
        "X-Client": "fixture",
        Authorization: "Bearer fixture",
      },
      upstream_auth_mode: "header",
      upstream_proxy_url: "http://proxy.example.test:3128",
      verify_ssl: true,
      http_auto_login: false,
    });
    expect(saved.httpHeaders!["uSeR-aGeNt"]).toBe("Saved-Identity/1");
    expect(config().http_form_automation).toEqual({
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submit: false,
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("retains an explicit UA override and saved fill-only consent when preferences are off", async () => {
    browserSettings({ preferNativeUserAgent: false, manualFormSubmit: false });
    mocks.connections[0].httpFormAutomation = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submit: false,
    };
    await connected();
    expect(config().custom_headers).toEqual(mocks.connections[0].httpHeaders);
    expect(config().http_form_automation.submit).toBe(false);
  });

  it("restricts form submission while preserving saved timing, fields and login consent", async () => {
    browserSettings({ manualFormSubmit: true });
    const saved = mocks.connections[0];
    saved.authType = "basic";
    saved.basicAuthUsername = "fixture-user";
    saved.basicAuthPassword = "fixture-password";
    saved.httpAutoLogin = true;
    saved.httpFormAutomation = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      formSelector: "#login",
      fillDelayMs: 250,
      submitDelayMs: 500,
      fields: [{ selector: "#tenant", value: "fixture-tenant" }],
    };
    const original = structuredClone(saved.httpFormAutomation);
    Object.freeze(saved.httpFormAutomation.fields[0]);
    Object.freeze(saved.httpFormAutomation.fields);
    Object.freeze(saved.httpFormAutomation);
    Object.freeze(saved);
    await connected();
    expect(config().http_form_automation).toEqual({
      ...original,
      submit: false,
    });
    expect(config().http_auto_login).toBe(true);
    expect(saved.httpFormAutomation).toEqual(original);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("creates fill-only defaults without arming automatic login", async () => {
    browserSettings({ manualFormSubmit: true });
    await connected();
    expect(config().http_form_automation).toEqual({
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submit: false,
    });
    expect(config().http_auto_login).toBe(false);
    expect(mocks.connections[0].httpFormAutomation).toBeUndefined();
  });

  it("forwards opt-in indicator settings and timing while keeping native language and login consent", async () => {
    browserSettings({
      hideAutomationIndicator: true,
      minimumFormFillDelayMs: 1200,
      minimumFormSubmitDelayMs: 1800,
    });
    mocks.connections[0].httpHeaders!["Accept-Language"] = "fr-FR";
    await connected();
    expect(config().browser_compatibility).toEqual({ hide_webdriver: true });
    expect(config().custom_headers).toEqual({ "X-Client": "fixture" });
    expect(config().http_form_automation).toMatchObject({
      fillDelayMs: 1200,
      submitDelayMs: 1800,
    });
    expect(config().http_auto_login).toBe(false);
    expect(mocks.connections[0].httpHeaders!["Accept-Language"]).toBe("fr-FR");
  });

  it("does not revive legacy generic headers for an application profile", async () => {
    browserSettings({ preferNativeUserAgent: false });
    mocks.connections[0].httpApplication = {
      version: 1,
      id: "pfsense",
      loginMode: "manual",
    };
    mocks.connections[0].authType = "header";
    mocks.connections[0].httpHeaders!.Authorization = "Bearer legacy";
    await connected();
    expect(config().custom_headers).toEqual({});
    expect(config().upstream_auth_mode).toBe("none");
    expect(config().http_auto_login).toBe(false);
  });

  it("does not send unsupported global delay overrides to a staged login adapter", async () => {
    browserSettings({
      // Automatic submission is an explicit saved choice, not a missing default.
      manualFormSubmit: false,
      hideAutomationIndicator: true,
      minimumFormFillDelayMs: 1200,
      minimumFormSubmitDelayMs: 1800,
    });
    Object.assign(mocks.connections[0], {
      httpApplication: {
        version: 1,
        id: "bitwarden-self-hosted",
        loginMode: "form",
      },
      basicAuthUsername: "fixture-user@example.test",
      basicAuthPassword: "fixture-password",
    });
    await connected();
    expect(config().browser_compatibility).toEqual({ hide_webdriver: true });
    expect(config().upstream_auth_mode).toBe("bitwarden-form");
    expect(config().http_form_automation).toBeUndefined();
    expect(config().http_auto_login).toBe(true);
  });

  const invalidHeaders: Record<string, string>[] = [
    { "User-Agent": "invalid\r\nvalue" },
    { "User-Agent": "first", "user-agent": "duplicate" },
    { "Sec-CH-UA": '"Invented";v="1"' },
    { Authorization: "Bearer unauthorized" },
  ];
  it.each(invalidHeaders)(
    "refuses invalid headers before compatibility filtering: %j",
    async (headers) => {
      mocks.connections[0].httpHeaders = headers;
      const hook = renderHook(() => useHTTPViewer(session));
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(starts()).toHaveLength(0);
    },
  );

  it("refuses invalid saved form options before manual-submit replacement", async () => {
    browserSettings({ manualFormSubmit: true });
    mocks.connections[0].httpFormAutomation = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submit: "invalid",
    } as unknown as Connection["httpFormAutomation"];
    const hook = renderHook(() => useHTTPViewer(session));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(starts()).toHaveLength(0);
  });

  it("refuses malformed browser preferences", async () => {
    browserSettings({ preferNativeUserAgent: "true" });
    const hook = renderHook(() => useHTTPViewer(session));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(starts()).toHaveLength(0);
  });

  it("waits for settings and applies changed preferences on the next proxy start", async () => {
    mocks.ready = false;
    const hook = renderHook(() => useHTTPViewer(session));
    expect(starts()).toHaveLength(0);
    mocks.ready = true;
    hook.rerender();
    await waitFor(() => expect(hook.result.current.status).toBe("connected"));
    expect(config().custom_headers).toEqual({ "X-Client": "fixture" });

    browserSettings({ preferNativeUserAgent: false, manualFormSubmit: true });
    hook.rerender();
    expect(starts()).toHaveLength(1);
    await act(async () => hook.result.current.initProxy());
    expect(starts()).toHaveLength(2);
    expect(config().custom_headers["uSeR-aGeNt"]).toBe("Saved-Identity/1");
    expect(config().http_form_automation.submit).toBe(false);
  });
});
