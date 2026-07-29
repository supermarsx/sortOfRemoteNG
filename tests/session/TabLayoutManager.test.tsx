import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabLayoutManager } from "../../src/components/session/TabLayoutManager";
import type {
  ConnectionSession,
  TabLayout,
} from "../../src/types/connection/connection";

const { tabLayoutT } = vi.hoisted(() => ({
  tabLayoutT: vi.fn(
    (
      key: string,
      fallback: string = key,
      variables?: Record<string, unknown>,
    ) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
        String(variables?.[token] ?? `{{${token}}}`),
      ),
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tabLayoutT }),
}));

vi.mock("react-resizable", () => ({
  Resizable: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const sessions: ConnectionSession[] = [
  {
    id: "s1",
    connectionId: "c1",
    name: "Session One",
    status: "connected",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "ssh",
    hostname: "host-1",
  },
  {
    id: "s2",
    connectionId: "c2",
    name: "Session Two",
    status: "connected",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "ssh",
    hostname: "host-2",
  },
];

const layout: TabLayout = {
  mode: "tabs",
  sessions: [],
};

const renderManager = (
  onLayoutChange = vi.fn(),
  sessionList: ConnectionSession[] = sessions,
  layoutValue: TabLayout = layout,
) =>
  render(
    <TabLayoutManager
      sessions={sessionList}
      activeSessionId={sessionList[0]?.id}
      layout={layoutValue}
      onLayoutChange={onLayoutChange}
      onSessionSelect={vi.fn()}
      onSessionClose={vi.fn()}
      onSessionDetach={vi.fn()}
      renderSession={(session) => (
        <div data-testid={`session-${session.id}`}>{session.name}</div>
      )}
    />,
  );

describe("TabLayoutManager", () => {
  it("shows that no session is selected when the layout is empty", () => {
    renderManager(vi.fn(), []);

    expect(screen.getByText("No session selected")).toBeInTheDocument();
    expect(screen.queryByText("No active sessions")).not.toBeInTheDocument();
  });

  it("opens and closes the custom-grid popover", async () => {
    renderManager();

    fireEvent.click(screen.getByTitle("Custom grid layout"));
    expect(
      await screen.findByTestId("tab-layout-custom-grid-popover"),
    ).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByTestId("tab-layout-custom-grid-popover"),
      ).not.toBeInTheDocument();
    });
  });

  it("applies custom grid layout and closes popover", async () => {
    const onLayoutChange = vi.fn();
    renderManager(onLayoutChange);

    fireEvent.click(screen.getByTitle("Custom grid layout"));
    const popover = await screen.findByTestId("tab-layout-custom-grid-popover");

    const sliders = popover.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(2);
    fireEvent.change(sliders[0], { target: { value: "3" } });
    fireEvent.change(sliders[1], { target: { value: "1" } });

    fireEvent.click(within(popover).getByText("Apply Layout"));

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const callArg = onLayoutChange.mock.calls[0][0] as TabLayout;
    expect(callArg.mode).toBe("customGrid");
    expect(callArg.customCols).toBe(3);
    expect(callArg.customRows).toBe(1);
    expect(callArg.sessions.length).toBe(2);
    await waitFor(() => {
      expect(
        screen.queryByTestId("tab-layout-custom-grid-popover"),
      ).not.toBeInTheDocument();
    });
  });

  // ── Session counter accuracy ──────────────────────
  // Tool tabs (`tool:*`) and Windows management panels (`winmgmt:*`)
  // share the session list with real connections but they are NOT
  // sessions. The counter must reflect that, and the breakdown
  // chips surface the tool/panel counts so they're not hidden.

  const toolSession = {
    id: "tool-1",
    connectionId: "tool-settings",
    name: "Settings",
    status: "connected" as const,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "tool:settings",
    hostname: "",
  };
  const winmgmtSession = {
    id: "winmgmt-1",
    connectionId: "c1",
    name: "Session One - Services",
    status: "connected" as const,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "winmgmt:services",
    hostname: "host-1",
  };

  it("session counter excludes tool tabs and winmgmt panels", () => {
    renderManager(vi.fn(), [sessions[0], toolSession, winmgmtSession]);
    // Only one real connection → "1 session"
    expect(screen.getByTestId("session-counter-sessions")).toHaveTextContent(
      "1 session",
    );
    // Tool and panel chips surface the non-session counts
    expect(screen.getByTestId("session-counter-tools")).toHaveTextContent(
      "1 tool",
    );
    expect(screen.getByTestId("session-counter-winmgmt")).toHaveTextContent(
      "1 panel",
    );
  });

  it("session counter pluralizes per chip", () => {
    renderManager(vi.fn(), [
      sessions[0],
      sessions[1],
      toolSession,
      toolSession,
      winmgmtSession,
    ]);
    expect(screen.getByTestId("session-counter-sessions")).toHaveTextContent(
      "2 sessions",
    );
    expect(screen.getByTestId("session-counter-tools")).toHaveTextContent(
      "2 tools",
    );
    expect(screen.getByTestId("session-counter-winmgmt")).toHaveTextContent(
      "1 panel",
    );
  });

  it("session counter shows just the session chip when no tools/panels are open", () => {
    renderManager(vi.fn(), [sessions[0], sessions[1]]);
    expect(screen.getByTestId("session-counter-sessions")).toHaveTextContent(
      "2 sessions",
    );
    expect(
      screen.queryByTestId("session-counter-tools"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-counter-winmgmt"),
    ).not.toBeInTheDocument();
  });

  it("session counter still renders 0 sessions when only tools/panels are open", () => {
    // Regression: previously the toolbar would render nothing when
    // every tab was a tool. We always show the session chip so the
    // empty state is visible.
    renderManager(vi.fn(), [toolSession, winmgmtSession]);
    expect(screen.getByTestId("session-counter-sessions")).toHaveTextContent(
      "0 sessions",
    );
    expect(screen.getByTestId("session-counter-tools")).toHaveTextContent(
      "1 tool",
    );
    expect(screen.getByTestId("session-counter-winmgmt")).toHaveTextContent(
      "1 panel",
    );
  });

  it("session counter exposes a screenreader-friendly aria-label", () => {
    renderManager(vi.fn(), [sessions[0], toolSession]);
    const counter = screen.getByTestId("tab-layout-session-counter");
    expect(counter).toHaveAttribute("aria-label", "1 session, 1 tool");
  });
  it("routes every owned visible fallback through the translator", () => {
    tabLayoutT.mockClear();
    const thirdSession: ConnectionSession = {
      ...sessions[1],
      id: "s3",
      connectionId: "c3",
      name: "Session Three",
    };
    const cappedLayout: TabLayout = {
      mode: "grid2",
      sessions: [
        { sessionId: "s1", position: { x: 0, y: 0, width: 50, height: 100 } },
        { sessionId: "s2", position: { x: 50, y: 0, width: 50, height: 100 } },
      ],
    };
    const cappedView = renderManager(
      vi.fn(),
      [...sessions, thirdSession],
      cappedLayout,
    );
    cappedView.unmount();

    const soloLayout: TabLayout = {
      mode: "grid2",
      sessions: [
        { sessionId: "s1", position: { x: 0, y: 0, width: 100, height: 100 } },
      ],
    };
    const soloView = renderManager(vi.fn(), [sessions[0]], soloLayout);
    soloView.unmount();

    const miniView = renderManager(vi.fn(), sessions, {
      mode: "miniMosaic",
      sessions: [],
    });
    miniView.unmount();
    renderManager(vi.fn(), []);

    const ownedFallbacks: Array<[string, string]> = [
      ["session.tabLayout.customGrid.buttonTitle","Custom grid layout"],
      ["session.tabLayout.customGrid.title","Custom Grid Layout"],
      ["session.tabLayout.customGrid.columns","Columns"],
      ["session.tabLayout.customGrid.rows","Rows"],
      ["session.tabLayout.customGrid.tilesSuffix","tiles ·"],
      ["session.tabLayout.customGrid.filledSuffix","filled ·"],
      ["session.tabLayout.customGrid.sessionOne","session"],
      ["session.tabLayout.customGrid.applyLayout","Apply Layout"],
      ["session.tabLayout.hiddenLabel","hidden"],
      ["session.tabLayout.hiddenMenuTitle","Hidden sessions — click to promote"],
      ["session.tabLayout.tile.menu","Tile menu"],
      ["session.tabLayout.tile.detach","Detach"],
      ["session.tabLayout.tile.close","Close"],
      ["session.tabLayout.tile.label","Tile"],
      ["session.tabLayout.tile.of","of"],
      ["session.tabLayout.tile.showInThisTile","Show in this tile…"],
      ["session.tabLayout.tile.showInThisTileAria","Show session in this tile"],
      ["session.tabLayout.tile.noOtherSessions","No other sessions"],
      ["session.tabLayout.tile.maximize","Maximize (switch to tabs)"],
      ["session.tabLayout.tile.detachWindow","Detach to new window"],
      ["session.tabLayout.tile.closeSession","Close session"],
      ["session.tabLayout.modes.tabs","Tabs (single pane)"],
      ["session.tabLayout.modes.splitVertical","Split left/right"],
      ["session.tabLayout.modes.splitHorizontal","Split top/bottom"],
      ["session.tabLayout.modes.sideBySide","Side-by-side (2 cols, fill rows)"],
      ["session.tabLayout.modes.grid2","2 side by side (capped)"],
      ["session.tabLayout.modes.grid4","4 squares (capped)"],
      ["session.tabLayout.modes.grid6","6 squares (capped)"],
      ["session.tabLayout.modes.mosaic","Auto mosaic (sqrt grid)"],
      ["session.tabLayout.modes.miniMosaic","Mini mosaic (preview grid)"],
      ["session.tabLayout.clickToFocus","Click to focus"],
      ["session.tabLayout.noSessionSelected","No session selected"],
      ["session.tabLayout.tile.actionsAria","Tile actions"],
    ];
    for (const [key, fallback] of ownedFallbacks) {
      expect(tabLayoutT).toHaveBeenCalledWith(key, fallback);
    }
    expect(tabLayoutT).toHaveBeenCalledWith(
      "session.tabLayout.hiddenTooltip",
      "{{count}} session(s) not visible in the current tiling — click to promote one into a tile",
      { count: 1 },
    );
    expect(tabLayoutT).toHaveBeenCalledWith(
      "session.tabLayout.counters.sessionsOther",
      "{{count}} sessions",
      { count: 3 },
    );
  });
});
