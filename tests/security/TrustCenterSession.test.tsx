import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
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
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: true }),
}));
vi.mock("../../src/components/security/TrustCenterTab", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close dedicated manager</button>
  ),
}));
vi.mock("../../src/components/SettingsDialog/index", () => ({
  SettingsTabContent: ({
    onOpenTrustCenter,
  }: {
    onOpenTrustCenter: () => void;
  }) => <button onClick={onOpenTrustCenter}>Open dedicated manager</button>,
}));
import { useTrustCenterSession } from "../../src/hooks/security/useTrustCenterSession";
import {
  createTrustCenterSession,
  createToolSession,
  TRUST_CENTER_PROTOCOL,
} from "../../src/components/app/toolSession";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
afterEach(() => {
  cleanup();
  fixture.sessions = [];
  fixture.dispatch.mockClear();
});
describe("Trust Center tab navigation", () => {
  it("creates one reusable local tab even on rapid repeated activation", () => {
    const activate = vi.fn();
    const { result } = renderHook(() => useTrustCenterSession(activate));
    act(() => {
      result.current();
      result.current();
    });
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "trust-center-main",
        protocol: TRUST_CENTER_PROTOCOL,
        connectionId: "tool-trust-center",
      }),
    });
    expect(activate).toHaveBeenLastCalledWith("trust-center-main");
  });
  it("renders the dedicated manager and closes only its tool tab", async () => {
    const close = vi.fn();
    render(
      <ToolTabViewer session={createTrustCenterSession()} onClose={close} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Close dedicated manager" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it("opens the manager from the real Settings tool routing", async () => {
    const activate = vi.fn();
    render(
      <ToolTabViewer
        session={createToolSession("settings")}
        onClose={vi.fn()}
        onActivateSession={activate}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open dedicated manager" }),
    );
    expect(activate).toHaveBeenCalledWith("trust-center-main");
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ protocol: TRUST_CENTER_PROTOCOL }),
    });
  });
});
