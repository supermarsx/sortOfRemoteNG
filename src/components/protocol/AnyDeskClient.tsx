import React from 'react';
import { ConnectionSession } from '../../types/connection/connection';
import { Monitor, ExternalLink, AlertCircle, CheckCircle2, Activity, Link2, Power } from 'lucide-react';
import { useAnyDeskClient } from '../../hooks/protocol/useAnyDeskClient';

interface AnyDeskClientProps {
  session: ConnectionSession;
}

export const AnyDeskClient: React.FC<AnyDeskClientProps> = ({ session }) => {
  const {
    connection,
    anydeskId,
    backendSession,
    launchMode,
    isLaunching,
    isDisconnecting,
    error,
    canLaunch,
    launch,
    disconnect,
    refreshSession,
  } = useAnyDeskClient(session);

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)]">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-error mb-4" />
          <h3 className="text-lg font-medium mb-2">Connection Not Found</h3>
          <p className="text-[var(--color-textSecondary)]">The connection for this session could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)] text-[var(--color-text)]">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center space-x-3">
          <Monitor className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-medium">{connection.name}</h3>
            <p className="text-sm text-[var(--color-textSecondary)]">AnyDesk Connection</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-textSecondary)]">
          <span className={`h-2 w-2 rounded-full ${backendSession?.connected ? 'bg-success' : launchMode === 'external' ? 'bg-warning' : 'bg-[var(--color-textMuted)]'}`} />
          {backendSession?.connected ? 'Managed session active' : launchMode === 'external' ? 'External handoff' : 'Ready to launch'}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
          <Monitor className="mx-auto h-16 w-16 text-primary mb-6" />
          <h3 className="mb-2 text-center text-xl font-medium">AnyDesk Remote Desktop</h3>
          <p className="mx-auto mb-8 max-w-xl text-center text-[var(--color-textSecondary)]">
            Launch AnyDesk through the native Tauri backend when available, and fall back to the URL scheme when the desktop client cannot be spawned directly.
          </p>

          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-left">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Link2 className="h-4 w-4 text-primary" />
                Target
              </div>
              <p className="text-sm text-[var(--color-textSecondary)]">{anydeskId || 'Not configured'}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-left">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Activity className="h-4 w-4 text-warning" />
                Launch Mode
              </div>
              <p className="text-sm text-[var(--color-textSecondary)]">
                {launchMode === 'managed' ? 'Managed backend session' : launchMode === 'external' ? 'External URL handoff' : 'Idle'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-left">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Session State
              </div>
              <p className="text-sm text-[var(--color-textSecondary)]">
                {backendSession?.connected ? 'Connected' : session.backendSessionId ? 'Registered' : 'Not started'}
              </p>
            </div>
          </div>

          {backendSession && (
            <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-left text-sm text-[var(--color-textSecondary)]">
              <div className="mb-2 font-medium text-[var(--color-text)]">Managed Session Details</div>
              <div className="grid gap-2 md:grid-cols-2">
                <div>Session ID: <span className="font-mono text-[var(--color-text)]">{backendSession.id}</span></div>
                <div>Started: <span className="text-[var(--color-text)]">{new Date(backendSession.start_time).toLocaleString()}</span></div>
                <div>Remote ID: <span className="text-[var(--color-text)]">{backendSession.anydesk_id}</span></div>
                <div>Password sent: <span className="text-[var(--color-text)]">{backendSession.password ? 'Yes' : 'No'}</span></div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={launch}
              disabled={!canLaunch || isLaunching}
              className="inline-flex items-center rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ExternalLink className="mr-2 h-5 w-5" />
              {isLaunching ? 'Launching AnyDesk...' : backendSession?.connected ? 'Reconnect AnyDesk' : 'Launch AnyDesk'}
            </button>
            <button
              onClick={refreshSession}
              disabled={!session.backendSessionId}
              className="inline-flex items-center rounded-lg border border-[var(--color-border)] px-4 py-3 font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Activity className="mr-2 h-4 w-4" />
              Refresh Status
            </button>
            <button
              onClick={disconnect}
              disabled={(!session.backendSessionId && launchMode !== 'external') || isDisconnecting}
              className="inline-flex items-center rounded-lg border border-error/40 px-4 py-3 font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Power className="mr-2 h-4 w-4" />
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-lg border border-error bg-error/10 p-4">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-error mr-2" />
                <p className="text-sm text-error">{error}</p>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-2 text-left text-xs text-[var(--color-textMuted)] md:grid-cols-2">
            <p>Native launches use the Tauri command bridge and can track a backend session ID for cleanup.</p>
            <p>If native launch fails, the client falls back to the URL scheme so the desktop app can still open.</p>
          </div>
        </div>
      </div>
    </div>
  );
};