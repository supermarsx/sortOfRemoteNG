import React, { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/monitoring/ApplicationLogsView", () => ({
  ApplicationLogsView: ({ source }: { source?: string }) => (
    <section aria-label="Browser startup journal">journal:{source}</section>
  ),
}));

import {
  BrowserSessionsView,
  type BrowserSessionsSubView,
  type BrowserSessionsViewProps,
} from "../../src/components/session/sessionManager/BrowserSessionsView";
import { BrowserSessionStatistics } from "../../src/components/session/sessionManager/BrowserSessionStatistics";
import {
  buildBrowserSessionRows,
  formatDuration,
  formatRelativeTime,
  humanizeToken,
} from "../../src/components/session/sessionManager/browserSessionList";
import type { UnifiedSessionRow } from "../../src/hooks/session/useUnifiedSessionManager";
import type { Connection } from "../../src/types/connection/connection";
import type {
  NativeBrowserDiagnostics,
  NativeBrowserSessionDiagnostics,
} from "../../src/types/network/nativeBrowserDiagnostics";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const frontendRow = (
  id: string,
  overrides: Partial<UnifiedSessionRow> = {},
): UnifiedSessionRow => ({
  uid: `https:${id}`,
  kind: "https",
  source: "frontend",
  bucket: "connection",
  kindLabel: "Browser (HTTPS)",
  groupKey: "https",
  groupLabel: "Browser (HTTPS)",
  nativeId: id,
  title: `Portal ${id}`,
  subtitle: `${id}.example.test:443`,
  status: "connected",
  connectionId: `conn-${id}`,
  protocol: "https",
  hostname: `${id}.example.test`,
  startedAt: new Date(NOW - 2 * 3600_000),
  lastActivity: new Date(NOW - 5 * 60_000),
  ...overrides,
});

const nativeSession = (
  sessionId: string,
  overrides: Partial<NativeBrowserSessionDiagnostics> = {},
): NativeBrowserSessionDiagnostics => ({
  identity: {
    connectionId: `conn-${sessionId}`,
    sessionId,
    attemptId: `attempt-${sessionId}`,
  },
  phase: "attached",
  proxy: {
    state: "listening",
    acceptedConnections: 1200,
    authenticationChallenges: 2,
    authenticatedRequests: 12,
    destinationDenials: 1,
    upstreamFailures: 3,
    requestRejections: 4,
    capacityRefusals: 5,
  },
  ...overrides,
});

const connections = [
  { id: "conn-orphan", name: "Orphan router" },
] as unknown as Connection[];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildBrowserSessionRows", () => {
  it("joins HTTP(S) tabs with native observations and keeps unmatched native sessions", () => {
    const diagnostics: NativeBrowserDiagnostics = {
      available: true,
      sessions: [
        nativeSession("a", { phase: "starting" }),
        nativeSession("orphan", {
          phase: "failed",
          failureReason: "redirect-denied",
          proxy: null,
        }),
      ],
    };
    const rows = buildBrowserSessionRows(
      [
        frontendRow("a"),
        frontendRow("b", { status: "error", errorMessage: "Boom" }),
        frontendRow("ssh", { protocol: "ssh" }),
        frontendRow("rdp-proxy", { source: "http-proxy" }),
      ],
      diagnostics,
      connections,
    );
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["a", "loading"],
      ["b", "error"],
      ["orphan", "failed"],
    ]);
    expect(rows[1].failureReason).toBe("Boom");
    expect(rows[2]).toMatchObject({
      title: "Orphan router",
      failureReason: "Redirect denied",
    });
    expect(rows[2].frontendRow).toBeUndefined();
  });

  it("falls back to the tab status when the native phase is busy", () => {
    const rows = buildBrowserSessionRows(
      [frontendRow("a", { status: "waiting" })],
      { available: true, sessions: [nativeSession("a", { phase: null })] },
      [],
    );
    expect(rows[0].status).toBe("loading");
  });
});

describe("formatting helpers", () => {
  it("formats durations, relative times, and tokens", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(7260)).toBe("2h 1m");
    expect(formatDuration(90_000)).toBe("1d 1h");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatRelativeTime(undefined)).toBe("—");
    expect(formatRelativeTime(new Date(NOW - 10_000), NOW)).toMatch(/now/i);
    expect(formatRelativeTime(new Date(NOW - 3 * 60_000), NOW)).toMatch(
      /3 minutes ago/,
    );
    expect(humanizeToken("listener-failed")).toBe("Listener failed");
  });
});

