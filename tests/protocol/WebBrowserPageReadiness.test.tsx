import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  verify: vi.fn(),
  trust: vi.fn(),
  dispatch: vi.fn(),
  startRecording: vi.fn(),
  connections: [] as Connection[],
  settings: {
    httpsTrustPolicy: "always-ask",
    webRecording: { autoRecordWebSessions: false },
    proxyKeepaliveEnabled: false,
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mocks.connections },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => ({
  ...(await original<typeof import("../../src/contexts/SettingsContext")>()),
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {}, startRecording: mocks.startRecording }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => undefined,
}));
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: mocks.verify,
  trustIdentity: mocks.trust,
}));
import { WebBrowser } from "../../src/components/protocol/WebBrowser";

const certificate = {
  fingerprint: "AA:BB:CC",
  subject: null,
  issuer: null,
  san: [],
  chain: [],
};
const proxy = {
  session_id: "readiness-fixture-session",
  local_port: 43081,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
};
const profiles = [
  {
    id: "nginxProxyMgr",
    name: "NPM fixture",
    hostname: "npm.example.test",
    protocol: "http",
    port: 81,
  },
  {
    id: "pfsense",
    name: "pfSense fixture",
    hostname: "firewall.example.test",
    protocol: "https",
    port: 443,
  },
] as const;

