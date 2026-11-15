import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxyStatsView } from "../../src/components/network/ProxyStatsView";
import {
  formatCount,
  formatPercent,
  summarizeNativeProxy,
} from "../../src/utils/network/proxyStatsFormat";
import type { NativeBrowserDiagnostics } from "../../src/types/network/nativeBrowserDiagnostics";

const proxy = (over = {}) => ({
  state: "listening" as const,
  acceptedConnections: 10,
  authenticationChallenges: 1,
  authenticatedRequests: 8,
  destinationDenials: 1,
  upstreamFailures: 2,
  requestRejections: 0,
  capacityRefusals: 0,
  ...over,
});
const data = (): NativeBrowserDiagnostics => ({
  available: true,
  sessions: [
    {
      identity: { connectionId: "c1", sessionId: "s1", attemptId: "a1" },
      phase: "attached",
      proxy: proxy(),
    },
    {
      identity: { connectionId: "c2", sessionId: "s2", attemptId: "a2" },
      phase: null,
      proxy: null,
    },
  ],
});
const mgr = (over: Record<string, unknown> = {}) =>
  ({
    nativeDiagnostics: data(),
    nativeDiagnosticsError: "",
    nativeDiagnosticsLoading: false,
    sessions: [],
    totalRequests: 0,
    totalErrors: 0,
    errorRate: "0.0",
    ...over,
  }) as never;

afterEach(cleanup);

describe("proxy stats formatting", () => {
  it("formats counts compactly and exactly when small", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(9999)).toBe("9,999");
    expect(formatCount(12_500)).toBe("12.5K");
    expect(formatCount(3_000_000)).toBe("3M");
    expect(formatCount(-1)).toBe("0");
  });
  it("never invents a percentage without a denominator", () => {
    expect(formatPercent(1, 0)).toBeNull();
    expect(formatPercent(1, 8)).toBe("13%");
    expect(formatPercent(1, 100)).toBe("1.0%");
  });
  it("aggregates only sessions with a relay snapshot", () => {
    const t = summarizeNativeProxy(data().sessions);
    expect(t).toMatchObject({
      sessions: 2,
      observed: 1,
      listening: 1,
      acceptedConnections: 10,
      problems: 3,
    });
  });
});

describe("ProxyStatsView", () => {
  it("leads with CEF summary and session list, no legacy when none exist", () => {
    render(<ProxyStatsView mgr={mgr()} />);
    expect(screen.getByTestId("proxy-stats-summary")).toHaveTextContent("1/2");
    expect(screen.getByTestId("proxy-stats-problems")).toHaveTextContent("3");
    expect(screen.getByText(/Totals cover 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByTestId("proxy-stats-legacy")).toBeNull();
  });
  it("expands a session to grouped counters", () => {
    render(<ProxyStatsView mgr={mgr()} />);
    expect(screen.queryByText("Upstream failures")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /s1/ }));
    expect(screen.getByText("Upstream failures")).toBeInTheDocument();
    expect(screen.getByText("Traffic")).toBeInTheDocument();
  });
  it("places legacy after CEF content, collapsed", () => {
    render(
      <ProxyStatsView
        mgr={mgr({
          sessions: [
            {
              session_id: "L1",
              target_url: "https://legacy.invalid/",
              request_count: 4,
              error_count: 1,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          totalRequests: 4,
          totalErrors: 1,
          errorRate: "25.0",
        })}
      />,
    );
    const legacy = screen.getByTestId("proxy-stats-legacy");
    expect(legacy).not.toHaveAttribute("open");
    const cef = screen.getByTestId("proxy-stats-summary");
    expect(
      cef.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("shows empty, unsupported and error states", () => {
    const { rerender } = render(
      <ProxyStatsView
        mgr={mgr({ nativeDiagnostics: { available: true, sessions: [] } })}
      />,
    );
    expect(screen.getByText(/No observable native browser/)).toBeVisible();
    rerender(
      <ProxyStatsView
        mgr={mgr({ nativeDiagnostics: { available: false, sessions: [] } })}
      />,
    );
    expect(screen.getByText(/unavailable in this build/)).toBeVisible();
    rerender(<ProxyStatsView mgr={mgr({ nativeDiagnosticsError: "boom" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
  it("offers a link to the proxy log", () => {
    const open = vi.fn();
    render(<ProxyStatsView mgr={mgr()} onOpenProxyLog={open} />);
    fireEvent.click(screen.getByRole("button", { name: /Open proxy log/ }));
    expect(open).toHaveBeenCalled();
  });
});
