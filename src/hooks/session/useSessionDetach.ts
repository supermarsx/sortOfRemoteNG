import { useCallback } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window';
import { Connection, ConnectionSession } from '../../types/connection';
import { generateId } from '../../utils/id';

export function useSessionDetach(
  sessions: ConnectionSession[],
  connections: Connection[],
  visibleSessions: ConnectionSession[],
  activeSessionId: string | undefined,
  dispatch: React.Dispatch<any>,
  setActiveSessionId: (id: string | undefined) => void,
) {
  const handleSessionDetach = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;
      const connection = connections.find(
        (item) => item.id === session.connectionId,
      );
      const windowLabel = `detached-${session.id}`;

      // Request terminal buffer before detaching
      let terminalBuffer = "";
      try {
        const bufferPromise = new Promise<string>((resolve) => {
          const timeout = setTimeout(() => {
            console.log("Buffer request timed out for detach");
            resolve("");
          }, 1000);

          listen<{ sessionId: string; buffer: string }>("terminal-buffer-response", (event) => {
            if (event.payload.sessionId === sessionId) {
              clearTimeout(timeout);
              console.log("Received buffer for detach:", event.payload.buffer?.length || 0, "chars");
              resolve(event.payload.buffer);
            }
          }).then(unlisten => {
            setTimeout(() => unlisten(), 1200);
          });
        });

        console.log("Requesting terminal buffer for detach:", sessionId);
        await emit("request-terminal-buffer", { sessionId });
        terminalBuffer = await bufferPromise;
        console.log("Got terminal buffer for detach:", terminalBuffer?.length || 0, "chars");
      } catch (error) {
        console.warn("Failed to get terminal buffer:", error);
      }

      try {
        const sessionWithBuffer = {
          ...session,
          terminalBuffer,
        };
        const payload = {
          session: sessionWithBuffer,
          connection: connection || null,
          savedAt: Date.now(),
        };
        localStorage.setItem(
          `detached-session-${session.id}`,
          JSON.stringify(payload),
        );
      } catch (error) {
        console.error("Failed to persist detached session payload:", error);
      }

      const url = `/detached?sessionId=${session.id}`;
      const windowTitle = session.name || "Detached Session";
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
              const secondary = monitors.find(m =>
                m.name !== current?.name ||
                m.position.x !== current?.position.x
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
            const newWindow = new WebviewWindow(windowLabel, {
              url,
              title: windowTitle,
              width: winWidth,
              height: winHeight,
              x: winX,
              y: winY,
              resizable: true,
              decorations: false,
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

      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          ...session,
          layout: {
            x: session.layout?.x ?? 0,
            y: session.layout?.y ?? 0,
            width: session.layout?.width ?? 100,
            height: session.layout?.height ?? 100,
            zIndex: session.layout?.zIndex ?? 1,
            isDetached: true,
            windowId: windowLabel,
          },
        },
      });

      if (activeSessionId === sessionId) {
        const remaining = visibleSessions.filter(
          (item) => item.id !== sessionId,
        );
        setActiveSessionId(remaining[0]?.id);
      }
    },
    [
      activeSessionId,
      dispatch,
      setActiveSessionId,
      connections,
      sessions,
      visibleSessions,
    ],
  );

  const handleReattachRdpSession = useCallback(
    (backendSessionId: string, connectionId?: string) => {
      const connection = connectionId
        ? connections.find((c) => c.id === connectionId)
        : undefined;

      const existing = sessions.find(
        (s) => s.backendSessionId === backendSessionId ||
          (connectionId && s.connectionId === connectionId && s.protocol === 'rdp')
      );
      if (existing) {
        setActiveSessionId(existing.id);
        return;
      }

      const newSession: ConnectionSession = {
        id: generateId(),
        connectionId: connectionId || backendSessionId,
        name: connection?.name || connectionId || backendSessionId.slice(0, 8),
        status: 'connecting',
        startTime: new Date(),
        protocol: 'rdp',
        hostname: connection?.hostname || '',
        reconnectAttempts: 0,
        maxReconnectAttempts: 3,
      };

      dispatch({ type: 'ADD_SESSION', payload: newSession });
      setActiveSessionId(newSession.id);
    },
    [connections, sessions, dispatch, setActiveSessionId],
  );

  return { handleSessionDetach, handleReattachRdpSession };
}
