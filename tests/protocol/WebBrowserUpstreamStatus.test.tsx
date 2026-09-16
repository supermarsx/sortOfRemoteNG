import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorPage } from "../../src/components/protocol/webBrowser/ERROR_BASE";
import {
  parseProxyFailurePayload,
  type ProxyNavigationFailure,
  type WebBrowserMgr,
} from "../../src/hooks/protocol/useWebBrowser";

const NGINX_BODY =
  "<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>";

const upstream = {
  method: "GET",
  reasonPhrase: "Not Found",
  server: "nginx",
  contentType: "text/html",
  bodyBytes: 150,
  elapsedMs: 12,
} as const;

const failure: ProxyNavigationFailure = {
  version: 1,
  sessionId: "proxy-session-1",
  kind: "http_status",
  status: 404,
  title: "Not found",
  url: "https://10.15.27.1/packages/backup/backup.php",
  reason:
    "The page or resource doesn't exist at this address. Check the URL for typos, or whether the path was moved.",
  detail: NGINX_BODY,
  upstream: { ...upstream },
};

function payload(overrides: Record<string, unknown> = {}) {
  return { type: "sorng_proxy_failure", ...failure, ...overrides };
}

function manager(overrides: Partial<WebBrowserMgr> = {}): WebBrowserMgr {
  return {
    currentUrl: failure.url,
    loadError: failure.detail,
    navigationFailure: failure,
    session: { hostname: "10.15.27.1" },
    connection: { id: "8d2f1b6e-4c3a-4f2b-9d10-2f4a6c8e0b11", name: "NAS" },
    canGoBack: true,
    handleRefresh: vi.fn(),
    handleBack: vi.fn(),
    handleOpenExternal: vi.fn(),
    runDeepDiagnostics: vi.fn(),
    isRunningDiagnostics: false,
    diagnosticReport: null,
    diagnosticError: null,
    proxyAlive: true,
    proxyRestarting: false,
    shouldMountIframe: true,
    handleRestartProxy: vi.fn(),
    ...overrides,
  } as unknown as WebBrowserMgr;
}

/** The facts list renders one `dt`/`dd` pair per row, in a fixed order. */
function factRows(): [string, string][] {
  const facts = screen.getByTestId("web-upstream-response-facts");
  return Array.from(facts.querySelectorAll("dt")).map((term) => [
    term.textContent ?? "",
    term.nextElementSibling?.textContent ?? "",
  ]);
}

