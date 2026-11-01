import React, { useEffect, useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabLayoutControls } from "../../src/components/session/TabLayoutControls";
import {
  TabLayoutManager,
  SESSION_TAB_DND_TYPE,
} from "../../src/components/session/TabLayoutManager";
import { SessionTabs } from "../../src/components/session/SessionTabs";
import { buildTabLayout } from "../../src/utils/session/tabLayoutBuilder";
import type {
  ConnectionSession,
  TabLayout,
} from "../../src/types/connection/connection";

let sessionList: ConnectionSession[] = [];
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: sessionList, connections: [], tabGroups: [] },
    dispatch: vi.fn(),
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { defaultTabColor: "" } }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: async () => [] }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string = _key,
      values?: Record<string, unknown>,
    ) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        String(values?.[key] ?? key),
      ),
  }),
}));
afterEach(() => vi.restoreAllMocks());

const sessions = Array.from({ length: 5 }, (_, index): ConnectionSession => ({
  id: `s${index + 1}`,
  connectionId: `c${index + 1}`,
  name: `Session ${index + 1}`,
  protocol: "rdp",
  hostname: `host-${index + 1}`,
  status: "connected",
  startTime: new Date("2026-01-01"),
}));
const tabs: TabLayout = { mode: "tabs", sessions: [] };

function controls(layout = tabs, rows = sessions) {
  const onLayoutChange = vi.fn(),
    onSessionSelect = vi.fn();
  const props = {
    sessions: rows,
    activeSessionId: "s2",
    layout,
    onLayoutChange,
    onSessionSelect,
  };
  return {
    ...render(<TabLayoutControls {...props} />),
    props,
    onLayoutChange,
    onSessionSelect,
  };
}
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "View mode" }));

