import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorPage } from "../../src/components/protocol/webBrowser/ERROR_BASE";
import ContentArea from "../../src/components/protocol/webBrowser/ContentArea";
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
    handleRestartProxy: vi.fn(),
    ...overrides,
  } as unknown as WebBrowserMgr;
}

describe("proxy failure bridge validation", () => {
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
    expect(screen.getByText("84 ms")).toBeVisible();
  });
});
