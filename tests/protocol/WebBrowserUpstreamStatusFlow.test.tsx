import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
  connections: [] as Connection[],
  settings: {
    httpsTrustPolicy: "always-ask",
    webRecording: { autoRecordWebSessions: false },
    proxyKeepaliveEnabled: false,
  },
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
  useWebRecorder: () => ({ state: {}, startRecording: vi.fn() }),
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

const proxy = {
  session_id: "upstream-status-fixture-session",
  local_port: 43091,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43091/",
};
const TARGET = "http://device.example.test:81";
const FAILING_URL = `${TARGET}/packages/backup/backup.php`;

let documentSequence = 0;
/** The identity the proxy's readiness script reports for the landing page. */
function documentReport(iframe: HTMLIFrameElement) {
  const url = new URL(iframe.src);
  const token = url.searchParams.get("__sorng_navigation_v1");
  expect(token).toMatch(/^[a-f0-9]{32}$/);
  return {
    source: iframe.contentWindow!,
    origin: url.origin,
    data: {
      type: "proxy_document_start",
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
/** The toolbar has its own Back/Refresh, so scope to the failure screen. */
function errorScreen() {
  return within(screen.getByTestId("web-navigation-error-screen"));
}
function frameSrc(): string {
  return (document.querySelector("iframe") as HTMLIFrameElement).src;
}
function post(message: {
  source: Window;
  origin: string;
  data: Record<string, unknown>;
}) {
  act(() => window.dispatchEvent(new MessageEvent("message", message)));
}

async function mounted() {
  const connection: Connection = {
    id: "upstream-status-connection",
    name: "Device fixture",
    hostname: "device.example.test",
    protocol: "http",
    port: 81,
    isGroup: false,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
  mocks.connections = [connection];
  const session: ConnectionSession = {
    id: "upstream-status-session",
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
  // Land on the site's own page first, so the failing request below is a link
  // click inside that document rather than an address-bar navigation.
  const report = documentReport(iframe);
  post(report);
  post({ ...report, data: { ...report.data, type: "proxy_dom_ready" } });
  return { ...view, iframe, report };
}

/** What the themed proxy failure page posts back from its inline bridge. */
function failurePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "sorng_proxy_failure",
    version: 1,
    sessionId: proxy.session_id,
    kind: "http_status",
    status: 404,
    title: "Not found",
    url: FAILING_URL,
    reason: "The page or resource doesn't exist at this address.",
    detail:
      "<html><head><title>404 Not Found</title></head><body><center>nginx</center></body></html>",
    upstream: {
      method: "GET",
      reasonPhrase: "Not Found",
      server: "nginx",
      contentType: "text/html",
      bodyBytes: 150,
      elapsedMs: 12,
    },
    ...overrides,
  };
}

describe("upstream HTTP error reached by a link click", () => {
  const holdFrameLoad = (event: Event) => {
    if (event.target instanceof HTMLIFrameElement)
      event.stopImmediatePropagation();
  };
  beforeEach(() => {
    documentSequence = 0;
    document.addEventListener("load", holdFrameLoad, true);
    mocks.verify.mockReset().mockResolvedValue({ status: "trusted" });
    mocks.trust.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "start_basic_auth_proxy") return proxy;
      if (command === "stop_basic_auth_proxy") return undefined;
      if (command === "open_url_external") return undefined;
      throw new Error(`Unexpected native boundary: ${command}`);
    });
  });
  afterEach(() => {
    cleanup();
    document.removeEventListener("load", holdFrameLoad, true);
  });

  it("replaces the bare proxy page with the app's error screen and its actions", async () => {
    const { iframe, report } = await mounted();
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();

    // The document unloads (link click), then the themed 404 page loads and
    // posts its bridge message. That page carries no readiness script, so the
    // tab never learns the new address from anywhere else.
    post({
      ...report,
      data: { ...report.data, type: "proxy_navigation_start" },
    });
    post({
      source: iframe.contentWindow!,
      origin: new URL(proxy.proxy_url).origin,
      data: failurePayload(),
    });

    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(screen.getByText("Server returned HTTP 404")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Not found" })).toBeVisible();
    // The failing address is adopted, not the page the link was clicked on.
    expect(screen.getByText(FAILING_URL)).toBeVisible();
    expect(screen.getByDisplayValue(FAILING_URL)).toBeInTheDocument();
    for (const name of ["Copy diagnostics", "Retry", "Back"])
      expect(errorScreen().getByRole("button", { name })).toBeEnabled();
  });

  it("does the same for a themed transport failure, which sends no upstream facts", async () => {
    // `themed_errors.rs` returns before the readiness injection too, so a link
    // click that cannot reach the upstream at all was stranded on the bare
    // proxy page in exactly the same way.
    const { iframe, report } = await mounted();
    post({
      ...report,
      data: { ...report.data, type: "proxy_navigation_start" },
    });
    post({
      source: iframe.contentWindow!,
      origin: new URL(proxy.proxy_url).origin,
      data: failurePayload({
        kind: "connection_refused",
        status: 502,
        title: "Connection refused",
        reason: "The server actively refused the connection.",
        detail: "tcp connect error: actively refused (os error 10061)",
        upstream: undefined,
      }),
    });

    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(screen.getByText("Service refused the connection")).toBeVisible();
    expect(screen.getByText(FAILING_URL)).toBeVisible();
    expect(screen.queryByTestId("web-upstream-response-facts")).toBeNull();
    expect(screen.getByText("Technical details")).toBeVisible();
    for (const name of ["Copy diagnostics", "Retry", "Back"])
      expect(errorScreen().getByRole("button", { name })).toBeEnabled();
  });

  it("retries the request that failed, not the page before it", async () => {
    const { iframe, report } = await mounted();
    post({
      ...report,
      data: { ...report.data, type: "proxy_navigation_start" },
    });
    post({
      source: iframe.contentWindow!,
      origin: new URL(proxy.proxy_url).origin,
      data: failurePayload(),
    });

    await act(async () => {
      fireEvent.click(errorScreen().getByRole("button", { name: "Retry" }));
    });
    const retried = new URL(frameSrc());
    expect(retried.origin).toBe(new URL(proxy.proxy_url).origin);
    expect(retried.pathname).toBe("/packages/backup/backup.php");
    expect(iframe).toBe(document.querySelector("iframe"));
  });

  it("goes back to the page the link was clicked on", async () => {
    const { iframe, report } = await mounted();
    post({
      ...report,
      data: { ...report.data, type: "proxy_navigation_start" },
    });
    post({
      source: iframe.contentWindow!,
      origin: new URL(proxy.proxy_url).origin,
      data: failurePayload(),
    });

    await act(async () => {
      fireEvent.click(errorScreen().getByRole("button", { name: "Back" }));
    });
    const back = new URL(frameSrc());
    expect(back.pathname).toBe("/");
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
  });

  it("ignores a failure report for another authority or without a navigation", async () => {
    const { iframe, report } = await mounted();
    const origin = new URL(proxy.proxy_url).origin;
    // No navigation in flight.
    post({
      source: iframe.contentWindow!,
      origin,
      data: failurePayload(),
    });
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();

    post({
      ...report,
      data: { ...report.data, type: "proxy_navigation_start" },
    });
    post({
      source: iframe.contentWindow!,
      origin,
      data: failurePayload({ url: "https://attacker.example/evil" }),
    });
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    expect(screen.queryByText("https://attacker.example/evil")).toBeNull();
  });
});
