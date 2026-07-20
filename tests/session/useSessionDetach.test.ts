import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessionDetach } from "../../src/hooks/session/useSessionDetach";
import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionSession,
  Connection,
} from "../../src/types/connection/connection";
import { resetSessionLifecycleAllocatorForTests } from "../../src/utils/session/sessionLifecycle";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

const terminalBufferListeners = new Set<(event: any) => void>();
let autoReplyTerminalBuffer = true;
const mockListen = vi.fn((eventName: string, handler: (event: any) => void) => {
  if (eventName === "terminal-buffer-response") {
    terminalBufferListeners.add(handler);
  }
  return Promise.resolve(() => terminalBufferListeners.delete(handler));
});
const mockEmit = vi.fn((eventName: string, payload: any) => {
  if (eventName === "request-terminal-buffer" && autoReplyTerminalBuffer) {
    queueMicrotask(() => {
      terminalBufferListeners.forEach((handler) =>
        handler({ payload: { sessionId: payload.sessionId, buffer: "" } }),
      );
    });
  }
  return Promise.resolve();
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: (event: any) => void) =>
    mockListen(eventName, handler),
  emit: (eventName: string, payload: any) => mockEmit(eventName, payload),
}));

const mockSetFocus = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn((_event, cb) => cb());
const mockWebviewCreate = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel = vi.fn().mockResolvedValue(null);
    constructor(...args: any[]) {
      mockWebviewCreate(args[0], args[1]);
    }
    once = mockOnce;
    setFocus = mockSetFocus;
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn().mockResolvedValue([]),
  currentMonitor: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/components/windows/WindowsToolPanel.helpers", () => ({
  isWinmgmtProtocol: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/utils/core/id", () => ({
  generateId: vi.fn().mockReturnValue("new-id"),
}));

// ── Test data ──────────────────────────────────────────────────────

