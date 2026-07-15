import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";
import { createDefaultRloginSettings } from "../../utils/rlogin/rloginSettings";

const mocks = vi.hoisted(() => {
  class TerminalMock {
    write = vi.fn();
    reset = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    private dataCallback: (data: string) => void = () => undefined;
    private resizeCallback: (size: { cols: number; rows: number }) => void =
      () => undefined;
    constructor() {
      terminals.push(this);
    }
    onData(callback: (data: string) => void) {
      this.dataCallback = callback;
      return { dispose: vi.fn() };
    }
    onResize(callback: (size: { cols: number; rows: number }) => void) {
      this.resizeCallback = callback;
      return { dispose: vi.fn() };
    }
    emitData(data: string) {
      this.dataCallback(data);
    }
    emitResize(cols: number, rows: number) {
      this.resizeCallback({ cols, rows });
    }
  }
  class FitAddonMock {
    fit = vi.fn();
  }
  const terminals: TerminalMock[] = [];
  return { TerminalMock, FitAddonMock, terminals, hook: vi.fn() };
});

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.TerminalMock }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: mocks.FitAddonMock }));
vi.mock("../../hooks/protocol/useRloginSession", () => ({
  useRloginSession: (...args: unknown[]) => mocks.hook(...args),
}));

import { RloginClient } from "./RloginClient";

const session: ConnectionSession = {
  id: "frontend-rlogin-1",
  connectionId: "connection-rlogin-1",
  name: "Legacy host",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "rlogin",
  hostname: "legacy.example.test",
};

const createModel = () => {
  const settings = createDefaultRloginSettings();
  settings.plaintextAcknowledgement = {
    version: 1,
    scope: "rlogin-plaintext-v1",
    acknowledged: true,
    acknowledgedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    status: "connected" as const,
    error: null,
    backendSessionId: "backend-rlogin-1",
    settings,
    outputFrames: [
      {
        sessionId: "backend-rlogin-1",
        sequence: 1,
        byteLength: 6,
        prefixTruncated: false,
        replayed: false,
        data: new TextEncoder().encode("remote"),
      },
    ],
    replayTruncated: false,
    stats: {
      handshakeBytesSent: 24,
      terminalBytesSent: 0,
      terminalBytesReceived: 6,
      protocolBytesSent: 0,
      resizeFramesSent: 0,
      urgentControlsReceived: 0,
      discardedOutputBytes: 0,
    },
    capabilities: {
      directRoute: true,
      proxyRoutes: false,
      reservedSourcePort: false,
      outOfBandControl: false,
      limitationMessages: [],
    },
    sourcePortFallback: false,
    diagnosisWarnings: [] as string[],
    localAddress: "127.0.0.1:42000",
    remoteAddress: "127.0.0.1:513",
    sendInput: vi.fn().mockResolvedValue({ lossy: false }),
    resize: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
};

beforeEach(() => {
  mocks.terminals.length = 0;
  mocks.hook.mockReset();
  mocks.hook.mockReturnValue(createModel());
});

describe("RloginClient", () => {
  it("writes remote output only and forwards terminal input without local echo", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<RloginClient session={session} />);
    const terminal = mocks.terminals[0];

    expect(terminal.write).toHaveBeenCalledWith("remote");
    expect(terminal.write).toHaveBeenCalledTimes(1);
    await act(async () => terminal.emitData("ls\r"));
    await waitFor(() => expect(model.sendInput).toHaveBeenCalledWith("ls\r"));
    expect(terminal.write).toHaveBeenCalledTimes(1);
  });

  it("forwards xterm resizes and exposes capability/plaintext status accessibly", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<RloginClient session={session} />);

    expect(
      screen.getByRole("region", {
        name: "RLogin session to legacy.example.test",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("application", { name: "RLogin terminal" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Plaintext/).parentElement).toHaveTextContent(
      "Plaintext acknowledged",
    );
    expect(screen.getByText(/Proxy unavailable/)).toHaveTextContent(
      "Reserved source port unavailable",
    );

    await act(async () => mocks.terminals[0].emitResize(120, 40));
    expect(model.resize).toHaveBeenCalledWith(120, 40, 0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(model.disconnect).toHaveBeenCalledOnce());
  });
});
