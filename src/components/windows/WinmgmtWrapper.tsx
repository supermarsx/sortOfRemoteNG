import React, { useMemo } from "react";
import { ConnectionSession, WinrmConnectionSettings } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useWinmgmtSession } from "../../hooks/windows/useWinmgmtSession";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import WinmgmtErrorScreen from "./WinmgmtErrorScreen";

interface WinmgmtWrapperProps {
  session: ConnectionSession;
  children: (ctx: WinmgmtContext) => React.ReactNode;
}

export interface WinmgmtContext {
  cmd: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  sessionId: string;
  hostname: string;
}

/** Standard WinRM port defaults */
const WINRM_HTTP_PORT = 5985;
const WINRM_HTTPS_PORT = 5986;

/**
 * Build a WmiConnectionConfig (matching Rust serde shape) from the parent
 * Connection and its optional winrmSettings.
 *
 * IMPORTANT: The connection's generic `port` (3389 for RDP, 22 for SSH,
 * etc.) is NEVER used for WinRM.  WinRM has its own HTTP and HTTPS ports
 * configured in `winrmSettings.httpPort` / `winrmSettings.httpsPort`,
 * falling back to the standard 5985 / 5986.
 */
function buildWinrmConfig(
  hostname: string,
  username?: string,
  password?: string,
  domain?: string,
  ws?: WinrmConnectionSettings,
): Record<string, unknown> {
  const config: Record<string, unknown> = { computerName: hostname };

  if (username && password) {
    config.credential = {
      username,
      password,
      domain: domain || null,
    };
  }

  // WinRM ports — independent of the connection's primary protocol port.
  // The backend's port=0 triggers auto-detect (try preferred then fallback),
  // but we can also send the explicit port for the preferred protocol so it
  // knows which one to use first.
  const preferSsl = ws?.preferSsl ?? false;
  const httpPort = ws?.httpPort ?? WINRM_HTTP_PORT;
  const httpsPort = ws?.httpsPort ?? WINRM_HTTPS_PORT;

  config.useSsl = preferSsl;
  config.port = preferSsl ? httpsPort : httpPort;

  // Tell the backend what the alternate port is so it can fallback correctly
  // (we encode it as a custom field the backend reads)
  config.altPort = preferSsl ? httpPort : httpsPort;

  // WinRM-specific overrides
  if (ws?.authMethod)           config.authMethod = ws.authMethod;
  if (ws?.namespace)            config.namespace = ws.namespace;
  if (ws?.timeoutSec != null)   config.timeoutSec = ws.timeoutSec;
  if (ws?.skipCaCheck != null)  config.skipCaCheck = ws.skipCaCheck;
  if (ws?.skipCnCheck != null)  config.skipCnCheck = ws.skipCnCheck;

  // Fallback: default true — try the other protocol if preferred fails
  const autoFallback = ws?.autoFallback ?? true;
  if (!autoFallback) {
    // When fallback is disabled, set port explicitly so the backend
    // does NOT try the alternate (port != 0 = no fallback)
    // port is already set above, and altPort won't be used
  }

  return config;
}

/**
 * Wraps a Windows management tool panel with WMI session lifecycle.
 * Looks up the parent connection's credentials and auto-connects.
 */
const WinmgmtWrapper: React.FC<WinmgmtWrapperProps> = ({
  session,
  children,
}) => {
  const { state } = useConnections();
  const connection = state.connections.find(
    (c) => c.id === session.connectionId,
  );

  // Build the full WMI connection config (shared by connect + diagnostics).
  // Does NOT use connection.port — WinRM has its own ports.
  const connectionConfig = useMemo(
    () =>
      buildWinrmConfig(
        session.hostname,
        connection?.username,
        connection?.password,
        connection?.domain,
        connection?.winrmSettings,
      ),
    [
      session.hostname,
      connection?.username,
      connection?.password,
      connection?.domain,
      connection?.winrmSettings,
    ],
  );

  const {
    sessionId,
    isConnected,
    loading,
    error,
    connect,
    cmd,
  } = useWinmgmtSession(connectionConfig);

  if (loading && !isConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-[var(--color-background)]">
        <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
        <p className="text-sm text-[var(--color-textSecondary)]">
          Connecting to {session.hostname}…
        </p>
      </div>
    );
  }

  if (error && !isConnected) {
    return (
      <div className="h-full relative bg-[var(--color-background)]">
        <WinmgmtErrorScreen
          hostname={session.hostname}
          errorMessage={error}
          connectionId={session.connectionId}
          connectionConfig={connectionConfig}
          onRetry={connect}
        />
      </div>
    );
  }

  if (!isConnected || !sessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-[var(--color-background)]">
        <WifiOff size={32} className="text-[var(--color-textMuted)]" />
        <p className="text-sm text-[var(--color-textSecondary)]">
          Not connected
        </p>
        <button
          onClick={connect}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-accent)] text-[var(--color-text)] hover:opacity-90 transition-opacity"
        >
          <Wifi size={12} />
          Connect
        </button>
      </div>
    );
  }

  return (
    <>
      {children({ cmd, sessionId, hostname: session.hostname })}
    </>
  );
};

export default WinmgmtWrapper;
