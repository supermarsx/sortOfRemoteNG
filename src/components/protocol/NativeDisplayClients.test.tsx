import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";
import { SpiceClient } from "./SpiceClient";
import { XdmcpClient } from "./XdmcpClient";

const mocks = vi.hoisted(() => ({
  spice: vi.fn(),
  xdmcp: vi.fn(),
  spiceDisconnect: vi.fn(),
  spiceReconnect: vi.fn(),
  xdmcpDisconnect: vi.fn(),
  xdmcpReconnect: vi.fn(),
}));

vi.mock("../../hooks/protocol/useSpiceClient", () => ({
  useSpiceClient: () => mocks.spice(),
}));
vi.mock("../../hooks/protocol/useXdmcpClient", () => ({
  useXdmcpClient: () => mocks.xdmcp(),
}));

const session: ConnectionSession = {
  id: "native-display-1",
  connectionId: "connection-1",
  name: "Display",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "spice",
  hostname: "display.example.test",
};

beforeEach(() => {
  mocks.spice.mockReset();
  mocks.xdmcp.mockReset();
  mocks.spiceDisconnect.mockReset();
  mocks.spiceReconnect.mockReset();
  mocks.xdmcpDisconnect.mockReset();
  mocks.xdmcpReconnect.mockReset();
  mocks.spice.mockReturnValue({
    status: "viewer-running",
    error: null,
    backendSessionId: "spice-backend-1",
    sessionInfo: { host: session.hostname, port: 5900 },
    disconnect: mocks.spiceDisconnect,
    reconnect: mocks.spiceReconnect,
  });
  mocks.xdmcp.mockReturnValue({
    status: "x-server-running",
    error: null,
    backendSessionId: "xdmcp-backend-1",
    sessionInfo: {
      host: session.hostname,
      display_number: 10,
      x_server_pid: 4321,
    },
    disconnect: mocks.xdmcpDisconnect,
    reconnect: mocks.xdmcpReconnect,
  });
});

describe("native display clients", () => {
  it("describes SPICE process liveness without claiming remote authentication", () => {
    render(<SpiceClient session={session} />);
    expect(
      screen.getByText("Native viewer process is running"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /confirms only that the local viewer process remains alive/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Connected$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop viewer/i }));
    expect(mocks.spiceDisconnect).toHaveBeenCalledTimes(1);
  });

  it("always exposes the XDMCP unauthenticated and unencrypted warning", () => {
    render(<XdmcpClient session={{ ...session, protocol: "xdmcp" }} />);
    expect(
      screen.getByText("XDMCP is unauthenticated and unencrypted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not claim that a remote login screen/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop X server/i }));
    expect(mocks.xdmcpDisconnect).toHaveBeenCalledTimes(1);
  });
});
