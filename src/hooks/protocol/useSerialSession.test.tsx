import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  serialHostnameFor,
  type SerialBackendSession,
  type SerialPortSelection,
} from "../../types/protocols/serial";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisteners: [] as ReturnType<typeof vi.fn>[],
  rawWrites: [] as number[][],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mocks.listen(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import {
  describeSerialConnectError,
  encodeSerialTerminalInput,
  useSerialSession,
} from "./useSerialSession";

const connection: Connection = {
  id: "connection-serial-1",
  name: "Console cable",
  protocol: "serial",
  hostname: "COM7",
  port: 0,
  isGroup: false,
  serialSettings: {
    version: 1,
    portName: "COM7",
    portSelection: { mode: "fixed" },
    baudRate: 115200,
    dataBits: "8",
    parity: "none",
    stopBits: "1",
    flowControl: "rtsCts",
    readTimeoutMs: 100,
    writeTimeoutMs: 1000,
    rxBufferSize: 8192,
    txBufferSize: 4096,
    dtrOnOpen: true,
    rtsOnOpen: false,
    lineEnding: "crLf",
    charDelayMs: 2,
    localEcho: true,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const backend: SerialBackendSession = {
  id: "backend-serial-1",
  portName: "COM7",
  configShorthand: "115200-8N1 RTS/CTS",
  state: "connected",
  label: "Console cable",
  connectedAt: "2026-01-01T00:00:00.000Z",
  bytesRx: 0,
  bytesTx: 0,
  controlLines: {
    dtr: false,
    rts: false,
    cts: true,
    dsr: false,
    ri: false,
    dcd: true,
  },
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-serial-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "serial",
  hostname: "COM7",
  ...patch,
});

const withSelection = (
  portSelection: SerialPortSelection,
  portName = connection.serialSettings!.portName,
): Connection => ({
  ...connection,
  hostname: serialHostnameFor({ portName, portSelection }),
  serialSettings: { ...connection.serialSettings!, portName, portSelection },
});

const useConnection = (value: Connection) => {
  mocks.useConnections.mockReturnValue({
    state: { connections: [value], sessions: [] },
    dispatch: mocks.dispatch,
  });
};

const emit = (eventName: string, payload: unknown) => {
  const handler = mocks.listeners.get(eventName);
  if (!handler) throw new Error(`No listener registered for ${eventName}`);
  handler({ payload });
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.listen.mockReset();
  mocks.listeners.clear();
  mocks.unlisteners = [];
  mocks.rawWrites = [];
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.listen.mockImplementation(
    async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      mocks.listeners.set(eventName, handler);
      const unlisten = vi.fn();
      mocks.unlisteners.push(unlisten);
      return unlisten;
    },
  );
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "serial_connect") return Promise.resolve(backend);
    if (command === "serial_read_control_lines") {
      return Promise.resolve(backend.controlLines);
    }
    if (command === "serial_send_raw") {
      const data = (args as { data?: number[] } | undefined)?.data;
      if (Array.isArray(data)) mocks.rawWrites.push([...data]);
    }
    return Promise.resolve(undefined);
  });
});

