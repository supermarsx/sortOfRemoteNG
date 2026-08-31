import { useEffect, useRef } from "react";

import type { Connection } from "../../types/connection/connection";
import {
  releaseRuntimeConnection,
  resolveRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";

export const OPEN_RUNTIME_CONNECTION_EVENT = "open-runtime-connection" as const;

export type RuntimeConnectionLaunchSource =
  "nginxProxyMgr" | "pfsense" | "portainer" | "proxmox";

interface RuntimeConnectionLaunchDetail {
  connection: Connection;
  source: RuntimeConnectionLaunchSource;
}

const RUNTIME_CONNECTION_LAUNCH_SOURCES = new Set<string>([
  "nginxProxyMgr",
  "pfsense",
  "portainer",
  "proxmox",
]);

const isRuntimeConnection = (value: unknown): value is Connection => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const connection = value as Partial<Connection>;
  return (
    typeof connection.id === "string" &&
    connection.id.length > 0 &&
    typeof connection.name === "string" &&
    connection.name.length > 0 &&
    typeof connection.protocol === "string" &&
    connection.protocol.length > 0 &&
    typeof connection.hostname === "string" &&
    connection.hostname.length > 0 &&
    Number.isInteger(connection.port) &&
    Number(connection.port) >= 1 &&
    Number(connection.port) <= 65535 &&
    connection.isGroup === false
  );
};

export function parseRuntimeConnectionLaunch(
  event: Event,
): RuntimeConnectionLaunchDetail | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as Partial<RuntimeConnectionLaunchDetail> | null;
  if (
    !isRuntimeConnection(detail?.connection) ||
    typeof detail?.source !== "string" ||
    !RUNTIME_CONNECTION_LAUNCH_SOURCES.has(detail.source)
  ) {
    return null;
  }

  // Launchers must register this exact ephemeral object before announcing it.
  // This rejects forged events while keeping credentials only in the volatile
  // runtime registry and the normal session-open path.
  if (
    resolveRuntimeConnection([], detail.connection.id) !== detail.connection
  ) {
    return null;
  }
  return detail as RuntimeConnectionLaunchDetail;
}

/** Bridge registered integration WebGUI launchers into the canonical session
 * path. Failed or declined opens release the ephemeral credential record. */
export function useRuntimeConnectionLaunch(
  handleConnect: (connection: Connection) => Promise<string | undefined>,
): void {
  const handleConnectRef = useRef(handleConnect);
  useEffect(() => {
    handleConnectRef.current = handleConnect;
  }, [handleConnect]);

  useEffect(() => {
    const handleLaunch = (event: Event) => {
      const detail = parseRuntimeConnectionLaunch(event);
      if (!detail) return;

      void handleConnectRef
        .current(detail.connection)
        .then((sessionId) => {
          if (!sessionId) releaseRuntimeConnection(detail.connection.id);
        })
        .catch((error) => {
          releaseRuntimeConnection(detail.connection.id);
          console.error(
            `Failed to open ${detail.source} runtime connection:`,
            error,
          );
        });
    };

    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, handleLaunch);
    return () =>
      window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, handleLaunch);
  }, []);
}
