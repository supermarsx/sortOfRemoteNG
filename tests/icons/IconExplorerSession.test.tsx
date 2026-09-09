import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
const fixture = vi.hoisted(() => ({
  sessions: [] as ConnectionSession[],
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: fixture.sessions, connections: [] },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/components/icons/IconExplorerTab", () => ({
  default: () => (
    <section aria-label="Autonomous Icon Explorer">Library workspace</section>
  ),
}));
import { useIconExplorerSession } from "../../src/hooks/icons/useIconExplorerSession";
import {
  createIconExplorerSession,
  ICON_EXPLORER_PROTOCOL,
} from "../../src/components/app/toolSession";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
afterEach(() => {
  fixture.sessions = [];
  fixture.dispatch.mockReset();
});
describe("Icon Explorer tool tab", () => {
  it("creates only one independent tab for rapid repeated launches, then focuses it", () => {
    const activate = vi.fn();
    const { result } = renderHook(() => useIconExplorerSession(activate));
    act(() => {
      result.current();
      result.current();
    });
    expect(fixture.dispatch).toHaveBeenCalledOnce();
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "icon-explorer-main",
        protocol: ICON_EXPLORER_PROTOCOL,
        connectionId: "tool-icon-explorer",
      }),
    });
    expect(activate).toHaveBeenNthCalledWith(2, "icon-explorer-main");
  });
  it("reuses an existing explorer and does not change connection state", () => {
    fixture.sessions = [createIconExplorerSession()];
    const activate = vi.fn();
    const { result } = renderHook(() => useIconExplorerSession(activate));
    act(() => result.current());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith("icon-explorer-main");
  });
  it("routes the dedicated protocol to its workspace, not Settings", async () => {
    const close = vi.fn();
    render(
      <ToolTabViewer session={createIconExplorerSession()} onClose={close} />,
    );
    expect(
      await screen.findByRole("region", { name: "Autonomous Icon Explorer" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it("keeps a detached host's singleton local to that window", () => {
    const session = createIconExplorerSession({
      ...createIconExplorerSession(),
      layout: { isDetached: true, windowId: "second" },
      tabGroupId: "group",
    } as ConnectionSession);
    expect(session.id).toBe("icon-explorer-second");
    expect(session.layout?.windowId).toBe("second");
    expect(session.tabGroupId).toBe("group");
  });
});
