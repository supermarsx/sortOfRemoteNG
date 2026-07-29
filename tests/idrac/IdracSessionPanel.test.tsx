import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  resetIdracRuntimeLeaseForTests,
} from "../../src/utils/session/builtInManagementRuntimeRegistry";
import IdracSessionPanel from "../../src/components/idrac/IdracSessionPanel";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  panelProps: vi.fn(),
  state: {
    connections: [] as Connection[],
    sessions: [] as ConnectionSession[],
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: mocks.state,
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../../src/components/idrac/idracPanel/IdracPanel", () => ({
  __esModule: true,
  default: (props: any) => {
    mocks.panelProps(props);
    return (
      <button type="button" onClick={() => props.onClose?.()}>
        Mock saved iDRAC panel
      </button>
    );
  },
}));

const connection = {
  id: "idrac-1",
  name: "Rack iDRAC",
  protocol: "idrac",
  hostname: "10.0.0.42",
  port: 443,
  username: "operator",
  password: "secret",
  isGroup: false,
  tags: [],
  order: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Connection;

const session = {
  id: "session-idrac-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "idrac",
  hostname: connection.hostname,
} as ConnectionSession;

describe("IdracSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(undefined);
    resetIdracRuntimeLeaseForTests();
    mocks.state.connections = [connection];
    mocks.state.sessions = [session];
  });

  afterEach(() => {
    cleanup();
    resetIdracRuntimeLeaseForTests();
  });

  it("resolves the selected saved connection and forwards real lifecycle state", async () => {
    const onClose = vi.fn();
    render(<IdracSessionPanel session={session} onClose={onClose} />);

    await screen.findByRole("button", { name: /mock saved idrac panel/i });
    const props =
      mocks.panelProps.mock.calls[mocks.panelProps.mock.calls.length - 1]?.[0];
    expect(props).toEqual(
      expect.objectContaining({
        connection,
        autoConnect: true,
        onClose,
      }),
    );

    act(() => {
      props.onConnectionStateChange("connected");
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: session.id,
        status: "connected",
        errorMessage: undefined,
      }),
    });

    act(() => {
      props.onConnectionStateChange("error", "authentication failed");
    });
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: session.id,
        status: "error",
        errorMessage: "authentication failed",
      }),
    });
  });

  it("fails visibly when the saved connection cannot be resolved", async () => {
    mocks.state.connections = [];
    render(<IdracSessionPanel session={session} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /saved connection may have been removed/i,
    );
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          status: "error",
          errorMessage: expect.stringMatching(/unavailable/i),
        }),
      });
    });
  });

  it("fails closed when a second tab would overwrite the global native service", async () => {
    render(<IdracSessionPanel session={session} />);
    await screen.findByRole("button", { name: /mock saved idrac panel/i });

    const secondSession = {
      ...session,
      id: "session-idrac-2",
    };
    render(<IdracSessionPanel session={secondSession} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /supports one device at a time/i,
    );
  });

  it("shares one idempotent disconnect across explicit close and unmount", async () => {
    const view = render(<IdracSessionPanel session={session} />);
    await screen.findByRole("button", { name: /mock saved idrac panel/i });
    const props =
      mocks.panelProps.mock.calls[mocks.panelProps.mock.calls.length - 1]?.[0];

    const explicitClose = props.onRequestTeardown();
    view.unmount();
    await explicitClose;

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("idrac_disconnect");
  });

  it("holds the singleton lease until asynchronous teardown settles", async () => {
    let finishDisconnect: (() => void) | undefined;
    mocks.invoke.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      }),
    );

    const first = render(<IdracSessionPanel session={session} />);
    await screen.findByRole("button", { name: /mock saved idrac panel/i });
    first.unmount();

    const secondSession = { ...session, id: "session-idrac-2" };
    const second = render(<IdracSessionPanel session={secondSession} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /supports one device at a time/i,
    );

    finishDisconnect?.();
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });
    second.unmount();

    const thirdSession = { ...session, id: "session-idrac-3" };
    render(<IdracSessionPanel session={thirdSession} />);
    expect(
      await screen.findByRole("button", { name: /mock saved idrac panel/i }),
    ).toBeInTheDocument();
  });
});
