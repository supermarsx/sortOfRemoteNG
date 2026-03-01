import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabLayoutManager } from "../src/components/session/TabLayoutManager";
import type { ConnectionSession, TabLayout } from "../src/types/connection";

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

const renderManager = (onLayoutChange = vi.fn()) =>
  render(
    <TabLayoutManager
      sessions={sessions}
      activeSessionId="s1"
      layout={layout}
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
    expect(callArg.mode).toBe("mosaic");
    expect(callArg.sessions.length).toBe(2);
    await waitFor(() => {
      expect(
        screen.queryByTestId("tab-layout-custom-grid-popover"),
      ).not.toBeInTheDocument();
    });
  });
});
