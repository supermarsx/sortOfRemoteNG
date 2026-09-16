import { createRef } from "react";
import { readFileSync } from "node:fs";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorPage } from "../../src/components/protocol/webBrowser/ERROR_BASE";
import ContentArea from "../../src/components/protocol/webBrowser/ContentArea";
import type {
  ProxyFailureKind,
  ProxyNavigationFailure,
  WebBrowserMgr,
} from "../../src/hooks/protocol/useWebBrowser";
import type {
  WebNavigationTimeline,
  WebTrustCheck,
} from "../../src/types/security/certificateInspection";
import { describeCertificateInspectionFailure } from "../../src/utils/security/certificateInspectionFailure";

const STARTED_AT = Date.UTC(2026, 8, 15, 12, 2, 11);

const CERTIFICATE_TIPS = [
  "Verify that the certificate is valid for this hostname.",
  "Check the certificate expiry date and issuing chain.",
  "Only change certificate verification after confirming the server identity.",
];

const TRUST_SENTENCE =
  "The certificate trust check could not run, so no connection was opened and nothing was sent.";

function directTimeline(
  overrides: Partial<WebNavigationTimeline> = {},
): WebNavigationTimeline {
  return {
    startedAt: STARTED_AT,
    failedAfterMs: 10_012,
    route: "direct",
    steps: [
      {
        id: "resolve",
        label: "Resolve address",
        status: "pass",
        durationMs: 1,
        detail: null,
      },
      {
        id: "connect",
        label: "TCP connect",
        status: "fail",
        durationMs: 10_003,
        detail: "No response from 10.1.180.11:443 after 10.0 s",
      },
      {
        id: "tls_handshake",
        label: "TLS handshake",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "certificate",
        label: "Read certificate",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "trust",
        label: "Certificate trust check",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "page",
        label: "Open page",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
    ],
    ...overrides,
  };
}

/** The reported incident: https://10.1.180.11/ with a silently dropped SYN. */
const hostUnreachable: ProxyNavigationFailure = {
  version: 1,
  sessionId: "local",
  kind: "host_unreachable",
  status: null,
  title: "Can't reach 10.1.180.11:443",
  url: "https://10.1.180.11/",
  reason: `No response from 10.1.180.11:443 within 10.0 s (TCP connect). ${TRUST_SENTENCE}`,
  detail: "TCP connect to 10.1.180.11:443 timed out after 10.0 s",
  timeline: directTimeline(),
};

function manager(overrides: Partial<WebBrowserMgr> = {}): WebBrowserMgr {
  return {
    currentUrl: hostUnreachable.url,
    loadError: hostUnreachable.detail,
    navigationFailure: hostUnreachable,
    session: { hostname: "10.1.180.11", name: "NAS" },
    canGoBack: false,
    handleRefresh: vi.fn(),
    handleBack: vi.fn(),
    handleOpenExternal: vi.fn(),
    runDeepDiagnostics: vi.fn(),
    isRunningDiagnostics: false,
    diagnosticsStartedAt: null,
    diagnosticConnectTimeoutSecs: 15,
    diagnosticReport: null,
    diagnosticError: null,
    proxyAlive: true,
    proxyRestarting: false,
    shouldMountIframe: true,
    iframeRef: createRef<HTMLIFrameElement>(),
    handleRestartProxy: vi.fn(),
    trustCheck: null,
    trustPrompt: null,
    ...overrides,
  } as unknown as WebBrowserMgr;
}

function failureOf(
  kind: ProxyFailureKind,
  title: string,
  timeline: WebNavigationTimeline | undefined = undefined,
): ProxyNavigationFailure {
  return { ...hostUnreachable, kind, title, timeline };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("inspection failure presentation by failing layer", () => {
  it("shows the reported 10.1.180.11 timeout as Host unreachable, not a certificate problem", () => {
    render(<ErrorPage mgr={manager()} />);
    expect(screen.getByText("Host unreachable")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Can't reach 10.1.180.11:443",
      }),
    ).toBeVisible();
    expect(screen.getByText(hostUnreachable.reason)).toBeVisible();
    expect(screen.queryByText("Secure connection failed")).toBeNull();
    expect(
      screen.queryByText("Unable to inspect the HTTPS certificate"),
    ).toBeNull();
    for (const tip of CERTIFICATE_TIPS)
      expect(screen.queryByText(tip)).toBeNull();
    const icon = screen.getByTestId("web-navigation-error-icon");
    expect(icon.querySelector("svg")).toHaveClass("lucide-wifi-off");
    expect(icon).toHaveAttribute("data-tone", "error");
  });

  it.each([
    {
      kind: "host_unreachable",
      title: "Can't reach 10.1.180.11:443",
      eyebrow: "Host unreachable",
      icon: "lucide-wifi-off",
      tone: "error",
      tips: [
        "Check that the device is on and reachable from this computer (network, VPN, routing).",
        "Confirm the web interface listens on the saved port; a firewall may be silently dropping connections.",
        "If a browser on this computer opens the address, check firewall or VPN rules that apply only to this app.",
      ],
    },
    {
      kind: "proxy_route_failure",
      title: "The proxy rejected its credentials (HTTP 407)",
      eyebrow: "Proxy route failed",
      icon: "lucide-route-off",
      tone: "error",
      tips: [
        "Check the global HTTP(S) proxy address and credentials in Settings.",
        "HTTP 502 or 504 from the proxy means the proxy could not reach the website.",
        "The configured proxy is never bypassed; correct or disable it to connect directly.",
      ],
    },
    {
      kind: "tls_handshake_failure",
      title: "TLS handshake with 10.1.180.11:443 failed",
      eyebrow: "TLS handshake failed",
      icon: "lucide-shield-alert",
      tone: "warning",
      tips: [
        "Confirm this port serves HTTPS; plain HTTP or another service cannot complete a TLS handshake.",
        "Check the TLS versions the server supports.",
        "Run deep diagnostics to see whether TCP succeeds and where TLS stops.",
      ],
    },
    {
      kind: "inspection_unavailable",
      title: "HTTPS certificate check unavailable",
      eyebrow: "Certificate check unavailable",
      icon: "lucide-shield-alert",
      tone: "warning",
      tips: [
        "Restart the app and retry.",
        "Check that the Windows trusted root certificate store is available.",
        "TLS verification was not bypassed.",
      ],
    },
    {
      kind: "connection_failed",
      title: "Can't connect to 10.1.180.11:443",
      eyebrow: "Connection failed",
      icon: "lucide-wifi-off",
      tone: "error",
      tips: [
        "Check that the host is online and the saved port is correct.",
        "Check your VPN, firewall, and network routes to this host.",
        "Run deep diagnostics to see which network stage fails.",
      ],
    },
    {
      kind: "connection_refused",
      title: "10.1.180.11:443 refused the connection",
      eyebrow: "Service refused the connection",
      icon: "lucide-server-crash",
      tone: "error",
      tips: ["Confirm the web service is running on the saved port."],
    },
    {
      kind: "dns_failure",
      title: "Can't find nas.invalid",
      eyebrow: "Name resolution failed",
      icon: "lucide-route-off",
      tone: "error",
      tips: ["Check that the saved hostname is spelled correctly."],
    },
  ] as const)(
    "$kind leads with $eyebrow, its own icon and tips, and no certificate advice",
    ({ kind, title, eyebrow, icon, tone, tips }) => {
      render(
        <ErrorPage
          mgr={manager({ navigationFailure: failureOf(kind, title) })}
        />,
      );
      const eyebrowEl = screen.getByText(eyebrow);
      expect(eyebrowEl).toBeVisible();
      expect(eyebrowEl).toHaveClass(
        tone === "error" ? "text-error" : "text-warning",
      );
      expect(
        screen.getByRole("heading", { level: 2, name: title }),
      ).toBeVisible();
      const iconBox = screen.getByTestId("web-navigation-error-icon");
      expect(iconBox.querySelector("svg")).toHaveClass(icon);
      expect(iconBox).toHaveAttribute("data-tone", tone);
      const checks = screen.getByRole("heading", {
        name: "What to check",
      }).parentElement!;
      for (const tip of tips)
        expect(within(checks).getByText(tip)).toBeVisible();
      for (const tip of CERTIFICATE_TIPS)
        expect(screen.queryByText(tip)).toBeNull();
      expect(screen.queryByText("Secure connection failed")).toBeNull();
    },
  );

  it("keeps certificate advice for real certificate failures", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: failureOf(
            "tls_failure",
            "Unable to read the HTTPS certificate",
          ),
        })}
      />,
    );
    expect(screen.getByText("Secure connection failed")).toBeVisible();
    for (const tip of CERTIFICATE_TIPS)
      expect(screen.getByText(tip)).toBeVisible();
    expect(
      screen.getByTestId("web-navigation-error-icon").querySelector("svg"),
    ).toHaveClass("lucide-shield-alert");
  });
});

