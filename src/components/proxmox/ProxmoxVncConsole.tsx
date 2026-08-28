/**
 * ProxmoxVncConsole — noVNC-equivalent overlay backed by the loopback bridge.
 *
 * `proxmox_vnc_bridge_open` (t67-e6) fetches a `vncproxy` ticket, dials the PVE
 * `vncwebsocket` with the pinned TLS connector, and exposes the plain RFB stream
 * on `127.0.0.1:<localPort>`. Everything past that point is ordinary VNC, so
 * this overlay mounts the app's existing native `VNCClient` against loopback
 * with the bridge ticket as the RFB password.
 *
 * ## Why an in-panel overlay and not a session tab (plan §3 D4 investigation)
 *
 * The session-manager quick-connect route was checked first, as the plan asks.
 * `useSessionManager.tsx` exposes no consumable "open this ephemeral connection"
 * API to a panel, and it is owned by t63 — t67 must not edit it. The one
 * cross-boundary mechanism that exists is the volatile
 * `runtimeConnectionRegistry` plus the `open-runtime-connection` window event
 * that the web-UI launchers dispatch — and that event currently has **zero
 * listeners app-wide** (t64/t65/t67-e4 all dispatch it; the app-shell handler is
 * still t63's follow-up). Routing the console through it would have produced
 * another dead button.
 *
 * So this takes the fallback the plan sanctions: a synthetic `ConnectionSession`
 * whose `connectionId` resolves through `registerRuntimeConnection` — the exact
 * lookup `useVNCClient` already performs (`resolveRuntimeConnection`) — rendered
 * in an in-panel `Modal`. Nothing is persisted; the runtime entry is released
 * when the overlay unmounts. If t63 later lands an app-shell listener, moving
 * this to a real tab is a change to `handleOpen` alone.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, Monitor, RefreshCw, X } from "lucide-react";
import Modal from "../ui/overlays/Modal";
import { VNCClient } from "../protocol/VNCClient";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  registerRuntimeConnection,
  releaseRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";
import type { ProxmoxVncTarget } from "../../hooks/proxmox/useProxmoxConsole";

export const PROXMOX_VNC_BRIDGE_OPEN_COMMAND = "proxmox_vnc_bridge_open";
export const PROXMOX_VNC_BRIDGE_CLOSE_COMMAND = "proxmox_vnc_bridge_close";
export const PROXMOX_VNC_BRIDGE_CLOSED_EVENT = "proxmox-vnc-bridge-closed";

/** `ProxmoxVncBridge` as returned by `proxmox_vnc_bridge_open` (camelCase). */
export interface ProxmoxVncBridgeHandle {
  bridgeId: string;
  localPort: number;
  /** PVE's VNC ticket — the RFB password inside the tunnel. */
  ticket: string;
  user: string;
  node: string;
  vmid?: number;
  vmType: string;
}

export interface ProxmoxVncBridgeClosedEvent {
  bridgeId: string;
  reason: string;
}

export type ProxmoxVncStatus = "opening" | "open" | "closed" | "error";

export interface ProxmoxVncConsoleProps {
  target: ProxmoxVncTarget;
  onClose: () => void;
}

function describeTarget(target: ProxmoxVncTarget): string {
  return target.label ?? `${target.node} · ${target.vmid}`;
}

/**
 * The loopback connection handed to `VNCClient`.
 *
 * `vncAllowUnencryptedTransport` is deliberate and safe here: the socket never
 * leaves `127.0.0.1`, and the real transport security is the pinned TLS the
 * bridge terminates on the PVE side.
 */
export function buildProxmoxVncConnection(
  bridge: ProxmoxVncBridgeHandle,
  target: ProxmoxVncTarget,
  now: () => string = () => new Date().toISOString(),
): Connection {
  const stamp = now();
  return {
    id: `proxmox-vnc-${bridge.bridgeId}`,
    name: describeTarget(target),
    protocol: "vnc",
    hostname: "127.0.0.1",
    port: bridge.localPort,
    password: bridge.ticket,
    isGroup: false,
    icon: "monitor",
    createdAt: stamp,
    updatedAt: stamp,
    vncAllowUnencryptedTransport: true,
  };
}

