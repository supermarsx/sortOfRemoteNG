import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  normalizeInternalProxySettings,
  normalizeWebBrowserSettings,
} from "../../src/utils/settings/webBrowserSettings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  connections: [] as Connection[],
  settings: {} as GlobalSettings,
  ready: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mocks.connections, sessions: [] },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => ({
  ...(await original<typeof import("../../src/contexts/SettingsContext")>()),
  useSettings: () => ({ settings: mocks.settings, settingsReady: mocks.ready }),
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
  getGlobalHttpProxyUrl: () => undefined,
}));

import {
  browserSessionPolicy,
  useBrowserRuntimeSettings,
} from "../../src/hooks/protocol/useBrowserRuntimeSettings";
import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";
import { WebBrowser } from "../../src/components/protocol/WebBrowser";
import SecurityInfoBar from "../../src/components/protocol/webBrowser/SecurityInfoBar";
import {
  useWebBrowser,
  type WebBrowserMgr,
} from "../../src/hooks/protocol/useWebBrowser";
import * as automationHooks from "../../src/hooks/protocol/useWebAutomation";
import * as autoMfaHooks from "../../src/hooks/protocol/useWebAutoMfa";
import { webPopupTabs } from "../../src/utils/protocol/webPopupTabs";

const proxy = {
  session_id: "browser-settings-native",
  local_port: 43081,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
};
const session: ConnectionSession = {
  id: "browser-settings-tab",
  connectionId: "browser-settings-connection",
  name: "Website",
  protocol: "http",
  hostname: "site.example.test",
  status: "connected",
  startTime: new Date(),
};
const starts = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === "start_basic_auth_proxy",
  );
const stops = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === "stop_basic_auth_proxy",
  );
const holdFrameLoad = (event: Event) => {
  if (event.target instanceof HTMLIFrameElement)
    event.stopImmediatePropagation();
};
beforeEach(() => {
  vi.useFakeTimers();
  document.addEventListener("load", holdFrameLoad, true);
  mocks.ready = true;
  mocks.settings = {
    webBrowser: normalizeWebBrowserSettings({ engine: "legacy" }),
    internalProxy: normalizeInternalProxySettings(undefined),
    proxyKeepaliveEnabled: false,
    webRecording: { autoRecordWebSessions: false },
  } as GlobalSettings;
  mocks.connections = [
    {
      id: session.connectionId,
      name: session.name,
      hostname: session.hostname,
      protocol: "http",
      port: 80,
      isGroup: false,
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
    },
  ];
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "start_basic_auth_proxy") return proxy;
    if (command === "web_network_guard_status")
      return {
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: false,
      };
    if (command === "activate_proxy_network_document") return false;
    if (command === "stop_basic_auth_proxy") return undefined;
    throw new Error(`Unexpected native command: ${command}`);
  });
});
afterEach(() => {
  cleanup();
  document.removeEventListener("load", holdFrameLoad, true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function browserPreferences(
  patch: Partial<NonNullable<GlobalSettings["webBrowser"]>>,
) {
  mocks.settings = {
    ...mocks.settings,
    webBrowser: { ...mocks.settings.webBrowser!, ...patch },
  };
}
async function mountBrowser() {
  const view = render(<WebBrowser session={session} />);
  await act(async () => {});
  return {
    ...view,
    refresh: async () => {
      view.rerender(<WebBrowser session={session} />);
      await act(async () => {});
    },
  };
}
function report(
  frame: HTMLIFrameElement,
  type: string,
  sequence = 1,
  navigationToken: string | null = new URL(frame.src).searchParams.get(
    "__sorng_navigation_v1",
  ),
) {
  const url = new URL(frame.src);
  url.searchParams.delete("__sorng_navigation_v1");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow!,
        origin: url.origin,
        data: {
          type,
          version: 1,
          sessionId: proxy.session_id,
          documentSequence: sequence,
          documentToken: sequence.toString(16).padStart(32, "0"),
          navigationToken,
          url: url.href,
        },
      }),
    ),
  );
}

