import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDetachedSessionEvents } from "../../src/hooks/session/useDetachedSessionEvents";
import type { ConnectionSession } from "../../src/types/connection/connection";

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: any }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: any }) => void) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  }),
}));

const session: ConnectionSession = {
  id: "session-1",
  connectionId: "connection-1",
  name: "Detached",
  status: "connecting",
  startTime: new Date("2026-07-19T08:00:00.000Z"),
  protocol: "ssh",
  hostname: "host.example",
  backendSessionId: "backend-old",
  layout: {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    zIndex: 1,
    isDetached: true,
    windowId: "detached-session-1",
  },
};

describe("useDetachedSessionEvents lifecycle handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    (window as any).__TAURI__ = true;
  });

  it("merges the detached lifecycle into the reattached row", async () => {
    const dispatch = vi.fn();
    const setActiveSessionId = vi.fn();
    renderHook(() =>
      useDetachedSessionEvents(
        vi.fn().mockResolvedValue(true),
        [session],
        dispatch,
        setActiveSessionId,
      ),
    );
    await waitFor(() => {
      expect(listeners.get("detached-session-reattach")).toBeTypeOf("function");
    });

    act(() => {
      listeners.get("detached-session-reattach")!({
        payload: {
          sessionId: "session-1",
          terminalBuffer: "handoff-buffer",
          lifecycle: {
            revision: 1,
            actorGeneration: 1,
            writerId: "detached-session-1",
            backendSessionId: "backend-current",
            shellId: "shell-current",
            vpnLeaseOwnerId: "owner-current",
            vpnLeaseOwnerIds: ["owner-current"],
            status: "connected",
          },
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: "backend-current",
        shellId: "shell-current",
        vpnLeaseOwnerId: "owner-current",
        terminalBuffer: "handoff-buffer",
        layout: expect.objectContaining({ isDetached: false }),
      }),
    });
    expect(setActiveSessionId).toHaveBeenCalledWith("session-1");
  });

  it("commits detached lifecycle before forwarding the legacy close", async () => {
    const dispatch = vi.fn();
    const handleSessionClose = vi.fn().mockResolvedValue(true);
    renderHook(() =>
      useDetachedSessionEvents(
        handleSessionClose,
        [session],
        dispatch,
        vi.fn(),
      ),
    );
    await waitFor(() => {
      expect(listeners.get("detached-session-closed")).toBeTypeOf("function");
    });

    act(() => {
      listeners.get("detached-session-closed")!({
        payload: {
          sessionId: "session-1",
          lifecycle: {
            revision: 1,
            actorGeneration: 1,
            writerId: "detached-session-1",
            backendSessionId: "backend-current",
            vpnLeaseOwnerId: "owner-current",
            vpnLeaseOwnerIds: ["owner-current"],
            status: "connected",
          },
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: "backend-current",
        vpnLeaseOwnerId: "owner-current",
      }),
    });
    await waitFor(() => {
      expect(handleSessionClose).toHaveBeenCalledWith("session-1");
    });
  });
});
