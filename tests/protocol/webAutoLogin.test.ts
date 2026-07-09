/**
 * t20-e6 — Frontend invoke-mapping test for web auto-login.
 *
 * Proves the e4 wiring contract: when a connection opts into web auto-login
 * (`httpAutoLogin`), the `start_basic_auth_proxy` invoke config carries the
 * camelCase Connection fields mapped to the snake_case BasicAuthProxyConfig
 * keys the proxy expects (`http_auto_login` + `http_auto_login_selectors`);
 * and when it does NOT opt in, the flag is `false` and selectors are omitted.
 *
 * This is a DIFFERENT level than the e3/e5 Rust unit tests (which check the
 * proxy/asset side): it pins the actual invoke payload the React hook sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  verifyIdentity,
  resolveEffectiveTrustPolicy,
} from "../../src/utils/auth/trustStore";

// ── Mocks for the hook's context / side-effect dependencies ──
const { mockDispatch, connections } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  connections: [] as Record<string, unknown>[],
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: vi.fn(() => ({
    state: { connections },
    dispatch: mockDispatch,
  })),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: vi.fn(() => ({
    settings: { theme: "dark" },
    updateSettings: vi.fn(),
  })),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: vi.fn(() => ({ toast: vi.fn() })),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: vi.fn(() => ({
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  })),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: vi.fn(() => ({})),
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  saveWebRecording: vi.fn(),
  trimWebRecordings: vi.fn(),
}));
vi.mock("../../src/utils/auth/trustStore", () => ({
  verifyIdentity: vi.fn(),
  trustIdentity: vi.fn(),
  resolveEffectiveTrustPolicy: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mockInvoke = vi.mocked(invoke);
const mockVerifyIdentity = vi.mocked(verifyIdentity);
const mockResolveEffectiveTrustPolicy = vi.mocked(resolveEffectiveTrustPolicy);

const session: ConnectionSession = {
  id: "sess-1",
  connectionId: "conn-1",
  name: "Device Panel",
  status: "connected",
  startTime: new Date(),
  protocol: "http",
  hostname: "device.local",
};

/** Pull the config object from the first `start_basic_auth_proxy` invoke. */
function lastProxyConfig(): Record<string, unknown> | undefined {
  const call = mockInvoke.mock.calls.find(
    (c) => c[0] === "start_basic_auth_proxy",
  );
  if (!call) return undefined;
  return (call[1] as { config: Record<string, unknown> }).config;
}

describe("useWebBrowser — web auto-login invoke mapping (t20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections.length = 0;
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      local_port: 9000,
      session_id: "proxy-1",
      proxy_url: "http://127.0.0.1:9000",
    });
  });

  it("maps httpAutoLogin + camelCase selectors to the snake_case config when armed", async () => {
    connections.push({
      id: "conn-1",
      name: "Device Panel",
      hostname: "device.local",
      protocol: "http",
      username: "admin",
      password: "devpass",
      httpVerifySsl: true,
      httpAutoLogin: true,
      httpAutoLoginSelectors: {
        usernameSelector: "#user",
        passwordSelector: "#pass",
        submitSelector: "#go",
      },
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {
      await result.current.navigateToUrl("http://device.local/login");
    });

    const config = lastProxyConfig();
    expect(config).toBeDefined();
    expect(config?.http_auto_login).toBe(true);
    expect(config?.http_auto_login_selectors).toEqual({
      username_selector: "#user",
      password_selector: "#pass",
      submit_selector: "#go",
    });
    // The credential is NOT a new field — it rides the existing username/password.
    expect(config?.username).toBe("admin");
    expect(config?.password).toBe("devpass");
  });

  it("sends http_auto_login=false and omits selectors when not opted in", async () => {
    connections.push({
      id: "conn-1",
      name: "Plain Site",
      hostname: "device.local",
      protocol: "http",
      username: "admin",
      password: "devpass",
      httpVerifySsl: true,
      // httpAutoLogin absent → off
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {
      await result.current.navigateToUrl("http://device.local/login");
    });

    const config = lastProxyConfig();
    expect(config).toBeDefined();
    expect(config?.http_auto_login).toBe(false);
    // Omitted entirely (undefined) when no selector overrides are configured.
    expect(config?.http_auto_login_selectors).toBeUndefined();
  });

  it("arms auto-login but omits selectors when the toggle is on with no overrides", async () => {
    connections.push({
      id: "conn-1",
      name: "Heuristic Site",
      hostname: "device.local",
      protocol: "http",
      username: "admin",
      password: "devpass",
      httpVerifySsl: true,
      httpAutoLogin: true,
      // no httpAutoLoginSelectors → backend heuristic, undefined selectors
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {
      await result.current.navigateToUrl("http://device.local/login");
    });

    const config = lastProxyConfig();
    expect(config?.http_auto_login).toBe(true);
    expect(config?.http_auto_login_selectors).toBeUndefined();
  });

  it("normalizes scheme-prefixed HTTPS hostnames before certificate trust checks", async () => {
    connections.push({
      id: "conn-1",
      name: "Legacy HTTPS Admin",
      hostname: "https://admin.example.test",
      protocol: "https",
      port: 443,
      httpVerifySsl: true,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const httpsSession: ConnectionSession = {
      ...session,
      protocol: "https",
      hostname: "https://admin.example.test",
    };
    mockResolveEffectiveTrustPolicy.mockReturnValue("tofu");
    mockVerifyIdentity.mockReturnValue({ status: "trusted" });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "get_tls_certificate_info") {
        return {
          fingerprint: "sha256:clean-host-cert",
          subject: "CN=admin.example.test",
          issuer: "CN=Test CA",
          pem: null,
          valid_from: null,
          valid_to: null,
          serial: null,
          signature_algorithm: null,
          san: [],
          subject_cn: "admin.example.test",
          subject_org: null,
          subject_ou: null,
          subject_country: null,
          subject_state: null,
          subject_locality: null,
          subject_email: null,
          issuer_cn: "Test CA",
          issuer_org: null,
          issuer_country: null,
          key_algorithm: null,
          key_size: null,
          version: null,
          chain: null,
        };
      }
      return {
        local_port: 9000,
        session_id: "proxy-1",
        proxy_url: "http://127.0.0.1:9000",
      };
    });

    const { result } = renderHook(() => useWebBrowser(httpsSession));
    await act(async () => {
      await result.current.navigateToUrl("https://admin.example.test/");
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_tls_certificate_info", {
      host: "admin.example.test",
      port: 443,
    });
    expect(mockVerifyIdentity).toHaveBeenCalledWith(
      "admin.example.test",
      443,
      "https",
      expect.objectContaining({ fingerprint: "sha256:clean-host-cert" }),
      "conn-1",
    );
    expect(lastProxyConfig()?.target_url).toBe("https://admin.example.test/");
  });
});
