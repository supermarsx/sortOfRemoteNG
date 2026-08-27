import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const terminalState = vi.hoisted(() => ({
  writes: [] as Uint8Array[],
  dataHandlers: [] as Array<(data: string) => void>,
  resizeHandlers: [] as Array<(size: { cols: number; rows: number }) => void>,
  disposed: 0,
  cols: 80,
  rows: 24,
}));
const fitSpy = vi.hoisted(() => vi.fn());

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      focus: vi.fn(),
      write: (chunk: Uint8Array) => terminalState.writes.push(chunk),
      onData: (handler: (data: string) => void) => {
        terminalState.dataHandlers.push(handler);
        return { dispose: vi.fn() };
      },
      onResize: (handler: (size: { cols: number; rows: number }) => void) => {
        terminalState.resizeHandlers.push(handler);
        return { dispose: vi.fn() };
      },
      dispose: () => {
        terminalState.disposed += 1;
      },
      get cols() {
        return terminalState.cols;
      },
      get rows() {
        return terminalState.rows;
      },
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: fitSpy };
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ProxmoxTermConsole from "../../src/components/proxmox/ProxmoxTermConsole";
import type { ProxmoxConsoleTarget } from "../../src/hooks/proxmox/useProxmoxConsole";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();

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
  label: "web-01",
};

const flushFrames = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
};

describe("ProxmoxTermConsole", () => {
  beforeEach(() => {
    handlers.clear();
    terminalState.writes = [];
    terminalState.dataHandlers = [];
    terminalState.resizeHandlers = [];
    terminalState.disposed = 0;
    terminalState.cols = 80;
    terminalState.rows = 24;
    fitSpy.mockClear();
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockListen.mockImplementation((async (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return vi.fn(() => set.delete(handler));
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

  const renderOverlay = (onClose = vi.fn()) => {
    const utils = render(
      <ProxmoxTermConsole target={TARGET} onClose={onClose} />,
    );
    return { ...utils, onClose };
  };

  it("mounts the overlay, opens the relay and shows the target", async () => {
    renderOverlay();
    expect(await screen.findByTestId("proxmox-console-overlay")).toBeTruthy();
    expect(screen.getByTestId("proxmox-console-title").textContent).toBe(
      "web-01",
    );
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_open", {
      node: "pve1",
      vmid: 100,
      vmType: "qemu",
    });
  });

  it("writes batched relay output into the terminal exactly once", async () => {
    renderOverlay();
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    act(() => {
      emit("proxmox-console-output", { sessionId: "sess-1", data: b64("ok ") });
      emit("proxmox-console-output", { sessionId: "sess-1", data: b64("go") });
    });
    await flushFrames();

    const decoded = terminalState.writes
      .map((chunk) => new TextDecoder().decode(chunk))
      .join("");
    expect(decoded).toBe("ok go");

    // A re-render must not replay the same batch.
    fireEvent.click(screen.getByTestId("proxmox-console-paste-btn"));
    await flushFrames();
    expect(
      terminalState.writes
        .map((chunk) => new TextDecoder().decode(chunk))
        .join(""),
    ).toBe("ok go");
  });

  it("forwards keystrokes only once the session is open", async () => {
    renderOverlay();
    await waitFor(() => expect(terminalState.dataHandlers.length).toBe(1));
    const onData = terminalState.dataHandlers[0];

    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    await act(async () => {
      onData("id\r");
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_send", {
        sessionId: "sess-1",
        data: "id\r",
      }),
    );
  });

  it("pushes the fitted geometry with proxmox_console_resize", async () => {
    terminalState.cols = 132;
    terminalState.rows = 43;
    renderOverlay();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_resize", {
        sessionId: "sess-1",
        cols: 132,
        rows: 43,
      }),
    );
    expect(fitSpy).toHaveBeenCalled();
  });

  it("forwards a terminal resize event to the relay", async () => {
    renderOverlay();
    await waitFor(() => expect(terminalState.resizeHandlers.length).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    await act(async () => {
      terminalState.resizeHandlers[0]({ cols: 100, rows: 30 });
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_resize", {
        sessionId: "sess-1",
        cols: 100,
        rows: 30,
      }),
    );
  });

  it("pastes the system clipboard into the relay", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("pasted") },
    });
    renderOverlay();
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    fireEvent.click(screen.getByTestId("proxmox-console-paste-btn"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_send", {
        sessionId: "sess-1",
        data: "pasted",
      }),
    );
  });

  it("shows a dismissible banner for a non-fatal relay error and keeps the terminal", async () => {
    renderOverlay();
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    act(() => {
      emit("proxmox-console-error", {
        sessionId: "sess-1",
        message: "dropped 42 bytes",
      });
    });
    expect(
      (await screen.findByTestId("proxmox-console-notice")).textContent,
    ).toContain("dropped 42 bytes");
    expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
      "Connected",
    );
    expect(screen.getByTestId("proxmox-console-terminal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("proxmox-console-notice-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("proxmox-console-notice")).toBeNull(),
    );
  });

  it("shows the close reason and a reconnect button after the relay closes", async () => {
    renderOverlay();
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    act(() => {
      emit("proxmox-console-closed", {
        sessionId: "sess-1",
        reason: "Console closed by Proxmox VE",
      });
    });
    expect(
      (await screen.findByTestId("proxmox-console-close-reason")).textContent,
    ).toContain("Console closed by Proxmox VE");

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open")
        return { ...HANDLE, sessionId: "sess-2" };
      return undefined;
    });
    fireEvent.click(screen.getByTestId("proxmox-console-reconnect-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    expect(
      mockInvoke.mock.calls.filter(([cmd]) => cmd === "proxmox_console_open"),
    ).toHaveLength(2);
    // The reconnected session is the one that now receives input.
    await act(async () => {
      terminalState.dataHandlers[0]("whoami\r");
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_send", {
        sessionId: "sess-2",
        data: "whoami\r",
      }),
    );
    // The terminal is reused across a reconnect, not torn down.
    expect(terminalState.disposed).toBe(0);
  });

  it("raises a fatal banner when the relay refuses to open", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_console_open") throw "Session expired";
      return undefined;
    });
    renderOverlay();
    expect(
      (await screen.findByTestId("proxmox-console-error")).textContent,
    ).toContain("Session expired");
    expect(screen.getByTestId("proxmox-console-reconnect-btn")).toBeTruthy();
  });

  it("closes the relay and notifies the parent from the close button", async () => {
    const onClose = vi.fn();
    renderOverlay(onClose);
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    fireEvent.click(screen.getByTestId("proxmox-console-close-btn"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_close", {
        sessionId: "sess-1",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("closes the relay and disposes the terminal on unmount", async () => {
    const { unmount } = renderOverlay();
    await waitFor(() =>
      expect(screen.getByTestId("proxmox-console-status").textContent).toBe(
        "Connected",
      ),
    );
    unmount();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("proxmox_console_close", {
        sessionId: "sess-1",
      }),
    );
    expect(terminalState.disposed).toBe(1);
  });
});
