import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import { certificateInfoFixture } from "../fixtures/certificateInspection";
import { anonymousRedirectConnection } from "../../src/utils/protocol/httpRedirectReview";
import {
  registerRuntimeConnection,
  clearRuntimeConnectionsForTests,
} from "../../src/utils/session/runtimeConnectionRegistry";
import type { Connection } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  verify: vi.fn(),
  trust: vi.fn(),
  dispatch: vi.fn(),
  policy: "tofu",
  caMode: "system",
  proxy: "http://proxy.fixture:8080",
  proxyInvalid: false,
  verifySsl: true,
  credentialOverrides: {} as Record<string, unknown>,
  settingsReady: false,
  availability: { status: "ready", databaseId: "owner", generation: 1 },
  assertLease: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    command === "web_network_guard_status"
      ? Promise.resolve({
          platform: "windows",
          frameNavigation: "enforced",
          allNetworkRequestsMediated: false,
        })
      : command === "activate_proxy_network_document"
        ? Promise.resolve(false)
        : mocks.invoke(command, ...args),
}));
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
    databaseAvailability: mocks.availability,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      httpsTrustPolicy: mocks.policy,
      httpsCaTrustMode: mocks.caMode,
    },
    settingsReady: mocks.settingsReady,
  }),
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: (value: ConnectionSession) => {
    if (!value.ownerDatabaseId)
      throw new Error(
        "Open and unlock this session's owning database before continuing.",
      );
    mocks.assertLease();
    return mocks.assertLease;
  },
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
import { TransientTrustStoreError } from "../../src/utils/auth/trustStore";
import ApplicationSignInNotice from "../../src/components/protocol/webBrowser/ApplicationSignInNotice";

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
    clearRuntimeConnectionsForTests();
    mocks.policy = "tofu";
    mocks.caMode = "system";
    mocks.proxyInvalid = false;
    mocks.proxy = "http://proxy.fixture:8080";
    mocks.verifySsl = true;
    mocks.credentialOverrides = {};
    mocks.settingsReady = false;
    mocks.availability = {
      status: "ready",
      databaseId: "owner",
      generation: 1,
    };
    mocks.assertLease.mockReset();
    mocks.verify.mockReset().mockResolvedValue({ status: "trusted" });
    mocks.trust.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "get_tls_certificate_info") return cert;
      if (command === "start_basic_auth_proxy") return proxy;
      return undefined;
    });
  });
  afterEach(() => {
    cleanup();
    clearRuntimeConnectionsForTests();
    vi.useRealTimers();
  });
  async function loadingFixture(value = session) {
    vi.useFakeTimers();
    const hook = renderHook(() => useWebBrowser(value));
    const iframe = document.createElement("iframe");
    iframe.src = "about:blank";
    hook.result.current.iframeRef.current = iframe;
    await act(async () => {});
    expect(iframe.src).toContain(proxy.proxy_url);
    return { ...hook, iframe };
  }
  it.each(["https", "http"] as const)(
    "opens a reviewed anonymous %s destination with its own trust and path, never the source credentials",
    async (protocol) => {
      const source: Connection = {
        id: "source",
        name: "Source",
        hostname: "source.invalid",
        protocol: "https",
        port: 443,
        isGroup: false,
        createdAt: "2026-09-10",
        updatedAt: "2026-09-10",
        basicAuthUsername: "source-private",
        basicAuthPassword: "source-secret",
        httpVerifySsl: false,
        httpProxyPolicy: {
          version: 1,
          pageScripts: "allow",
          httpsOnly: false,
          sameOriginOnly: false,
          cacheMode: "normal",
          queryParameters: [],
          allowCrossOriginRedirects: true,
          allowHttpDowngradeRedirects: true,
        },
      };
      const destination = anonymousRedirectConnection(source, {
        receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sessionId: "source-proxy",
        sourceOrigin: "https://source.invalid",
        destinationUrl: `${protocol}://destination.invalid/admin/`,
        documentSequence: 1,
        navigationToken: null,
        removedQuery: true,
      });
      registerRuntimeConnection(destination, {
        initialUrl: `${protocol}://destination.invalid/admin/`,
        redirectHops: 1,
        assertCurrent: () => {},
      });
      const { result, iframe } = await loadingFixture({
        ...session,
        connectionId: destination.id,
        protocol,
        hostname: destination.hostname,
        ownerDatabaseId: "owner",
      });
      if (protocol === "https")
        expect(mocks.invoke).toHaveBeenCalledWith("get_tls_certificate_info", {
          host: "destination.invalid",
          port: 443,
          proxyUrl: mocks.proxy,
        });
      else
        expect(
          mocks.invoke.mock.calls.some(
            ([name]) => name === "get_tls_certificate_info",
          ),
        ).toBe(false);
      expect(result.current.currentUrl).toBe(
        `${protocol}://destination.invalid/admin/`,
      );
      expect(new URL(iframe.src).pathname).toBe("/admin/");
      const config = mocks.invoke.mock.calls.find(
        ([name]) => name === "start_basic_auth_proxy",
      )![1].config;
      expect(config).toMatchObject({
        target_url: `${protocol}://destination.invalid/`,
        username: "",
        password: "",
        verify_ssl: true,
        http_auto_login: false,
      });
      if (protocol === "https")
        expect(config.accepted_cert_fingerprint).toBe(cert.fingerprint);
      else expect(config.accepted_cert_fingerprint).toBeNull();
      expect(JSON.stringify(config)).not.toContain("source-private");
      expect(JSON.stringify(config)).not.toContain("source-secret");
    },
  );
  it("runs reviewed web-vault mode only in the owning lease and revokes the frame/proxy on lock without reconnecting", async () => {
    mocks.settingsReady = true;
    mocks.credentialOverrides = {
      httpApplication: { version: 1, id: "vaultwarden", loginMode: "form" },
    };
    const owned = { ...session, ownerDatabaseId: "owner" };
    const { result, rerender, iframe } = await loadingFixture(owned);
    const starts = () =>
      mocks.invoke.mock.calls.filter(
        ([name]) => name === "start_basic_auth_proxy",
      );
    expect(starts()).toHaveLength(1);
    expect(result.current.currentUrl).toBe("https://10.10.10.2/#/login");
    expect(starts()[0][1].config).toMatchObject({
      upstream_auth_mode: "bitwarden-form",
      http_auto_login: true,
    });
    expect(mocks.assertLease).toHaveBeenCalled();
    mocks.availability = {
      status: "suspended",
      databaseId: "owner",
      generation: 2,
    };
    rerender();
    await act(async () => {});
    expect(iframe.src).toBe("about:blank");
    expect(mocks.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: proxy.session_id,
    });
    expect(result.current.loadError).toContain("owning database");
    mocks.availability = {
      status: "ready",
      databaseId: "owner",
      generation: 3,
    };
    rerender();
    await act(async () => {});
    expect(starts()).toHaveLength(1);
  });
  it("stops a late reviewed proxy result after owner revocation and never attaches it", async () => {
    mocks.settingsReady = true;
    mocks.credentialOverrides = {
      httpApplication: {
        version: 1,
        id: "bitwarden-self-hosted",
        loginMode: "form",
      },
    };
    let resolve!: (value: typeof proxy) => void;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info"
        ? cert
        : command === "start_basic_auth_proxy"
          ? new Promise((done) => {
              resolve = done;
            })
          : undefined,
    );
    const hook = renderHook(() =>
      useWebBrowser({ ...session, ownerDatabaseId: "owner" }),
    );
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    mocks.availability = {
      status: "ready",
      databaseId: "other",
      generation: 2,
    };
    hook.rerender();
    await act(async () => {
      resolve(proxy);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: proxy.session_id,
    });
    expect(hook.result.current.loadError).toContain("owning database");
  });
  it("refuses a web-vault attempt without a ready owning database before TLS or native start", async () => {
    mocks.settingsReady = true;
    mocks.credentialOverrides = {
      httpApplication: { version: 1, id: "vaultwarden", loginMode: "form" },
    };
    const hook = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) =>
          name === "get_tls_certificate_info" ||
          name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    expect(hook.result.current.loadError).toContain("owning database");
  });
  it("forwards typed proxy controls and header authentication without putting parameters in the frame URL", async () => {
    mocks.credentialOverrides = {
      authType: "header",
      httpHeaders: { Authorization: "Bearer synthetic-only" },
      httpProxyPolicy: {
        version: 1,
        pageScripts: "inline-only",
        httpsOnly: true,
        sameOriginOnly: true,
        cacheMode: "bypass",
        queryParameters: [{ name: "tenant", value: "synthetic-private" }],
      },
    };
    const { iframe } = await loadingFixture();
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.proxy_policy).toEqual({
      ...(mocks.credentialOverrides.httpProxyPolicy as object),
      allowCrossOriginRedirects: false,
      allowHttpDowngradeRedirects: false,
    });
    expect(config.custom_headers).toEqual({
      Authorization: "Bearer synthetic-only",
    });
    expect(iframe.src).not.toContain("synthetic-private");
  });
  it("refuses malformed proxy controls before certificate inspection or startup", async () => {
    mocks.credentialOverrides = { httpProxyPolicy: { version: 9 } };
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.navigationFailure?.kind).toBe("invalid_navigation"),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("finishes a script-blocked page on iframe load without requiring a script readiness message", async () => {
    mocks.credentialOverrides = {
      httpProxyPolicy: {
        version: 1,
        pageScripts: "block",
        httpsOnly: false,
        sameOriginOnly: false,
        cacheMode: "normal",
        queryParameters: [],
      },
    };
    const { result } = await loadingFixture();
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.http_auto_login).toBe(false);
    act(() => result.current.handleIframeLoad());
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(31000);
    });
    expect(result.current.navigationFailure).toBeNull();
  });
  it("clears only its proxy and obtains a fresh session after the explicit action", async () => {
    const { result } = await loadingFixture();
    await act(async () => {
      await result.current.handleClearSessionData();
    });
    const names = mocks.invoke.mock.calls.map(([name]) => name);
    const stop = names.indexOf("stop_basic_auth_proxy");
    expect(mocks.invoke.mock.calls[stop][1]).toEqual({
      sessionId: "proxy-fixture",
    });
    expect(names.lastIndexOf("start_basic_auth_proxy")).toBeGreaterThan(stop);
    expect(result.current.clearingSession).toBe(false);
  });
  it("does not create another session when discarding the previous one fails", async () => {
    const { result } = await loadingFixture();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "stop_basic_auth_proxy")
        throw new Error("synthetic stop failure");
      if (command === "get_tls_certificate_info") return cert;
      if (command === "start_basic_auth_proxy") return proxy;
    });
    const before = mocks.invoke.mock.calls.filter(
      ([name]) => name === "start_basic_auth_proxy",
    ).length;
    await act(async () => {
      await result.current.handleClearSessionData();
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toHaveLength(before);
    expect(result.current.navigationFailure?.title).toBe(
      "Unable to clear session data",
    );
  });
  it.each([
    { protocol: "http" as const, hostname: "dash.cloudflare.com", port: 443 },
    {
      protocol: "https" as const,
      hostname: "elsewhere.example.test",
      port: 443,
    },
    { protocol: "https" as const, hostname: "dash.cloudflare.com", port: 8443 },
  ])(
    "blocks Cloudflare's actual stale/wrong session authority before native preflight: $protocol $hostname $port",
    async (target) => {
      mocks.credentialOverrides = {
        protocol: "https",
        hostname: "dash.cloudflare.com",
        port: target.port,
        httpApplication: { version: 1, id: "cloudflare", loginMode: "manual" },
      };
      const { result } = renderHook(() =>
        useWebBrowser({
          ...session,
          protocol: target.protocol,
          hostname: target.hostname,
        }),
      );
      await waitFor(() =>
        expect(result.current.navigationFailure?.kind).toBe(
          "invalid_navigation",
        ),
      );
      expect(result.current.navigationFailure?.detail).toContain(
        "Cloudflare Dashboard requires HTTPS",
      );
      expect(
        mocks.invoke.mock.calls.some(([name]) =>
          [
            "get_tls_certificate_info",
            "start_basic_auth_proxy",
            "open_url_external",
          ].includes(name),
        ),
      ).toBe(false);
    },
  );
  it("mounts interactive Cloudflare guidance without inherited credential forwarding and opens only the fixed real origin after an explicit click", async () => {
    mocks.credentialOverrides = {
      hostname: "dash.cloudflare.com",
      port: 443,
      basicAuthUsername: "old-account",
      basicAuthPassword: "old-password",
      httpAutoLogin: true,
      httpAutoLoginSelectors: { usernameSelector: "#old" },
      httpHeaders: { Authorization: "Bearer old-token" },
      httpApplication: { version: 1, id: "cloudflare", loginMode: "manual" },
    };
    let browser!: ReturnType<typeof useWebBrowser>;
    function Fixture() {
      const mgr = useWebBrowser({
        ...session,
        hostname: "dash.cloudflare.com",
      });
      browser = mgr;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ApplicationSignInNotice, { mgr }),
        React.createElement("iframe", {
          ref: mgr.attachIframe,
          title: "Cloudflare fixture",
        }),
      );
    }
    render(React.createElement(Fixture));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )![1].config;
    expect(config).toMatchObject({
      target_url: "https://dash.cloudflare.com/",
      username: "",
      password: "",
      upstream_auth_mode: "none",
      http_auto_login: false,
      upstream_proxy_url: mocks.proxy,
      verify_ssl: true,
    });
    expect(config.http_auto_login_selectors).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(
      /old-account|old-password|old-token|saved-password|Authorization/,
    );
    expect(
      mocks.invoke.mock.calls.some(([name]) => name === "open_url_external"),
    ).toBe(false);
    expect(
      screen.getByRole("region", {
        name: "Cloudflare sign-in and two-factor authentication",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Signing in there does not sign in this tab/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await act(async () =>
      browser.navigateToUrl(
        "https://dash.cloudflare.com/account/security?challenge=ephemeral#code",
      ),
    );
    expect(browser.currentUrl).toContain("challenge=ephemeral");
    fireEvent.click(
      screen.getByRole("button", { name: "Open Cloudflare in system browser" }),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("open_url_external", {
        url: "https://dash.cloudflare.com/",
      }),
    );
    const externalCalls = mocks.invoke.mock.calls.filter(
      ([name]) => name === "open_url_external",
    );
    expect(externalCalls).toHaveLength(1);
    expect(externalCalls[0][1]).toEqual({
      url: "https://dash.cloudflare.com/",
    });
  });
  it.each([
    ["github", "GitHub", "github.com", "/login"],
    ["brevo", "Brevo", "login.brevo.com", "/"],
    ["gitea", "Gitea", "git.example.test", "/user/login"],
  ])(
    "%s starts at the reviewed entry path and explicitly hands off only the original HTTPS address",
    async (id, label, hostname, path) => {
      mocks.credentialOverrides = {
        hostname,
        httpApplication: { version: 1, id, loginMode: "manual" },
      };
      const { result, rerender } = renderHook(() =>
        useWebBrowser({ ...session, hostname }),
      );
      await waitFor(() =>
        expect(
          mocks.invoke.mock.calls.some(
            ([name]) => name === "start_basic_auth_proxy",
          ),
        ).toBe(true),
      );
      const config = mocks.invoke.mock.calls.find(
        ([name]) => name === "start_basic_auth_proxy",
      )![1].config;
      expect(config.target_url).toBe(`https://${hostname}/`);
      expect(result.current.currentUrl).toBe(`https://${hostname}${path}`);
      expect(
        mocks.invoke.mock.calls.some(([name]) => name === "open_url_external"),
      ).toBe(false);
      render(
        React.createElement(ApplicationSignInNotice, { mgr: result.current }),
      );
      expect(
        screen.getByText(/YubiKey and other WebAuthn security keys/),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: `Open ${label} in system browser` }),
      );
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith("open_url_external", {
          url: `https://${hostname}${path}`,
        }),
      );
      const oldAction = result.current.handleOpenApplicationExternal;
      mocks.credentialOverrides = {
        ...mocks.credentialOverrides,
        hostname: "changed.example.test",
      };
      rerender();
      await act(async () => oldAction());
      expect(
        mocks.invoke.mock.calls.filter(
          ([name]) => name === "open_url_external",
        ),
      ).toHaveLength(1);
    },
  );
  it("never shows the loading screen for a page that finishes inside 200ms", async () => {
    const { result } = await loadingFixture();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.showLoadingIndicator).toBe(false);
    act(() => vi.advanceTimersByTime(199));
    act(() => result.current.handleIframeLoad());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.showLoadingIndicator).toBe(false);
  });
  it("also skips the loading screen for fast plain HTTP without bypassing its proxy", async () => {
    const { result } = await loadingFixture({ ...session, protocol: "http" });
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "get_tls_certificate_info",
      ),
    ).toBe(false);
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(true);
    act(() => result.current.handleIframeLoad());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.showLoadingIndicator).toBe(false);
  });
  it("shows slow navigation at 200ms and hides it immediately when the frame loads, including an auth document", async () => {
    const { result } = await loadingFixture();
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.showLoadingIndicator).toBe(true);
    act(() => result.current.handleIframeLoad());
    expect(result.current.showLoadingIndicator).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
  it("resets the grace for consecutive bookmarks and ignores old frame loads during certificate inspection", async () => {
    const { result } = await loadingFixture();
    act(() => result.current.handleIframeLoad());
    let finish!: (value: typeof cert) => void;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info"
        ? new Promise<typeof cert>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    act(() => {
      void result.current.navigateToUrl("https://10.10.10.2/first");
    });
    act(() => vi.advanceTimersByTime(150));
    act(() => {
      void result.current.navigateToUrl("https://10.10.10.2/second");
    });
    // Native navigation readiness is asynchronous and precedes certificate
    // inspection. Drain that preflight without resolving the certificate.
    await act(async () => {});
    act(() => result.current.handleIframeLoad());
    expect(result.current.isLoading).toBe(true);
    act(() => vi.advanceTimersByTime(199));
    expect(result.current.showLoadingIndicator).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.showLoadingIndicator).toBe(true);
    await act(async () => finish(cert));
    act(() => result.current.handleIframeLoad());
    expect(result.current.showLoadingIndicator).toBe(false);
  });
  it("never obscures required trust approval and clears pending indicators on rejection", async () => {
    mocks.verify.mockResolvedValue({
      status: "first-use",
      identity: cert,
      requiresApproval: true,
    });
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    expect(result.current.trustPrompt).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.showLoadingIndicator).toBe(false);
    expect(
      mocks.invoke.mock.calls.some(
        ([name]) => name === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    act(() => result.current.handleTrustReject());
    expect(result.current.loadError).not.toBe("");
    expect(result.current.showLoadingIndicator).toBe(false);
  });
  it("clears indicators on cancel, invalid navigation and unmount", async () => {
    const { result, unmount } = await loadingFixture();
    act(() => result.current.handleCancelLoading());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.showLoadingIndicator).toBe(false);
    await act(async () =>
      result.current.navigateToUrl("https://unrelated.example.test/"),
    );
    expect(result.current.loadError).not.toBe("");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.showLoadingIndicator).toBe(false);
    await act(async () =>
      result.current.navigateToUrl("https://10.10.10.2/pending-at-unmount"),
    );
    expect(result.current.isLoading).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the existing 30-second timeout immediate once reached", async () => {
    const { result } = await loadingFixture();
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.navigationFailure?.kind).toBe("page_load_timeout");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.showLoadingIndicator).toBe(false);
  });
  it("keeps full peer details ephemeral while preserving populated legacy trust fields", async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info"
        ? certificateInfoFixture
        : command === "start_basic_auth_proxy"
          ? proxy
          : undefined,
    );
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.certificateInspection?.certificate).toEqual(
        certificateInfoFixture,
      ),
    );
    expect(result.current.certIdentity).toMatchObject({
      subject: certificateInfoFixture.subject,
      issuer: certificateInfoFixture.issuer,
      serial: certificateInfoFixture.serial,
      pem: certificateInfoFixture.pem,
    });
    const identity = mocks.verify.mock.calls[0][3];
    expect(identity).not.toHaveProperty("details");
    expect(identity).not.toHaveProperty("capture");
    expect(identity.chain[0]).not.toHaveProperty("details");
    expect(result.current.certificateInspection).toMatchObject({
      host: "10.10.10.2",
      port: 443,
    });
  });
  it("clears the prior capture during reinspection and ignores a stale pending response", async () => {
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(result.current.certIdentity).not.toBeNull());
    let finishOld!: (value: typeof certificateInfoFixture) => void;
    let finishNew!: (value: typeof certificateInfoFixture) => void;
    const pendingOld = new Promise<typeof certificateInfoFixture>((resolve) => {
      finishOld = resolve;
    });
    const pendingNew = new Promise<typeof certificateInfoFixture>((resolve) => {
      finishNew = resolve;
    });
    let calls = 0;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info"
        ? ++calls === 1
          ? pendingOld
          : pendingNew
        : command === "start_basic_auth_proxy"
          ? proxy
          : undefined,
    );
    act(() => {
      result.current.setShowCertPopup(true);
      void result.current.navigateToUrl("https://10.10.10.2/old");
    });
    await waitFor(() => expect(calls).toBe(1));
    expect(result.current.certIdentity).toBeNull();
    expect(result.current.showCertPopup).toBe(false);
    act(() => {
      void result.current.navigateToUrl("https://10.10.10.2/new");
    });
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => {
      finishNew(certificateInfoFixture);
    });
    await waitFor(() =>
      expect(result.current.certIdentity?.fingerprint).toBe(
        certificateInfoFixture.fingerprint,
      ),
    );
    await act(async () => {
      finishOld({ ...certificateInfoFixture, subject: "STALE" });
    });
    expect(result.current.certIdentity?.subject).not.toBe("STALE");
  });
  it("does not retain observed metadata when a different connection session replaces the hook props", async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useWebBrowser(value),
      { initialProps: { value: session } },
    );
    await waitFor(() => expect(result.current.certIdentity).not.toBeNull());
    rerender({ value: { ...session, id: "other-session" } });
    expect(result.current.certIdentity).toBeNull();
    expect(result.current.certificateInspection).toBeNull();
  });

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

  it("opens a native CA-approved HTTPS peer with CA plus pin enforcement, not persistence", async () => {
    mocks.settingsReady = true;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info"
        ? {
            ...cert,
            ca_validation: { status: "verified", proof_id: "a".repeat(32) },
          }
        : command === "start_basic_auth_proxy"
          ? proxy
          : undefined,
    );
    mocks.verify.mockResolvedValue({ status: "trusted", caValidated: true });
    const { result } = renderHook(() => useWebBrowser(ownedSession));
    await waitFor(() => expect(proxyStarts()).toHaveLength(1));
    expect(mocks.verify).toHaveBeenCalledWith(
      "10.10.10.2",
      443,
      "https",
      expect.objectContaining({ fingerprint: cert.fingerprint }),
      "fixture",
      {
        caTrustMode: "system",
        policy: "tofu",
        caProofId: "a".repeat(32),
        proxyUrl: mocks.proxy,
      },
    );
    expect(proxyStarts()[0][1].config).toMatchObject({
      require_ca_verification: true,
      accepted_cert_fingerprint: cert.fingerprint,
      verify_ssl: true,
    });
    expect(mocks.trust).not.toHaveBeenCalled();
    expect(result.current.trustPrompt).toBeNull();
  });

  it.each(["system", "review"])(
    "keeps unknown certificates manual in %s mode despite native first-use",
    async (mode) => {
      mocks.settingsReady = true;
      mocks.caMode = mode;
      mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
      const { result } = renderHook(() => useWebBrowser(ownedSession));
      await waitFor(() =>
        expect(result.current.trustPrompt?.status).toBe("first-use"),
      );
      expect(proxyStarts()).toHaveLength(0);
      expect(mocks.trust).not.toHaveBeenCalled();
      expect(mocks.verify.mock.calls[0][5].caTrustMode).toBe(mode);
    },
  );

  it.each(["mode", "policy"])(
    "revokes deferred CA acceptance when HTTPS %s changes",
    async (change) => {
      mocks.settingsReady = true;
      let resolve!: (value: { status: string; caValidated: true }) => void;
      mocks.verify.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const { result, rerender } = renderHook(() =>
        useWebBrowser(ownedSession),
      );
      await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(1));
      if (change === "mode") mocks.caMode = "review";
      else mocks.credentialOverrides = { httpsTrustPolicy: "strict" };
      rerender();
      await act(async () => resolve({ status: "trusted", caValidated: true }));
      expect(proxyStarts()).toHaveLength(0);
      expect(mocks.trust).not.toHaveBeenCalled();
      expect(result.current.navigationFailure?.kind).toBe("invalid_navigation");
    },
  );

  it("does not let a retained earlier approval clear a later CA-enforced launch", async () => {
    mocks.settingsReady = true;
    mocks.verify.mockResolvedValueOnce({ status: "first-use", identity: cert });
    const { result } = renderHook(() => useWebBrowser(ownedSession));
    await waitFor(() => expect(result.current.trustPrompt).not.toBeNull());
    const staleAccept = result.current.handleTrustAccept;
    await act(async () => result.current.handleTrustReject());
    mocks.verify.mockResolvedValue({ status: "trusted", caValidated: true });
    await act(async () => result.current.navigateToUrl("https://10.10.10.2/"));
    await act(async () => staleAccept(false));
    expect(proxyStarts()).toHaveLength(1);
    expect(proxyStarts()[0][1].config.require_ca_verification).toBe(true);
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it.each(["unsafe-global", "source-tightened"] as const)(
    "preserves restrictive trust on a redirected runtime: %s",
    async (scenario) => {
      mocks.settingsReady = true;
      const target: Connection = {
        id: "redirect-fixture",
        name: "Redirect",
        hostname: "destination.invalid",
        protocol: "https",
        port: 443,
        isGroup: false,
        createdAt: "2026-09-13",
        updatedAt: "2026-09-13",
        httpVerifySsl: true,
        httpsTrustPolicy: "inherit",
        httpAutoLogin: false,
      };
      registerRuntimeConnection(target, {
        initialUrl: "https://destination.invalid/",
        redirectHops: 1,
        assertCurrent: () => {},
        trustedRedirectSource: {
          databaseId: "owner",
          savedConnectionId: "fixture",
          originalOrigin: "https://10.10.10.2",
          assertOwner: () => {},
          assertIdentity: () => {},
        },
      });
      if (scenario === "unsafe-global") {
        mocks.policy = "always-trust";
        mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
        const { result } = renderHook(() =>
          useWebBrowser({
            ...ownedSession,
            connectionId: target.id,
            hostname: target.hostname,
          }),
        );
        await waitFor(() =>
          expect(result.current.trustPrompt?.status).toBe("first-use"),
        );
        expect(mocks.verify.mock.calls[0][5].policy).toBe("always-ask");
        expect(proxyStarts()).toHaveLength(0);
      } else {
        let finish!: (value: { status: string; caValidated: true }) => void;
        mocks.verify.mockReturnValue(
          new Promise((resolve) => {
            finish = resolve;
          }),
        );
        const { rerender } = renderHook(() =>
          useWebBrowser({
            ...ownedSession,
            connectionId: target.id,
            hostname: target.hostname,
          }),
        );
        await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(1));
        mocks.credentialOverrides = { httpsTrustPolicy: "strict" };
        rerender();
        await act(async () => finish({ status: "trusted", caValidated: true }));
        expect(proxyStarts()).toHaveLength(0);
      }
      expect(mocks.trust).not.toHaveBeenCalled();
    },
  );

  it("does not request automatic CA trust before persisted preferences are ready", async () => {
    mocks.settingsReady = false;
    mocks.caMode = "system";
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    const { result } = renderHook(() => useWebBrowser(ownedSession));
    await waitFor(() =>
      expect(result.current.trustPrompt?.status).toBe("first-use"),
    );
    expect(mocks.verify.mock.calls[0][5].caTrustMode).toBe("review");
    expect(proxyStarts()).toHaveLength(0);
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("cancels pending CA admission when settings readiness is revoked", async () => {
    mocks.settingsReady = true;
    let finish!: (value: { status: string; caValidated: true }) => void;
    mocks.verify.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = renderHook(() => useWebBrowser(ownedSession));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(1));
    expect(mocks.verify.mock.calls[0][5].caTrustMode).toBe("system");
    mocks.settingsReady = false;
    rerender();
    await act(async () => finish({ status: "trusted", caValidated: true }));
    expect(proxyStarts()).toHaveLength(0);
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("does not auto-pin unseen HTTPS certificates without native CA authority", async () => {
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(result.current.trustPrompt?.status).toBe("first-use"),
    );
    expect(proxyStarts()).toHaveLength(0);
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("pins an explicit session-only acceptance without persisting an unchecked Remember decision", async () => {
    mocks.verify.mockResolvedValue({
      status: "first-use",
      identity: cert,
      requiresApproval: true,
    });
    const { result } = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(result.current.trustPrompt).not.toBeNull());
    await act(async () => result.current.handleTrustAccept(false));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([name]) => name === "start_basic_auth_proxy",
        ),
      ).toBe(true),
    );
    expect(mocks.trust).not.toHaveBeenCalled();
    const config = mocks.invoke.mock.calls.find(
      ([name]) => name === "start_basic_auth_proxy",
    )?.[1].config;
    expect(config.accepted_cert_fingerprint).toBe(cert.fingerprint);
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
      { caTrustMode: "review", policy: "tofu", proxyUrl: mocks.proxy },
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

  const ownedSession = { ...session, ownerDatabaseId: "owner" };
  const proxyStarts = () =>
    mocks.invoke.mock.calls.filter(
      ([name]) => name === "start_basic_auth_proxy",
    );
  async function pendingTrustRead() {
    vi.useFakeTimers();
    mocks.verify.mockRejectedValue(new TransientTrustStoreError());
    const hook = renderHook(() => useWebBrowser(ownedSession));
    await act(async () => {});
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(hook.result.current.navigationFailure).toBeNull();
    expect(proxyStarts()).toHaveLength(0);
    return hook;
  }

  it("waits one then two seconds for transient trust reads without releasing credentials or repeating certificate inspection", async () => {
    const { result } = await pendingTrustRead();
    const iframe = document.createElement("iframe");
    iframe.src = "about:blank";
    result.current.iframeRef.current = iframe;
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(iframe.src).toBe("about:blank");
    expect(result.current.pageInteractionBlocked).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(proxyStarts()).toHaveLength(0);
    expect(mocks.trust).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    mocks.verify.mockResolvedValue({ status: "trusted" });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(proxyStarts()).toHaveLength(1);
    expect(proxyStarts()[0][1].config.verify_ssl).toBe(true);
    expect(proxyStarts()[0][1].config.accepted_cert_fingerprint).toBe(
      cert.fingerprint,
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([name]) => name === "get_tls_certificate_info",
      ),
    ).toHaveLength(1);
    expect(result.current.navigationFailure).toBeNull();
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("stops after exactly two retries and offers explicit recovery without reconnect loops", async () => {
    const { result } = await pendingTrustRead();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(result.current.navigationFailure?.kind).toBe("trust_failure");
    expect(result.current.navigationFailure?.reason).toContain(
      "after two retries",
    );
    expect(result.current.isLoading).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(proxyStarts()).toHaveLength(0);
    expect(mocks.trust).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry an ownerless legacy tab by adopting the currently selected database", async () => {
    vi.useFakeTimers();
    mocks.verify.mockRejectedValue(new TransientTrustStoreError());
    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(result.current.navigationFailure?.detail).toContain(
      "owning database",
    );
    expect(proxyStarts()).toHaveLength(0);
  });

  it("does not attempt legacy TOFU persistence even when persistence would fail", async () => {
    vi.useFakeTimers();
    mocks.verify.mockResolvedValue({ status: "first-use", identity: cert });
    mocks.trust.mockRejectedValue(new TransientTrustStoreError());
    const { result } = renderHook(() => useWebBrowser(ownedSession));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.trust).not.toHaveBeenCalled();
    expect(result.current.navigationFailure).toBeNull();
    expect(result.current.trustPrompt?.status).toBe("first-use");
    expect(proxyStarts()).toHaveLength(0);
  });

  it.each([
    "Database Trust Center is locked",
    "No database is open",
    "Trust database changed; refresh and review the action again",
    "Malformed native trust verification response",
    "Trust identity revoked",
    "The native Trust Center is temporarily unavailable. Retry from the Trust Center.",
    "The native Trust Center operation exceeded its UI deadline",
  ])("does not retry a non-transient trust failure: %s", async (message) => {
    vi.useFakeTimers();
    mocks.verify.mockRejectedValue(new Error(message));
    const { result } = renderHook(() => useWebBrowser(ownedSession));
    await act(async () => {});
    expect(result.current.navigationFailure?.kind).toBe("trust_failure");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(proxyStarts()).toHaveLength(0);
  });

  it.each(["cancel", "unmount", "lock", "switch"] as const)(
    "cancels pending trust backoff on %s",
    async (event) => {
      const { result, rerender, unmount } = await pendingTrustRead();
      if (event === "cancel") act(() => result.current.handleCancelLoading());
      else if (event === "unmount") unmount();
      else {
        mocks.availability = {
          status: event === "lock" ? "suspended" : "ready",
          databaseId: event === "switch" ? "other" : "owner",
          generation: 2,
        };
        rerender();
      }
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.verify).toHaveBeenCalledTimes(1);
      expect(proxyStarts()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      if (event !== "unmount")
        expect(result.current.navigationFailure?.kind).toBe(
          "navigation_cancelled",
        );
    },
  );

  it("checks the native owner lease again before retry even without a context rerender", async () => {
    const { result } = await pendingTrustRead();
    mocks.assertLease.mockImplementation(() => {
      throw new Error("Database lease is locked");
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(result.current.navigationFailure?.detail).toContain(
      "lease is locked",
    );
    expect(proxyStarts()).toHaveLength(0);
  });

  it("refuses a retry on a different configured route", async () => {
    const { result } = await pendingTrustRead();
    mocks.proxy = "http://replacement.fixture:8081";
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(result.current.navigationFailure?.detail).toContain("route changed");
    expect(proxyStarts()).toHaveLength(0);
  });

  it("cancels old backoff when a newer navigation succeeds", async () => {
    const { result } = await pendingTrustRead();
    mocks.verify.mockResolvedValue({ status: "trusted" });
    await act(async () =>
      result.current.navigateToUrl("https://10.10.10.2/new"),
    );
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(proxyStarts()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(proxyStarts()).toHaveLength(1);
    expect(result.current.navigationFailure).toBeNull();
  });

  it("ignores a late successful retry after the owning database is locked", async () => {
    const { result, rerender } = await pendingTrustRead();
    let finish!: (value: { status: string }) => void;
    mocks.verify.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    mocks.availability = {
      status: "suspended",
      databaseId: "owner",
      generation: 2,
    };
    rerender();
    await act(async () => finish({ status: "trusted" }));
    expect(proxyStarts()).toHaveLength(0);
    expect(result.current.navigationFailure?.kind).toBe("navigation_cancelled");
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("shows only one consent prompt after recovery and never retries an uncertain trust write", async () => {
    const { result } = await pendingTrustRead();
    mocks.verify.mockResolvedValue({
      status: "first-use",
      identity: cert,
      requiresApproval: true,
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.trustPrompt).not.toBeNull();
    expect(mocks.trust).not.toHaveBeenCalled();
    expect(proxyStarts()).toHaveLength(0);
    mocks.trust.mockRejectedValue(new TransientTrustStoreError());
    await act(async () => result.current.handleTrustAccept());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(mocks.trust).toHaveBeenCalledTimes(1);
    expect(result.current.navigationFailure?.title).toBe(
      "Unable to save the HTTPS trust decision",
    );
    expect(result.current.trustPrompt).toBeNull();
    expect(proxyStarts()).toHaveLength(0);
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
