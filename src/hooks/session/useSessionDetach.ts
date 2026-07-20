import { useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveConnectionRetryAttempts } from "../../utils/behavior/legacyBehavior";
import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";
import {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { isWinmgmtProtocol } from "../../components/windows/WindowsToolPanel.helpers";
import { generateId } from "../../utils/core/id";
import type { WindowId } from "../../types/windowManager";
import {
  advanceSessionLifecycleAuthority,
  hasSessionLifecycleActorAttempt,
} from "../../utils/session/sessionLifecycle";

export function useSessionDetach(
  sessions: ConnectionSession[],
  connections: Connection[],
  visibleSessions: ConnectionSession[],
  activeSessionId: string | undefined,
  dispatch: React.Dispatch<any>,
  setActiveSessionId: (id: string | undefined) => void,
  registerWindow?: (windowId: WindowId, sessionIds: string[]) => void,
) {
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const visibleSessionsRef = useRef(visibleSessions);
  visibleSessionsRef.current = visibleSessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const handleSessionDetach = useCallback(
    async (sessionId: string) => {
      const getLatestSession = () =>
        sessionsRef.current.find((item) => item.id === sessionId);
      const getLatestConnection = (session: ConnectionSession) =>
        connectionsRef.current.find((item) => item.id === session.connectionId);
      const session = getLatestSession();
      if (!session) return;
      const windowLabel = `detached-${session.id}`;

      console.log(
        `[detach] session=${session.id}, protocol=${session.protocol}, backendSessionId=${session.backendSessionId}, connectionId=${session.connectionId}`,
      );

      // A window handoff cannot race an attempt whose native actor has not
      // finished publishing its reserved lifecycle generation. SSH also stays
      // fail-closed for the shell-start gap after connect_ssh returns.
      if (
        hasSessionLifecycleActorAttempt(session.id) ||
        (session.protocol === "ssh" &&
          (session.status === "connecting" ||
            session.status === "reconnecting"))
      ) {
        console.warn(
          `[detach] aborted: ${session.protocol} actor handoff is still in flight`,
        );
        return;
      }

      /**
       * A backend can finish connecting while an earlier detach IPC call is
       * in flight. Keep following the current actor so an old completion can
       * never leave the replacement viewer attached to the main window.
       */
      const detachedActors = new Map<string, Set<string>>();
      const detachLatestBackend = async (
        command: string,
        fallbackArgs?: Record<string, string>,
        requireActorWhileConnecting = false,
      ): Promise<boolean> => {
        const handledActors = detachedActors.get(command) ?? new Set<string>();
        detachedActors.set(command, handledActors);
        let fallbackAttempted = false;

        for (let attempt = 0; attempt < 4; attempt += 1) {
          let current = getLatestSession();
          if (!current) return false;
          let backendSessionId = current.backendSessionId;

          // A still-connecting native actor can be published immediately after
          // the detach request. Give that exact actor a bounded chance to land,
          // but never unmount the old viewer while ownership is unresolved.
          if (
            !backendSessionId &&
            !fallbackArgs &&
            requireActorWhileConnecting &&
            (current.status === "connecting" ||
              current.status === "reconnecting")
          ) {
            for (let poll = 0; poll < 20 && !backendSessionId; poll += 1) {
              await new Promise((resolve) => setTimeout(resolve, 25));
              current = getLatestSession();
              if (!current) return false;
              backendSessionId = current.backendSessionId;
              if (
                current.status !== "connecting" &&
                current.status !== "reconnecting"
              ) {
                break;
              }
            }
            if (
              !backendSessionId &&
              (current.status === "connecting" ||
                current.status === "reconnecting")
            ) {
              console.warn(
                `[detach] ${command} aborted: native session is still connecting without an exact actor`,
              );
              return false;
            }
          }

          const actor = backendSessionId
            ? `session:${backendSessionId}`
            : fallbackArgs && !fallbackAttempted
              ? `fallback:${JSON.stringify(fallbackArgs)}`
              : undefined;
          if (!actor || handledActors.has(actor)) return true;

          handledActors.add(actor);
          if (!backendSessionId) fallbackAttempted = true;
          try {
            await invoke(
              command,
              backendSessionId ? { sessionId: backendSessionId } : fallbackArgs,
            );
          } catch (error) {
            console.warn(`[detach] ${command} failed:`, error);
            return false;
          }
        }

        const current = getLatestSession();
        const currentActor = current?.backendSessionId
          ? `session:${current.backendSessionId}`
          : undefined;
        return !currentActor || handledActors.has(currentActor);
      };

      // For RDP sessions, explicitly detach the viewer from the backend
      // *before* opening the new window. This ensures the backend session
      // is in "detached" state so the new window can reattach without a
      // race against the main window's component cleanup.
      if (session.protocol === "rdp") {
        const connection = getLatestConnection(getLatestSession() ?? session);
        if (
          !(await detachLatestBackend(
            "detach_rdp_session",
            connection ? { connectionId: connection.id } : undefined,
            true,
          ))
        ) {
          return;
        }
      }

      if (session.protocol === "raw") {
        if (
          !(await detachLatestBackend("detach_raw_socket", undefined, true))
        ) {
          return;
        }
      }

      // Request terminal buffer before detaching (only for terminal-based protocols)
      let terminalBuffer = "";
      if (
        session.protocol !== "rdp" &&
        session.protocol !== "raw" &&
        session.protocol !== "rlogin" &&
        !isWinmgmtProtocol(session.protocol)
      ) {
        try {
          let resolveBuffer: (value: string) => void;
          const bufferPromise = new Promise<string>((resolve) => {
            resolveBuffer = resolve;
          });
          const timeout = setTimeout(() => resolveBuffer(""), 1000);

          // Store the listen promise so cleanup always works even if component
          // flow reaches cleanup before the listen() promise resolves.
          const listenPromise = listen<{ sessionId: string; buffer: string }>(
            "terminal-buffer-response",
            (event) => {
              if (event.payload.sessionId === sessionId) {
                clearTimeout(timeout);
                resolveBuffer(event.payload.buffer);
              }
            },
          );

          await emit("request-terminal-buffer", { sessionId });
          terminalBuffer = await bufferPromise;

          // Guaranteed cleanup: chain on the promise so unlisten is called
          // whether listen() resolved before or after bufferPromise.
          listenPromise.then((fn) => fn()).catch(() => {});
        } catch (error) {
          console.warn("Failed to get terminal buffer:", error);
        }
      }

      // PowerShell's native session must be detached explicitly and awaited.
      // In particular, its open can finish during the terminal-buffer wait
      // above; reading through the ref here hands off that exact latest actor
      // before the detached viewer is persisted or opened.
      if (session.protocol === "winrm") {
        if (
          !(await detachLatestBackend(
            "detach_powershell_session",
            undefined,
            true,
          ))
        ) {
          return;
        }
      }

      // RDP/raw can also be replaced while their first detach call is in
      // flight. A second pass is a no-op for the same actor and detaches only
      // a newly published backend ID.
      if (session.protocol === "rdp") {
        const latest = getLatestSession() ?? session;
        const connection = getLatestConnection(latest);
        if (
          !(await detachLatestBackend(
            "detach_rdp_session",
            connection ? { connectionId: connection.id } : undefined,
            true,
          ))
        ) {
          return;
        }
      } else if (session.protocol === "raw") {
        if (
          !(await detachLatestBackend("detach_raw_socket", undefined, true))
        ) {
          return;
        }
      }

      // Protocol clients use this synchronous signal to preserve their native
      // backend immediately before the main viewer unmounts. It is deliberately
      // published only after every required native detach handoff succeeded.
      if (hasSessionLifecycleActorAttempt(session.id)) {
        console.warn(
          `[detach] aborted: ${session.protocol} actor reservation started during handoff`,
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("sorng:session-will-detach", {
          detail: { sessionId: session.id },
        }),
      );

      // No await is permitted between this final freeze check and authority
      // advance; an old writer cannot reserve after the handoff commits.
      if (hasSessionLifecycleActorAttempt(session.id)) return;
      const currentSession = advanceSessionLifecycleAuthority(
        getLatestSession() ?? session,
        windowLabel,
      );
      const currentConnection = getLatestConnection(currentSession);
      const sessionWithBuffer: ConnectionSession = {
        ...currentSession,
        terminalBuffer,
        layout: {
          x: currentSession.layout?.x ?? 0,
          y: currentSession.layout?.y ?? 0,
          width: currentSession.layout?.width ?? 100,
          height: currentSession.layout?.height ?? 100,
          zIndex: currentSession.layout?.zIndex ?? 1,
          isDetached: true,
          windowId: windowLabel,
        },
      };
      try {
        const payload = {
          session: sessionWithBuffer,
          connection: currentConnection || null,
          savedAt: Date.now(),
        };
        localStorage.setItem(
          `detached-session-${session.id}`,
          JSON.stringify(payload),
        );
        console.log(
          `[detach] saved to localStorage, backendSessionId=${sessionWithBuffer.backendSessionId}`,
        );
      } catch (error) {
        console.error("Failed to persist detached session payload:", error);
      }

      // Publish the same latest snapshot before any window-management awaits.
      // UPDATE_SESSION is reducer-merged, providing an additional guard if a
      // newer lifecycle field lands between this handoff and React's commit.
      dispatch({ type: "UPDATE_SESSION", payload: sessionWithBuffer });

      if (activeSessionIdRef.current === sessionId) {
        const remaining = visibleSessionsRef.current.filter(
          (item) => item.id !== sessionId,
        );
        setActiveSessionId(remaining[0]?.id);
      }

      const url = `/detached?sessionId=${session.id}`;
      const windowTitle = `sortOfRemoteNG - ${currentSession.name || "Detached Session"}`;
      const isTauri =
        typeof window !== "undefined" &&
        Boolean(
          (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
        );

      if (isTauri) {
        try {
          const existingWindow = await WebviewWindow.getByLabel(windowLabel);
          if (existingWindow) {
            existingWindow.setFocus().catch(() => undefined);
          } else {
            // Multi-monitor: detect secondary monitor and position window there
            let winWidth = 1200;
            let winHeight = 800;
            let winX: number | undefined;
            let winY: number | undefined;
            try {
              const monitors = await availableMonitors();
              const current = await currentMonitor();
              const secondary = monitors.find(
                (m) =>
                  m.name !== current?.name ||
                  m.position.x !== current?.position.x,
              );
              if (secondary) {
                winX = secondary.position.x + 50;
                winY = secondary.position.y + 50;
                winWidth = Math.min(1600, secondary.size.width - 100);
                winHeight = Math.min(900, secondary.size.height - 100);
              }
            } catch {
              // Fallback to defaults
            }
            // Pre-register window in the centralized WindowManager
            registerWindow?.(windowLabel as WindowId, [session.id]);

            const newWindow = new WebviewWindow(windowLabel, {
              url,
              title: windowTitle,
              width: winWidth,
              height: winHeight,
              x: winX,
              y: winY,
              resizable: true,
              decorations: false,
              dragDropEnabled: false,
            });
            newWindow.once("tauri://created", () => {
              newWindow.setFocus().catch(() => undefined);
            });
          }
        } catch (error) {
          console.error("Failed to detach session window:", error);
        }
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [dispatch, setActiveSessionId, registerWindow],
  );

  const handleReattachRdpSession = useCallback(
    (backendSessionId: string, connectionId?: string) => {
      const connection = connectionId
        ? connections.find((c) => c.id === connectionId)
        : undefined;

      const existing = sessions.find(
        (s) =>
          s.backendSessionId === backendSessionId ||
          (connectionId &&
            s.connectionId === connectionId &&
            s.protocol === "rdp"),
      );
      if (existing) {
        // A close-policy detach keeps a hidden ownership row. Move it back to
        // the main layout before activation so the existing backend and every
        // persisted VPN owner remain associated with the reopened viewer.
        const reopened = advanceSessionLifecycleAuthority(
          {
            ...existing,
            status:
              existing.status === "disconnected"
                ? "connecting"
                : existing.status,
            layout: {
              x: existing.layout?.x ?? 0,
              y: existing.layout?.y ?? 0,
              width: existing.layout?.width ?? 100,
              height: existing.layout?.height ?? 100,
              zIndex: existing.layout?.zIndex ?? 1,
              isDetached: false,
              windowId: undefined,
            },
          },
          "main",
        );
        dispatch({
          type: "UPDATE_SESSION",
          payload: reopened,
        });
        setActiveSessionId(existing.id);
        return;
      }

      const newSession: ConnectionSession = {
        id: generateId(),
        connectionId: connection?.id || connectionId || backendSessionId,
        backendSessionId,
        name: connection?.name || connectionId || backendSessionId.slice(0, 8),
        status: "connecting",
        startTime: new Date(),
        protocol: "rdp",
        hostname: connection?.hostname || "",
        reconnectAttempts: 0,
        maxReconnectAttempts: resolveConnectionRetryAttempts(
          connection?.retryAttempts,
          3,
        ),
      };

      dispatch({ type: "ADD_SESSION", payload: newSession });
      setActiveSessionId(newSession.id);
    },
    [connections, sessions, dispatch, setActiveSessionId],
  );

  return { handleSessionDetach, handleReattachRdpSession };
}
