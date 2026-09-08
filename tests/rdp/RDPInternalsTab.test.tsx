import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RDPInternalsTab } from "../../src/components/rdp/RDPInternalsTab";
import { useRDPInternalsBridge } from "../../src/hooks/rdp/useRDPInternalsBridge";
import {
  createRdpInternalsSession,
  createRecordingPlayerSession,
  RDP_INTERNALS_PROTOCOL,
  isToolProtocol,
} from "../../src/components/app/toolSession";
import { rdpInternalsStore } from "../../src/utils/rdp/rdpInternalsStore";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { ConnectionAction } from "../../src/contexts/ConnectionContextTypes";
import { SessionRenderActivityProvider } from "../../src/components/session/SessionRenderActivity";

const TestContext = createContext({
  state: { sessions: [] as ConnectionSession[] },
  dispatch: (_action: ConnectionAction) => {},
});
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => useContext(TestContext),
}));

const source: ConnectionSession = {
  id: "desktop-one",
  connectionId: "shared-host",
  name: "Desktop one",
  hostname: "host",
  protocol: "rdp",
  status: "connected",
  startTime: new Date(),
};
const details: Parameters<typeof useRDPInternalsBridge>[1] = {
  connectionStatus: "connected",
  desktopSize: { width: 2560, height: 1440 },
  rdpSettings: {
    display: { width: 1920, height: 1080 },
    gateway: { password: "must-not-be-shared" },
    performance: { frameBatching: true },
  },
  colorDepth: 32,
  audioEnabled: true,
  clipboardEnabled: true,
  perfLabel: "lan",
  certFingerprint: null,
  stats: null,
  lifecycle: null,
  connectTiming: null,
  activeRenderBackend: "webview",
  activeFrontendRenderer: "webgl",
  framePressureState: "healthy",
  frameBackpressureTelemetry: null,
};

function Source({
  session,
  model,
  activate,
  mounted,
}: {
  session: ConnectionSession;
  model: typeof details;
  activate: (id: string) => void;
  mounted: () => () => void;
}) {
  const open = useRDPInternalsBridge(session, model, activate);
  useEffect(mounted, [mounted]);
  return (
    <div data-testid={`source-${session.id}`}>
      <canvas data-testid={`canvas-${session.id}`} />
      <button onClick={() => open("diagnostics")}>
        Internals {session.id}
      </button>
      <button onClick={() => open("settings")}>Settings {session.id}</button>
      <button
        onClick={() => {
          open("diagnostics");
          open("settings");
        }}
      >
        Open twice {session.id}
      </button>
    </div>
  );
}

const noLifecycle = () => () => {};
function Harness({
  sources = [source],
  model = details,
  mounted = noLifecycle,
  noise = 0,
}: {
  sources?: ConnectionSession[];
  model?: typeof details;
  mounted?: () => () => void;
  noise?: number;
}) {
  const [sessions, setSessions] = useState(sources);
  const [active, setActive] = useState(source.id);
  const dispatch = useCallback((action: ConnectionAction) => {
    setSessions((previous) => {
      if (action.type === "ADD_SESSION") return [...previous, action.payload];
      if (action.type === "UPDATE_SESSION")
        return previous.map((session) =>
          session.id === action.payload.id
            ? { ...session, ...action.payload }
            : session,
        );
      if (action.type === "REMOVE_SESSION")
        return previous.filter((session) => session.id !== action.payload);
      return previous;
    });
  }, []);
  const context = useMemo(
    () => ({ state: { sessions }, dispatch }),
    [sessions, dispatch],
  );
  return (
    <TestContext.Provider value={context}>
      <output data-testid="active-session">{active}</output>
      <span data-testid="noise">{noise}</span>
      {sessions
        .filter((session) => session.protocol === "rdp")
        .map((session) => (
          <SessionRenderActivityProvider
            key={session.id}
            isActive={session.id === active}
          >
            <Source
              session={session}
              model={model}
              activate={setActive}
              mounted={mounted}
            />
            <button
              onClick={() =>
                dispatch({ type: "REMOVE_SESSION", payload: session.id })
              }
            >
              Close source {session.id}
            </button>
          </SessionRenderActivityProvider>
        ))}
      {sessions
        .filter((session) => session.protocol === RDP_INTERNALS_PROTOCOL)
        .map((session) => (
          <RDPInternalsTab
            key={session.id}
            session={session}
            onClose={() => {
              dispatch({ type: "REMOVE_SESSION", payload: session.id });
              setActive(source.id);
            }}
          />
        ))}
    </TestContext.Provider>
  );
}