describe("browser runtime settings", () => {
  it("applies indicator and language compatibility plus form delays only to fresh sessions", async () => {
    mocks.connections[0].httpHeaders = {
      "Accept-Language": "fr-FR",
      "X-App": "kept",
    };
    browserPreferences({
      hideAutomationIndicator: true,
      minimumFormFillDelayMs: 1500,
      minimumFormSubmitDelayMs: 2000,
    });
    const view = await mountBrowser();
    const first = starts()[0][1].config;
    expect(first.browser_compatibility).toEqual({ hide_webdriver: true });
    expect(first.custom_headers).toEqual({ "X-App": "kept" });
    expect(first.http_form_automation).toMatchObject({
      fillDelayMs: 1500,
      submitDelayMs: 2000,
    });
    expect(first.http_auto_login).toBe(false);
    browserPreferences({ hideAutomationIndicator: false });
    await view.refresh();
    expect(starts()).toHaveLength(1);
    expect(mocks.connections[0].httpFormAutomation).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear session data" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear and reopen" }));
    await act(async () => {});
    expect(starts()[1][1].config.browser_compatibility).toEqual({
      hide_webdriver: false,
    });
  });

  it.each([true, false])(
    "applies native identity preference (%s) and manual-submit restrictions on fresh proxy starts",
    async (preferNativeUserAgent) => {
      mocks.connections[0].httpHeaders = {
        "uSeR-aGeNt": "saved-override",
        "X-App-Setting": "kept",
      };
      browserPreferences({ preferNativeUserAgent, manualFormSubmit: true });
      const autoMfa = vi.spyOn(autoMfaHooks, "useWebAutoMfa");
      const view = await mountBrowser();
      const first = starts()[0][1].config;
      expect(first.custom_headers).toEqual(
        preferNativeUserAgent
          ? { "X-App-Setting": "kept" }
          : mocks.connections[0].httpHeaders,
      );
      expect(first.http_form_automation.submit).toBe(false);
      expect(first.http_auto_login).toBe(false);
      expect(mocks.connections[0].httpHeaders["uSeR-aGeNt"]).toBe(
        "saved-override",
      );
      expect(mocks.connections[0].httpFormAutomation).toBeUndefined();
      expect(autoMfa.mock.lastCall?.[0].blocked).toBe(true);
      browserPreferences({ preferNativeUserAgent: !preferNativeUserAgent });
      await view.refresh();
      expect(starts()).toHaveLength(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Clear session data" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Clear and reopen" }));
      await act(async () => {});
      expect(starts()).toHaveLength(2);
      expect(starts()[1][1].config.custom_headers).toEqual(
        !preferNativeUserAgent
          ? { "X-App-Setting": "kept" }
          : mocks.connections[0].httpHeaders,
      );
    },
  );

  it("changes page zoom without remounting and applies only explicit sandbox capabilities", async () => {
    browserPreferences({
      defaultZoomPercent: 125,
      allowDownloads: true,
      allowPageDialogs: true,
    });
    const view = await mountBrowser();
    const frame = view.container.querySelector("iframe")!;
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms allow-downloads allow-modals",
    );
    expect(frame.style.getPropertyValue("zoom")).toBe("1.25");
    expect(frame).toHaveStyle({ width: "80%", height: "80%" });
    const url = frame.src;
    browserPreferences({ defaultZoomPercent: 50, showLoadingProgress: false });
    await view.refresh();
    expect(view.container.querySelector("iframe")).toBe(frame);
    expect(frame.style.getPropertyValue("zoom")).toBe("0.5");
    expect(frame).toHaveStyle({ width: "200%", height: "200%" });
    expect(frame.src).toBe(url);
    expect(starts()).toHaveLength(1);
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
  });
  it("captures defaults only after readiness and once for each tab identity", () => {
    mocks.ready = false;
    const hook = renderHook(
      ({ id }) =>
        useBrowserRuntimeSettings(id, undefined, mocks.settings, mocks.ready),
      { initialProps: { id: "first" } },
    );
    expect(hook.result.current.policy).toBeNull();
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "block",
      },
    });
    mocks.ready = true;
    hook.rerender({ id: "first" });
    expect(hook.result.current.policy?.pageScripts).toBe("block");
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "inline-only",
      },
    });
    hook.rerender({ id: "first" });
    expect(hook.result.current.policy?.pageScripts).toBe("block");
    hook.rerender({ id: "second" });
    expect(hook.result.current.policy?.pageScripts).toBe("inline-only");
  });

  it("waits for loaded defaults before native startup without an invalidation error", async () => {
    mocks.ready = false;
    const view = await mountBrowser();
    expect(starts()).toHaveLength(0);
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "block",
      },
    });
    mocks.ready = true;
    await view.refresh();
    expect(starts()).toHaveLength(1);
    expect(starts()[0][1].config.proxy_policy.pageScripts).toBe("block");
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
  });

  it("applies visibility live and reads transport only on a fresh start while retaining the tab policy", async () => {
    const view = await mountBrowser();
    const frame = view.container.querySelector("iframe")!;
    report(frame, "proxy_document_start");
    report(frame, "proxy_dom_ready");
    const frameUrl = frame.src;
    expect(screen.getByTestId("web-bookmark-bar")).toBeVisible();
    expect(screen.getByText(`Connected to ${session.hostname}`)).toBeVisible();
    expect(starts()[0][1].config.transport_settings).toEqual(
      normalizeInternalProxySettings(undefined),
    );
    browserPreferences({
      showBookmarksBar: false,
      showSecurityInfo: false,
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "block",
      },
    });
    mocks.settings = {
      ...mocks.settings,
      internalProxy: normalizeInternalProxySettings({
        connectTimeoutSeconds: 22,
        requestTimeoutSeconds: 145,
        poolIdleTimeoutSeconds: 44,
        maxIdleConnectionsPerHost: 7,
        tcpKeepaliveSeconds: 55,
      }),
    };
    await view.refresh();
    expect(screen.queryByTestId("web-bookmark-bar")).toBeNull();
    expect(screen.queryByText(`Connected to ${session.hostname}`)).toBeNull();
    expect(screen.getByText("Not secure (HTTP)")).toBeVisible();
    expect(view.container.querySelector("iframe")).toBe(frame);
    expect(frame.src).toBe(frameUrl);
    expect(starts()).toHaveLength(1);
    expect(stops()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear session data" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear and reopen" }));
    await act(async () => {});
    expect(starts()).toHaveLength(2);
    expect(starts()[1][1].config.transport_settings).toEqual(
      mocks.settings.internalProxy,
    );
    expect(starts()[1][1].config.proxy_policy.pageScripts).toBe("allow");
    browserPreferences({ showBookmarksBar: true, showSecurityInfo: true });
    await view.refresh();
    expect(screen.getByTestId("web-bookmark-bar")).toBeVisible();
    expect(screen.getByText(`Connected to ${session.hostname}`)).toBeVisible();
    expect(starts()).toHaveLength(2);
  });

  it.each([false, true])(
    "honors the complete saved override (present: %s) without granting automatic login",
    async (explicit) => {
      browserPreferences({
        defaultPolicy: {
          ...mocks.settings.webBrowser!.defaultPolicy,
          pageScripts: "block",
          sameOriginOnly: true,
        },
      });
      if (explicit)
        mocks.connections[0].httpProxyPolicy =
          normalizeWebBrowserSettings(undefined).defaultPolicy;
      await mountBrowser();
      expect(starts()[0][1].config.proxy_policy).toMatchObject({
        pageScripts: explicit ? "allow" : "block",
        sameOriginOnly: !explicit,
        allowCrossOriginRedirects: false,
        allowHttpDowngradeRedirects: false,
        queryParameters: [],
      });
      expect(starts()[0][1].config.http_auto_login).toBe(false);
      expect(mocks.connections[0].httpAutoLogin).toBeUndefined();
    },
  );

  it("does not run saved login when the effective global policy blocks scripts", async () => {
    mocks.connections[0] = {
      ...mocks.connections[0],
      httpAutoLogin: true,
      basicAuthUsername: "user",
      basicAuthPassword: "fixture-secret",
    };
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "block",
      },
    });
    await mountBrowser();
    expect(starts()[0][1].config.http_auto_login).toBe(false);
  });

  it.each(["browser", "transport"])(
    "fails closed on invalid %s settings",
    async (kind) => {
      if (kind === "browser")
        mocks.settings.webBrowser = {
          version: 9,
        } as unknown as GlobalSettings["webBrowser"];
      else
        mocks.settings.internalProxy = {
          version: 9,
        } as unknown as GlobalSettings["internalProxy"];
      await mountBrowser();
      expect(starts()).toHaveLength(0);
      if (kind === "browser")
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Browser settings are invalid",
        );
      else
        expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    },
  );

  it("uses the configured initial deadline", async () => {
    browserPreferences({ initialLoadTimeoutSeconds: 12 });
    await mountBrowser();
    act(() => vi.advanceTimersByTime(11_999));
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("web-navigation-error-screen")).toHaveTextContent(
      "Page did not become ready",
    );
  });

  it("inherits the actual native source policy in a popup opened after global defaults change", async () => {
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "inline-only",
      },
    });
    const view = await mountBrowser();
    const frame = view.container.querySelector("iframe")!;
    report(frame, "proxy_document_start");
    report(frame, "proxy_dom_ready");
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "allow",
      },
    });
    await view.refresh();
    const popup = webPopupTabs.open({
      source: session,
      document: {
        sessionId: proxy.session_id,
        generation: 1,
        sequence: 1,
        token: "1".padStart(32, "0"),
        navigationToken: new URL(frame.src).searchParams.get(
          "__sorng_navigation_v1",
        ),
      },
      proxyUrl: proxy.proxy_url,
      url: `${proxy.proxy_url}takecontrol/agent?__sorng_popup_parent_v1=1`,
      isCurrent: () =>
        browserSessionPolicy.read(session.id, proxy.session_id) !== null,
    });
    const automation = vi.spyOn(automationHooks, "useWebAutomation");
    const child = renderHook(() =>
      useWebBrowser({ ...session, id: popup.id }, undefined, popup.id),
    );
    await act(async () => {});
    expect(child.result.current.loadError).toBe("");
    expect(child.result.current.shouldMountIframe).toBe(true);
    expect(automation.mock.lastCall?.[0].effectivePolicy?.pageScripts).toBe(
      "inline-only",
    );
    expect(starts()).toHaveLength(1);
    child.unmount();
    expect(
      browserSessionPolicy.read(session.id, proxy.session_id)?.pageScripts,
    ).toBe("inline-only");
    view.unmount();
    expect(browserSessionPolicy.read(session.id, proxy.session_id)).toBeNull();
  });

  it("refuses a popup with no matching source policy instead of adopting new global defaults", async () => {
    const popup = webPopupTabs.open({
      source: session,
      document: {
        sessionId: "unbound-proxy",
        generation: 1,
        sequence: 1,
        token: "a".repeat(32),
        navigationToken: null,
      },
      proxyUrl: proxy.proxy_url,
      url: `${proxy.proxy_url}takecontrol/agent?__sorng_popup_parent_v1=1`,
      isCurrent: () => true,
    });
    const child = renderHook(() =>
      useWebBrowser({ ...session, id: popup.id }, undefined, popup.id),
    );
    await act(async () => {});
    expect(child.result.current.loadError).toMatch(
      /source browser policy is unavailable/i,
    );
    expect(child.result.current.shouldMountIframe).toBe(false);
    expect(starts()).toHaveLength(0);
  });

  it("uses the configured document deadline after the server answers", async () => {
    browserPreferences({
      initialLoadTimeoutSeconds: 12,
      documentReadyTimeoutSeconds: 45,
    });
    const view = await mountBrowser();
    act(() => vi.advanceTimersByTime(10_000));
    report(view.container.querySelector("iframe")!, "proxy_document_start");
    act(() => vi.advanceTimersByTime(44_999));
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("web-navigation-error-screen")).toHaveTextContent(
      "Page did not become ready",
    );
  });

  it("caps continued document loading at 300 seconds even with larger per-document windows", async () => {
    browserPreferences({
      initialLoadTimeoutSeconds: 120,
      documentReadyTimeoutSeconds: 240,
    });
    const view = await mountBrowser();
    const frame = view.container.querySelector("iframe")!;
    act(() => vi.advanceTimersByTime(100_000));
    report(frame, "proxy_document_start");
    act(() => vi.advanceTimersByTime(100_000));
    report(frame, "proxy_navigation_start");
    report(frame, "proxy_document_start", 2, null);
    act(() => vi.advanceTimersByTime(99_999));
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("web-navigation-error-screen")).toHaveTextContent(
      "Page did not become ready",
    );
  });
});

