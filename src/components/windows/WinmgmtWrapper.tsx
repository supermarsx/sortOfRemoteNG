import React from "react";
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
  );

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