function makeSession(
  id: string,
  protocol: string = "ssh",
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession {
  return {
    id,
    connectionId: `conn-${id}`,
    protocol: protocol as any,
    name: `Session ${id}`,
    status: "connected",
    backendSessionId: `be-${id}`,
    hostname: `host-${id}`,
    startTime: new Date(),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    ...overrides,
  } as ConnectionSession;
}

function makeConnection(id: string, protocol: string = "ssh"): Connection {
  return {
    id,
    name: `Conn ${id}`,
    hostname: `host-${id}`,
    port: 22,
    protocol: protocol as any,
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Connection;
}

const sessions = [makeSession("s1"), makeSession("s2", "rdp")];
const connections = [
  makeConnection("conn-s1"),
  makeConnection("conn-s2", "rdp"),
];

function renderDetach(overrides: Record<string, any> = {}) {
  const defaults = {
    sessions,
    connections,
    visibleSessions: sessions,
    activeSessionId: "s1",
    dispatch: vi.fn(),
    setActiveSessionId: vi.fn(),
    registerWindow: vi.fn(),
  };
  const opts = { ...defaults, ...overrides };
  const rendered = renderHook(() =>
    useSessionDetach(
      opts.sessions,
      opts.connections,
      opts.visibleSessions,
      opts.activeSessionId,
      opts.dispatch,
      opts.setActiveSessionId,
      opts.registerWindow,
    ),
  );
  return {
    ...rendered,
    dispatch: opts.dispatch,
    setActiveSessionId: opts.setActiveSessionId,
    registerWindow: opts.registerWindow,
    updateProps: (next: Record<string, any>) => {
      Object.assign(opts, next);
      rendered.rerender();
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useSessionDetach", () => {
  beforeEach(() => {
    resetSessionLifecycleAllocatorForTests();
    vi.clearAllMocks();
    terminalBufferListeners.clear();
    autoReplyTerminalBuffer = true;
    localStorage.clear();
    (invoke as Mock).mockResolvedValue(undefined);
    // Set up Tauri flag
    (window as any).__TAURI__ = true;
  });

  it("returns handleSessionDetach and handleReattachRdpSession", () => {
    const { result } = renderDetach();
    expect(result.current.handleSessionDetach).toBeTypeOf("function");
    expect(result.current.handleReattachRdpSession).toBeTypeOf("function");
  });

  it("does nothing when session ID is not found", async () => {
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("nonexistent");
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("saves session payload to localStorage on detach", async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    const stored = localStorage.getItem("detached-session-s1");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.session.id).toBe("s1");
    expect(parsed.session.layout).toEqual(
      expect.objectContaining({
        isDetached: true,
        windowId: "detached-s1",
      }),
    );
    expect(parsed.savedAt).toBeTypeOf("number");
  });

  it("dispatches UPDATE_SESSION with isDetached=true and windowId", async () => {
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          id: "s1",
          layout: expect.objectContaining({
            isDetached: true,
            windowId: "detached-s1",
          }),
        }),
      }),
    );
  });

  it("switches active session to next visible session on detach", async () => {
    const { result, setActiveSessionId } = renderDetach({
      activeSessionId: "s1",
    });
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(setActiveSessionId).toHaveBeenCalledWith("s2");
  });

  it("does not switch active session when detaching a non-active session", async () => {
    const { result, setActiveSessionId } = renderDetach({
      activeSessionId: "s2",
    });
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(setActiveSessionId).not.toHaveBeenCalled();
  });

  it("calls invoke(detach_rdp_session) for RDP sessions before opening window", async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s2");
    });
    expect(invoke).toHaveBeenCalledWith("detach_rdp_session", {
      sessionId: "be-s2",
    });
  });

  it("detaches a replacement RDP backend that appears while the old detach is in flight", async () => {
    let finishOldDetach!: () => void;
    const oldDetach = new Promise<void>((resolve) => {
      finishOldDetach = resolve;
    });
    (invoke as Mock).mockImplementation((command: string, args: any) => {
      if (command === "detach_rdp_session" && args.sessionId === "be-old") {
        return oldDetach;
      }
      return Promise.resolve();
    });
    const original = makeSession("race-rdp", "rdp", {
      backendSessionId: "be-old",
    });
    const replacement = {
      ...original,
      backendSessionId: "be-new",
      shellId: "replacement-viewer",
    };
    const rendered = renderDetach({
      sessions: [original],
      connections: [makeConnection("conn-race-rdp", "rdp")],
      visibleSessions: [original],
      activeSessionId: "race-rdp",
    });

    let detachPromise!: Promise<void>;
    act(() => {
      detachPromise = rendered.result.current.handleSessionDetach("race-rdp");
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("detach_rdp_session", {
        sessionId: "be-old",
      });
    });

    act(() => {
      rendered.updateProps({
        sessions: [replacement],
        visibleSessions: [replacement],
      });
      finishOldDetach();
    });
    await act(async () => detachPromise);

    expect(invoke).toHaveBeenCalledWith("detach_rdp_session", {
      sessionId: "be-new",
    });
    expect(
      JSON.parse(localStorage.getItem("detached-session-race-rdp")!).session,
    ).toEqual(
      expect.objectContaining({
        backendSessionId: "be-new",
        shellId: "replacement-viewer",
      }),
    );
    expect(rendered.dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: "be-new",
        shellId: "replacement-viewer",
      }),
    });
    const replacementDetachOrder = (invoke as Mock).mock.invocationCallOrder[
      (invoke as Mock).mock.calls.findIndex(
        ([command, args]) =>
          command === "detach_rdp_session" && args.sessionId === "be-new",
      )
    ];
    expect(replacementDetachOrder).toBeLessThan(
      mockWebviewCreate.mock.invocationCallOrder[0],
    );
  });

  it("awaits the latest WinRM backend handoff before persisting or opening", async () => {
    autoReplyTerminalBuffer = false;
    const opening = makeSession("ps-race", "winrm", {
      backendSessionId: undefined,
      status: "connecting",
    });
    const opened = {
      ...opening,
      backendSessionId: "ps-backend-new",
      status: "connected" as const,
      lastActivity: new Date("2026-07-19T10:00:00.000Z"),
    };
    const rendered = renderDetach({
      sessions: [opening],
      connections: [makeConnection("conn-ps-race", "winrm")],
      visibleSessions: [opening],
      activeSessionId: "ps-race",
    });

    let detachPromise!: Promise<void>;
    act(() => {
      detachPromise = rendered.result.current.handleSessionDetach("ps-race");
    });
    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith("request-terminal-buffer", {
        sessionId: "ps-race",
      });
    });

    act(() => {
      rendered.updateProps({ sessions: [opened], visibleSessions: [opened] });
      terminalBufferListeners.forEach((handler) =>
        handler({
          payload: { sessionId: "ps-race", buffer: "latest-buffer" },
        }),
      );
    });
    await act(async () => detachPromise);

    expect(invoke).toHaveBeenCalledWith("detach_powershell_session", {
      sessionId: "ps-backend-new",
    });
    const stored = JSON.parse(
      localStorage.getItem("detached-session-ps-race")!,
    );
    expect(stored.session).toEqual(
      expect.objectContaining({
        backendSessionId: "ps-backend-new",
        status: "connected",
        terminalBuffer: "latest-buffer",
      }),
    );
    expect(rendered.dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: "ps-backend-new",
        status: "connected",
      }),
    });
    const powershellDetach = (invoke as Mock).mock.invocationCallOrder[
      (invoke as Mock).mock.calls.findIndex(
        ([command]) => command === "detach_powershell_session",
      )
    ];
    expect(powershellDetach).toBeLessThan(
      mockWebviewCreate.mock.invocationCallOrder[0],
    );
  });

  it("does not call detach_rdp_session for SSH sessions", async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "detach_rdp_session",
      expect.anything(),
    );
  });

  it("emits request-terminal-buffer for SSH sessions", async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(mockEmit).toHaveBeenCalledWith("request-terminal-buffer", {
      sessionId: "s1",
    });
  });

  it("does not emit request-terminal-buffer for RDP sessions", async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s2");
    });
    expect(mockEmit).not.toHaveBeenCalledWith(
      "request-terminal-buffer",
      expect.anything(),
    );
  });

  it("detaches Raw Socket before transfer and relies on backend replay", async () => {
    const raw = makeSession("raw1", "raw");
    const preserveSignal = vi.fn();
    window.addEventListener("sorng:session-will-detach", preserveSignal);
    const { result } = renderDetach({
      sessions: [raw],
      connections: [makeConnection("conn-raw1", "raw")],
      visibleSessions: [raw],
      activeSessionId: "raw1",
    });

    await act(async () => result.current.handleSessionDetach("raw1"));

    expect(invoke).toHaveBeenCalledWith("detach_raw_socket", {
      sessionId: "be-raw1",
    });
    expect(mockEmit).not.toHaveBeenCalledWith(
      "request-terminal-buffer",
      expect.anything(),
    );
    expect(preserveSignal).toHaveBeenCalledOnce();
    window.removeEventListener("sorng:session-will-detach", preserveSignal);
  });

  it("preserves RLogin for snapshot reattach without requesting a fake terminal buffer", async () => {
    const rlogin = makeSession("rlogin1", "rlogin");
    const { result } = renderDetach({
      sessions: [rlogin],
      connections: [makeConnection("conn-rlogin1", "rlogin")],
      visibleSessions: [rlogin],
      activeSessionId: "rlogin1",
    });

    await act(async () => result.current.handleSessionDetach("rlogin1"));

    expect(mockEmit).not.toHaveBeenCalledWith(
      "request-terminal-buffer",
      expect.anything(),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "disconnect_rlogin",
      expect.anything(),
    );
  });

  it("calls registerWindow when creating a new Tauri window", async () => {
    const { result, registerWindow } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s1");
    });
    expect(registerWindow).toHaveBeenCalledWith("detached-s1", ["s1"]);
  });

  it("reattachRdpSession activates existing session by backendSessionId", () => {
    const rdpSession = makeSession("rdp1", "rdp", {
      backendSessionId: "be-rdp1",
      status: "connected",
      vpnLeaseOwnerId: "owner-current",
      vpnLeaseOwnerIds: ["owner-old", "owner-current"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-current",
          backendSessionId: "be-rdp1",
          protocol: "rdp",
          status: "active",
        },
      ],
      lifecycleActorGeneration: 4,
      lifecycleWriterId: "detached-rdp1",
      lifecycleRevision: 9,
      layout: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        isDetached: true,
      },
    });
    const { result, dispatch, setActiveSessionId } = renderDetach({
      sessions: [rdpSession],
    });
    act(() => {
      result.current.handleReattachRdpSession("be-rdp1");
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "rdp1",
        vpnLeaseOwnerId: "owner-current",
        vpnLeaseOwnerIds: ["owner-old", "owner-current"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-current",
            backendSessionId: "be-rdp1",
            protocol: "rdp",
            status: "active",
          },
        ],
        lifecycleActorGeneration: 5,
        lifecycleWriterId: "main",
        lifecycleRevision: 10,
        layout: expect.objectContaining({
          isDetached: false,
          windowId: undefined,
        }),
      }),
    });
    expect(setActiveSessionId).toHaveBeenCalledWith("rdp1");
  });

  it("reattachRdpSession creates new session when none exists", () => {
    const { result, dispatch, setActiveSessionId } = renderDetach({
      sessions: [],
    });
    act(() => {
      result.current.handleReattachRdpSession("be-new", "conn-s2");
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_SESSION",
        payload: expect.objectContaining({
          id: "new-id",
          backendSessionId: "be-new",
          protocol: "rdp",
          status: "connecting",
        }),
      }),
    );
    expect(setActiveSessionId).toHaveBeenCalledWith("new-id");
  });

  it("preserves an explicit zero retry-attempt override when reattaching RDP", () => {
    const zeroRetryConnection = {
      ...makeConnection("conn-zero", "rdp"),
      retryAttempts: 0,
    };
    const { result, dispatch } = renderDetach({
      sessions: [],
      connections: [zeroRetryConnection],
    });

    act(() => {
      result.current.handleReattachRdpSession("be-zero", "conn-zero");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ maxReconnectAttempts: 0 }),
    });
  });

  it.each([
    { protocol: "rdp", command: "detach_rdp_session" },
    { protocol: "raw", command: "detach_raw_socket" },
    { protocol: "winrm", command: "detach_powershell_session" },
  ])(
    "fails closed without persisting or opening when $command fails",
    async ({ protocol, command }) => {
      const failing = makeSession("handoff-failure", protocol);
      const preserveSignal = vi.fn();
      window.addEventListener("sorng:session-will-detach", preserveSignal);
      (invoke as Mock).mockImplementation((invokedCommand: string) =>
        invokedCommand === command
          ? Promise.reject(new Error("backend error"))
          : Promise.resolve(undefined),
      );
      const rendered = renderDetach({
        sessions: [failing],
        connections: [makeConnection("conn-handoff-failure", protocol)],
        visibleSessions: [failing],
        activeSessionId: failing.id,
      });

      await act(async () => {
        await rendered.result.current.handleSessionDetach(failing.id);
      });

      expect(invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining(
          protocol === "rdp"
            ? { sessionId: failing.backendSessionId }
            : { sessionId: failing.backendSessionId },
        ),
      );
      expect(localStorage.getItem(`detached-session-${failing.id}`)).toBeNull();
      expect(rendered.dispatch).not.toHaveBeenCalled();
      expect(rendered.setActiveSessionId).not.toHaveBeenCalled();
      expect(rendered.registerWindow).not.toHaveBeenCalled();
      expect(mockWebviewCreate).not.toHaveBeenCalled();
      expect(preserveSignal).not.toHaveBeenCalled();
      window.removeEventListener("sorng:session-will-detach", preserveSignal);
    },
  );

  it("waits for a connecting WinRM actor and detaches it before opening", async () => {
    const opening = makeSession("winrm-delayed", "winrm", {
      backendSessionId: undefined,
      status: "connecting",
    });
    const opened = {
      ...opening,
      backendSessionId: "powershell-delayed-actor",
      status: "connected" as const,
    };
    const rendered = renderDetach({
      sessions: [opening],
      connections: [makeConnection("conn-winrm-delayed", "winrm")],
      visibleSessions: [opening],
      activeSessionId: opening.id,
    });

    let detachPromise!: Promise<void>;
    act(() => {
      detachPromise = rendered.result.current.handleSessionDetach(opening.id);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => {
      rendered.updateProps({ sessions: [opened], visibleSessions: [opened] });
    });
    await act(async () => detachPromise);

    expect(invoke).toHaveBeenCalledWith("detach_powershell_session", {
      sessionId: "powershell-delayed-actor",
    });
    expect(mockWebviewCreate).toHaveBeenCalledOnce();
    expect(
      JSON.parse(localStorage.getItem("detached-session-winrm-delayed")!)
        .session.backendSessionId,
    ).toBe("powershell-delayed-actor");
  });

  it("aborts a still-connecting WinRM detach when no actor becomes available", async () => {
    const opening = makeSession("winrm-unresolved", "winrm", {
      backendSessionId: undefined,
      status: "connecting",
    });
    const { result, dispatch, registerWindow } = renderDetach({
      sessions: [opening],
      connections: [makeConnection("conn-winrm-unresolved", "winrm")],
      visibleSessions: [opening],
      activeSessionId: opening.id,
    });
    await act(async () => {
      await result.current.handleSessionDetach(opening.id);
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "detach_powershell_session",
      expect.anything(),
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(registerWindow).not.toHaveBeenCalled();
    expect(mockWebviewCreate).not.toHaveBeenCalled();
    expect(
      localStorage.getItem("detached-session-winrm-unresolved"),
    ).toBeNull();
  });

  it("sets disconnected existing RDP session to connecting on reattach", () => {
    const rdpSession = makeSession("rdp1", "rdp", {
      backendSessionId: "be-rdp1",
      status: "disconnected",
    });
    const { result, dispatch } = renderDetach({ sessions: [rdpSession] });
    act(() => {
      result.current.handleReattachRdpSession("be-rdp1");
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ id: "rdp1", status: "connecting" }),
      }),
    );
  });
});
