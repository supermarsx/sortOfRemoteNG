import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  verify: vi.fn(),
  trust: vi.fn(),
  dispatch: vi.fn(),
  policy: "tofu",
  proxy: "http://proxy.fixture:8080",
  proxyInvalid: false,
  verifySsl: true,
  credentialOverrides: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [
        {
          id: "fixture",
          protocol: "https",
          name: "Device",
          hostname: "10.10.10.2",
          port: 443,
          username: "saved-user",
          password: "saved-password",
          httpVerifySsl: mocks.verifySsl,
          ...mocks.credentialOverrides,
        },
      ],
    },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { httpsTrustPolicy: mocks.policy } }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: (options?: { failClosed?: boolean }) => {
    if (mocks.proxyInvalid && options?.failClosed)
      throw new Error("Enabled proxy is invalid; route will not be bypassed");
    return mocks.proxyInvalid ? undefined : mocks.proxy;
  },
}));
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: mocks.verify,
  trustIdentity: mocks.trust,
}));
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";

const session: ConnectionSession = {
  id: "web-fixture",
  connectionId: "fixture",
  name: "Device",
  protocol: "https",
  hostname: "10.10.10.2",
  status: "connected",
  startTime: new Date(),
};
const cert = {
  fingerprint: "AA:BB:CC",
  subject: null,
  issuer: null,
  san: [],
  chain: [
    {
      fingerprint: "AA:BB:CC",
      subject: "",
      issuer: "",
      valid_from: "",
      valid_to: "",
    },
  ],
};
const proxy = {
  session_id: "proxy-fixture",
  local_port: 9000,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:9000/",
};

