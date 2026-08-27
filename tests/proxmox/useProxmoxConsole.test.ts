import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  decodeConsoleChunk,
  splitConsoleInput,
  useProxmoxConsole,
  useProxmoxConsoleLauncher,
  PROXMOX_CONSOLE_MAX_SEND_BYTES,
  type ProxmoxConsoleTarget,
} from "../../src/hooks/proxmox/useProxmoxConsole";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();
const unlistenSpies: Array<ReturnType<typeof vi.fn>> = [];

const emit = (event: string, payload: unknown) => {
  for (const handler of handlers.get(event) ?? []) handler({ payload });
};

const b64 = (text: string) =>
  globalThis.btoa(String.fromCharCode(...new TextEncoder().encode(text)));

const HANDLE = {
  sessionId: "sess-1",
  node: "pve1",
  vmid: 100,
  vmType: "qemu" as const,
  user: "root@pam",
  port: "5900",
};

const TARGET: ProxmoxConsoleTarget = {
  node: "pve1",
  vmid: 100,
  vmType: "qemu",
};

/** Flushes the rAF-batched output pump. */
const flushFrames = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
};

describe("useProxmoxConsole", () => {
  beforeEach(() => {
    handlers.clear();
    unlistenSpies.length = 0;
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockListen.mockImplementation((async (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      const unlisten = vi.fn(() => {
        set.delete(handler);
      });
      unlistenSpies.push(unlisten);
      return unlisten;
    }) as unknown as typeof listen);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open") return HANDLE;
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("stays dormant without a target", async () => {
    const { result } = renderHook(() => useProxmoxConsole(null));
    expect(result.current.status).toBe("idle");
    await waitFor(() => expect(mockListen).not.toHaveBeenCalled());
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("opens a relay session for the target and reports the handle", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_open", {
      node: "pve1",
      vmid: 100,
      vmType: "qemu",
    });
    expect(result.current.handle).toEqual(HANDLE);
    expect(result.current.sessionId).toBe("sess-1");
  });

  it("omits vmid for a node shell", async () => {
    const { result } = renderHook(() =>
      useProxmoxConsole({ node: "pve1", vmType: "node" }),
    );
    await waitFor(() => expect(result.current.status).toBe("open"));
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_open", {
      node: "pve1",
      vmid: undefined,
      vmType: "node",
    });
  });

  it("batches decoded output into one frame and ignores other sessions", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));

    act(() => {
      emit("proxmox-console-output", { sessionId: "sess-1", data: b64("he") });
      emit("proxmox-console-output", { sessionId: "sess-1", data: b64("llo") });
      emit("proxmox-console-output", { sessionId: "other", data: b64("NOPE") });
    });
    await flushFrames();

    expect(result.current.output.seq).toBe(1);
    const joined = result.current.output.chunks
      .map((chunk) => new TextDecoder().decode(chunk))
      .join("");
    expect(joined).toBe("hello");
  });

  it("keeps output that arrives before proxmox_console_open resolves", async () => {
    let releaseOpen: (() => void) | null = null;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open") {
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
        return HANDLE;
      }
      return undefined;
    });

    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() =>
      expect(handlers.get("proxmox-console-output")?.size).toBe(1),
    );
    act(() => {
      emit("proxmox-console-output", {
        sessionId: "sess-1",
        data: b64("early"),
      });
    });
    await act(async () => {
      releaseOpen?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("open"));
    await flushFrames();

    expect(
      result.current.output.chunks
        .map((chunk) => new TextDecoder().decode(chunk))
        .join(""),
    ).toBe("early");
  });

  it("treats a relay error as a non-fatal notice", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => {
      emit("proxmox-console-error", {
        sessionId: "sess-1",
        message: "dropped 12 bytes",
      });
    });
    await waitFor(() => expect(result.current.notice).toBe("dropped 12 bytes"));
    expect(result.current.status).toBe("open");
    act(() => result.current.dismissNotice());
    await waitFor(() => expect(result.current.notice).toBeNull());
  });

  it("moves to closed with the relay's reason", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => {
      emit("proxmox-console-closed", {
        sessionId: "sess-1",
        reason: "Console closed by Proxmox VE",
      });
    });
    await waitFor(() => expect(result.current.status).toBe("closed"));
    expect(result.current.closeReason).toBe("Console closed by Proxmox VE");
  });

  it("surfaces an open failure as a fatal error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open") {
        throw "Too many open Proxmox consoles (limit 16); close one first";
      }
      return undefined;
    });
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("Too many open Proxmox consoles");
  });

  it("sends input as plain UTF-8 against the session id", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    await act(async () => {
      await result.current.send("ls -al\r");
    });
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_send", {
      sessionId: "sess-1",
      data: "ls -al\r",
    });
  });

  it("splits input larger than the relay's 64 KiB ceiling", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    const big = "x".repeat(PROXMOX_CONSOLE_MAX_SEND_BYTES + 10);
    await act(async () => {
      await result.current.send(big);
    });
    const sends = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "proxmox_console_send",
    );
    expect(sends).toHaveLength(2);
    expect((sends[0][1] as { data: string }).data).toHaveLength(
      PROXMOX_CONSOLE_MAX_SEND_BYTES,
    );
    expect((sends[1][1] as { data: string }).data).toHaveLength(10);
  });

  it("clamps and forwards resizes", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    await act(async () => {
      await result.current.resize(120.7, 0);
    });
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_resize", {
      sessionId: "sess-1",
      cols: 120,
      rows: 1,
    });
  });

  it("closes the relay and drops every listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    unmount();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_close", {
        sessionId: "sess-1",
      }),
    );
    expect(unlistenSpies).toHaveLength(3);
    for (const spy of unlistenSpies) expect(spy).toHaveBeenCalled();
    expect(handlers.get("proxmox-console-output")?.size ?? 0).toBe(0);
  });

  it("tolerates close() on an already-closed session", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_close") {
        throw "Unknown Proxmox console session";
      }
      return HANDLE;
    });
    await act(async () => {
      await expect(result.current.close()).resolves.toBeUndefined();
    });
    expect(result.current.status).toBe("closed");
  });

  it("reconnect opens a fresh session after a close", async () => {
    const { result } = renderHook(() => useProxmoxConsole(TARGET));
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => {
      emit("proxmox-console-closed", { sessionId: "sess-1", reason: "bye" });
    });
    await waitFor(() => expect(result.current.status).toBe("closed"));

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open")
        return { ...HANDLE, sessionId: "sess-2" };
      return undefined;
    });
    act(() => result.current.reconnect());
    await waitFor(() => expect(result.current.sessionId).toBe("sess-2"));
    expect(result.current.closeReason).toBeNull();
  });

  it("closes the first session when the target changes", async () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: ProxmoxConsoleTarget }) =>
        useProxmoxConsole(target),
      { initialProps: { target: TARGET } },
    );
    await waitFor(() => expect(result.current.status).toBe("open"));
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open")
        return { ...HANDLE, sessionId: "sess-2", vmid: 101 };
      return undefined;
    });
    rerender({ target: { node: "pve1", vmid: 101, vmType: "lxc" } });
    await waitFor(() => expect(result.current.sessionId).toBe("sess-2"));
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_close", {
      sessionId: "sess-1",
    });
  });

  it("does not re-open when the caller passes a new object with the same fields", async () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: ProxmoxConsoleTarget }) =>
        useProxmoxConsole(target),
      { initialProps: { target: { ...TARGET } } },
    );
    await waitFor(() => expect(result.current.status).toBe("open"));
    rerender({ target: { ...TARGET } });
    await flushFrames();
    const opens = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "proxmox_console_open",
    );
    expect(opens).toHaveLength(1);
  });
});