describe("native inspection wire fixtures end to end", () => {
  const fixtures = JSON.parse(
    readFileSync("tests/fixtures/certificate-inspection-failures.json", "utf8"),
  ) as {
    name: string;
    wire: { route: "direct" | "proxy"; target: string; elapsed_ms: number };
  }[];

  function pageFor(name: string) {
    const { wire } = fixtures.find((entry) => entry.name === name)!;
    const host = wire.route === "proxy" ? "private.invalid" : "10.1.180.11";
    return describeCertificateInspectionFailure({
      error: wire,
      hookStage: "inspection",
      host: name === "direct_dns_failure" ? "nas.invalid" : host,
      port: 443,
      route: wire.route,
      proxyTls: false,
      url: `https://${host}/`,
      startedAt: STARTED_AT,
      failedAfterMs: wire.elapsed_ms + 12,
    });
  }

  it.each([
    ["direct_connect_timeout", "Host unreachable"],
    ["direct_host_unreachable", "Host unreachable"],
    ["direct_connection_refused", "Service refused the connection"],
    ["direct_dns_failure", "Name resolution failed"],
    ["proxy_unreachable", "Proxy route failed"],
    ["proxy_auth_rejected", "Proxy route failed"],
    ["proxy_tunnel_rejected", "Proxy route failed"],
    ["deadline_exceeded_proxy_tunnel", "Proxy route failed"],
    ["tls_handshake_timeout", "TLS handshake failed"],
    ["tls_handshake_not_tls", "TLS handshake failed"],
    ["inspection_unavailable", "Certificate check unavailable"],
    ["invalid_target", "The address could not be used"],
  ])(
    "%s renders %s with a measured timeline and no certificate advice",
    (name, eyebrow) => {
      const failure = pageFor(name);
      render(<ErrorPage mgr={manager({ navigationFailure: failure })} />);
      expect(screen.getByText(eyebrow)).toBeVisible();
      expect(
        screen.getByRole("heading", { level: 2, name: failure.title }),
      ).toBeVisible();
      expect(screen.queryByText("Secure connection failed")).toBeNull();
      for (const tip of CERTIFICATE_TIPS)
        expect(screen.queryByText(tip)).toBeNull();
      const section = screen.getByTestId("web-navigation-timeline");
      expect(section.querySelector("time")).toHaveAttribute(
        "dateTime",
        new Date(STARTED_AT).toISOString(),
      );
      const statuses = within(section)
        .queryAllByRole("listitem")
        .map((row) => row.getAttribute("data-status"));
      if (statuses.length > 0) {
        expect(statuses.filter((status) => status === "fail")).toHaveLength(1);
        // Nothing after the failing stage is presented as having run.
        expect(statuses.slice(statuses.indexOf("fail") + 1)).not.toContain(
          "pass",
        );
      }
    },
  );

  it("renders the reported incident with the failed TCP connect and an untouched trust check", () => {
    render(
      <ErrorPage
        mgr={manager({ navigationFailure: pageFor("direct_connect_timeout") })}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Can't reach 10.1.180.11:443",
      }),
    ).toBeVisible();
    const section = screen.getByTestId("web-navigation-timeline");
    expect(within(section).getByText(/failed after 10\.0 s$/)).toBeVisible();
    const rows = within(section).getAllByRole("listitem");
    const rowLabelled = (text: string) =>
      rows.find((row) => row.textContent?.startsWith(text))!;
    expect(rows[0]).toHaveAttribute("data-status", "pass");
    expect(rows[0]).toHaveTextContent("1 ms");
    expect(rows[1]).toHaveAttribute("data-status", "fail");
    expect(rows[1]).toHaveTextContent("10.0 s");
    expect(rowLabelled("Certificate trust check")).toHaveAttribute(
      "data-status",
      "not_started",
    );
  });

  it("keeps certificate advice for an unreadable certificate", () => {
    render(
      <ErrorPage
        mgr={manager({ navigationFailure: pageFor("certificate_unreadable") })}
      />,
    );
    expect(screen.getByText("Secure connection failed")).toBeVisible();
    for (const tip of CERTIFICATE_TIPS)
      expect(screen.getByText(tip)).toBeVisible();
  });
});