function Harness(
  props: Partial<BrowserSessionsViewProps> & {
    initial?: BrowserSessionsSubView;
  },
) {
  const [view, setView] = useState<BrowserSessionsSubView>(
    props.initial ?? "sessions",
  );
  return (
    <BrowserSessionsView
      view={view}
      onViewChange={setView}
      frontendRows={[]}
      connections={connections}
      diagnosticsError=""
      diagnosticsLoading={false}
      isActive
      isRefreshing={false}
      onRefresh={vi.fn()}
      onCloseSession={vi.fn()}
      now={NOW}
      {...props}
    />
  );
}

describe("BrowserSessionsView list", () => {
  const diagnostics: NativeBrowserDiagnostics = {
    available: true,
    sessions: [nativeSession("a"), nativeSession("orphan", { proxy: null })],
  };

  it("renders one row per browser session with status, relay, and actions", () => {
    const onCloseSession = vi.fn();
    render(
      <Harness
        frontendRows={[frontendRow("a"), frontendRow("b")]}
        diagnostics={diagnostics}
        onCloseSession={onCloseSession}
      />,
    );
    const table = screen.getByTestId("browser-session-table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    const rowA = within(screen.getByTestId("browser-session-row-a"));
    expect(rowA.getByRole("rowheader")).toHaveTextContent("Portal a");
    expect(rowA.getByText("Ready")).toBeInTheDocument();
    expect(rowA.getByText("Listening")).toBeInTheDocument();
    expect(rowA.getByText("2 hours ago")).toBeInTheDocument();
    expect(rowA.getByText("5 minutes ago")).toBeInTheDocument();
    const rowB = within(screen.getByTestId("browser-session-row-b"));
    expect(rowB.getByText("—")).toBeInTheDocument();
    const orphan = within(screen.getByTestId("browser-session-row-orphan"));
    expect(orphan.getByText("Orphan router")).toBeInTheDocument();
    expect(orphan.getByText("Unavailable")).toBeInTheDocument();
    expect(
      orphan.queryByRole("button", { name: /Close browser session/ }),
    ).toBeNull();
    fireEvent.click(
      rowA.getByRole("button", { name: "Close browser session Portal a" }),
    );
    expect(onCloseSession).toHaveBeenCalledWith("a");
    expect(screen.getByText("3 browser sessions")).toBeInTheDocument();
  });

  it("sorts by name and filters by search with a distinct empty state", () => {
    render(
      <Harness
        frontendRows={[
          frontendRow("b", { title: "Bravo" }),
          frontendRow("a", { title: "Alpha" }),
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sort by name / target" }),
    );
    const headers = () =>
      within(screen.getByTestId("browser-session-table"))
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent);
    expect(headers()[0]).toContain("Alpha");
    fireEvent.click(
      screen.getByRole("button", { name: "Sort by name / target" }),
    );
    expect(headers()[0]).toContain("Bravo");
    expect(screen.getAllByRole("columnheader")[0]).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    fireEvent.change(screen.getByTestId("browser-session-search"), {
      target: { value: "zzz" },
    });
    expect(
      screen.getByText("No matching browser sessions"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 2 browser sessions")).toBeInTheDocument();
  });

  it("shows an empty state when there are no browser sessions", () => {
    render(<Harness />);
    expect(screen.getByText("No browser sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Open an HTTP or HTTPS connection to see it here."),
    ).toBeInTheDocument();
  });

  it("opens the statistics page focused on a row and switches to the journal", () => {
    const onRefresh = vi.fn();
    render(
      <Harness
        frontendRows={[frontendRow("a")]}
        diagnostics={diagnostics}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "View statistics for Portal a" }),
    );
    expect(screen.getByRole("button", { name: "Statistics" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const card = screen.getByTestId("browser-session-stats-a");
    expect(card).toHaveClass("ring-2");
    expect(document.activeElement).toBe(card);
    fireEvent.click(screen.getByRole("button", { name: "Startup journal" }));
    expect(
      screen.getByRole("region", { name: "Browser startup journal" }),
    ).toHaveTextContent("journal:browser");
    expect(
      screen.queryByRole("button", { name: "Refresh sessions" }),
    ).toBeNull();
  });

  it("surfaces a native diagnostics error on the list", () => {
    render(
      <Harness diagnosticsError="Native browser diagnostics could not be read. Refresh to retry." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh to retry");
  });
});

describe("BrowserSessionStatistics", () => {
  const renderStats = (
    props: Partial<React.ComponentProps<typeof BrowserSessionStatistics>> & {
      diagnostics?: NativeBrowserDiagnostics;
      frontend?: UnifiedSessionRow[];
    } = {},
  ) => {
    const { diagnostics, frontend = [], ...rest } = props;
    return render(
      <BrowserSessionStatistics
        rows={buildBrowserSessionRows(frontend, diagnostics, connections)}
        diagnostics={diagnostics}
        diagnosticsError=""
        diagnosticsLoading={false}
        now={NOW}
        {...rest}
      />,
    );
  };

  it("groups overview, relay totals, and per-session details with headings", () => {
    renderStats({
      frontend: [frontendRow("a"), frontendRow("b")],
      diagnostics: {
        available: true,
        sessions: [
          nativeSession("a"),
          nativeSession("b", {
            phase: "failed",
            failureReason: "redirect-denied",
            proxy: { ...nativeSession("b").proxy!, state: "stopped" },
          }),
        ],
      },
    });
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Browser session statistics",
      }),
    ).toBeInTheDocument();
    for (const name of ["Overview", "Private relay totals", "Sessions"])
      expect(
        screen.getByRole("heading", { level: 3, name }),
      ).toBeInTheDocument();
    const totalsGrid = screen.getByLabelText("Private relay totals", {
      selector: "dl",
    });
    expect(
      within(totalsGrid).getByText("Accepted connections").nextSibling,
    ).toHaveTextContent((2400).toLocaleString());
    expect(screen.getByText("Relays listening").nextSibling).toHaveTextContent(
      "1 / 2",
    );
    expect(screen.getByText("Need attention").nextSibling).toHaveTextContent(
      "1",
    );
    const cardB = within(screen.getByTestId("browser-session-stats-b"));
    expect(cardB.getByRole("heading", { level: 4 })).toHaveTextContent(
      "Portal b",
    );
    expect(cardB.getByText("Failure reason").nextSibling).toHaveTextContent(
      "Redirect denied",
    );
    expect(cardB.getByText("Attempt").nextSibling).toHaveTextContent(
      "attempt-b",
    );
    expect(cardB.getByText("Stopped")).toBeInTheDocument();
    expect(cardB.getByText("Open for").nextSibling).toHaveTextContent("2h 0m");
    expect(
      within(cardB.getByLabelText("Relay counters for Portal b")).getByText(
        "Capacity refusals",
      ).nextSibling,
    ).toHaveTextContent("5");
  });

  it("never infers zero activity for busy snapshots and tab-only sessions", () => {
    renderStats({
      frontend: [frontendRow("a"), frontendRow("tab-only")],
      diagnostics: {
        available: true,
        sessions: [nativeSession("a", { phase: null, proxy: null })],
      },
    });
    const cardA = within(screen.getByTestId("browser-session-stats-a"));
    expect(cardA.getAllByText("Snapshot unavailable")).toHaveLength(2);
    expect(cardA.getByText(/Relay snapshot unavailable/)).toBeInTheDocument();
    const tabOnly = within(
      screen.getByTestId("browser-session-stats-tab-only"),
    );
    expect(tabOnly.getByText("Not observed")).toBeInTheDocument();
    expect(tabOnly.getByText("Attempt").nextSibling).toHaveTextContent("—");
    expect(
      screen.getByText(
        "No relay snapshots reported; no zero activity is inferred.",
      ),
    ).toBeInTheDocument();
  });

  it("distinguishes empty, unsupported, loading, and failed reads", () => {
    const { rerender } = renderStats({
      diagnostics: { available: true, sessions: [] },
    });
    expect(
      screen.getByText("No observable native browser sessions in this window."),
    ).toBeInTheDocument();
    rerender(
      <BrowserSessionStatistics
        rows={[]}
        diagnostics={{ available: false, sessions: [] }}
        diagnosticsError=""
        diagnosticsLoading={false}
      />,
    );
    expect(
      screen.getByText(
        "Native browser diagnostics are unavailable in this build.",
      ),
    ).toBeInTheDocument();
    rerender(
      <BrowserSessionStatistics
        rows={[]}
        diagnosticsError="Native browser diagnostics could not be read. Refresh to retry."
        diagnosticsLoading
      />,
    );
    expect(
      screen.getByText("Reading native browser diagnostics…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh to retry");
  });
});