describe("useSerialSession", () => {
  it("connects with the exact native config and keeps configuration off session state", async () => {
    const { result } = renderHook(() => useSerialSession(createSession()));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("serial_connect", {
      config: {
        portName: "COM7",
        portSelection: { mode: "fixed" },
        baudRate: "115200",
        dataBits: "8",
        parity: "none",
        stopBits: "1",
        flowControl: "rtsCts",
        readTimeoutMs: 100,
        writeTimeoutMs: 1000,
        rxBufferSize: 8192,
        txBufferSize: 4096,
        dtrOnOpen: true,
        rtsOnOpen: false,
        lineEnding: "crLf",
        label: "Console cable",
        charDelayMs: 2,
        localEcho: true,
      },
    });

    const connectedAction = mocks.dispatch.mock.calls.find(
      ([action]) => action.payload?.status === "connected",
    )?.[0];
    expect(connectedAction).toEqual({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "frontend-serial-1",
        backendSessionId: "backend-serial-1",
        status: "connected",
      }),
    });
    expect(connectedAction.payload).not.toHaveProperty("serialSettings");
    expect(connectedAction.payload).not.toHaveProperty("password");
    expect(connectedAction.payload.hostname).toBe("COM7");
    expect(result.current.resolvedPortName).toBe("COM7");
    expect(result.current.autoSelected).toBe(false);
    expect(result.current.selectionMode).toBe("fixed");
  });

  it("sends a blank portName plus the selection for firstUsb and adopts the resolved port", async () => {
    useConnection(withSelection({ mode: "firstUsb" }, ""));
    mocks.invoke.mockImplementation((command: string) =>
      command === "serial_connect"
        ? Promise.resolve({
            ...backend,
            portName: "COM7",
            autoSelected: true,
            portDisplayName: "COM7 - FTDI FT232R",
          })
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() =>
      useSerialSession(createSession({ hostname: "auto:first-usb" })),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("serial_connect", {
      config: expect.objectContaining({
        portName: "",
        portSelection: { mode: "firstUsb" },
      }),
    });
    const connectedAction = mocks.dispatch.mock.calls.find(
      ([action]) => action.payload?.status === "connected",
    )?.[0];
    expect(connectedAction).toEqual({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "frontend-serial-1",
        backendSessionId: "backend-serial-1",
        status: "connected",
        hostname: "COM7",
      }),
    });
    expect(result.current.resolvedPortName).toBe("COM7");
    expect(result.current.resolvedDisplayName).toBe("COM7 - FTDI FT232R");
    expect(result.current.autoSelected).toBe(true);
    expect(result.current.selectionMode).toBe("firstUsb");
  });

  it("refuses a fixed selection with no port before invoking the backend", async () => {
    useConnection(withSelection({ mode: "fixed" }, ""));
    const { result } = renderHook(() =>
      useSerialSession(createSession({ hostname: "" })),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "Choose a local serial device before connecting.",
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "serial_connect",
      expect.anything(),
    );
  });

  it("refuses a match selection without filters before invoking the backend", async () => {
    useConnection(withSelection({ mode: "match" }, ""));
    const { result } = renderHook(() =>
      useSerialSession(createSession({ hostname: "auto:match" })),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "Add a VID, PID, or name filter for the matching serial device.",
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "serial_connect",
      expect.anything(),
    );
  });

  it("maps a PortNotFound rejection to a friendly error and keeps the detail", async () => {
    useConnection(withSelection({ mode: "firstUsb" }, ""));
    mocks.invoke.mockImplementation((command: string) =>
      command === "serial_connect"
        ? Promise.reject(
            'PortNotFound: no serial device found for mode "first USB device"; seen 1 device: COM1 (native)',
          )
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() =>
      useSerialSession(createSession({ hostname: "auto:first-usb" })),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("No serial device is attached");
    expect(result.current.error).toContain('"first USB"');
    expect(result.current.error).toContain("seen 1 device: COM1 (native)");
    expect(result.current.error).not.toContain("PortNotFound:");
    expect(result.current.resolvedPortName).toBeNull();
    expect(result.current.autoSelected).toBe(false);
    const errorAction = mocks.dispatch.mock.calls.find(
      ([action]) => action.payload?.status === "error",
    )?.[0];
    expect(errorAction.payload.errorMessage).toContain(
      "No serial device is attached",
    );
  });

  it("re-resolves the device on reconnect by calling serial_connect again", async () => {
    useConnection(withSelection({ mode: "firstUsb" }, ""));
    let attempt = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== "serial_connect") return Promise.resolve(undefined);
      attempt += 1;
      return Promise.resolve({
        ...backend,
        id: `backend-serial-${attempt}`,
        portName: attempt === 1 ? "COM7" : "COM9",
        autoSelected: true,
        portDisplayName: null,
      });
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useSerialSession(createSession({ id, hostname: "auto:first-usb" })),
      { initialProps: { id: "frontend-serial-1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.resolvedPortName).toBe("COM7");

    rerender({ id: "frontend-serial-2" });
    await waitFor(() => expect(result.current.resolvedPortName).toBe("COM9"));
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "serial_connect",
      ),
    ).toHaveLength(2);
    expect(mocks.invoke).toHaveBeenCalledWith("serial_disconnect", {
      sessionId: "backend-serial-1",
    });
    expect(result.current.resolvedDisplayName).toBeNull();
    expect(result.current.status).toBe("connected");
  });

  it("sends raw bytes, relies on one backend echo, and exposes supported controls", async () => {
    const { result } = renderHook(() => useSerialSession(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    await act(async () => {
      await result.current.sendInput("A\r");
      await result.current.sendBreak();
      await result.current.flush();
      await result.current.setDtr(false);
      await result.current.setRts(true);
      await result.current.refreshControlLines();
    });

    expect(mocks.rawWrites).toContainEqual([65, 13, 10]);
    expect(result.current.outputChunks).toHaveLength(0);

    act(() => {
      emit("serial:echo", {
        sessionId: "backend-serial-1",
        data: "QQ0K",
        text: "A\r\n",
      });
    });
    expect(result.current.outputChunks).toHaveLength(1);
    expect(Array.from(result.current.outputChunks[0])).toEqual([65, 13, 10]);
    expect(mocks.invoke).toHaveBeenCalledWith("serial_send_break", {
      sessionId: "backend-serial-1",
      durationMs: 250,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("serial_flush", {
      sessionId: "backend-serial-1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("serial_set_dtr", {
      sessionId: "backend-serial-1",
      state: false,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("serial_set_rts", {
      sessionId: "backend-serial-1",
      state: true,
    });
    expect(result.current.requestedDtr).toBe(false);
    expect(result.current.requestedRts).toBe(true);
    expect(
      mocks.invoke.mock.calls.some(([command]) =>
        String(command).toLowerCase().includes("resize"),
      ),
    ).toBe(false);
  });

  it("reattaches, handles closure, disconnects, and removes every listener", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "serial_get_session_info") {
        return Promise.resolve({ ...backend, id: "backend-serial-existing" });
      }
      return Promise.resolve(undefined);
    });
    const { result, unmount } = renderHook(() =>
      useSerialSession(
        createSession({
          status: "connected",
          backendSessionId: "backend-serial-existing",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "serial_connect",
      expect.anything(),
    );

    act(() => {
      emit("serial:closed", {
        sessionId: "backend-serial-existing",
        reason: "device unplugged",
      });
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.error).toBe("device unplugged");

    unmount();
    expect(mocks.unlisteners).toHaveLength(5);
    mocks.unlisteners.forEach((unlisten) =>
      expect(unlisten).toHaveBeenCalledTimes(1),
    );
  });

  it("cleans partial listener registration when a later listener fails", async () => {
    let registration = 0;
    mocks.listen.mockImplementation(async () => {
      registration += 1;
      if (registration === 3) throw new Error("event bridge unavailable");
      const unlisten = vi.fn();
      mocks.unlisteners.push(unlisten);
      return unlisten;
    });

    const { result } = renderHook(() => useSerialSession(createSession()));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("event bridge unavailable");
    expect(mocks.unlisteners).toHaveLength(2);
    mocks.unlisteners.forEach((unlisten) =>
      expect(unlisten).toHaveBeenCalledTimes(1),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "serial_connect",
      expect.anything(),
    );
  });
});

describe("describeSerialConnectError", () => {
  it("rewrites only PortNotFound-prefixed messages", () => {
    expect(
      describeSerialConnectError("PortNotFound: nothing", "firstAny"),
    ).toBe(
      'No serial device is attached that matches "first device". Plug in the adapter and reconnect.\nnothing',
    );
    expect(describeSerialConnectError("PortNotFound:", "match")).toBe(
      'No serial device is attached that matches "match". Plug in the adapter and reconnect.',
    );
    expect(describeSerialConnectError("PortBusy: COM7", "firstUsb")).toBe(
      "PortBusy: COM7",
    );
  });
});

describe("encodeSerialTerminalInput", () => {
  it("maps xterm Enter sequences to the configured serial line ending", () => {
    expect(Array.from(encodeSerialTerminalInput("A\r", "crLf"))).toEqual([
      65, 13, 10,
    ]);
    expect(Array.from(encodeSerialTerminalInput("A\r", "lf"))).toEqual([
      65, 10,
    ]);
    expect(Array.from(encodeSerialTerminalInput("A\r", "none"))).toEqual([65]);
  });
});
