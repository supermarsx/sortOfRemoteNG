import { createRef } from "react";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorPage } from "../../src/components/protocol/webBrowser/ERROR_BASE";
import ContentArea from "../../src/components/protocol/webBrowser/ContentArea";
import NavigationBar from "../../src/components/protocol/webBrowser/NavigationBar";
import progressStyles from "../../src/components/protocol/webBrowser/NavigationProgress.module.css";
import {
  normalizeWebsiteDarkModeConfig,
  DEFAULT_WEBSITE_DARK_THEME,
} from "../../src/utils/connection/websiteDarkMode";
import {
  parseProxyFailurePayload,
  type ProxyNavigationFailure,
  type WebBrowserMgr,
} from "../../src/hooks/protocol/useWebBrowser";

const failure: ProxyNavigationFailure = {
  version: 1,
  sessionId: "proxy-session-1",
  kind: "dns_failure",
  status: 502,
  title: "Server not found",
  url: "https://device.example.test/admin?view=system",
  reason: "The hostname could not be resolved by DNS.",
  detail: "dns error: no record found for device.example.test",
};

function manager(overrides: Partial<WebBrowserMgr> = {}): WebBrowserMgr {
  return {
    currentUrl: failure.url,
    loadError: failure.detail,
    navigationFailure: failure,
    session: { hostname: "device.example.test" },
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

describe("proxy failure bridge validation", () => {
  it("accepts 202 only for a fenced redirect pending message", () => {
    const payload = {
      type: "sorng_proxy_failure",
      ...failure,
      kind: "redirect_review",
      status: 202,
    };
    expect(
      parseProxyFailurePayload(payload, failure.sessionId, failure.url)?.status,
    ).toBe(202);
    for (const changed of [
      { kind: "http_status" },
      { status: 200 },
      { sessionId: "stale" },
      { url: "https://other.invalid/" },
    ])
      expect(
        parseProxyFailurePayload(
          { ...payload, ...changed },
          failure.sessionId,
          failure.url,
        ),
      ).toBeNull();
  });
  it("accepts only a known failure for the active session and target URL", () => {
    const payload = { type: "sorng_proxy_failure", ...failure };
    expect(
      parseProxyFailurePayload(
        payload,
        "proxy-session-1",
        `${failure.url}#ignored-fragment`,
      ),
    ).toEqual(failure);

    expect(
      parseProxyFailurePayload(
        { ...payload, sessionId: "another-session" },
        "proxy-session-1",
        failure.url,
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        { ...payload, kind: "arbitrary-script" },
        "proxy-session-1",
        failure.url,
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        { ...payload, url: "https://attacker.example/" },
        "proxy-session-1",
        failure.url,
      ),
    ).toBeNull();
  });

  it("rejects credentials, malformed status codes, and oversized text", () => {
    const payload = { type: "sorng_proxy_failure", ...failure };
    expect(
      parseProxyFailurePayload(
        {
          ...payload,
          url: "https://admin:secret@device.example.test/",
        },
        "proxy-session-1",
        "https://admin:secret@device.example.test/",
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        { ...payload, status: 200 },
        "proxy-session-1",
        failure.url,
      ),
    ).toBeNull();
    expect(
      parseProxyFailurePayload(
        { ...payload, detail: "x".repeat(16_385) },
        "proxy-session-1",
        failure.url,
      ),
    ).toBeNull();
  });
});

describe("embedded web failure recovery screen", () => {
  it("presents an issued default handoff as neutral pending, with a review/retry fallback", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "redirect_review",
            status: 202,
            title: "Preparing destination handoff",
          },
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the current redirect permission",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("HTTP 202")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
  it("presents the proxy's redirect pause as review, not a NAS HTTP 403, and can reopen its review", () => {
    const offer = vi.fn();
    const mgr = manager({
      navigationFailure: {
        ...failure,
        kind: "redirect_review",
        status: 403,
        title: "Review redirect destination",
        reason: "Review the destination in the browser dialog.",
      },
      redirectReview: {
        continuingAutomatically: false,
        review: null,
        busy: false,
        error: "",
        offer,
        accept: vi.fn(),
        cancel: vi.fn(),
        abort: vi.fn(),
        redirectStep: 2,
        maxRedirectHops: 5,
        trustedDestination: false,
        defaultDestination: false,
        canRememberDestination: false,
        rememberUnavailableReason: "Save this connection first.",
        rememberingDestination: false,
        rememberDestination: vi.fn(async () => {}),
        trustNotice: "",
        authentication: {
          configured: false,
          available: false,
          insecure: false,
          reason: "",
        },
      },
    });
    render(<ErrorPage mgr={mgr} />);
    expect(screen.getByText("Navigation paused for review")).toBeVisible();
    expect(screen.queryByText("HTTP 403")).not.toBeInTheDocument();
    expect(
      screen.getByText(/not an access-denied response from the destination/),
    ).toBeVisible();
    expect(screen.getByText(/Reviewed redirects are enabled/)).toBeVisible();
    expect(
      screen.queryByText(/Enable reviewed cross-origin redirects/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review destination" }));
    expect(offer).toHaveBeenCalledWith(true);
  });
  it("renders redirect review inside the page without a modal and keeps the source iframe inert", () => {
    const mgr = manager({
      redirectReview: {
        continuingAutomatically: false,
        review: {
          receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          sessionId: "s",
          sourceOrigin: "https://source.invalid",
          destinationUrl: "https://target.invalid/",
          navigationToken: null,
          documentSequence: 1,
          removedQuery: false,
        },
        busy: false,
        error: "",
        accept: vi.fn(),
        cancel: vi.fn(),
        abort: vi.fn(),
        offer: vi.fn(),
        authentication: {
          configured: false,
          available: false,
          insecure: false,
          reason: "",
        },
        redirectStep: 1,
        maxRedirectHops: 5,
        trustedDestination: false,
        defaultDestination: false,
        canRememberDestination: false,
        rememberUnavailableReason: "Save this connection first.",
        rememberingDestination: false,
        rememberDestination: vi.fn(async () => {}),
        trustNotice: "",
      },
    });
    const { container } = render(<ContentArea mgr={mgr} />);
    expect(container).toContainElement(
      screen.getByRole("region", { name: "Redirect review" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.querySelector("iframe")).toHaveAttribute("inert");
    expect(container.querySelector("iframe")).toHaveClass("invisible");
    expect(
      screen.getByRole("button", { name: "Continue in this tab" }),
    ).toBeInTheDocument();
  });
  it("keeps page and bookmarks interactive beneath an indeterminate top progress line", () => {
    const mgr = manager({
      loadError: "",
      navigationFailure: null,
      isLoading: true,
      showLoadingIndicator: false,
      iframeRef: createRef<HTMLIFrameElement>(),
    });
    const { container, rerender } = render(<ContentArea mgr={mgr} />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe).not.toHaveClass("invisible");
    expect(iframe).not.toHaveAttribute("inert");
    expect(iframe).not.toHaveAttribute("tabindex", "-1");
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
    rerender(<ContentArea mgr={{ ...mgr, showLoadingIndicator: true }} />);
    expect(screen.getByTestId("web-navigation-progress")).toBeVisible();
    expect(screen.getByTestId("web-navigation-progress")).not.toHaveClass(
      "inset-0",
    );
    const progress = screen.getByRole("progressbar", { name: "Loading page" });
    expect(progress).toHaveClass(progressStyles.track);
    expect(progress.firstElementChild).toHaveClass(progressStyles.segment);
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(iframe).not.toHaveAttribute("inert");
    expect(container.querySelector("iframe")).toBe(iframe);
    rerender(<ContentArea mgr={{ ...mgr, isLoading: false }} />);
    expect(iframe).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
  });
  it("keeps Google in the embedded tab when an optional external destination exists", () => {
    const open = vi.fn(async () => undefined);
    const { container } = render(
      <ContentArea
        mgr={manager({
          loadError: "",
          navigationFailure: null,
          applicationExternalTarget: {
            label: "Google Analytics",
            url: "https://analytics.google.com/analytics/web/",
          },
          openingApplicationExternal: false,
          handleOpenApplicationExternal: open,
        })}
      />,
    );

    expect(container.querySelector("iframe")).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Continue securely in your browser",
      }),
    ).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it("uses only smooth transform/opacity animation and a static visible reduced-motion line", () => {
    const css = readFileSync(
      "src/components/protocol/webBrowser/NavigationProgress.module.css",
      "utf8",
    );
    expect(css).toContain("height: 2px");
    expect(css).toContain("pointer-events: none");
    expect(css).toMatch(/@keyframes travel[\s\S]*?transform: translateX/);
    expect(css).toMatch(/@keyframes pulse[\s\S]*?opacity:/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;[\s\S]*?transform: none;[\s\S]*?width: 100%;[\s\S]*?opacity: 1;/,
    );
  });
  it("opens bounded history menus, jumps directly, and exposes Stop loading in the toolbar", async () => {
    const jump = vi.fn();
    const stop = vi.fn();
    const mgr = manager({
      loadError: "",
      isLoading: true,
      canGoForward: true,
      backHistory: [
        { url: "http://fixture.invalid/previous", index: 2 },
        { url: "http://fixture.invalid/oldest", index: 0 },
      ],
      forwardHistory: [{ url: "http://fixture.invalid/next", index: 4 }],
      handleHistoryJump: jump,
      handleCancelLoading: stop,
      webRecorder: { isRecording: false } as WebBrowserMgr["webRecorder"],
      displayRecorder: {
        state: { isRecording: false },
      } as WebBrowserMgr["displayRecorder"],
      proxySessionIdRef: { current: "fixture" },
      totpConfigs: [],
      totpBtnRef: createRef<HTMLDivElement>(),
      automation: {
        darkMode: {
          scopeKey: "fixture",
          enabled: false,
          available: false,
          busy: false,
          error: null,
          status: { kind: "off", message: "The dark-mode extension is off." },
          unavailableReason: "Open a saved connection first.",
          configuration: normalizeWebsiteDarkModeConfig(undefined),
          theme: { ...DEFAULT_WEBSITE_DARK_THEME },
          defaultTheme: { ...DEFAULT_WEBSITE_DARK_THEME },
          presets: [],
          setEnabled: vi.fn(async () => false),
          updateConfiguration: vi.fn(async () => false),
        },
        // NavigationBar consumes only darkMode; unrelated library actions are
        // deliberately absent from this isolated toolbar fixture.
      } as unknown as WebBrowserMgr["automation"],
    });
    const view = render(<NavigationBar mgr={mgr} />);
    const extension = screen.getByRole("button", {
      name: "Dark-mode extension",
    });
    const recording = screen.getByTitle("Record HTTP traffic (HAR)");
    const notifications = screen.getByRole("button", {
      name: "Website notifications",
    });
    expect(extension.parentElement?.nextElementSibling).toBe(notifications);
    expect(screen.queryByText(/Website proxy routing/)).toBeNull();
    expect(screen.queryByText(/Sign-in & 2FA help/)).toBeNull();
    expect(
      extension.compareDocumentPosition(recording) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(extension);
    fireEvent(window, new Event("resize"));
    expect(
      screen.getByRole("button", { name: "Enable extension" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Close appearance settings" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop loading" }));
    expect(stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back history" }));
    const menu = screen.getByRole("menu", { name: "Back history" });
    expect(menu).toHaveClass("overflow-y-auto");
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /2 pages back: http:\/\/fixture.invalid\/oldest/,
      }),
    );
    expect(jump).toHaveBeenCalledWith(0);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forward history" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    const retry = vi.fn();
    const vaultTotp = {
      scopeKey: "vault-scope",
      available: true,
      unavailableReason: "",
      load: vi.fn(async () => []),
      generate: vi.fn(),
    };
    const vaultManager = {
      ...mgr,
      showTotpPanel: true,
      connection: {
        id: "saved",
        credentialSource: {
          kind: "vault",
          credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      } as WebBrowserMgr["connection"],
      vaultTotp,
      autoMfa: {
        status: "Waiting for the selected 2FA challenge…",
        canRetry: false,
        retry,
      },
    };
    await act(async () => view.rerender(<NavigationBar mgr={vaultManager} />));
    const check = await screen.findByRole("button", {
      name: "Check for 2FA challenge again",
    });
    expect(check).toBeDisabled();
    expect(retry).not.toHaveBeenCalled();
    view.rerender(
      <NavigationBar
        mgr={{
          ...vaultManager,
          autoMfa: { ...vaultManager.autoMfa, canRetry: true },
        }}
      />,
    );
    fireEvent.click(check);
    expect(retry).toHaveBeenCalledOnce();
    expect(vaultTotp.generate).not.toHaveBeenCalled();
  });
  it("never puts a delayed spinner over a trust prompt or error", () => {
    const mgr = manager({ isLoading: true, showLoadingIndicator: true });
    const { rerender } = render(<ContentArea mgr={mgr} />);
    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
    rerender(
      <ContentArea
        mgr={{
          ...mgr,
          loadError: "",
          trustPrompt: {
            status: "first-use",
            identity: { fingerprint: "fixture" },
          } as WebBrowserMgr["trustPrompt"],
        }}
      />,
    );
    expect(screen.queryByTestId("web-navigation-progress")).toBeNull();
  });
  it("distinguishes local document readiness and cancellation from a real network timeout", () => {
    const { rerender } = render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "page_load_timeout",
            title: "Page did not become ready",
          },
        })}
      />,
    );
    expect(screen.getByText("Page readiness was not confirmed")).toBeVisible();
    expect(
      screen.getByText(/The server may already have responded/),
    ).toBeVisible();
    expect(screen.queryByText("The server took too long")).toBeNull();
    rerender(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "navigation_cancelled",
            title: "Loading cancelled",
          },
        })}
      />,
    );
    expect(screen.getByText("Navigation stopped")).toBeVisible();
    expect(screen.queryByText("The server took too long")).toBeNull();
    rerender(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "timeout",
            title: "Connection timed out",
          },
        })}
      />,
    );
    expect(screen.getByText("The server took too long")).toBeVisible();
    expect(screen.queryByText("Page readiness was not confirmed")).toBeNull();
  });
  it("distinguishes Trust Center failures and labels anonymous diagnostic authentication challenges", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "trust_failure",
            title: "Unable to verify HTTPS trust",
            reason:
              "The certificate was inspected, but the database Trust Center is locked.",
          },
        })}
      />,
    );
    expect(
      screen.getByText("Database trust decision unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unable to verify HTTPS trust"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open and unlock the database/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Read-only anonymous connectivity probe/),
    ).toHaveTextContent(
      "HTTP 401 here can be an expected authentication challenge",
    );
    expect(
      screen.queryByText(
        "Check the certificate expiry date and issuing chain.",
      ),
    ).toBeNull();
  });
  it("keeps the failed iframe mounted so Retry can navigate the same frame", () => {
    const iframeRef = createRef<HTMLIFrameElement>();
    const handleRefresh = vi.fn(() => {
      if (iframeRef.current) {
        iframeRef.current.src =
          "http://p0123456789abcdef0123456789abcdef.localhost:43123/retry";
      }
    });
    const mgr = manager({
      iframeRef,
      handleRefresh,
      isLoading: false,
      hasAuth: false,
      handleIframeLoad: vi.fn(),
      handleCancelLoading: vi.fn(),
    });

    const { container } = render(<ContentArea mgr={mgr} />);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframeRef.current).toBe(iframe);
    expect(iframe!).toHaveClass("invisible");
    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(handleRefresh).toHaveBeenCalledOnce();
    expect(iframeRef.current).toBe(iframe);
    expect(iframe!).toHaveAttribute(
      "src",
      "http://p0123456789abcdef0123456789abcdef.localhost:43123/retry",
    );
  });

  it("paints the browser surface and blank iframe with the website palette before navigation", () => {
    const { container } = render(
      <ContentArea
        mgr={manager({
          loadError: "",
          navigationFailure: null,
          isLoading: true,
          handleIframeLoad: vi.fn(),
          websiteDarkBootstrap: {
            backgroundColor: "#181a1b",
            textColor: "#e8e6e3",
          },
        })}
      />,
    );
    expect(container.firstElementChild).toHaveStyle({
      backgroundColor: "#181a1b",
      color: "#e8e6e3",
      colorScheme: "dark",
    });
    expect(container.querySelector("iframe")).toHaveStyle({
      backgroundColor: "#181a1b",
      colorScheme: "dark",
    });
  });

  it("keeps the frame mounted beneath the paint shield and removes the shield for errors or review", () => {
    const mgr = manager({
      loadError: "",
      waitingForDarkPaint: true,
      websiteDarkBootstrap: {
        backgroundColor: "#181a1b",
        textColor: "#e8e6e3",
      },
    });
    const { container, rerender } = render(<ContentArea mgr={mgr} />);
    const frame = container.querySelector("iframe");
    expect(screen.getByTestId("web-dark-paint-shield")).toHaveStyle({
      backgroundColor: "#181a1b",
    });
    expect(frame).not.toHaveClass("invisible");
    rerender(<ContentArea mgr={{ ...mgr, loadError: "Timeout" }} />);
    expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
    expect(container.querySelector("iframe")).toBe(frame);
    rerender(
      <ContentArea
        mgr={{
          ...mgr,
          redirectReview: {
            review: null,
            error: "Review unavailable",
            busy: false,
          } as WebBrowserMgr["redirectReview"],
        }}
      />,
    );
    expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Redirect review" }),
    ).toBeVisible();
    rerender(<ContentArea mgr={{ ...mgr, waitingForDarkPaint: false }} />);
    expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
    expect(container.querySelector("iframe")).toBe(frame);
  });

  it("shows structured context and exposes retry, back, external, and diagnostic actions", () => {
    const mgr = manager();
    render(<ErrorPage mgr={mgr} />);

    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Server not found" }),
    ).toBeVisible();
    expect(screen.getByText("HTTP 502")).toBeVisible();
    expect(screen.getByText(failure.url)).toBeVisible();
    expect(screen.getByText(failure.reason)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Open externally" }));
    fireEvent.click(screen.getByRole("button", { name: "Deep diagnostics" }));

    expect(mgr.handleRefresh).toHaveBeenCalledOnce();
    expect(mgr.handleBack).toHaveBeenCalledOnce();
    expect(mgr.handleOpenExternal).toHaveBeenCalledOnce();
    expect(mgr.runDeepDiagnostics).toHaveBeenCalledOnce();
  });

  it("renders the deep diagnostic stages and root-cause hint", () => {
    render(
      <ErrorPage
        mgr={manager({
          diagnosticReport: {
            host: "device.example.test",
            port: 443,
            protocol: "https",
            resolvedIp: "192.0.2.10",
            summary: "DNS passed, but the TCP connection was refused.",
            rootCauseHint: "The service may not be listening on port 443.",
            totalDurationMs: 84,
            steps: [
              {
                name: "DNS Resolution",
                status: "pass",
                message: "Resolved device.example.test to 192.0.2.10",
                durationMs: 12,
                detail: null,
              },
              {
                name: "TCP Connect",
                status: "fail",
                message: "Connection refused",
                durationMs: 72,
                detail: "os error 10061",
              },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText("DNS Resolution")).toBeVisible();
    expect(screen.getByText("TCP Connect")).toBeVisible();
    expect(
      screen.getByText("The service may not be listening on port 443."),
    ).toBeVisible();
    expect(screen.getByText("Separate probe · took 84 ms")).toBeVisible();
    expect(screen.queryByText("84 ms")).toBeNull();
  });

  it("gives a generic TCP connection failure network advice, not the default or certificate copy", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failure,
            kind: "connection_failed",
            status: null,
            title: "Can't connect to device.example.test:443",
          },
        })}
      />,
    );
    expect(screen.getByText("Connection failed")).toBeVisible();
    expect(
      screen.getByText(
        "Check that the host is online and the saved port is correct.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Web connection failed")).toBeNull();
    expect(screen.queryByText("Secure connection failed")).toBeNull();
    expect(
      screen.queryByText(
        "Check the certificate expiry date and issuing chain.",
      ),
    ).toBeNull();
    expect(
      screen.getByTestId("web-navigation-error-icon").querySelector("svg"),
    ).toHaveClass("lucide-wifi-off");
  });
});
