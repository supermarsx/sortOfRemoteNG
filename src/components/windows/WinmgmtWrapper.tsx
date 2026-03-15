import React, { useMemo } from "react";
import { ConnectionSession } from "../../types/connection/connection";
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

  const {
    sessionId,
    isConnected,
    loading,
    error,
    connect,
    cmd,
  } = useWinmgmtSession(
    session.hostname,
    session.connectionId,
    connection?.username,
    connection?.password,
    connection?.domain,
    connection?.port,
  );

  // Build the full WMI connection config passed to both connect and diagnostics.
  // Maps fields from the parent Connection to WmiConnectionConfig's serde shape.
  const connectionConfig = useMemo(() => {
    const config: Record<string, unknown> = {
      computerName: session.hostname,
    };
    if (connection?.username && connection?.password) {
      config.credential = {
        username: connection.username,
        password: connection.password,
        domain: connection.domain || null,
      };
    }
    // Pass port if the connection has one (0 = auto-detect HTTP/HTTPS)
    if (connection?.port) {
      config.port = connection.port;
    }
    return config;
  }, [session.hostname, connection?.username, connection?.password, connection?.domain, connection?.port]);

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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
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
