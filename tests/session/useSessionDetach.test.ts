import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessionDetach } from "../../src/hooks/session/useSessionDetach";
import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionSession,
  Connection,
} from "../../src/types/connection/connection";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
const mockEmit = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: any[]) => mockListen(...args),
  emit: (...args: any[]) => mockEmit(...args),
}));

const mockSetFocus = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn((_event, cb) => cb());

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel = vi.fn().mockResolvedValue(null);
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
  return {
    ...renderHook(() =>
      useSessionDetach(
        opts.sessions,
        opts.connections,
        opts.visibleSessions,
        opts.activeSessionId,
        opts.dispatch,
        opts.setActiveSessionId,
        opts.registerWindow,
      ),
    ),
    dispatch: opts.dispatch,
    setActiveSessionId: opts.setActiveSessionId,
    registerWindow: opts.registerWindow,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useSessionDetach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      connectionId: "conn-s2",
    });
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
    });
    const { result, setActiveSessionId } = renderDetach({
      sessions: [rdpSession],
    });
    act(() => {
      result.current.handleReattachRdpSession("be-rdp1");
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

  it("continues gracefully when detach_rdp_session fails", async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error("backend error"));
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach("s2");
    });
    // Should still dispatch the UPDATE_SESSION
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ id: "s2" }),
      }),
    );
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
