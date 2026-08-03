import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudSessionPanel } from "../../src/components/cloud/CloudSessionPanel";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { CloudRuntimeAdapter } from "../../src/utils/session/cloudRuntimeAdapters";
import { resetBuiltInCloudRuntimeLeasesForTests } from "../../src/utils/session/builtInCloudRuntimeRegistry";
import { loadCloudRuntimeInventory } from "../../src/utils/session/cloudRuntimeInventoryAdapters";
import { resolveRuntimeConnection } from "../../src/utils/session/runtimeConnectionRegistry";

const dispatch = vi.fn();
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] }, dispatch }),
}));
vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: vi.fn(),
}));
vi.mock("../../src/utils/session/cloudRuntimeInventoryAdapters", () => ({
  cloudInventoryLabel: () => "Compute Engine instances",
  loadCloudRuntimeInventory: vi.fn(),
}));
const resolveConnection = vi.mocked(resolveRuntimeConnection);
const loadInventory = vi.mocked(loadCloudRuntimeInventory);

const saved = (protocol: Connection["protocol"] = "gcp") =>
  ({
    id: "saved",
    name: "Cloud account",
    protocol,
    password: "secret",
  }) as Connection;
const session = (id = "cloud-a") =>
  ({
    id,
    connectionId: "saved",
    name: "Cloud account",
    protocol: "gcp",
    status: "disconnected",
  }) as ConnectionSession;
const adapter = (
  overrides: Partial<CloudRuntimeAdapter> = {},
): CloudRuntimeAdapter => ({
  protocol: "gcp",
  displayName: "Google Cloud",
  validate: vi.fn(() => null),
  summary: vi.fn(() => "project-a"),
  connect: vi.fn().mockResolvedValue({ backendSessionId: "backend-a" }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("CloudSessionPanel", () => {
  beforeEach(() => {
    dispatch.mockReset();
    resolveConnection.mockReset();
    loadInventory.mockReset();
    loadInventory.mockResolvedValue([]);
    resetBuiltInCloudRuntimeLeasesForTests();
  });
  afterEach(() => resetBuiltInCloudRuntimeLeasesForTests());

  it("hydrates and reports the backend session handle without credentials", async () => {
    const connection = saved();
    const runtime = adapter();
    resolveConnection.mockReturnValue(connection);
    render(
      <CloudSessionPanel
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
          id: "cloud-a",
          status: "connected",
          errorMessage: undefined,
          backendSessionId: "backend-a",
        },
      }),
    );
    expect(JSON.stringify(dispatch.mock.calls)).not.toContain("secret");
  });

  it("surfaces saved-connection validation errors", async () => {
    resolveConnection.mockReturnValue(undefined);
    const runtime = adapter();
    render(
      <CloudSessionPanel
        adapter={runtime}
        session={session()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it("joins close and unmount onto one serialized disconnect", async () => {
    let finishConnect!: () => void;
    let finishDisconnect!: () => void;
    const connectGate = new Promise<{ backendSessionId: string }>((resolve) => {
      finishConnect = () => resolve({ backendSessionId: "backend-a" });
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
      <CloudSessionPanel
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

  it("keeps inventory unverified until a manual provider refresh", async () => {
    const connection = saved();
    const runtime = adapter();
    resolveConnection.mockReturnValue(connection);
    loadInventory.mockResolvedValue([
      {
        id: "instance-1",
        name: "api-primary",
        status: "RUNNING",
        location: "europe-west1-b",
        type: "e2-medium",
      },
    ]);

    render(
      <CloudSessionPanel
        adapter={runtime}
        session={session()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "Runtime initialized locally. Refresh to verify inventory with the provider.",
      ),
    ).toBeInTheDocument();
    expect(loadInventory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("api-primary")).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(loadInventory).toHaveBeenCalledWith("gcp", connection, {
      backendSessionId: "backend-a",
    });
  });

  it("surfaces inventory failures and allows an explicit retry", async () => {
    resolveConnection.mockReturnValue(saved());
    loadInventory
      .mockRejectedValueOnce(new Error("Provider inventory unavailable"))
      .mockResolvedValueOnce([
        {
          id: "instance-2",
          name: "worker-primary",
          status: "ACTIVE",
        },
      ]);

    render(
      <CloudSessionPanel
        adapter={adapter()}
        session={session()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText(
      "Runtime initialized locally. Refresh to verify inventory with the provider.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText("Provider inventory unavailable"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("worker-primary")).toBeInTheDocument();
    expect(loadInventory).toHaveBeenCalledTimes(2);
  });
});