describe("compact tab-strip layout controls", () => {
  it.each([false, true])(
    "keeps one fixed right-side action beside the tabs with empty=%s",
    (empty) => {
      sessionList = empty ? [] : sessions;
      render(
        <SessionTabs
          activeSessionId="s1"
          onSessionSelect={vi.fn()}
          onSessionClose={vi.fn()}
          onSessionDetach={vi.fn()}
          trailingActions={
            <TabLayoutControls
              sessions={sessionList}
              layout={tabs}
              onLayoutChange={vi.fn()}
              onSessionSelect={vi.fn()}
            />
          }
        />,
      );
      const strip = screen.getByTestId("session-tabs");
      const actions = within(strip).getByTestId("session-tabs-actions");
      const trigger = within(actions).getByRole("button", {
        name: "View mode",
      });
      const list = within(strip).getByRole("tablist", { name: "Session tabs" });
      expect(list).not.toContainElement(trigger);
      expect(list.parentElement).toBe(actions.parentElement);
      expect(actions).toHaveClass("shrink-0");
      expect(trigger.textContent).toBe("");
      expect(screen.queryByTestId("tab-layout-toolbar")).toBeNull();
      open();
      expect(
        screen.getByRole("menu", { name: "View mode" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("menuitem")).toHaveLength(10);
    },
  );

  it("uses keyboard navigation, Escape and outside dismissal and restores trigger focus", async () => {
    controls();
    const trigger = screen.getByRole("button", { name: "View mode" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = screen.getByRole("menuitem", { name: "Tabs (single pane)" });
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(
      screen.getByRole("menuitem", { name: "Split left/right" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["tabs", "Tabs (single pane)", 5],
    ["splitVertical", "Split left/right", 5],
    ["splitHorizontal", "Split top/bottom", 5],
    ["sideBySide", "Side-by-side (2 cols, fill rows)", 5],
    ["grid2", "2 side by side (capped)", 2],
    ["grid4", "4 squares (capped)", 4],
    ["grid6", "6 squares (capped)", 5],
    ["mosaic", "Auto mosaic (sqrt grid)", 5],
    ["miniMosaic", "Mini mosaic (preview grid)", 5],
  ] as const)("selects %s through its menu action", (mode, label, slots) => {
    const view = controls();
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.onLayoutChange).toHaveBeenCalledOnce();
    const chosen = view.onLayoutChange.mock.calls[0][0] as TabLayout;
    expect(chosen.mode).toBe(mode);
    expect(chosen.sessions).toHaveLength(slots);
    if (slots) expect(chosen.sessions[0].sessionId).toBe("s2");
    view.rerender(<TabLayoutControls {...view.props} layout={chosen} />);
    expect(screen.getByRole("button", { name: "View mode" })).toHaveAttribute(
      "title",
      `View mode: ${label}`,
    );
  });

  it("opens the custom-grid editor, focuses its sliders, applies dimensions and returns focus", async () => {
    const view = controls();
    open();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Custom grid layout" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Custom Grid Layout",
    });
    const sliders = within(dialog).getAllByRole("slider");
    await waitFor(() => expect(sliders[0]).toHaveFocus());
    fireEvent.change(sliders[0], { target: { value: "3" } });
    fireEvent.change(sliders[1], { target: { value: "1" } });
    expect(dialog).toHaveTextContent("3 tiles · 3 filled · 5 sessions");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Apply Layout" }),
    );
    expect(view.onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "customGrid",
        customCols: 3,
        customRows: 1,
        sessions: expect.any(Array),
      }),
    );
    expect(view.onLayoutChange.mock.calls[0][0].sessions).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "View mode" })).toHaveFocus();
  });

  it("loads later persisted custom dimensions and dismisses the editor without applying", async () => {
    const view = controls();
    view.rerender(
      <TabLayoutControls
        {...view.props}
        layout={buildTabLayout("customGrid", sessions, {
          customCols: 4,
          customRows: 1,
        })}
      />,
    );
    open();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Custom grid layout" }),
    );
    const dialog = await screen.findByRole("dialog");
    const sliders = within(dialog).getAllByRole("slider");
    expect(sliders[0]).toHaveValue("4");
    expect(sliders[1]).toHaveValue("1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.onLayoutChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "View mode" })).toHaveFocus();
  });

  it("promotes an overflow session into the active tile and hides overflow actions in tab mode", () => {
    const initial = buildTabLayout("grid2", sessions);
    const view = controls(initial);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Session 5" }));
    const next = view.onLayoutChange.mock.calls[0][0] as TabLayout;
    expect(next.sessions.map((slot) => slot.sessionId)).toEqual(["s1", "s5"]);
    expect(view.onSessionSelect).toHaveBeenCalledWith("s5");
    expect(next.mode).toBe("grid2");
    view.rerender(<TabLayoutControls {...view.props} layout={tabs} />);
    open();
    expect(screen.queryByText("Hidden sessions — click to promote")).toBeNull();
  });

  it("keeps viewer nodes mounted across menu layout changes, promotion and tile drops", () => {
    const mounted = vi.fn(),
      unmounted = vi.fn(),
      close = vi.fn();
    const Viewer = ({ id }: { id: string }) => {
      useEffect(() => {
        mounted(id);
        return () => unmounted(id);
      }, [id]);
      return <div data-testid={`viewer-${id}`}>{id}</div>;
    };
    function Harness() {
      const [layout, change] = useState(tabs);
      const [active, select] = useState("s2");
      return (
        <>
          <TabLayoutControls
            sessions={sessions}
            layout={layout}
            activeSessionId={active}
            onLayoutChange={change}
            onSessionSelect={select}
          />
          <TabLayoutManager
            sessions={sessions}
            activeSessionId={active}
            layout={layout}
            onLayoutChange={change}
            onSessionSelect={select}
            onSessionClose={close}
            onSessionDetach={vi.fn()}
            renderSession={(s) => <Viewer id={s.id} />}
          />
        </>
      );
    }
    render(<Harness />);
    const nodes = sessions.map((s) => screen.getByTestId(`viewer-${s.id}`));
    open();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "2 side by side (capped)" }),
    );
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Session 5" }));
    expect(screen.getByTestId("tile-slot-0")).toContainElement(nodes[4]);
    fireEvent.drop(screen.getByTestId("tile-slot-1"), {
      dataTransfer: {
        getData: (type: string) => (type === SESSION_TAB_DND_TYPE ? "s3" : ""),
      },
    });
    expect(screen.getByTestId("tile-slot-1")).toContainElement(nodes[2]);
    open();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Tabs (single pane)" }),
    );
    sessions.forEach((s, i) =>
      expect(screen.getByTestId(`viewer-${s.id}`)).toBe(nodes[i]),
    );
    expect(mounted).toHaveBeenCalledTimes(sessions.length);
    expect(unmounted).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
