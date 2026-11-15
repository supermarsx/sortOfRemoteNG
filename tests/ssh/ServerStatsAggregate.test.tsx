import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AggregateView } from "../../src/components/ssh/serverStats/AggregateView";
import { Sparkline } from "../../src/components/ssh/serverStats/Sparkline";
import { serverStatsHistory } from "../../src/utils/ssh/serverStatsHistory";
import type { ServerStatsSnapshot } from "../../src/types/monitoring/serverStats";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, fb?: unknown, opts?: Record<string, unknown>) => {
      let s = typeof fb === "string" ? fb : k;
      if (opts)
        for (const [key, v] of Object.entries(opts))
          s = s.replace(`{{${key}}}`, String(v));
      return s;
    },
  }),
}));

function snap(cpu: number, host: string): ServerStatsSnapshot {
  return {
    collectedAt: "",
    sessionId: "",
    connectionName: "",
    cpu: {
      usagePercent: cpu,
      coreCount: 2,
      loadAvg1: 0.5,
      loadAvg5: 0,
      loadAvg15: 0,
      model: "",
    },
    memory: {
      totalBytes: 1,
      usedBytes: 1,
      freeBytes: 0,
      availableBytes: 0,
      usagePercent: 40,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsagePercent: 0,
    },
    disk: { partitions: [], io: null },
    system: {
      uptime: "",
      uptimeSeconds: 3600,
      kernelVersion: "",
      osName: "",
      osVersion: "",
      hostname: host,
      architecture: "",
      serverTime: "",
      loggedInUsers: 0,
    },
    firewall: { backend: "none", active: false, rules: [], rawOutput: "" },
    ports: {
      listeningPorts: [],
      establishedConnections: 3,
      timeWaitConnections: 0,
    },
    collectionDurationMs: 1,
    warnings: [],
  };
}

const sessions = [
  {
    id: "s1",
    connectionId: "c1",
    name: "Alpha",
    hostname: "a.local",
    status: "connected",
  },
  {
    id: "s2",
    connectionId: "c2",
    name: "Bravo",
    hostname: "b.local",
    status: "connected",
  },
];
const connections = [
  { id: "f", name: "Prod", isGroup: true },
  { id: "c1", parentId: "f" },
  { id: "c2" },
];

const names = () =>
  screen
    .getAllByTestId("aggregate-row")
    .map((r) => within(r).getAllByRole("button")[0].textContent);

describe("Sparkline", () => {
  it("exposes a text equivalent for data and for no data", () => {
    const { rerender } = render(
      <Sparkline values={[1, 2, 3]} label="CPU" format={(v) => `${v}%`} />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "CPU trend, 3 samples, min 1%, max 3%",
    );
    rerender(<Sparkline values={[]} label="CPU" format={String} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "CPU: no data",
    );
  });
});

describe("AggregateView", () => {
  beforeEach(() => {
    serverStatsHistory.clear();
    serverStatsHistory.record("s1", snap(80, "alpha-host"), Date.now());
    serverStatsHistory.record("s1", snap(85, "alpha-host"), Date.now());
    serverStatsHistory.record("s2", snap(10, "bravo-host"), Date.now());
    act(() => serverStatsHistory.flush());
  });

  it("renders a row per server with sparklines and a dash for missing stats", () => {
    render(
      <AggregateView
        sessions={sessions}
        connections={connections}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("aggregate-row")).toHaveLength(2);
    expect(screen.getAllByTestId("sparkline").length).toBeGreaterThan(2);
    // no disk partitions supplied: placeholder, never an invented value
    expect(
      within(screen.getAllByTestId("aggregate-row")[0]).getAllByText("—")
        .length,
    ).toBeGreaterThan(0);
  });

  it("sorts via header buttons and sets aria-sort", () => {
    render(
      <AggregateView
        sessions={sessions}
        connections={connections}
        onOpenSession={vi.fn()}
      />,
    );
    const cpu = () => screen.getByRole("columnheader", { name: /CPU/ });
    expect(cpu()).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(cpu()).getByRole("button"));
    expect(cpu()).toHaveAttribute("aria-sort", "descending");
    expect(names()[0]).toContain("Alpha");
    fireEvent.click(within(cpu()).getByRole("button"));
    expect(cpu()).toHaveAttribute("aria-sort", "ascending");
    expect(names()[0]).toContain("Bravo");
  });

  it("filters and groups", () => {
    render(
      <AggregateView
        sessions={sessions}
        connections={connections}
        onOpenSession={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "bravo" },
    });
    expect(screen.getAllByTestId("aggregate-row")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No servers match the filter")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "folder" },
    });
    expect(screen.getByText("Prod (1)")).toBeInTheDocument();
    expect(screen.getByText("Ungrouped (1)")).toBeInTheDocument();
  });

  it("opens the detailed view on row click", () => {
    const open = vi.fn();
    render(
      <AggregateView
        sessions={sessions}
        connections={connections}
        onOpenSession={open}
      />,
    );
    fireEvent.click(screen.getAllByTestId("aggregate-row")[1]);
    expect(open).toHaveBeenCalledWith("s2");
  });

  it("shows the empty state without sessions", () => {
    render(
      <AggregateView sessions={[]} connections={[]} onOpenSession={vi.fn()} />,
    );
    expect(screen.getByText("No SSH sessions")).toBeInTheDocument();
  });
});
