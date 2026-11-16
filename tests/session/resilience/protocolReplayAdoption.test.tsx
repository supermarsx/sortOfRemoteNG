/**
 * Mocked-invoke reload simulation for telnet and serial adoption: a fresh hook
 * (new document) is handed a backendSessionId the backend still holds, replays
 * the ring snapshot, then dedupes live events by generation/sequence without
 * delaying them.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../../src/types/connection/connection";
import type { SerialBackendSession } from "../../../src/types/protocols/serial";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      mocks.listeners.set(eventName, handler);
      return vi.fn();
    },
  ),
}));
vi.mock("../../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import { useTelnetSession } from "../../../src/hooks/protocol/useTelnetSession";
import { useSerialSession } from "../../../src/hooks/protocol/useSerialSession";
import { resetCloseIntentForTests } from "../../../src/utils/session/closeIntent";

const telnetConnection: Connection = {
  id: "conn-telnet",
  name: "Switch",
  protocol: "telnet",
  hostname: "switch.example.test",
  port: 23,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const serialConnection: Connection = {
  id: "conn-serial",
  name: "Console",
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
    flowControl: "none",
    readTimeoutMs: 100,
    writeTimeoutMs: 1000,
    rxBufferSize: 8192,
    txBufferSize: 4096,
    dtrOnOpen: true,
    rtsOnOpen: false,
    lineEnding: "crLf",
    charDelayMs: 0,
    localEcho: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const tab = (
  connection: Connection,
  backendSessionId: string,
): ConnectionSession => ({
  id: `tab-${connection.protocol}`,
  connectionId: connection.id,
  name: connection.name,
  status: "connected",
  startTime: new Date(0),
  protocol: connection.protocol,
  hostname: connection.hostname,
  backendSessionId,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const emit = (name: string, payload: unknown) => {
  const handler = mocks.listeners.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
};

const snapshotPage = (over: Record<string, unknown>) => ({
  session_id: "x",
  data: "",
  encoding: "utf8",
  generation: 3,
  sequence_start: 0,
  sequence_end: 0,
  retained_start: 0,
  dropped_bytes: 0,
  gap: false,
  generation_changed: false,
  has_more: false,
  ...over,
});

const calls = (command: string) =>
  mocks.invoke.mock.calls.filter(([name]) => name === command);

beforeEach(() => {
  resetCloseIntentForTests();
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.listeners.clear();
  mocks.useConnections.mockReturnValue({
    state: { connections: [telnetConnection, serialConnection], sessions: [] },
    dispatch: mocks.dispatch,
  });
});

describe("telnet adoption after a full reload", () => {
  it("replays the ring, holds live events meanwhile, and dedupes by generation/sequence", async () => {
    const snapshot = deferred<unknown>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "is_telnet_connected") return Promise.resolve(true);
      if (command === "telnet_get_output_snapshot") return snapshot.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() =>
      useTelnetSession(tab(telnetConnection, "tn-live")),
    );
    await waitFor(() =>
      expect(result.current.requiresInsecureApproval).toBe(true),
    );
    act(() => result.current.approveInsecureTransport());
    await waitFor(() =>
      expect(calls("telnet_get_output_snapshot")).toHaveLength(1),
    );
    expect(calls("telnet_get_output_snapshot")[0][1]).toEqual({
      sessionId: "tn-live",
    });

    // Live events while the snapshot is in flight: one already inside it, one newer.
    await act(async () => {
      emit("telnet-output", {
        session_id: "tn-live",
        data: "hello ",
        generation: 3,
        sequence_start: 0,
        sequence_end: 6,
      });
      emit("telnet-output", {
        session_id: "tn-live",
        data: "world",
        generation: 3,
        sequence_start: 6,
        sequence_end: 11,
      });
    });
    expect(result.current.outputChunks).toEqual([]);

    await act(async () => {
      snapshot.resolve(
        snapshotPage({ data: "hello ", sequence_end: 6, gap: true }),
      );
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.outputChunks).toEqual(["hello ", "world"]);
    expect(result.current.replayGap).toBe(true);

    // After adoption: pass-through, duplicates of replayed output dropped.
    await act(async () => {
      emit("telnet-output", {
        session_id: "tn-live",
        data: "hello ",
        generation: 3,
        sequence_start: 0,
        sequence_end: 6,
      });
      emit("telnet-output", {
        session_id: "tn-live",
        data: "!",
        generation: 3,
        sequence_start: 11,
        sequence_end: 12,
      });
      // Old build / other generation: never dropped.
      emit("telnet-output", { session_id: "tn-live", data: "?" });
      emit("telnet-output", {
        session_id: "tn-live",
        data: "#",
        generation: 4,
        sequence_start: 0,
        sequence_end: 1,
      });
    });
    expect(result.current.outputChunks).toEqual([
      "hello ",
      "world",
      "!",
      "?",
      "#",
    ]);
    // Adopted, not re-dialled or disconnected.
    expect(calls("connect_telnet")).toHaveLength(0);
    expect(calls("disconnect_telnet")).toHaveLength(0);
  });

  it("adopts without history when the snapshot command fails", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "is_telnet_connected") return Promise.resolve(true);
      if (command === "telnet_get_output_snapshot")
        return Promise.reject(new Error("Session not found"));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() =>
      useTelnetSession(tab(telnetConnection, "tn-live")),
    );
    await waitFor(() =>
      expect(result.current.requiresInsecureApproval).toBe(true),
    );
    act(() => result.current.approveInsecureTransport());
    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      emit("telnet-output", {
        session_id: "tn-live",
        data: "x",
        generation: 1,
        sequence_end: 1,
      });
    });
    expect(result.current.outputChunks).toEqual(["x"]);
    expect(calls("connect_telnet")).toHaveLength(0);
  });
});

describe("serial adoption after a full reload", () => {
  const b64 = (text: string) => btoa(text);
  const text = (chunks: readonly Uint8Array[]) =>
    chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  const liveBackend: SerialBackendSession = {
    id: "ser-live",
    portName: "COM7",
    configShorthand: "115200-8N1",
    state: "connected",
    label: "Console",
    connectedAt: "2026-01-01T00:00:00.000Z",
    bytesRx: 0,
    bytesTx: 0,
    controlLines: {
      dtr: true,
      rts: false,
      cts: false,
      dsr: false,
      ri: false,
      dcd: false,
    },
  };

  it("replays the ring and drops live chunks already inside it", async () => {
    const snapshot = deferred<unknown>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "serial_get_session_info")
        return Promise.resolve(liveBackend);
      if (command === "serial_get_output_snapshot") return snapshot.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() =>
      useSerialSession(tab(serialConnection, "ser-live")),
    );
    await waitFor(() =>
      expect(calls("serial_get_output_snapshot")).toHaveLength(1),
    );
    expect(calls("serial_get_output_snapshot")[0][1]).toEqual({
      sessionId: "ser-live",
    });

    await act(async () => {
      emit("serial:output", {
        sessionId: "ser-live",
        data: b64("boot\r\n"),
        text: "boot\r\n",
        generation: 2,
        sequenceStart: 0,
        sequenceEnd: 6,
      });
      emit("serial:output", {
        sessionId: "ser-live",
        data: b64("login: "),
        text: "login: ",
        generation: 2,
        sequenceStart: 6,
        sequenceEnd: 13,
      });
    });
    expect(text(result.current.outputChunks)).toBe("");

    await act(async () => {
      snapshot.resolve(
        snapshotPage({
          data: b64("boot\r\n"),
          encoding: "base64",
          generation: 2,
          sequence_end: 6,
        }),
      );
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(text(result.current.outputChunks)).toBe("boot\r\nlogin: ");

    // Live path stays pass-through; replayed positions are dropped; echo has no position.
    await act(async () => {
      emit("serial:output", {
        sessionId: "ser-live",
        data: b64("boot\r\n"),
        text: "",
        generation: 2,
        sequenceStart: 0,
        sequenceEnd: 6,
      });
      emit("serial:output", {
        sessionId: "ser-live",
        data: b64("root"),
        text: "root",
        generation: 2,
        sequenceStart: 13,
        sequenceEnd: 17,
      });
      emit("serial:echo", {
        sessionId: "ser-live",
        data: b64("!"),
        text: "!",
      });
    });
    expect(text(result.current.outputChunks)).toBe("boot\r\nlogin: root!");
    expect(calls("serial_connect")).toHaveLength(0);
    expect(calls("serial_disconnect")).toHaveLength(0);
  });
});
