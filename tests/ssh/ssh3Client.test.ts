import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SSH3Client,
  SSHLibraryFactory,
  type SSHLibraryConfig,
} from "../../src/utils/ssh/sshLibraries";

// `@tauri-apps/api/core` is globally mocked in vitest.setup.ts; mock the event
// module here so we can capture listener registration + drive emitted events.
type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: Listener) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

const baseConfig: SSHLibraryConfig = {
  host: "ssh3.example",
  port: 443,
  username: "alice",
  password: "secret",
};

describe("SSH3Client (real ssh3_* Tauri wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    (window as any).__TAURI_INTERNALS__ = true;
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("drives connect_ssh3 + start_ssh3_shell and reports connected", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });

    const client = new SSH3Client(baseConfig);
    const onConnect = vi.fn();
    client.onConnect(onConnect);
    await client.connect();

    expect(onConnect).toHaveBeenCalledTimes(1);
    // The connection config carries the SSH3 serde shape (snake_case fields).
    const connectCall = vi
      .mocked(invoke)
      .mock.calls.find((c) => c[0] === "connect_ssh3");
    expect(connectCall).toBeTruthy();
    const cfg = (connectCall![1] as { config: Record<string, unknown> }).config;
    expect(cfg.host).toBe("ssh3.example");
    expect(cfg.port).toBe(443);
    expect(cfg.verify_server_cert).toBe(true);
    // The shell is opened against the established session.
    expect(invoke).toHaveBeenCalledWith("start_ssh3_shell", {
      sessionId: "session-1",
    });
  });

  it("routes ssh3-output events to onData (filtered by session id)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });

    const client = new SSH3Client(baseConfig);
    const onData = vi.fn();
    client.onData(onData);
    await client.connect();

    emit("ssh3-output", {
      session_id: "session-1",
      channel_id: "chan-1",
      data: "hello\n",
    });
    expect(onData).toHaveBeenCalledWith("hello\n");

    // Output for a different session must be ignored.
    emit("ssh3-output", {
      session_id: "other",
      channel_id: "chan-1",
      data: "nope",
    });
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it("surfaces ssh3-error events through onError", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });
    const client = new SSH3Client(baseConfig);
    const onError = vi.fn();
    client.onError(onError);
    await client.connect();

    emit("ssh3-error", {
      session_id: "session-1",
      channel_id: "chan-1",
      message: "read error: boom",
    });
    expect(onError).toHaveBeenCalledWith("read error: boom");
  });

  it("sends input via send_ssh3_input with the session + channel ids", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });
    const client = new SSH3Client(baseConfig);
    await client.connect();

    client.sendData("ls -la\n");
    // sendData is fire-and-forget async (dynamic import + invoke); wait for it.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("send_ssh3_input", {
        sessionId: "session-1",
        channelId: "chan-1",
        data: "ls -la\n",
      }),
    );
  });

  it("resizes via resize_ssh3_shell", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });
    const client = new SSH3Client(baseConfig);
    await client.connect();

    client.resize(120, 40);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("resize_ssh3_shell", {
        sessionId: "session-1",
        channelId: "chan-1",
        cols: 120,
        rows: 40,
      }),
    );
  });

  it("disconnect_ssh3 is called on disconnect", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3") return "session-1";
      if (cmd === "start_ssh3_shell") return "chan-1";
      return undefined;
    });
    const client = new SSH3Client(baseConfig);
    const onClose = vi.fn();
    client.onClose(onClose);
    await client.connect();

    client.disconnect();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("disconnect_ssh3", {
        sessionId: "session-1",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("propagates a real backend connect failure (no fake success)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "connect_ssh3")
        throw new Error("SSH3: QUIC connection failed: refused");
      return undefined;
    });
    const client = new SSH3Client(baseConfig);
    const onError = vi.fn();
    const onConnect = vi.fn();
    client.onError(onError);
    client.onConnect(onConnect);
    await client.connect();

    expect(onConnect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("QUIC connection failed"),
    );
    // start_ssh3_shell must NOT be attempted after a failed connect.
    expect(invoke).not.toHaveBeenCalledWith(
      "start_ssh3_shell",
      expect.anything(),
    );
  });

  it("reports an actionable error outside the Tauri runtime (no SSH2 fallback)", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const client = new SSH3Client(baseConfig);
    const onError = vi.fn();
    client.onError(onError);
    await client.connect();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("desktop (Tauri) runtime"),
    );
    // It must NOT silently invoke any ssh3 / ssh2 command.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("factory returns a real SSH3Client for type 'ssh3' (not coerced to webssh)", () => {
    const client = SSHLibraryFactory.createClient("ssh3", baseConfig);
    expect(client).toBeInstanceOf(SSH3Client);
  });
});