const writeText = vi.fn<(text: string) => Promise<void>>();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  cleanup();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("upstream status failure binding", () => {
  it("accepts a link-click failure for the saved authority the tab never resolved", () => {
    // The themed status page carries no readiness script, so the tab's active
    // navigation URL still points at the page the link was clicked on.
    const parsed = parseProxyFailurePayload(
      payload(),
      "proxy-session-1",
      "https://10.15.27.1/webman/index.cgi",
      { authorityUrl: "https://10.15.27.1" },
    );
    expect(parsed).toEqual(failure);
  });

  it("refuses the same report without an in-flight navigation or off the saved authority", () => {
    expect(
      parseProxyFailurePayload(
        payload(),
        "proxy-session-1",
        "https://10.15.27.1/webman/index.cgi",
        null,
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        payload({ url: "https://10.15.27.9/packages/backup/backup.php" }),
        "proxy-session-1",
        "https://10.15.27.1/webman/index.cgi",
        { authorityUrl: "https://10.15.27.1" },
      ),
    ).toBeNull();
    // A different port or scheme is a different authority.
    expect(
      parseProxyFailurePayload(
        payload({ url: "https://10.15.27.1:8443/x" }),
        "proxy-session-1",
        "https://10.15.27.1/webman/index.cgi",
        { authorityUrl: "https://10.15.27.1" },
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        payload({ url: "http://10.15.27.1/x" }),
        "proxy-session-1",
        "https://10.15.27.1/webman/index.cgi",
        { authorityUrl: "https://10.15.27.1" },
      ),
    ).toBeNull();
  });

  it("refuses a 404 that came from a redirect to a different host", () => {
    // If the upstream redirects off its own authority and THAT host answers
    // 404, the result must never be presented as this connection's failure —
    // the address on the error screen and in the copied diagnostics would name
    // a host the user never connected to.
    for (const url of [
      "https://elsewhere.example/packages/backup/backup.php",
      "https://10.15.27.1.evil.example/packages/backup/backup.php",
      "https://10.15.27.1@elsewhere.example/backup.php",
    ])
      expect(
        parseProxyFailurePayload(
          payload({ url }),
          "proxy-session-1",
          "https://10.15.27.1/webman/index.cgi",
          { authorityUrl: "https://10.15.27.1" },
        ),
      ).toBeNull();
    // The proxy's own cross-origin redirect pages name the destination, so they
    // keep the strict path for the same reason.
    expect(
      parseProxyFailurePayload(
        payload({
          kind: "cross_origin_redirect",
          status: 403,
          url: "https://elsewhere.example/",
          upstream: undefined,
        }),
        "proxy-session-1",
        "https://10.15.27.1/webman/index.cgi",
        { authorityUrl: "https://10.15.27.1" },
      ),
    ).toBeNull();
  });

  it("keeps the exact-target path working and still binds the session", () => {
    expect(
      parseProxyFailurePayload(payload(), "proxy-session-1", failure.url),
    ).toEqual(failure);
    expect(
      parseProxyFailurePayload(payload(), "other-session", failure.url, {
        authorityUrl: "https://10.15.27.1",
      }),
    ).toBeNull();
  });

  it("fails closed on an upstream facts block it does not fully recognise", () => {
    const cases: Record<string, unknown>[] = [
      { ...upstream, unexpected: 1 },
      { ...upstream, method: "TRACE" },
      { ...upstream, method: "get" },
      { ...upstream, server: "nginx\r\nX-Injected: 1" },
      { ...upstream, server: "x".repeat(129) },
      { ...upstream, contentType: "" },
      { ...upstream, reasonPhrase: "Not\nFound" },
      { ...upstream, bodyBytes: -1 },
      { ...upstream, bodyBytes: 1.5 },
      { ...upstream, elapsedMs: 86_400_001 },
      { method: "GET" },
      [upstream] as unknown as Record<string, unknown>,
    ];
    for (const value of cases)
      expect(
        parseProxyFailurePayload(
          payload({ upstream: value }),
          "proxy-session-1",
          failure.url,
        ),
      ).toBeNull();
    // A null server or content type is the documented "header absent" shape.
    expect(
      parseProxyFailurePayload(
        payload({ upstream: { ...upstream, server: null, contentType: null } }),
        "proxy-session-1",
        failure.url,
      )?.upstream,
    ).toEqual({ ...upstream, server: null, contentType: null });
  });

  it("leaves a transport failure without an upstream block", () => {
    const parsed = parseProxyFailurePayload(
      payload({ kind: "connection_refused", status: 502, upstream: undefined }),
      "proxy-session-1",
      failure.url,
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("upstream");
  });
});

describe("upstream status error screen", () => {
  it.each([
    [404, "Not Found", "Server returned HTTP 404"],
    [403, "Forbidden", "Server returned HTTP 403"],
    [500, "Internal Server Error", "Server returned HTTP 500"],
    [502, "Bad Gateway", "Server returned HTTP 502"],
  ])(
    "offers copy, retry and back for an upstream %i",
    async (status, reasonPhrase, eyebrow) => {
      const mgr = manager({
        navigationFailure: {
          ...failure,
          status,
          upstream: { ...upstream, reasonPhrase },
        },
      });
      render(<ErrorPage mgr={mgr} />);

      expect(screen.getByText(eyebrow)).toBeVisible();
      expect(screen.getByText(`HTTP ${status}`)).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(mgr.handleRefresh).toHaveBeenCalledOnce();
      expect(mgr.handleBack).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const copied = writeText.mock.calls[0]![0];
      expect(copied).toContain(`Result: HTTP ${status} ${reasonPhrase}`);
      expect(copied).toContain(
        "Address: https://10.15.27.1/packages/backup/backup.php",
      );
      expect(copied).toContain("Request method: GET");
      expect(copied).toContain("Upstream server header: nginx");
      expect(copied).toContain("Response body size: 150 bytes");
      expect(copied).toContain("Upstream request duration: 12 ms");
      expect(copied).toContain(
        "Connection: NAS (id 8d2f1b6e-4c3a-4f2b-9d10-2f4a6c8e0b11)",
      );
      expect(copied).toMatch(/^App version: \d+\.\d+$/m);
      // The server's own body stays on the page, never on the clipboard.
      expect(copied).not.toContain("<html>");
      expect(copied).not.toContain("nginx</center>");
    },
  );

  it("shows the upstream facts and keeps the server's response readable", () => {
    render(<ErrorPage mgr={manager()} />);
    expect(factRows()).toEqual([
      ["Method", "GET"],
      ["Server", "nginx"],
      ["Content type", "text/html"],
      ["Response size", "150 bytes"],
      ["Took", "12 ms"],
    ]);

    const toggle = screen.getByText("Show the server's response");
    expect(toggle).toBeVisible();
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(toggle.parentElement).toHaveTextContent("404 Not Found");
    expect(toggle.parentElement).toHaveTextContent("nginx");
  });

  it("still offers the actions when the upstream sent an empty body", async () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            status: 502,
            detail: "The upstream server returned HTTP 502.",
            upstream: {
              ...upstream,
              reasonPhrase: "Bad Gateway",
              server: null,
              contentType: null,
              bodyBytes: 0,
            },
          },
        })}
      />,
    );
    expect(factRows()).toEqual([
      ["Method", "GET"],
      ["Server", "not reported"],
      ["Content type", "not reported"],
      ["Response size", "0 bytes"],
      ["Took", "12 ms"],
    ]);
    expect(screen.getByText("Show the server's response")).toBeVisible();
    expect(
      screen.getByText("The upstream server returned HTTP 502."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]![0]).toContain(
      "Upstream server header: not reported",
    );
  });

  it("keeps the technical-details wording when no response was received", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "host_unreachable",
            status: null,
            title: "Can't reach 10.15.27.1:443",
            detail: "tcp connect error: timed out",
            upstream: undefined,
          },
        })}
      />,
    );
    expect(screen.getByText("Technical details")).toBeVisible();
    expect(screen.queryByText("Show the server's response")).toBeNull();
    expect(screen.queryByTestId("web-upstream-response-facts")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeVisible();
  });
});
