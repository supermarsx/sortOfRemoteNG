import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  state: {
    sessions: [] as ConnectionSession[],
    connections: [] as Connection[],
  },
  dispatch: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mocks.listen(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

vi.mock("../../src/utils/recording/scriptEngine", () => ({
  ScriptEngine: {
    getInstance: () => ({ executeScriptsForTrigger: vi.fn() }),
  },
}));

vi.mock("../../src/utils/connection/statusChecker", () => ({
  StatusChecker: {
    getInstance: () => ({
      startChecking: vi.fn(),
      stopChecking: vi.fn(),
      cleanup: vi.fn(),
    }),
  },
}));

import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { useSessionManager } from "../../src/hooks/session/useSessionManager";
import { useSerialSession } from "../../src/hooks/protocol/useSerialSession";

const backend = {
  id: "backend-serial-qc",
  portName: "COM3",
  configShorthand: "",
  state: "connected",
  label: "Quick Connect",
  connectedAt: "2026-01-01T00:00:00.000Z",
  bytesRx: 0,
  bytesTx: 0,
  controlLines: {
    dtr: false,
    rts: false,
    cts: false,
    dsr: false,
    ri: false,
    dcd: false,
  },
};

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  SettingsManager.resetInstance();
  SettingsManager.getInstance().applyInMemory({
    maxConcurrentConnections: 10,
    retryAttempts: 0,
    retryDelay: 1,
    connectionTimeout: 0,
    singleConnectionMode: false,
    openConnectionInBackground: false,
    notifyOnConnect: false,
    notifyOnReconnect: false,
    notifyOnDisconnect: false,
    notifyOnError: false,
    notificationSound: false,
  });
  mocks.state = { sessions: [], connections: [] };
  mocks.dispatch.mockReset();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.listen.mockImplementation(async () => vi.fn());
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "serial_connect") return Promise.resolve(backend);
    if (command === "serial_read_control_lines") {
      return Promise.resolve(backend.controlLines);
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  clearRuntimeConnectionsForTests();
});

async function quickConnectThenOpen(hostname: string) {
  const manager = renderHook(() => useSessionManager());
  await act(async () => {
    await manager.result.current.handleQuickConnect({
      hostname,
      protocol: "serial",
    });
  });
  const added = mocks.dispatch.mock.calls.find(
    ([action]) => action.type === "ADD_SESSION",
  )?.[0].payload as ConnectionSession | undefined;
  expect(added).toBeDefined();
  expect(added!.protocol).toBe("serial");
  const runtime = resolveRuntimeConnection([], added!.connectionId);
  expect(runtime?.protocol).toBe("serial");

  // The viewer mounts the serial hook for the new session.
  const serial = renderHook(() => useSerialSession(added!));
  await waitFor(() => expect(serial.result.current.status).toBe("connected"));
  return serial;
}

function connectConfig() {
  const call = mocks.invoke.mock.calls.find(
    ([command]) => command === "serial_connect",
  );
  expect(call).toBeDefined();
  return (call![1] as { config: Record<string, unknown> }).config;
}

describe("Quick Connect serial end to end (mocked invoke)", () => {
  it("opens COM3:115200 as a serial session via serial_connect", async () => {
    await quickConnectThenOpen("COM3:115200");
    const config = connectConfig();
    expect(config.portName).toBe("COM3");
    expect(config.baudRate).toBe("115200");
  });

  it("opens serial://COM3?baud=9600 as a serial session via serial_connect", async () => {
    await quickConnectThenOpen("serial://COM3?baud=9600");
    const config = connectConfig();
    expect(config.portName).toBe("COM3");
    expect(config.baudRate).toBe("9600");
  });

  it("rejects a hostile serial address without opening a session", async () => {
    const manager = renderHook(() => useSessionManager());
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = manager.result.current.handleQuickConnect({
        hostname: "serial:///etc/shadow",
        protocol: "serial",
      });
      await Promise.resolve();
    });
    // The error alert is awaiting user acknowledgement; nothing was opened.
    expect(manager.result.current.confirmDialog).not.toBeNull();
    expect(
      mocks.dispatch.mock.calls.some(([a]) => a.type === "ADD_SESSION"),
    ).toBe(false);
    expect(mocks.invoke.mock.calls.some(([c]) => c === "serial_connect")).toBe(
      false,
    );
    void pending;
  });
});