describe("measured navigation timeline", () => {
  it("lists each stage with its measured status and duration before the advice", () => {
    const { container } = render(<ErrorPage mgr={manager()} />);
    const section = screen.getByTestId("web-navigation-timeline");
    expect(
      within(section).getByRole("heading", {
        level: 3,
        name: "Connection timeline",
      }),
    ).toBeVisible();
    expect(within(section).getByText("Direct connection")).toBeVisible();

    const time = section.querySelector("time")!;
    expect(time).toHaveAttribute(
      "dateTime",
      new Date(STARTED_AT).toISOString(),
    );
    expect(time).toHaveTextContent(
      new Date(STARTED_AT).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    expect(time.parentElement).toHaveTextContent(
      `Attempt started ${time.textContent} · failed after 10.0 s`,
    );

    const list = within(section).getByRole("list", {
      name: "Connection stages",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual([
      "pass",
      "fail",
      "not_started",
      "not_started",
      "not_started",
      "not_started",
    ]);
    expect(rows[0]).toHaveTextContent("Resolve address: passed1 ms");
    expect(rows[1]).toHaveTextContent("TCP connect: failed10.0 s");
    expect(
      within(rows[1]).getByText(
        "No response from 10.1.180.11:443 after 10.0 s",
      ),
    ).toBeVisible();
    expect(within(rows[4]).getByText("Certificate trust check")).toBeVisible();
    expect(rows[4]).toHaveTextContent("not started");
    expect(within(rows[5]).getByText("Not started")).toBeVisible();

    const advice = screen.getByRole("heading", { name: "What to check" });
    expect(
      section.compareDocumentPosition(advice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll("time")).toHaveLength(1);
  });

  it("formats measured durations as ms, seconds, or minutes", () => {
    const { rerender } = render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...hostUnreachable,
            timeline: directTimeline({ failedAfterMs: 850 }),
          },
        })}
      />,
    );
    expect(screen.getByText(/failed after 850 ms$/)).toBeVisible();
    rerender(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...hostUnreachable,
            timeline: directTimeline({ failedAfterMs: 2_087 }),
          },
        })}
      />,
    );
    expect(screen.getByText(/failed after 2\.1 s$/)).toBeVisible();
    rerender(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...hostUnreachable,
            timeline: directTimeline({ failedAfterMs: 75_000 }),
          },
        })}
      />,
    );
    expect(screen.getByText(/failed after 1 min 15 s$/)).toBeVisible();
  });

  it("labels the proxy route and never renders an invalid start time", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: {
            ...failureOf(
              "proxy_route_failure",
              "The proxy rejected its credentials (HTTP 407)",
            ),
            timeline: {
              startedAt: Number.NaN,
              failedAfterMs: 12,
              route: "proxy",
              steps: [
                {
                  id: "proxy_connect",
                  label: "Connect to proxy",
                  status: "pass",
                  durationMs: 8,
                  detail: null,
                },
                {
                  id: "proxy_tunnel",
                  label: "Proxy tunnel",
                  status: "fail",
                  durationMs: 4,
                  detail: "The proxy rejected its credentials (HTTP 407)",
                },
              ],
            },
          },
        })}
      />,
    );
    const section = screen.getByTestId("web-navigation-timeline");
    expect(
      within(section).getByText("Through the configured proxy"),
    ).toBeVisible();
    expect(section.querySelector("time")).toBeNull();
    expect(
      within(section).getByText("Attempt failed after 12 ms"),
    ).toBeVisible();
  });

  it("omits the timeline block when the failure carries no timeline", () => {
    render(
      <ErrorPage
        mgr={manager({
          navigationFailure: failureOf("timeout", "Connection timed out"),
        })}
      />,
    );
    expect(screen.queryByTestId("web-navigation-timeline")).toBeNull();
    expect(screen.queryByText(/Attempt started/)).toBeNull();
  });
});