describe("session-scoped RDP Internals tabs", () => {
  it("opens/reuses one tab for both buttons, survives close/reopen without replacing the desktop", async () => {
    const disposed = vi.fn();
    const mounted = vi.fn(() => disposed);
    const view = render(<Harness mounted={mounted} />);
    const canvas = screen.getByTestId("canvas-desktop-one");
    fireEvent.click(screen.getByText("Open twice desktop-one"));
    expect(screen.getAllByTestId("rdp-internals-tab")).toHaveLength(1);
    expect(screen.getByTestId("active-session")).toHaveTextContent(
      "rdp-internals-desktop-one",
    );
    expect(screen.getByText("Current resolution")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Internals desktop-one"));
    expect(screen.getAllByTestId("rdp-internals-tab")).toHaveLength(1);
    expect(
      screen.getByText("Waiting for session statistics..."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("rdp-internals-tab")).getByRole("status"),
    ).toHaveTextContent("presentation is paused");
    fireEvent.click(
      screen.getByRole("button", { name: "Close RDP Internals tab" }),
    );
    expect(screen.queryByTestId("rdp-internals-tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-desktop-one")).toBe(canvas);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Settings desktop-one"));
    expect(screen.getAllByTestId("rdp-internals-tab")).toHaveLength(1);
    view.unmount();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(rdpInternalsStore.getSnapshot(source.id)).toBeNull();
  });

  it("targets logical sessions separately even when both connect to the same saved host", () => {
    const second = { ...source, id: "desktop-two", name: "Desktop two" };
    render(<Harness sources={[source, second]} />);
    fireEvent.click(screen.getByText("Internals desktop-one"));
    fireEvent.click(screen.getByText("Internals desktop-two"));
    expect(screen.getAllByTestId("rdp-internals-tab")).toHaveLength(2);
    expect(screen.getByText("RDP Internals — Desktop one")).toBeInTheDocument();
    expect(screen.getByText("RDP Internals — Desktop two")).toBeInTheDocument();
  });

  it("updates actual resolution/settings while hidden and never shares gateway credentials or per-frame churn", async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText("Settings desktop-one"));
    const tab = screen.getByTestId("rdp-internals-tab");
    expect(within(tab).getByText("2560x1440")).toBeInTheDocument();
    expect(within(tab).getByText("1920x1080")).toBeInTheDocument();
    expect(
      rdpInternalsStore.getSnapshot(source.id)?.rdpSettings,
    ).not.toHaveProperty("gateway");
    const listener = vi.fn();
    const stop = rdpInternalsStore.subscribe(source.id, listener);
    view.rerender(<Harness noise={200} />);
    expect(listener).not.toHaveBeenCalled();
    view.rerender(
      <Harness
        model={{
          ...details,
          desktopSize: { width: 1600, height: 900 },
          clipboardEnabled: false,
        }}
      />,
    );
    await waitFor(() =>
      expect(within(tab).getByText("1600x900")).toBeInTheDocument(),
    );
    expect(within(tab).getByText("Disabled")).toBeInTheDocument();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("handles disconnected and removed targets without attaching another connection", () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText("Internals desktop-one"));
    view.rerender(
      <Harness model={{ ...details, connectionStatus: "disconnected" }} />,
    );
    expect(
      screen.getByText(/The RDP connection is not active/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close source desktop-one"));
    expect(screen.getByText(/This RDP session has closed/)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-desktop-one")).not.toBeInTheDocument();
    expect(rdpInternalsStore.getSnapshot(source.id)).toBeNull();
  });

  it("stores only opaque target metadata and uses ordinary tool close classification", () => {
    const tab = createRdpInternalsSession({
      ...source,
      backendSessionId: "native-actor",
      vpnLeaseOwnerId: "private-owner",
    });
    expect(isToolProtocol(tab.protocol)).toBe(true);
    expect(tab.rdpInternals).toEqual({
      sessionId: source.id,
      section: "diagnostics",
    });
    expect(tab).not.toHaveProperty("backendSessionId");
    expect(tab).not.toHaveProperty("vpnLeaseOwnerId");
    expect(
      createRecordingPlayerSession("recording-1", "clip").recordingPlayer,
    ).toEqual({ recordingId: "recording-1" });
  });

  it("does not let an old source cleanup erase a replacement's snapshot", () => {
    const oldOwner = Symbol();
    const newOwner = Symbol();
    const snapshot = { ...details, renderActive: false };
    act(() => {
      rdpInternalsStore.publish("replacement", oldOwner, snapshot);
      rdpInternalsStore.publish("replacement", newOwner, snapshot);
      rdpInternalsStore.remove("replacement", oldOwner);
    });
    expect(rdpInternalsStore.getSnapshot("replacement")).toBe(snapshot);
    rdpInternalsStore.remove("replacement", newOwner);
  });
});
