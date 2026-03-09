import React from 'react';
import dynamic from 'next/dynamic';
import { Monitor, Terminal, AlertCircle, Loader2, ExternalLink, Shield } from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';
import { isToolProtocol } from '../app/toolSession';

const ToolTabViewer = dynamic(
  () => import('../app/ToolPanel').then((module) => module.ToolTabViewer),
  { ssr: false },
);
const WebTerminal = dynamic(
  () => import('../ssh/WebTerminal'),
  { ssr: false },
);
const WebBrowser = dynamic(
  () => import('../protocol/WebBrowser').then((module) => module.WebBrowser),
  { ssr: false },
);
const RDPClient = dynamic(
  () => import('../rdp/RDPClient'),
  { ssr: false },
);
const AnyDeskClient = dynamic(
  () => import('../protocol/AnyDeskClient').then((module) => module.AnyDeskClient),
  { ssr: false },
);

interface SessionViewerProps {
  session: ConnectionSession;
  onCloseSession?: (sessionId: string) => void;
}

export const SessionViewer: React.FC<SessionViewerProps> = ({ session, onCloseSession }) => {
  const renderContent = () => {
    // Tool tabs render their own component
    if (isToolProtocol(session.protocol)) {
      return (
        <ToolTabViewer
          session={session}
          onClose={() => onCloseSession?.(session.id)}
        />
      );
    }

    // RDP handles its own connection lifecycle internally — mount the
    // client for both 'connecting' and 'connected' status so there is a
    // single stable component instance (no unmount/remount on status change).
    if (session.protocol === 'rdp' && (session.status === 'connecting' || session.status === 'connected')) {
      return <RDPClient session={session} />;
    }

    switch (session.status) {
      case 'connecting':
        return (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-textSecondary)]">
            <Loader2 size={48} className="animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Connecting...</h3>
            <p className="text-sm text-center">
              Establishing {session.protocol.toUpperCase()} connection to {session.hostname}
            </p>
          </div>
        );

      case 'connected':
        // Route to appropriate viewer based on protocol
        switch (session.protocol) {
          case 'ssh':
          case 'telnet':
          case 'rlogin':
            return <WebTerminal session={session} />;

          case 'http':
          case 'https':
            return <WebBrowser session={session} />;
          
          case 'anydesk':
            return <AnyDeskClient session={session} />;

          case 'ilo':
            return (
              <div className="flex flex-col items-center justify-center h-full text-primary">
                <Shield size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">HP iLO Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
                  iLO connection to {session.hostname} is active
                </p>
                <div className="p-4 bg-[var(--color-surface)] rounded-lg max-w-md">
                  <p className="text-xs text-[var(--color-textMuted)] mb-2">Connection Details:</p>
                  <div className="space-y-1 text-sm">
                    <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                    <div>Protocol: <span className="text-[var(--color-text)]">HP iLO</span></div>
                    <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                  </div>
                  <div className="mt-3 p-2 bg-primary/20 border border-primary rounded text-xs text-primary">
                    <p>Use the iLO panel to manage server power, health, virtual media, and more.</p>
                  </div>
                </div>
              </div>
            );

          case 'lenovo':
            return (
              <div className="flex flex-col items-center justify-center h-full text-warning">
                <Shield size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">Lenovo XCC Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
                  XCC/IMM connection to {session.hostname} is active
                </p>
                <div className="p-4 bg-[var(--color-surface)] rounded-lg max-w-md">
                  <p className="text-xs text-[var(--color-textMuted)] mb-2">Connection Details:</p>
                  <div className="space-y-1 text-sm">
                    <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                    <div>Protocol: <span className="text-[var(--color-text)]">Lenovo XCC</span></div>
                    <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                  </div>
                  <div className="mt-3 p-2 bg-warning/20 border border-warning rounded text-xs text-warning">
                    <p>Use the Lenovo panel to manage server power, health, virtual media, and more.</p>
                  </div>
                </div>
              </div>
            );

          case 'supermicro':
            return (
              <div className="flex flex-col items-center justify-center h-full text-success">
                <Shield size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">Supermicro BMC Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
                  BMC connection to {session.hostname} is active
                </p>
                <div className="p-4 bg-[var(--color-surface)] rounded-lg max-w-md">
                  <p className="text-xs text-[var(--color-textMuted)] mb-2">Connection Details:</p>
                  <div className="space-y-1 text-sm">
                    <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                    <div>Protocol: <span className="text-[var(--color-text)]">Supermicro IPMI/Redfish</span></div>
                    <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                  </div>
                  <div className="mt-3 p-2 bg-success/20 border border-success rounded text-xs text-success">
                    <p>Use the Supermicro panel to manage server power, health, virtual media, and more.</p>
                  </div>
                </div>
              </div>
            );
          
          case 'vnc':
            return (
              <div className="flex flex-col items-center justify-center h-full text-primary">
                <Monitor size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">VNC Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
                  VNC connection to {session.hostname} is active
                </p>
                <div className="p-4 bg-[var(--color-surface)] rounded-lg max-w-md">
                  <p className="text-xs text-[var(--color-textMuted)] mb-2">Connection Details:</p>
                  <div className="space-y-1 text-sm">
                    <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                    <div>Protocol: <span className="text-[var(--color-text)]">VNC</span></div>
                    <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                  </div>
                  <div className="mt-3 p-2 bg-primary/20 border border-primary rounded text-xs text-primary">
                    <p>Note: Full VNC client functionality would require additional browser plugins or native applications.</p>
                  </div>
                </div>
              </div>
            );
          
          default:
            return (
              <div className="flex flex-col items-center justify-center h-full text-success">
                <Monitor size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)]">
                  {session.protocol.toUpperCase()} connection to {session.hostname} is active
                </p>
              </div>
            );
        }

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center h-full text-error">
            <AlertCircle size={48} className="mb-4" />
            <h3 className="text-lg font-medium mb-2">Connection Failed</h3>
            <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
              Unable to connect to {session.hostname}
            </p>
            <div className="space-y-2">
              <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded transition-colors">
                Retry Connection
              </button>
              <p className="text-xs text-[var(--color-textMuted)] text-center">
                Check your network connection and server settings
              </p>
            </div>
          </div>
        );

      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-textSecondary)]">
            <Monitor size={48} className="mb-4" />
            <h3 className="text-lg font-medium mb-2">Disconnected</h3>
            <p className="text-sm text-center">
              Session ended
            </p>
          </div>
        );
    }
  };

  return (
    <div className="h-full bg-[var(--color-background)]">
      {renderContent()}
    </div>
  );
};