describe("deep diagnostics labels", () => {
  it("counts the running probe and states its own TCP connect timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 20_000);
    render(
      <ErrorPage
        mgr={manager({
          isRunningDiagnostics: true,
          diagnosticsStartedAt: Date.now(),
          diagnosticConnectTimeoutSecs: 15,
        })}
      />,
    );
    const running = screen.getByTestId("web-diagnostics-running");
    expect(running).toHaveTextContent(
      "Testing each connection stage… 0 s (TCP connect waits up to 15 s)",
    );
    act(() => vi.advanceTimersByTime(4_000));
    expect(running).toHaveTextContent(
      "Testing each connection stage… 4 s (TCP connect waits up to 15 s)",
    );
    expect(screen.getByRole("button", { name: "Diagnosing…" })).toBeDisabled();
    expect(
      screen.getByText(
        "Runs separately from the page load, with its own start time and a 15 s TCP connect timeout.",
      ),
    ).toBeVisible();
  });

  it("labels a slower report as a separate probe, never as this navigation's timing", () => {
    render(
      <ErrorPage
        mgr={manager({
          diagnosticConnectTimeoutSecs: 15,
          diagnosticReport: {
            host: "10.1.180.11",
            port: 443,
            protocol: "https",
            resolvedIp: "10.1.180.11",
            summary: "Diagnostics stopped at: TCP Connect",
            rootCauseHint: null,
            totalDurationMs: 15_013,
            steps: [
              {
                name: "TCP Connect",
                status: "fail",
                message: "Connection timed out",
                durationMs: 15_010,
                detail: null,
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("Separate probe · took 15013 ms")).toBeVisible();
    expect(screen.queryByText("15013 ms")).toBeNull();
    expect(screen.getByText(/15 s TCP connect timeout/)).toBeVisible();
    // The navigation's own measured attempt stays distinct from the probe.
    expect(
      within(screen.getByTestId("web-navigation-timeline")).getByText(
        /failed after 10\.0 s$/,
      ),
    ).toBeVisible();
  });
});

describe("live certificate trust-check caption", () => {
  const T0 = STARTED_AT + 60_000;

  function loading(trustCheck: WebTrustCheck | null, extra = {}) {
    return manager({
      loadError: "",
      navigationFailure: null,
      isLoading: true,
      showLoadingIndicator: true,
      trustCheck,
      ...extra,
    });
  }

  const direct: WebTrustCheck = {
    startedAt: T0,
    host: "10.1.180.11",
    port: 443,
    route: "direct",
  };

  it("stays hidden for the first second, then counts whole seconds in a polite live region", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    render(<ContentArea mgr={loading(direct)} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("pointer-events-none");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();
    // The existing progress line is unchanged by the caption.
    expect(screen.getByTestId("web-navigation-progress")).toBeVisible();

    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();

    act(() => vi.advanceTimersByTime(500));
    const caption = screen.getByTestId("web-trust-check-status");
    expect(region).toContainElement(caption);
    expect(caption).toHaveTextContent(
      "Checking the HTTPS certificate for 10.1.180.11:443 · 1 s",
    );

    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByTestId("web-trust-check-status")).toHaveTextContent(
      "Checking the HTTPS certificate for 10.1.180.11:443 · 4 s",
    );
    expect(screen.queryByText(/elapsed/)).toBeNull();

    act(() => vi.advanceTimersByTime(8_000));
    const late = screen.getByTestId("web-trust-check-status");
    expect(late).toHaveTextContent("· 12 s");
    // Assistive technology hears coarse steps instead of every tick.
    expect(within(late).getByText(", 10 s elapsed")).toHaveClass("sr-only");
    expect(within(late).getByText("12 s")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("shows time already spent by a check that started while the tab was hidden", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 7_000);
    render(<ContentArea mgr={loading(direct)} />);
    expect(screen.getByTestId("web-trust-check-status")).toHaveTextContent(
      "· 7 s",
    );
  });

  it("names the proxy route and brackets IPv6 authorities", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2_000);
    render(
      <ContentArea
        mgr={loading({
          startedAt: T0,
          host: "fd00::1",
          port: 8443,
          route: "proxy",
        })}
      />,
    );
    expect(screen.getByTestId("web-trust-check-status")).toHaveTextContent(
      "Checking the HTTPS certificate for [fd00::1]:8443 through the configured proxy · 2 s",
    );
  });

  it("hides under a trust prompt, an error page, or when loading ends, and restarts for a new attempt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3_000);
    const mgr = loading(direct);
    const { rerender } = render(<ContentArea mgr={mgr} />);
    expect(screen.getByTestId("web-trust-check-status")).toBeVisible();

    rerender(
      <ContentArea
        mgr={{
          ...mgr,
          trustPrompt: {
            status: "first-use",
            identity: { fingerprint: "fixture" },
          } as WebBrowserMgr["trustPrompt"],
        }}
      />,
    );
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();

    rerender(
      <ContentArea
        mgr={{
          ...mgr,
          loadError: hostUnreachable.detail,
          navigationFailure: hostUnreachable,
        }}
      />,
    );
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();
    expect(screen.getByTestId("web-navigation-error-screen")).toBeVisible();

    rerender(<ContentArea mgr={{ ...mgr, isLoading: false }} />);
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();

    rerender(<ContentArea mgr={{ ...mgr, trustCheck: null }} />);
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();

    rerender(<ContentArea mgr={mgr} />);
    expect(screen.getByTestId("web-trust-check-status")).toHaveTextContent(
      "· 3 s",
    );
    rerender(
      <ContentArea
        mgr={{ ...mgr, trustCheck: { ...direct, startedAt: Date.now() } }}
      />,
    );
    expect(screen.queryByTestId("web-trust-check-status")).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId("web-trust-check-status")).toHaveTextContent(
      "· 1 s",
    );
  });

  it("clears its interval on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = render(<ContentArea mgr={loading(direct)} />);
    const ids = setIntervalSpy.mock.results.map((result) => result.value);
    expect(ids).toHaveLength(1);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(ids[0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