export function buildProxmoxVncSession(
  connection: Connection,
  startedAt: Date = new Date(),
): ConnectionSession {
  return {
    id: `session-${connection.id}`,
    connectionId: connection.id,
    name: connection.name,
    status: "connecting",
    startTime: startedAt,
    protocol: "vnc",
    hostname: connection.hostname ?? "127.0.0.1",
  };
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

export const ProxmoxVncConsole: React.FC<ProxmoxVncConsoleProps> = ({
  target,
  onClose,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ProxmoxVncStatus>("opening");
  const [bridge, setBridge] = useState<ProxmoxVncBridgeHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const bridgeIdRef = useRef<string | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const { node, vmid, vmType } = target;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    setStatus("opening");
    setError(null);
    setCloseReason(null);
    setBridge(null);

    void (async () => {
      try {
        const subscription = await listen<ProxmoxVncBridgeClosedEvent>(
          PROXMOX_VNC_BRIDGE_CLOSED_EVENT,
          (event) => {
            const payload = event.payload;
            if (!payload || payload.bridgeId !== bridgeIdRef.current) return;
            bridgeIdRef.current = null;
            if (!mountedRef.current) return;
            setCloseReason(payload.reason ?? null);
            setStatus("closed");
          },
        );
        if (cancelled) {
          subscription();
          return;
        }
        unlisten = subscription;

        const opened = await invoke<ProxmoxVncBridgeHandle>(
          PROXMOX_VNC_BRIDGE_OPEN_COMMAND,
          { node, vmid, vmType },
        );
        if (cancelled || !opened?.bridgeId) {
          if (opened?.bridgeId) {
            void invoke(PROXMOX_VNC_BRIDGE_CLOSE_COMMAND, {
              bridgeId: opened.bridgeId,
            }).catch(() => undefined);
          }
          return;
        }
        bridgeIdRef.current = opened.bridgeId;
        // Register before the client mounts: `useVNCClient` resolves the
        // connection synchronously on its first render.
        const connection = buildProxmoxVncConnection(opened, target);
        registerRuntimeConnection(connection);
        connectionIdRef.current = connection.id;
        if (!mountedRef.current) return;
        setBridge(opened);
        setStatus("open");
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        setError(errorMessage(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* listener already gone */
        }
      }
      const openId = bridgeIdRef.current;
      bridgeIdRef.current = null;
      if (openId) {
        void invoke(PROXMOX_VNC_BRIDGE_CLOSE_COMMAND, {
          bridgeId: openId,
        }).catch(() => undefined);
      }
      const connectionId = connectionIdRef.current;
      connectionIdRef.current = null;
      if (connectionId) releaseRuntimeConnection(connectionId);
    };
    // `target` is only read to name the connection; the identity that matters
    // is the primitive triple, so a fresh object from the parent must not
    // re-open the bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [node, vmid, vmType, attempt]);

  const session = useMemo(() => {
    if (!bridge) return null;
    return buildProxmoxVncSession(buildProxmoxVncConnection(bridge, target));
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [bridge]);

  const handleClose = useCallback(() => {
    const openId = bridgeIdRef.current;
    bridgeIdRef.current = null;
    if (openId) {
      void invoke(PROXMOX_VNC_BRIDGE_CLOSE_COMMAND, { bridgeId: openId }).catch(
        () => undefined,
      );
    }
    onClose();
  }, [onClose]);

  const statusLabel =
    status === "open"
      ? t("proxmox.vnc.statusOpen", "Connected")
      : status === "opening"
        ? t("proxmox.vnc.statusOpening", "Opening…")
        : status === "error"
          ? t("proxmox.vnc.statusError", "Failed")
          : t("proxmox.vnc.statusClosed", "Closed");

  return (
    <Modal
      isOpen
      onClose={handleClose}
      backdropClassName="bg-black/60"
      panelClassName="max-w-6xl h-[85vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="bg-[var(--color-surface)]"
      dataTestId="proxmox-vnc-overlay"
    >
      <section
        className="flex h-full min-h-0 w-full flex-col"
        aria-label={t("proxmox.vnc.overlayLabel", "Proxmox VNC console")}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-3 py-2 text-xs">
          <Monitor className="h-4 w-4 text-primary" aria-hidden />
          <span
            className="font-medium text-[var(--color-text)]"
            data-testid="proxmox-vnc-title"
          >
            {describeTarget(target)}
          </span>
          <span
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 uppercase text-[var(--color-textSecondary)]"
            role="status"
            aria-live="polite"
            data-testid="proxmox-vnc-status"
          >
            {statusLabel}
          </span>
          {bridge ? (
            <span
              className="text-[var(--color-textSecondary)]"
              data-testid="proxmox-vnc-endpoint"
            >
              127.0.0.1:{bridge.localPort}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {status === "closed" || status === "error" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
                onClick={() => setAttempt((value) => value + 1)}
                data-testid="proxmox-vnc-reconnect-btn"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("proxmox.vnc.reconnect", "Reconnect")}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error transition-colors hover:bg-error/10"
              onClick={handleClose}
              data-testid="proxmox-vnc-close-btn"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t("common.close", "Close")}
            </button>
          </div>
        </header>

        {error ? (
          <div
            className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
            role="alert"
            data-testid="proxmox-vnc-error"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </div>
        ) : null}

        {status === "closed" && closeReason ? (
          <div
            className="border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]"
            data-testid="proxmox-vnc-close-reason"
          >
            {closeReason}
          </div>
        ) : null}

        <div className="min-h-0 flex-1" data-testid="proxmox-vnc-surface">
          {session ? (
            <VNCClient session={session} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--color-textSecondary)]">
              {status === "opening"
                ? t("proxmox.vnc.opening", "Opening the VNC bridge…")
                : t("proxmox.vnc.notConnected", "No VNC bridge is open.")}
            </div>
          )}
        </div>
      </section>
    </Modal>
  );
};

export default ProxmoxVncConsole;
