import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BmcSessionPanel } from "../../src/components/hardware/BmcSessionPanel";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { BmcRuntimeAdapter } from "../../src/utils/session/bmcRuntimeAdapters";
import { resetBuiltInManagementRuntimeLeasesForTests } from "../../src/utils/session/builtInManagementRuntimeRegistry";
import { resolveRuntimeConnection } from "../../src/utils/session/runtimeConnectionRegistry";

const dispatch = vi.fn();
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] }, dispatch }),
}));
vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: vi.fn(),
}));
const resolveConnection = vi.mocked(resolveRuntimeConnection);

const saved = (protocol: Connection["protocol"] = "ilo"): Connection => ({
  id: "saved",
  name: "Rack controller",
  protocol,
  hostname: "rack-bmc.example.test",
  port: 443,
  username: "operator",
  password: "secret",
  isGroup: false,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
});

const session = (id = "a") =>
  ({
    id,
    connectionId: "saved",
    name: "Rack controller",
    protocol: "ilo",
    status: "disconnected",
  }) as ConnectionSession;

const adapter = (
  overrides: Partial<BmcRuntimeAdapter> = {},
): BmcRuntimeAdapter => ({
  protocol: "ilo",
  displayName: "HPE iLO",
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  loadOverview: vi.fn().mockResolvedValue({
    refreshedAt: "2026-07-29T00:00:00.000Z",
    sections: [],
  }),
  ...overrides,
});

describe("BmcSessionPanel", () => {
  beforeEach(() => {
    dispatch.mockReset();
    resolveConnection.mockReset();
    resetBuiltInManagementRuntimeLeasesForTests();
  });

  afterEach(() => resetBuiltInManagementRuntimeLeasesForTests());

  it("hydrates a saved connection and reports connected status", async () => {
    const connection = saved();
    const runtime = adapter();
    resolveConnection.mockReturnValue(connection);

    render(
      <BmcSessionPanel
        adapter={runtime}
        session={session()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(runtime.connect).toHaveBeenCalledWith(connection),
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: {
          id: "a",
          status: "connected",
          errorMessage: undefined,
        },
      }),
    );
    expect(screen.getByText("rack-bmc.example.test")).toBeTruthy();
  });

  it("shows missing and mismatched saved-connection errors", async () => {
    const runtime = adapter();
    resolveConnection.mockReturnValue(undefined);
    const first = render(
      <BmcSessionPanel
        adapter={runtime}
        session={session()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    first.unmount();

    resolveConnection.mockReturnValue(saved("lenovo"));
    render(
      <BmcSessionPanel
        adapter={runtime}
        session={session()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "does not match",
    );
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it("blocks a second same-provider session", async () => {
    resolveConnection.mockReturnValue(saved());
    const first = render(
      <BmcSessionPanel
        adapter={adapter()}
        session={session("a")}
        onClose={vi.fn()}
      />,
    );
    const secondRuntime = adapter();
    render(
      <BmcSessionPanel
        adapter={secondRuntime}
        session={session("b")}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another HPE iLO session is active",
    );
    expect(secondRuntime.connect).not.toHaveBeenCalled();
    first.unmount();
  });

  it("joins close and unmount onto one serialized disconnect", async () => {
    let finishConnect!: () => void;
    let finishDisconnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    const disconnectGate = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    const runtime = adapter({
      connect: vi.fn(() => connectGate),
      disconnect: vi.fn(() => disconnectGate),
    });
    const onClose = vi.fn();
    resolveConnection.mockReturnValue(saved());
    const rendered = render(
      <BmcSessionPanel
        adapter={runtime}
        session={session()}
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(runtime.connect).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rendered.unmount();
    expect(runtime.disconnect).not.toHaveBeenCalled();

    await act(async () => {
      finishConnect();
      await connectGate;
    });
    await waitFor(() => expect(runtime.disconnect).toHaveBeenCalledTimes(1));

    await act(async () => {
      finishDisconnect();
      await disconnectGate;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(runtime.disconnect).toHaveBeenCalledTimes(1);
  });
});
