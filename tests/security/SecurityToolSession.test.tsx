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
  availability: { status: "ready", databaseId: "db-a", generation: 1 } as {
    status: string;
    databaseId: string | null;
    generation: number;
  },
  vaultMount: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: fixture.sessions, connections: [] },
    dispatch: fixture.dispatch,
    databaseAvailability: fixture.availability,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: true }),
}));
vi.mock("../../src/components/security/DatabaseCredentialVault", () => ({
  default: () => {
    fixture.vaultMount();
    return <section aria-label="Private vault" />;
  },
}));
vi.mock("../../src/components/security/HardwareKeysTab", () => ({
  default: () => <section aria-label="Device manager" />,
}));
vi.mock("../../src/components/SettingsDialog/index", () => ({
  SettingsTabContent: ({
    onOpenCredentialVault,
    onOpenHardwareKeys,
  }: {
    onOpenCredentialVault?: () => void;
    onOpenHardwareKeys?: () => void;
  }) => (
    <>
      <button onClick={onOpenCredentialVault}>Manage vault</button>
      <button onClick={onOpenHardwareKeys}>Manage keys</button>
    </>
  ),
}));
import {
  createSecurityToolSession,
  createToolSession,
} from "../../src/components/app/toolSession";
import { useSecurityToolSession } from "../../src/hooks/security/useSecurityToolSession";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
afterEach(() => {
  cleanup();
  fixture.sessions = [];
  fixture.dispatch.mockClear();
  fixture.vaultMount.mockClear();
  fixture.availability = { status: "ready", databaseId: "db-a", generation: 1 };
});
describe("autonomous security tools", () => {
  it.each(["credentialVault", "hardwareKeys"] as const)(
    "rapid opening %s focuses one session",
    (tool) => {
      const activate = vi.fn();
      const { result } = renderHook(() =>
        useSecurityToolSession(tool, activate),
      );
      act(() => {
        result.current();
        result.current();
      });
      expect(fixture.dispatch).toHaveBeenCalledOnce();
      expect(activate).toHaveBeenCalledTimes(2);
      expect(fixture.dispatch.mock.calls[0][0].payload).toMatchObject({
        protocol: `tool:${tool}`,
      });
    },
  );
  it("keeps detached window and database ownership distinct without copying private source data", () => {
    const source = {
      ...createToolSession("settings"),
      layout: { isDetached: true, windowId: "window-b" },
      tabGroupId: "group-b",
    } as ConnectionSession;
    const candidate = createSecurityToolSession("hardwareKeys", source);
    fixture.sessions = [createSecurityToolSession("hardwareKeys")];
    const activate = vi.fn();
    const { result } = renderHook(() =>
      useSecurityToolSession("hardwareKeys", activate, source),
    );
    act(() => result.current());
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        protocol: candidate.protocol,
        layout: source.layout,
        tabGroupId: "group-b",
      }),
    });
    expect(candidate).not.toHaveProperty("password");
  });
  it("does not focus another database's vault after switching owners", () => {
    fixture.sessions = [
      createSecurityToolSession("credentialVault", undefined, "db-a"),
    ];
    fixture.availability.databaseId = "db-b";
    const activate = vi.fn();
    const { result } = renderHook(() =>
      useSecurityToolSession("credentialVault", activate),
    );
    act(() => result.current());
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ ownerDatabaseId: "db-b" }),
    });
    expect(activate).not.toHaveBeenCalledWith(fixture.sessions[0].id);
  });
  it("does not create or mount private vault content in detached windows", () => {
    const source = {
      ...createToolSession("settings"),
      layout: { isDetached: true, windowId: "window-b" },
    } as ConnectionSession;
    const { result } = renderHook(() =>
      useSecurityToolSession("credentialVault", vi.fn(), source),
    );
    act(() => result.current());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    render(
      <ToolTabViewer
        session={createSecurityToolSession("credentialVault", source, "db-a")}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "main application toolbar",
    );
    expect(fixture.vaultMount).not.toHaveBeenCalled();
  });
  it.each(["credentialVault", "hardwareKeys"] as const)(
    "does not reuse a moved %s session ID when reopening in main",
    (tool) => {
      const moved = {
        ...createSecurityToolSession(tool, undefined, "db-a"),
        layout: { isDetached: true, windowId: "other-window" },
      } as ConnectionSession;
      fixture.sessions = [moved];
      const { result } = renderHook(() =>
        useSecurityToolSession(tool, vi.fn()),
      );
      act(() => result.current());
      const created = fixture.dispatch.mock.calls[0][0].payload;
      expect(created.id).not.toBe(moved.id);
      expect(created.protocol).toBe(moved.protocol);
      expect(created.layout).toBeUndefined();
    },
  );
  it("uses the existing bound unowned-origin tab after provider acknowledgement", () => {
    fixture.sessions = [
      {
        ...createSecurityToolSession("credentialVault"),
        ownerDatabaseId: "db-a",
      },
    ];
    const activate = vi.fn();
    const { result } = renderHook(() =>
      useSecurityToolSession("credentialVault", activate),
    );
    act(() => result.current());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith(fixture.sessions[0].id);
  });
  it("gates the real vault route on owner/lock while keeping hardware independent and no duplicate close", async () => {
    const session = createSecurityToolSession(
      "credentialVault",
      undefined,
      "db-a",
    );
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      await screen.findByRole("region", { name: "Private vault" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();
    fixture.availability = {
      status: "suspended",
      databaseId: "db-a",
      generation: 2,
    };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      screen.queryByRole("region", { name: "Private vault" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      "Database locked",
    );
    fixture.availability = {
      status: "ready",
      databaseId: "db-b",
      generation: 3,
    };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      "A different database is open",
    );
    fixture.availability = { status: "none", databaseId: null, generation: 4 };
    view.rerender(
      <ToolTabViewer
        session={createSecurityToolSession("hardwareKeys")}
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("region", { name: "Device manager" }),
    ).toBeInTheDocument();
  });
  it("opens both tools through the real Settings tab integration", async () => {
    const activate = vi.fn();
    render(
      <ToolTabViewer
        session={createToolSession("settings")}
        onClose={vi.fn()}
        onActivateSession={activate}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage vault" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage keys" }));
    expect(
      fixture.dispatch.mock.calls.map(([action]) => action.payload.protocol),
    ).toEqual(["tool:credentialVault", "tool:hardwareKeys"]);
  });
});