describe("legacy HTTP viewer settings", () => {
  it("waits for settings and snapshots policy, then uses the latest transport on explicit reconnect", async () => {
    mocks.ready = false;
    const hook = renderHook(() => useHTTPViewer(session));
    await act(async () => {});
    expect(starts()).toHaveLength(0);
    browserPreferences({
      defaultPolicy: {
        ...mocks.settings.webBrowser!.defaultPolicy,
        pageScripts: "block",
      },
    });
    mocks.ready = true;
    hook.rerender();
    await act(async () => {});
    expect(starts()).toHaveLength(1);
    expect(starts()[0][1].config.proxy_policy.pageScripts).toBe("block");
    expect(starts()[0][1].config.transport_settings).toEqual(
      mocks.settings.internalProxy,
    );
    browserPreferences({
      showSecurityInfo: false,
      defaultPolicy: normalizeWebBrowserSettings(undefined).defaultPolicy,
    });
    mocks.settings = {
      ...mocks.settings,
      internalProxy: normalizeInternalProxySettings({
        requestTimeoutSeconds: 222,
      }),
    };
    hook.rerender();
    await act(async () => {});
    expect(starts()).toHaveLength(1);
    expect(stops()).toHaveLength(0);
    await act(async () => hook.result.current.initProxy());
    expect(starts()).toHaveLength(2);
    expect(starts()[1][1].config.transport_settings.requestTimeoutSeconds).toBe(
      222,
    );
    expect(starts()[1][1].config.proxy_policy.pageScripts).toBe("block");
  });
});

describe("security information visibility", () => {
  it("hides ordinary status while retaining expiry and automatic login problem notices", () => {
    const mgr = {
      session,
      browserSettings: normalizeWebBrowserSettings({ showSecurityInfo: false }),
      isSecure: true,
      certIdentity: { validTo: "2000-01-01" },
      automaticLoginNotice: {
        text: "Automatic sign-in stopped; use manual sign-in.",
        detail: "A supported form was not ready.",
      },
      deferredLogin: {
        text: "Saved login: status read failed",
        detail: "Refresh to retry.",
        muted: true,
      },
      hasAuth: true,
      resolvedCreds: { username: "user" },
    } as unknown as WebBrowserMgr;
    render(<SecurityInfoBar mgr={mgr} />);
    expect(screen.queryByText("Secure connection (HTTPS)")).toBeNull();
    expect(screen.queryByText(`Connected to ${session.hostname}`)).toBeNull();
    expect(screen.getByText("Certificate expired")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic sign-in stopped",
    );
    expect(
      screen.getByRole("button", { name: "Refresh saved login status" }),
    ).toBeVisible();
  });
});
