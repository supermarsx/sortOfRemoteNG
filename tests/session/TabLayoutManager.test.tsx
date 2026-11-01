import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("No session selected")).toHaveClass("select-none");
    expect(screen.queryByText("No active sessions")).not.toBeInTheDocument();
  });

  it("renders viewers without adding a layout toolbar or session counter row", () => {
    renderManager();
    expect(screen.queryByTestId("tab-layout-toolbar")).toBeNull();
    expect(screen.queryByTestId("tab-layout-session-counter")).toBeNull();
    expect(screen.queryByRole("button", { name: "View mode" })).toBeNull();
    expect(screen.getByTestId("session-s1")).toBeInTheDocument();
    expect(screen.getByTestId("session-s2")).toBeInTheDocument();
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
      ["session.tabLayout.tile.menu", "Tile menu"],
      ["session.tabLayout.tile.detach", "Detach"],
      ["session.tabLayout.tile.close", "Close"],
      ["session.tabLayout.tile.label", "Tile"],
      ["session.tabLayout.tile.of", "of"],
      ["session.tabLayout.tile.showInThisTile", "Show in this tile…"],
      [
        "session.tabLayout.tile.showInThisTileAria",
        "Show session in this tile",
      ],
      ["session.tabLayout.tile.noOtherSessions", "No other sessions"],
      ["session.tabLayout.tile.maximize", "Maximize (switch to tabs)"],
      ["session.tabLayout.tile.detachWindow", "Detach to new window"],
      ["session.tabLayout.tile.closeSession", "Close session"],
      ["session.tabLayout.clickToFocus", "Click to focus"],
      ["session.tabLayout.noSessionSelected", "No session selected"],
      ["session.tabLayout.tile.actionsAria", "Tile actions"],
    ];
    for (const [key, fallback] of ownedFallbacks) {
      expect(tabLayoutT).toHaveBeenCalledWith(key, fallback);
    }
  });
});
