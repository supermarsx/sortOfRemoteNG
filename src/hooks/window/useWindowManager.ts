/**
 * Centralized Window Manager — runs ONLY in the main window.
 *
 * Owns the canonical registry of which sessions belong to which window.
 * Detached windows send `wm:command` events; the manager processes them,
 * updates session state via dispatch, and pushes `wm:sync` back with the
 * detached window's current session data.
 */

import { useCallback, useEffect, useRef } from "react";
import { ConnectionSession, Connection } from "../../types/connection/connection";
import { ConnectionAction } from "../../contexts/ConnectionContextTypes";
import {
  WindowId,
  WindowEntry,
  WindowRegistry,
  WindowCommand,
  WindowSessionSync,
} from "../../types/windowManager";

interface UseWindowManagerParams {
  sessions: ConnectionSession[];
  connections: Connection[];
  dispatch: React.Dispatch<ConnectionAction>;
  setActiveSessionId: (id: string | undefined) => void;
  handleSessionClose: (sessionId: string) => Promise<void>;
  /** Called when a drop from main lands on empty space — should create a new detached window. */
  handleSessionDetach?: (sessionId: string) => void;
}

export function useWindowManager({
  sessions,
  connections,
  dispatch,
  setActiveSessionId,
  handleSessionClose,
  handleSessionDetach,
}: UseWindowManagerParams) {
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const detachRef = useRef(handleSessionDetach);
  detachRef.current = handleSessionDetach;

  const registry = useRef<WindowRegistry>({
    windows: new Map<WindowId, WindowEntry>([
      [
        "main",
        {
          windowId: "main",
          sessionIds: [],
          activeSessionId: undefined,
          createdAt: Date.now(),
        },
      ],
    ]),
    sessionOwnership: new Map(),
  });

  // ── Keep main window's session list in sync with registry ──────────

  useEffect(() => {
    const mainIds = sessions
      .filter((s) => !s.layout?.isDetached)
      .map((s) => s.id);
    const mainEntry = registry.current.windows.get("main");
    if (mainEntry) mainEntry.sessionIds = mainIds;
    mainIds.forEach((id) => registry.current.sessionOwnership.set(id, "main"));

    // Also track detached sessions
    sessions
      .filter((s) => s.layout?.isDetached && s.layout?.windowId)
      .forEach((s) => {
        const wid = s.layout!.windowId! as WindowId;
        registry.current.sessionOwnership.set(s.id, wid);
        const entry = registry.current.windows.get(wid);
        if (entry && !entry.sessionIds.includes(s.id)) {
          entry.sessionIds.push(s.id);
        }
      });
  }, [sessions]);

  // ── Push session data to a detached window ─────────────────────────

  const syncWindow = useCallback(
    async (windowId: WindowId) => {
      if (windowId === "main") return;
      const entry = registry.current.windows.get(windowId);
      if (!entry) return;

      const windowSessions = entry.sessionIds
        .map((id) => sessionsRef.current.find((s) => s.id === id))
        .filter(Boolean) as ConnectionSession[];

      const neededConnIds = new Set(windowSessions.map((s) => s.connectionId));
      const windowConns = connectionsRef.current.filter((c) =>
        neededConnIds.has(c.id),
      );

      const payload: WindowSessionSync = {
        windowId,
        sessions: windowSessions,
        connections: windowConns,
        activeSessionId: entry.activeSessionId,
      };

      try {
        const { emitTo } = await import("@tauri-apps/api/event");
        await emitTo(windowId, "wm:sync", payload);
      } catch {
        // Window might have closed — ignore
      }
    },
    [],
  );

  // ── Sync detached windows when their sessions change ───────────────

  const prevSessionsRef = useRef(sessions);
  useEffect(() => {
    const prev = prevSessionsRef.current;
    prevSessionsRef.current = sessions;

    for (const [windowId, entry] of registry.current.windows) {
      if (windowId === "main") continue;
      const changed = entry.sessionIds.some((id) => {
        const p = prev.find((s) => s.id === id);
        const c = sessions.find((s) => s.id === id);
        return p !== c;
      });
      if (changed) syncWindow(windowId);
    }
  }, [sessions, syncWindow]);

  // ── Register a new detached window in the registry ─────────────────

  const registerWindow = useCallback(
    (windowId: WindowId, sessionIds: string[]) => {
      registry.current.windows.set(windowId, {
        windowId,
        sessionIds,
        activeSessionId: sessionIds[0],
        createdAt: Date.now(),
      });
      sessionIds.forEach((id) =>
        registry.current.sessionOwnership.set(id, windowId),
      );
    },
    [],
  );

  // ── Command handlers ───────────────────────────────────────────────

  const handleMoveSession = useCallback(
    async (
      sessionId: string,
      targetWindow: WindowId,
      insertIndex?: number,
    ) => {
      const currentOwner = registry.current.sessionOwnership.get(sessionId);
      if (!currentOwner || currentOwner === targetWindow) return;

      // Remove from source
      const sourceEntry = registry.current.windows.get(currentOwner);
      if (sourceEntry) {
        sourceEntry.sessionIds = sourceEntry.sessionIds.filter(
          (id) => id !== sessionId,
        );
      }

      // Add to target
      const targetEntry = registry.current.windows.get(targetWindow);
      if (targetEntry) {
        if (insertIndex != null) {
          targetEntry.sessionIds.splice(insertIndex, 0, sessionId);
        } else {
          targetEntry.sessionIds.push(sessionId);
        }
        targetEntry.activeSessionId = sessionId;
      }

      // Update ownership
      registry.current.sessionOwnership.set(sessionId, targetWindow);

      // Update session's layout in main state
      const isDetached = targetWindow !== "main";
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: {
            ...session,
            layout: {
              ...(session.layout ?? {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                zIndex: 1,
              }),
              isDetached,
              windowId: isDetached ? targetWindow : undefined,
            },
          },
        });
      }

      // If moving to main, activate it
      if (targetWindow === "main") {
        setActiveSessionId(sessionId);
      }

      // Sync both windows
      if (currentOwner !== "main") syncWindow(currentOwner);
      if (targetWindow !== "main") syncWindow(targetWindow);

      // Close source window if it has no remaining sessions
      if (
        currentOwner !== "main" &&
        sourceEntry &&
        sourceEntry.sessionIds.length === 0
      ) {
        try {
          const { getAllWindows } = await import("@tauri-apps/api/window");
          const windows = await getAllWindows();
          const win = windows.find((w) => w.label === currentOwner);
          if (win) await win.close();
          registry.current.windows.delete(currentOwner);
        } catch {
          /* ignore */
        }
      }
    },
    [dispatch, setActiveSessionId, syncWindow],
  );

  const handleReattachSession = useCallback(
    (sessionId: string, terminalBuffer?: string) => {
      // Move to main + update terminal buffer
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: {
            ...session,
            terminalBuffer: terminalBuffer || session.terminalBuffer,
            layout: {
              ...(session.layout ?? {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                zIndex: 1,
              }),
              isDetached: false,
              windowId: undefined,
            },
          },
        });
      }

      const currentOwner = registry.current.sessionOwnership.get(sessionId);
      if (currentOwner && currentOwner !== "main") {
        const entry = registry.current.windows.get(currentOwner);
        if (entry) {
          entry.sessionIds = entry.sessionIds.filter((id) => id !== sessionId);
          syncWindow(currentOwner);

          // Close empty windows
          if (entry.sessionIds.length === 0) {
            import("@tauri-apps/api/window").then(({ getAllWindows }) =>
              getAllWindows().then((ws) => {
                const w = ws.find((x) => x.label === currentOwner);
                w?.close().catch(() => {});
              }),
            ).catch(() => {});
            registry.current.windows.delete(currentOwner);
          }
        }
      }

      registry.current.sessionOwnership.set(sessionId, "main");
      const mainEntry = registry.current.windows.get("main");
      if (mainEntry && !mainEntry.sessionIds.includes(sessionId)) {
        mainEntry.sessionIds.push(sessionId);
      }
      setActiveSessionId(sessionId);
    },
    [dispatch, setActiveSessionId, syncWindow],
  );

  const handleDropOnWindow = useCallback(
    async (
      sessionId: string,
      sourceWindow: WindowId,
      screenX: number,
      screenY: number,
    ) => {
      // Find which window the cursor landed on
      try {
        const { getAllWindows } = await import("@tauri-apps/api/window");
        const windows = await getAllWindows();
        for (const win of windows) {
          if (win.label === sourceWindow) continue;
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          if (
            screenX >= pos.x &&
            screenX <= pos.x + size.width &&
            screenY >= pos.y &&
            screenY <= pos.y + size.height
          ) {
            // Found target window
            const targetId = win.label as WindowId;
            await handleMoveSession(sessionId, targetId);
            return;
          }
        }
        // No window found at drop location
        if (sourceWindow === "main" && detachRef.current) {
          // From main to empty space → create new detached window
          detachRef.current(sessionId);
        } else if (sourceWindow === "main") {
          // No detach handler — do nothing (session stays in main)
        } else {
          // From detached to empty space → reattach to main
          handleReattachSession(sessionId);
        }
      } catch {
        handleReattachSession(sessionId);
      }
    },
    [handleMoveSession, handleReattachSession],
  );

  const handleWindowClosing = useCallback(
    async (windowId: WindowId) => {
      const entry = registry.current.windows.get(windowId);
      if (!entry) return;

      // Reattach all sessions from closing window to main
      for (const sid of [...entry.sessionIds]) {
        handleReattachSession(sid);
      }
      registry.current.windows.delete(windowId);
    },
    [handleReattachSession],
  );

  const handleCommand = useCallback(
    async (cmd: WindowCommand) => {
      switch (cmd.type) {
        case "WINDOW_READY":
          syncWindow(cmd.windowId);
          break;
        case "MOVE_SESSION":
          await handleMoveSession(
            cmd.sessionId,
            cmd.targetWindow,
            cmd.insertIndex,
          );
          break;
        case "CLOSE_SESSION":
          await handleSessionClose(cmd.sessionId);
          break;
        case "REATTACH_SESSION":
          handleReattachSession(cmd.sessionId, cmd.terminalBuffer);
          break;
        case "REORDER_SESSIONS": {
          const entry = registry.current.windows.get(cmd.windowId);
          if (entry) {
            entry.sessionIds = cmd.sessionIds;
            if (cmd.windowId !== "main") syncWindow(cmd.windowId);
          }
          break;
        }
        case "WINDOW_CLOSING":
          await handleWindowClosing(cmd.windowId);
          break;
        case "SET_ACTIVE_SESSION": {
          const entry = registry.current.windows.get(cmd.windowId);
          if (entry) entry.activeSessionId = cmd.sessionId;
          break;
        }
        case "DROP_ON_WINDOW":
          await handleDropOnWindow(
            cmd.sessionId,
            cmd.sourceWindow,
            cmd.screenX,
            cmd.screenY,
          );
          break;
      }
    },
    [
      syncWindow,
      handleMoveSession,
      handleSessionClose,
      handleReattachSession,
      handleWindowClosing,
      handleDropOnWindow,
    ],
  );

  // ── Listen for commands from detached windows ──────────────────────

  const handleCommandRef = useRef(handleCommand);
  handleCommandRef.current = handleCommand;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<WindowCommand>("wm:command", (event) => {
        handleCommandRef.current(event.payload);
      }).then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      });
    }).catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // ── Periodic orphan detection ──────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { getAllWindows } = await import("@tauri-apps/api/window");
        const openWindows = new Set(
          (await getAllWindows()).map((w) => w.label),
        );
        for (const [windowId, entry] of registry.current.windows) {
          if (windowId === "main") continue;
          if (!openWindows.has(windowId)) {
            // Window crashed or was force-closed — reattach orphans
            for (const sid of [...entry.sessionIds]) {
              handleReattachSession(sid);
            }
            registry.current.windows.delete(windowId);
          }
        }
      } catch {
        /* ignore */
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [handleReattachSession]);

  return { registry, registerWindow, syncWindow, detachRef };
}