describe("console payload helpers", () => {
  it("decodes base64 output to raw bytes", () => {
    expect(Array.from(decodeConsoleChunk(b64("hi")))).toEqual([104, 105]);
    expect(decodeConsoleChunk("")).toHaveLength(0);
  });

  it("round-trips bytes that are not valid UTF-8 text", () => {
    const raw = new Uint8Array([0x00, 0xff, 0x41]);
    const encoded = globalThis.btoa(String.fromCharCode(...raw));
    expect(Array.from(decodeConsoleChunk(encoded))).toEqual([0x00, 0xff, 0x41]);
  });

  it("never splits a multi-byte character across two sends", () => {
    const pieces = splitConsoleInput("é".repeat(10), 5);
    expect(pieces.join("")).toBe("é".repeat(10));
    for (const piece of pieces) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(5);
    }
  });

  it("returns nothing for empty input", () => {
    expect(splitConsoleInput("")).toEqual([]);
  });
});

describe("useProxmoxConsoleLauncher", () => {
  it("opens one overlay at a time and closes cleanly", () => {
    const { result } = renderHook(() => useProxmoxConsoleLauncher());
    expect(result.current.termTarget).toBeNull();
    expect(result.current.vncTarget).toBeNull();

    act(() => result.current.openTerm(TARGET));
    expect(result.current.termTarget).toEqual(TARGET);

    act(() =>
      result.current.openVnc({ node: "pve1", vmid: 100, vmType: "qemu" }),
    );
    expect(result.current.termTarget).toBeNull();
    expect(result.current.vncTarget).not.toBeNull();

    act(() => result.current.closeVnc());
    expect(result.current.vncTarget).toBeNull();
  });
});
