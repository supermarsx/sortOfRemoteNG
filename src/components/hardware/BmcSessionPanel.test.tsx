import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  BmcOverview,
  BmcRuntimeAdapter,
} from "../../utils/session/bmcRuntimeAdapters";
import { BmcSessionPanel } from "./BmcSessionPanel";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  claim: vi.fn(),
  teardown: vi.fn(),
  resolveConnection: vi.fn(),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [] },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../../utils/session/builtInManagementRuntimeRegistry", () => ({
  claimBuiltInManagementRuntime: mocks.claim,
  teardownBuiltInManagementRuntime: mocks.teardown,
}));

vi.mock("../../utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: mocks.resolveConnection,
}));

const savedConnection = {
  id: "ilo-connection",
  name: "Rack iLO",
  protocol: "ilo",
  hostname: "ilo.example.test",
  username: "operator",
  password: "connection-secret",
} as Connection;

const session = {
  id: "session-1",
  connectionId: savedConnection.id,
  name: savedConnection.name,
  status: "connecting",
} as ConnectionSession;

const overview = (model: string): BmcOverview => ({
  refreshedAt: "2026-07-30T12:00:00.000Z",
  sections: [
    {
      id: "system",
      title: "System",
      items: [{ label: "Model", value: model }],
    },
    {
      id: "health",
      title: "Health",
      status: "OK",
      items: [{ label: "Overall", value: "OK" }],
    },
    {
      id: "power",
      title: "Power",
      status: "On",
      items: [{ label: "Consumption", value: "180 W" }],
    },
    {
      id: "thermal",
      title: "Thermal",
      items: [{ label: "Ambient", value: "23 C" }],
    },
    {
      id: "storage",
      title: "Storage",
      items: [{ label: "Controllers", value: "1" }],
    },
    {
      id: "firmware",
      title: "Firmware",
      items: [{ label: "BMC", value: "1.2.3" }],
    },
  ],
});

const createAdapter = () => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const loadOverview = vi.fn().mockResolvedValue(overview("ProLiant DL380"));
  const adapter: BmcRuntimeAdapter = {
    protocol: "ilo",
    displayName: "HPE iLO",
    connect,
    disconnect,
    loadOverview,
  };
  return { adapter, connect, disconnect, loadOverview };
};

describe("BmcSessionPanel", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.claim.mockReset();
    mocks.claim.mockReturnValue(true);
    mocks.resolveConnection.mockReset();
    mocks.resolveConnection.mockReturnValue(savedConnection);
    mocks.teardown.mockReset();
    mocks.teardown.mockImplementation(
      async (
        _protocol: string,
        _sessionId: string,
        disconnect: () => Promise<void>,
      ) => {
        await disconnect();
      },
    );
  });

  it("loads a read-only overview after connect and refreshes it manually", async () => {
    const { adapter, connect, loadOverview } = createAdapter();
    loadOverview
      .mockResolvedValueOnce(overview("ProLiant DL380"))
      .mockResolvedValueOnce(overview("ProLiant DL385"));

    render(<BmcSessionPanel adapter={adapter} session={session} />);

    await waitFor(() => expect(connect).toHaveBeenCalledWith(savedConnection));
    expect(await screen.findByText("ProLiant DL380")).toBeInTheDocument();
    expect(screen.getByTestId("ilo-overview-health")).toHaveTextContent("OK");
    expect(screen.getByTestId("ilo-overview-storage")).toHaveTextContent(
      "Controllers",
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("ProLiant DL385")).toBeInTheDocument();
    expect(loadOverview).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: /power|reset|update/i }),
    ).toBeNull();
  });

  it("keeps the connected session open and reports a truthful refresh error", async () => {
    const { adapter, loadOverview } = createAdapter();
    loadOverview.mockRejectedValue(new Error("dashboard endpoint unavailable"));

    render(<BmcSessionPanel adapter={adapter} session={session} />);

    expect(
      await screen.findByText("Refresh failed: dashboard endpoint unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ status: "connected" }),
      }),
    );
  });

  it("preserves serialized lease teardown before closing", async () => {
    const { adapter, disconnect } = createAdapter();
    const onClose = vi.fn();

    render(
      <BmcSessionPanel adapter={adapter} session={session} onClose={onClose} />,
    );
    await screen.findByText("ProLiant DL380");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(mocks.teardown).toHaveBeenCalledWith(
        "ilo",
        session.id,
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
