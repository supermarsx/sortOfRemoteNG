import { useCallback, useContext, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveConnectionRetryAttempts } from "../../utils/behavior/legacyBehavior";
import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";
import {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";
import type { WindowId } from "../../types/windowManager";
import {
  advanceSessionLifecycleAuthority,
  hasSessionLifecycleActorAttempt,
} from "../../utils/session/sessionLifecycle";
import { hasNoLiveTransport } from "../../utils/session/sessionClassification";
import { ToastContext } from "../../contexts/ToastContext";

const DETACHED_SESSION_STORAGE_PREFIX = "detached-session-";
export const DETACH_REFUSED_EVENT = "sorng:detach-refused";
export const DETACH_REFUSED_IN_FLIGHT_MESSAGE =
  "Cannot detach while the connection attempt is still in flight — wait for it to finish or close the tab";
export const DETACH_REFUSED_BACKEND_MESSAGE =
  "Cannot detach: the native session refused the window handoff — try again or close the tab";
const DETACHED_SESSION_METADATA_VERSION = 2;
const MAX_OPAQUE_ID_LENGTH = 512;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isOpaqueId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_OPAQUE_ID_LENGTH &&
  /^[A-Za-z0-9._:-]+$/.test(value);

function isSafeDetachedSessionMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const layout = value.layout;
  const allowedRootKeys = new Set([
    "version",
    "sessionId",
    "connectionId",
    "backendSessionId",
    "ownerWindowId",
    "layout",
    "savedAt",
  ]);
  if (Object.keys(value).some((key) => !allowedRootKeys.has(key))) return false;
  if (
    value.version !== DETACHED_SESSION_METADATA_VERSION ||
    !isOpaqueId(value.sessionId) ||
    !isOpaqueId(value.connectionId) ||
    !isOpaqueId(value.ownerWindowId) ||
    (value.backendSessionId !== undefined &&
      !isOpaqueId(value.backendSessionId)) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    !isRecord(layout)
  ) {
    return false;
  }
  const allowedLayoutKeys = new Set([
    "x",
    "y",
    "width",
    "height",
    "zIndex",
    "isDetached",
    "windowId",
  ]);
  if (
    Object.keys(layout).some((key) => !allowedLayoutKeys.has(key)) ||
    layout.isDetached !== true ||
    layout.windowId !== value.ownerWindowId
  ) {
    return false;
  }
  return ["x", "y", "width", "height", "zIndex"].every(
    (key) =>
      typeof layout[key] === "number" && Number.isFinite(layout[key] as number),
  );
}