let documentSequence = 0;
function readiness(iframe: HTMLIFrameElement) {
  const url = new URL(iframe.src);
  const token = url.searchParams.get("__sorng_navigation_v1");
  expect(token).toMatch(/^[a-f0-9]{32}$/);
  return {
    source: iframe.contentWindow!,
    origin: url.origin,
    data: {
      type: "proxy_dom_ready",
      version: 1,
      sessionId: proxy.session_id,
      documentToken: (++documentSequence).toString(16).padStart(32, "0"),
      documentSequence,
      navigationToken: token,
      url: iframe.src.replace(
        /[?&]__sorng_navigation_v1=[a-f0-9]{32}(?=#|$)/,
        "",
      ),
    },
  };
}
function reportMessage(report: ReturnType<typeof readiness>) {
  act(() => window.dispatchEvent(new MessageEvent("message", report)));
}
function reportReady(report: ReturnType<typeof readiness>) {
  if (report.data.type === "proxy_dom_ready")
    reportMessage({
      ...report,
      data: { ...report.data, type: "proxy_document_start" },
    });
  reportMessage(report);
}

async function mounted(profile: (typeof profiles)[number] = profiles[0]) {
  const connection: Connection = {
    id: "readiness-connection",
    name: profile.name,
    hostname: profile.hostname,
    protocol: profile.protocol,
    port: profile.port,
    isGroup: false,
    basicAuthUsername: "fixture-user",
    basicAuthPassword: "fixture-secret",
    httpApplication: { version: 1, id: profile.id, loginMode: "form" },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
  mocks.connections = [connection];
  const session: ConnectionSession = {
    id: "readiness-session",
    connectionId: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    hostname: connection.hostname,
    status: "connected",
    startTime: new Date(),
  };
  const view = render(<WebBrowser session={session} />);
  await act(async () => {});
  const iframe = view.container.querySelector("iframe")!;
  expect(iframe).not.toBeNull();
  return { ...view, iframe };
}

describe("mounted website page readiness", () => {
  // jsdom completes a synthetic iframe navigation without fetching resources.
  // These fixtures deliberately represent documents whose load event is pending.
  const holdFrameLoad = (event: Event) => {
    if (event.target instanceof HTMLIFrameElement)
      event.stopImmediatePropagation();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    document.addEventListener("load", holdFrameLoad, true);
    mocks.settings.webRecording.autoRecordWebSessions = false;
    mocks.verify.mockReset().mockResolvedValue({ status: "trusted" });
    mocks.trust.mockReset().mockResolvedValue(undefined);
    mocks.startRecording.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "get_tls_certificate_info") return certificate;
      if (command === "start_basic_auth_proxy") return proxy;
      if (command === "stop_basic_auth_proxy") return undefined;
      throw new Error(`Unexpected native boundary: ${command}`);
    });
  });
  afterEach(() => {
    cleanup();
    document.removeEventListener("load", holdFrameLoad, true);
    vi.useRealTimers();
  });

  it.each(profiles)(
    "keeps $name :$port visible and interactive while form scripts or manual MFA wait",
    async (profile) => {
      const { iframe } = await mounted(profile);
      expect(iframe.src).toContain(proxy.proxy_url);
      act(() => vi.advanceTimersByTime(2_000));
      expect(iframe).not.toHaveClass("invisible");
      expect(iframe).not.toHaveAttribute("inert");
      expect(iframe).not.toHaveAttribute("tabindex", "-1");
      // A delayed subresource must not cover a usable login or MFA form.
      const progress = screen.getByTestId("web-navigation-progress");
      expect(progress.closest(".inset-0")).toBeNull();
      expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    },
  );

  it("does not time out a pending human certificate decision after thirty seconds", async () => {
    mocks.verify.mockResolvedValue({
      status: "first-use",
      identity: certificate,
      requiresApproval: true,
    });
    const { iframe } = await mounted(profiles[1]);
    expect(screen.getByText("Unknown HTTPS Certificate")).toBeVisible();
    expect(iframe).toHaveAttribute("src", "about:blank");
    act(() => vi.advanceTimersByTime(35_000));
    expect(screen.getByText("Unknown HTTPS Certificate")).toBeVisible();
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Accept & Continue" }));
    await act(async () => {});
    expect(iframe.src).toContain(proxy.proxy_url);
    // Accepting this session alone does not silently create a remembered decision.
    expect(mocks.trust).not.toHaveBeenCalled();
  });

  it("does not wait for optional recording startup before mounting the target document", async () => {
    mocks.settings.webRecording.autoRecordWebSessions = true;
    mocks.startRecording.mockImplementation(() => new Promise(() => {}));
    const { iframe } = await mounted();
    expect(mocks.startRecording).toHaveBeenCalledOnce();
    expect(iframe.src).toContain(proxy.proxy_url);
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
  });

  it.each(profiles)(
    "accepts only the current protected document's DOM-ready report for $name without waiting for subresources",
    async (profile) => {
      const { iframe } = await mounted(profile);
      act(() => vi.advanceTimersByTime(250));
      expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
      reportReady(readiness(iframe));
      expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "false");
      expect(iframe).not.toHaveAttribute("inert");
      act(() => vi.advanceTimersByTime(35_000));
      expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
      const config = mocks.invoke.mock.calls.find(
        ([command]) => command === "start_basic_auth_proxy",
      )?.[1].config;
      expect(config).toMatchObject({
        upstream_auth_mode: "none",
        http_auto_login: true,
      });
    },
  );

  it("ignores spoofed source, origin, session, token, version, URL and malformed readiness reports", async () => {
    const { iframe } = await mounted();
    const valid = readiness(iframe);
    act(() => vi.advanceTimersByTime(250));
    const invalid = [
      { ...valid, source: window },
      { ...valid, origin: "https://unrelated.example.test" },
      { ...valid, data: { ...valid.data, sessionId: "another-session" } },
      { ...valid, data: { ...valid.data, navigationToken: "0".repeat(32) } },
      { ...valid, data: { ...valid.data, version: 2 } },
      { ...valid, data: { ...valid.data, documentToken: "not-a-token" } },
      { ...valid, data: { ...valid.data, documentSequence: 0 } },
      { ...valid, data: { ...valid.data, documentSequence: 1.5 } },
      {
        ...valid,
        data: { ...valid.data, documentSequence: Number.MAX_SAFE_INTEGER + 1 },
      },
      {
        ...valid,
        data: { ...valid.data, url: `${valid.origin}/another-document` },
      },
      { ...valid, data: { ...valid.data, url: "not-a-url" } },
      { ...valid, data: { ...valid.data, url: "x".repeat(16_385) } },
      { ...valid, data: { ...valid.data, type: "unrecognized_ready" } },
    ];
    for (const report of invalid) {
      reportReady(report);
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "true");
      expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
    }
    reportReady(valid);
    expect(iframe.parentElement).toHaveAttribute("aria-busy", "false");
  });

  it.each(profiles)(
    "tracks an internal link or form document for $name without waiting for iframe.onload",
    async (profile) => {
      const { iframe } = await mounted(profile);
      const initial = readiness(iframe);
      // Readiness alone cannot invent the accepted document identity.
      reportMessage(initial);
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "true");
      reportReady(initial);
      reportMessage({
        ...initial,
        data: { ...initial.data, type: "proxy_navigation_start" },
      });
      act(() => vi.advanceTimersByTime(250));
      expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
      expect(iframe).not.toHaveAttribute("inert");
      const next = {
        ...initial,
        data: {
          ...initial.data,
          documentToken: "f".repeat(32),
          documentSequence: initial.data.documentSequence + 1,
          navigationToken: null,
          url: `${initial.origin}/dashboard?tab=certificates#details`,
        },
      };
      reportReady(initial);
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "true");
      reportReady(next);
      expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "false");
      expect(iframe).not.toHaveAttribute("inert");
      act(() => vi.advanceTimersByTime(35_000));
      expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    },
  );

  it("does not let a late internal document supersede an app-issued refresh", async () => {
    const { iframe } = await mounted();
    const initial = readiness(iframe);
    reportReady(initial);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => {});
    const current = readiness(iframe);
    act(() => vi.advanceTimersByTime(250));
    reportReady({
      ...initial,
      data: {
        ...initial.data,
        navigationToken: null,
        documentToken: "f".repeat(32),
        documentSequence: current.data.documentSequence + 1,
        url: `${initial.origin}/late-internal-document`,
      },
    });
    expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
    reportReady(current);
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
  });

  it.each([false, true])(
    "accepts a strictly newer full-document redirect before the first DOM-ready (beforeunload: %s)",
    async (beforeUnload) => {
      const { iframe } = await mounted(profiles[1]);
      const initial = readiness(iframe);
      reportMessage({
        ...initial,
        data: { ...initial.data, type: "proxy_document_start" },
      });
      if (beforeUnload)
        reportMessage({
          ...initial,
          data: { ...initial.data, type: "proxy_navigation_start" },
        });
      act(() => vi.advanceTimersByTime(250));
      expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
      reportReady({
        ...initial,
        data: {
          ...initial.data,
          navigationToken: null,
          documentToken: "e".repeat(32),
          documentSequence: initial.data.documentSequence + 1,
          url: `${initial.origin}/index.php?login=complete`,
        },
      });
      expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "false");
      reportReady(initial);
      act(() => vi.advanceTimersByTime(35_000));
      expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    },
  );

  it("keeps an internally navigating frame cancelled after late document start and ready reports", async () => {
    const { iframe } = await mounted();
    const initial = readiness(iframe);
    reportReady(initial);
    reportMessage({
      ...initial,
      data: { ...initial.data, type: "proxy_navigation_start" },
    });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.click(screen.getByRole("button", { name: "Stop loading" }));
    reportReady({
      ...initial,
      source: iframe.contentWindow!,
      data: {
        ...initial.data,
        navigationToken: null,
        documentToken: "f".repeat(32),
        documentSequence: initial.data.documentSequence + 1,
        url: `${initial.origin}/after-cancel`,
      },
    });
    expect(iframe).toHaveAttribute("src", "about:blank");
    expect(iframe).toHaveAttribute("inert");
    expect(screen.getByText("Loading cancelled")).toBeVisible();
    act(() => vi.advanceTimersByTime(35_000));
    expect(screen.getByText("Loading cancelled")).toBeVisible();
  });

  it("rejects an old same-URL document token after refresh and uses a fresh navigation token", async () => {
    const { iframe } = await mounted();
    const old = readiness(iframe);
    reportReady(old);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => {});
    const current = readiness(iframe);
    expect(current.data.url).toBe(old.data.url);
    expect(current.data.navigationToken).not.toBe(old.data.navigationToken);
    act(() => vi.advanceTimersByTime(250));
    reportReady({ ...old, source: iframe.contentWindow! });
    expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
    expect(iframe.parentElement).toHaveAttribute("aria-busy", "true");
    reportReady(current);
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
  });

  it("does not allow a late ready report to reopen a cancelled navigation", async () => {
    const { iframe } = await mounted();
    const pending = readiness(iframe);
    act(() => vi.advanceTimersByTime(250));
    fireEvent.click(
      screen.getByRole("button", { name: /Cancel|Stop loading/i }),
    );
    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(iframe).toHaveAttribute("src", "about:blank");
    reportReady({ ...pending, source: iframe.contentWindow! });
    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(iframe).toHaveAttribute("inert");
    act(() => vi.advanceTimersByTime(35_000));
    expect(screen.getByText("Loading cancelled")).toBeVisible();
  });
});