describe("HTTPS certificate and native trust stages", () => {
  beforeEach(() => {
    mocks.policy = "tofu";
    mocks.proxyInvalid = false;
    mocks.verifySsl = true;
    mocks.credentialOverrides = {};
    mocks.verify.mockReset().mockResolvedValue({ status: "trusted" });
    mocks.trust.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "get_tls_certificate_info") return cert;
      if (command === "start_basic_auth_proxy") return proxy;
      return undefined;
    });
  });
  afterEach(cleanup);

  it("requires explicit approval after Forget even under TOFU, without opening or auto-storing", async () => {
    mocks.verify.mockResolvedValue({
      status: "first-use",
      identity: cert,
      requiresApproval: true,
    });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.trustPrompt).toMatchObject({
        status: "first-use",
        requiresApproval: true,
      }),
    );
    expect(mocks.trust).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    expect(result.current.navigationFailure).toBeNull();
    await act(async () => result.current.handleTrustAccept());
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    expect(mocks.trust).toHaveBeenCalledWith(
      "10.10.10.2",
      443,
      "https",
      expect.objectContaining({ fingerprint: cert.fingerprint }),
      true,
      "fixture",
    );
  });

  it("retains TOFU for genuinely unseen hosts without a fresh-approval requirement", async () => {
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    expect(mocks.trust).toHaveBeenCalledWith(
      "10.10.10.2",
      443,
      "https",
      expect.objectContaining({ fingerprint: cert.fingerprint }),
      false,
      "fixture",
    );
    expect(result.current.trustPrompt).toBeNull();
  });

  it("accepts lean blank display metadata and passes the exact accepted fingerprint to the verifying proxy", async () => {
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    expect(result.current.navigationFailure).toBeNull();
    expect(mocks.verify).toHaveBeenCalledWith(
      "10.10.10.2",
      443,
      "https",
      expect.objectContaining({
        fingerprint: cert.fingerprint,
        chain: [
          {
            subject: "",
            issuer: "",
            validFrom: "",
            validTo: "",
            fingerprint: cert.fingerprint,
          },
        ],
      }),
      "fixture",
    );
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.verify_ssl).toBe(true);
    expect(config.accepted_cert_fingerprint).toBe(cert.fingerprint);
    expect(config.upstream_proxy_url).toBe(mocks.proxy);
  });

  it("reports certificate acquisition failure at the inspection stage", async () => {
    mocks.invoke.mockRejectedValue(new Error("TLS peer was unavailable"));
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.title).toBe(
        "Unable to inspect the HTTPS certificate",
      ),
    );
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("sends Quick Connect's omitted-authType Basic username with an empty password", async () => {
    mocks.credentialOverrides = {
      basicAuthUsername: "quick-admin",
      basicAuthPassword: "",
      authType: undefined,
    };
    renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.username).toBe("quick-admin");
    expect(config.password).toBe("");
  });

  it("does not silently inject saved Basic credentials in explicit custom-header mode", async () => {
    mocks.credentialOverrides = {
      authType: "header",
      basicAuthUsername: "must-not-send",
      basicAuthPassword: "must-not-send",
      httpHeaders: { Authorization: "Bearer fixture" },
    };
    renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.username).toBe("");
    expect(config.password).toBe("");
    expect(JSON.stringify(config)).not.toContain("must-not-send");
  });

  it("keeps the approved certificate pin when ordinary CA verification is disabled", async () => {
    mocks.verifySsl = false;
    mocks.policy = "always-ask";
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(result.current.trustPrompt).not.toBeNull());
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    await act(async () => result.current.handleTrustAccept());
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.verify_ssl).toBe(false);
    expect(config.accepted_cert_fingerprint).toBe(cert.fingerprint);
    expect(mocks.trust).toHaveBeenCalled();
  });

  it("rejects a malformed fingerprint even for always-trust without opening the proxy", async () => {
    mocks.policy = "always-trust";
    mocks.invoke.mockResolvedValue({ ...cert, fingerprint: "" });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.title).toBe(
        "Invalid HTTPS certificate identity",
      ),
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("does not mislabel a trust-store failure as inability to inspect the certificate", async () => {
    mocks.verify.mockRejectedValue(
      new Error("Database Trust Center is locked"),
    );
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.kind).toBe("trust_failure"),
    );
    expect(result.current.navigationFailure?.title).toBe(
      "Unable to verify HTTPS trust",
    );
    expect(result.current.navigationFailure?.detail).toContain(
      "Trust Center is locked",
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
  });

  it("keeps explicit trust persistence failures blocked with an actionable error", async () => {
    mocks.policy = "always-ask";
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    mocks.trust.mockRejectedValue(new Error("Trust-store write refused"));
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(result.current.trustPrompt).not.toBeNull());
    await act(async () => result.current.handleTrustAccept());
    expect(result.current.navigationFailure?.title).toBe(
      "Unable to save the HTTPS trust decision",
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
  });

  it("keeps anonymous diagnostic 401 separate from the real navigation/trust failure", async () => {
    mocks.verify.mockRejectedValue(new Error("Trust Center unavailable"));
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.kind).toBe("trust_failure"),
    );
    const originalFailure = result.current.navigationFailure;
    mocks.invoke.mockResolvedValue({
      summary: "Anonymous GET received HTTP 401",
      steps: [],
      totalDurationMs: 1,
    });
    await act(async () => result.current.runDeepDiagnostics());
    const args = mocks.invoke.mock.calls.find(
      ([name]) => name === "diagnose_http_connection",
    )?.[1];
    expect(args.proxyUrl).toBe(mocks.proxy);
    expect(args.method).toBe("GET");
    expect(JSON.stringify(args)).not.toContain("saved-password");
    expect(args).not.toHaveProperty("username");
    expect(result.current.navigationFailure).toBe(originalFailure);
    expect(result.current.diagnosticReport?.summary).toContain("401");
  });

  it("refuses diagnostics if the enabled configured proxy becomes invalid", async () => {
    mocks.verify.mockRejectedValue(new Error("Trust unavailable"));
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.kind).toBe("trust_failure"),
    );
    mocks.proxyInvalid = true;
    await act(async () => result.current.runDeepDiagnostics());
    expect(result.current.diagnosticError).toContain(
      "route will not be bypassed",
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "diagnose_http_connection",
      ),
    ).toBe(false);
  });

  it("does not apply a stale trust-save failure to a newer navigation", async () => {
    mocks.policy = "always-ask";
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    let rejectOld: (reason: Error) => void = () => undefined;
    mocks.trust.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(result.current.trustPrompt).not.toBeNull());
    let accept: Promise<void> = Promise.resolve();
    act(() => {
      accept = result.current.handleTrustAccept();
    });
    mocks.verify.mockResolvedValue({ status: "trusted" });
    act(() => {
      result.current.handleRefresh();
    });
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    await act(async () => {
      rejectOld(new Error("old write failed"));
      await accept;
    });
    expect(result.current.navigationFailure).toBeNull();
  });
});