function purgeLegacyDetachedSessionPayloads(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(DETACHED_SESSION_STORAGE_PREFIX)) continue;
      const stored = localStorage.getItem(key);
      let safe = false;
      if (stored && stored.length <= 4_096) {
        try {
          safe = isSafeDetachedSessionMetadata(JSON.parse(stored));
        } catch {
          safe = false;
        }
      }
      if (!safe) localStorage.removeItem(key);
    }
  } catch {
    // Browser storage can be unavailable. Detached state then remains runtime-only.
  }
}

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
  // Non-throwing read: the hook may be mounted outside a ToastProvider
  // (tests, detached shells). Without one, refusals fall back to console.warn
  // plus a `sorng:detach-refused` CustomEvent so callers can still react.
  const toastContext = useContext(ToastContext);
  const toastRef = useRef(toastContext);
  toastRef.current = toastContext;

  useEffect(() => {
    purgeLegacyDetachedSessionPayloads();
  }, []);

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

      // A refused handoff must tell the user why instead of silently no-op'ing.
      const refuseDetach = (
        logDetail: string,
        reason: string = DETACH_REFUSED_IN_FLIGHT_MESSAGE,
      ) => {
        console.warn(`[detach] aborted: ${logDetail}`);
        const toast = toastRef.current?.toast;
        if (toast) {
          toast.warning(reason);
        } else {
          window.dispatchEvent(
            new CustomEvent(DETACH_REFUSED_EVENT, {
              detail: { sessionId: session.id, reason },
            }),
          );
        }
      };

      // A session that never had a live transport (error / hung connecting,
      // no active VPN route) and has no in-flight native actor attempt has
      // nothing to hand off: skip every backend detach gate and move the row
      // straight to the detached window, which renders the failure + Retry.
      const abandoned =
        hasNoLiveTransport(session) &&
        !hasSessionLifecycleActorAttempt(session.id);

      // A window handoff cannot race an attempt whose native actor has not
      // finished publishing its reserved lifecycle generation. SSH also stays
      // fail-closed for the shell-start gap after connect_ssh returns.
      if (
        !abandoned &&
        (hasSessionLifecycleActorAttempt(session.id) ||
          (session.protocol === "ssh" &&
            (session.status === "connecting" ||
              session.status === "reconnecting")))
      ) {
        refuseDetach(`${session.protocol} actor handoff is still in flight`);
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
              refuseDetach(
                `${command}: native session is still connecting without an exact actor`,
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
            refuseDetach(`${command} rejected`, DETACH_REFUSED_BACKEND_MESSAGE);
            return false;
          }
        }

        const current = getLatestSession();
        const currentActor = current?.backendSessionId
          ? `session:${current.backendSessionId}`
          : undefined;
        return !currentActor || handledActors.has(currentActor);
      };

      // Abandoned sessions have no native actor to hand off; live sessions
      // must complete every backend detach before the viewer is unmounted.
      if (!abandoned) {
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

        // PowerShell's native session must be detached explicitly and awaited.
        // Sensitive terminal state is never copied into browser persistence.
        // The detached viewer must recover it from the exact native actor.
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
      }

      // Protocol clients use this synchronous signal to preserve their native
      // backend immediately before the main viewer unmounts. It is deliberately
      // published only after every required native detach handoff succeeded.
      if (hasSessionLifecycleActorAttempt(session.id)) {
        refuseDetach(
          `${session.protocol} actor reservation started during handoff`,
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
      if (hasSessionLifecycleActorAttempt(session.id)) {
        refuseDetach(
          `${session.protocol} actor reservation started after the will-detach signal`,
        );
        return;
      }
      const currentSession = advanceSessionLifecycleAuthority(
        getLatestSession() ?? session,
        windowLabel,
      );
      const currentConnection = getLatestConnection(currentSession);
      const detachedSession: ConnectionSession = {
        ...currentSession,
        terminalBuffer: undefined,
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
        if (
          !isOpaqueId(detachedSession.id) ||
          !isOpaqueId(detachedSession.connectionId) ||
          !isOpaqueId(windowLabel) ||
          (detachedSession.backendSessionId !== undefined &&
            !isOpaqueId(detachedSession.backendSessionId))
        ) {
          console.error(
            "Failed to persist detached session metadata: invalid opaque identifier",
          );
          return;
        }
        const payload = {
          version: DETACHED_SESSION_METADATA_VERSION,
          sessionId: detachedSession.id,
          connectionId: detachedSession.connectionId,
          backendSessionId: detachedSession.backendSessionId,
          ownerWindowId: windowLabel,
          layout: detachedSession.layout,
          savedAt: Date.now(),
        };
        localStorage.setItem(
          `detached-session-${session.id}`,
          JSON.stringify(payload),
        );
      } catch (error) {
        console.error("Failed to persist detached session metadata:", error);
      }

      // Publish the same latest snapshot before any window-management awaits.
      // UPDATE_SESSION is reducer-merged, providing an additional guard if a
      // newer lifecycle field lands between this handoff and React's commit.
      dispatch({ type: "UPDATE_SESSION", payload: detachedSession });

      if (activeSessionIdRef.current === sessionId) {
        const remaining = visibleSessionsRef.current.filter(
          (item) => item.id !== sessionId,
        );
        setActiveSessionId(remaining[0]?.id);
      }

      const url = `/detached?sessionId=${encodeURIComponent(session.id)}`;
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
