import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  fit: vi.fn(),
  write: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
  onData: vi.fn(),
  inputHandler: null as ((data: string) => void) | null,
}));

vi.mock("../../hooks/protocol/useSerialSession", () => ({
  useSerialSession: (...args: unknown[]) => mocks.hook(...args),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      mocks.fit();
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    focus() {}
    write(data: Uint8Array) {
      mocks.write(data);
    }
    reset() {
      mocks.reset();
    }
    dispose() {
      mocks.dispose();
    }
    onData(handler: (data: string) => void) {
      return mocks.onData(handler);
    }
  },
}));

import { SerialClient } from "./SerialClient";

const session: ConnectionSession = {
  id: "frontend-serial-1",
  connectionId: "connection-serial-1",
  name: "Console cable",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "serial",
  hostname: "COM7",
};

const createModel = () => ({
  status: "connected" as const,
  error: null as string | null,
  backendSessionId: "backend-serial-1",
  settings: {
    version: 1 as const,
    portName: "COM7",
    baudRate: 115200,
    dataBits: "8" as const,
    parity: "none" as const,
    stopBits: "1" as const,
    flowControl: "rtsCts" as const,
    readTimeoutMs: 100,
    writeTimeoutMs: 1000,
    rxBufferSize: 4096,
    txBufferSize: 4096,
    dtrOnOpen: true,
    rtsOnOpen: false,
    lineEnding: "crLf" as const,
    charDelayMs: 0,
    localEcho: false,
  },
  outputChunks: [Uint8Array.of(0x41, 0x00, 0xff)] as readonly Uint8Array[],
  controlLines: {
    dtr: false,
    rts: false,
    cts: true,
    dsr: false,
    ri: false,
    dcd: true,
  },
  requestedDtr: true,
  requestedRts: false,
  sendBytes: vi.fn().mockResolvedValue(undefined),
  sendInput: vi.fn().mockResolvedValue(undefined),
  sendBreak: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  setDtr: vi.fn().mockResolvedValue(undefined),
  setRts: vi.fn().mockResolvedValue(undefined),
  refreshControlLines: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  mocks.hook.mockReset();
  mocks.fit.mockReset();
  mocks.write.mockReset();
  mocks.reset.mockReset();
  mocks.dispose.mockReset();
  mocks.onData.mockReset();
  mocks.inputHandler = null;
  mocks.onData.mockImplementation((handler: (data: string) => void) => {
    mocks.inputHandler = handler;
    return { dispose: vi.fn() };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe("SerialClient", () => {
  it("renders native status and writes exact binary output to xterm", () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<SerialClient session={session} />);

    expect(screen.getByTestId("serial-client")).toHaveTextContent(
      "Serial · COM7",
    );
    expect(screen.getByTestId("serial-client")).toHaveTextContent("115200-8N1");
    expect(
      screen.getByLabelText("Serial input control lines"),
    ).toHaveTextContent("CTS");
    expect(mocks.write).toHaveBeenCalledWith(model.outputChunks[0]);
    expect(
      screen.getByText(/Terminal resizing is local only/),
    ).toBeInTheDocument();
  });

  it("sends terminal data and exposes only supported serial controls", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<SerialClient session={session} />);

    mocks.inputHandler?.("A\r");
    fireEvent.click(screen.getByRole("button", { name: "Lines" }));
    fireEvent.click(screen.getByRole("button", { name: "BREAK" }));
    fireEvent.click(screen.getByRole("button", { name: "Flush" }));
    fireEvent.click(screen.getByRole("button", { name: "DTR requested on" }));
    fireEvent.click(screen.getByRole("button", { name: "RTS requested off" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(model.sendInput).toHaveBeenCalledWith("A\r"));
    expect(model.refreshControlLines).toHaveBeenCalledOnce();
    expect(model.sendBreak).toHaveBeenCalledWith();
    expect(model.flush).toHaveBeenCalledOnce();
    expect(model.setDtr).toHaveBeenCalledWith(false);
    expect(model.setRts).toHaveBeenCalledWith(true);
    expect(model.disconnect).toHaveBeenCalledOnce();
    expect(model).not.toHaveProperty("resize");
  });

  it("labels DTR and RTS as requested rather than confirmed state", () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<SerialClient session={session} />);

    expect(
      screen.getByRole("button", { name: "DTR requested on" }),
    ).toHaveAttribute("title", expect.stringContaining("cannot confirm"));
    expect(
      screen.getByRole("button", { name: "RTS requested off" }),
    ).toHaveAttribute("title", expect.stringContaining("cannot confirm"));
  });
});
