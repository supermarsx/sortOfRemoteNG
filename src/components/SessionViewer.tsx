import React from 'react';
import { Monitor, Terminal, AlertCircle, Loader2, ExternalLink, Shield } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { WebTerminal } from './WebTerminal';
import { WebBrowser } from './WebBrowser';
import RDPClient from './RDPClient';
import { AnyDeskClient } from './AnyDeskClient';
import { isToolProtocol, ToolTabViewer } from './ToolPanel';

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
          
          case 'vnc':
            return (
              <div className="flex flex-col items-center justify-center h-full text-blue-400">
                <Monitor size={48} className="mb-4" />
                <h3 className="text-lg font-medium mb-2">VNC Connected</h3>
                <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
                  VNC connection to {session.hostname} is active
                </p>
                <div className="p-4 bg-[var(--color-surface)] rounded-lg max-w-md">
                  <p className="text-xs text-gray-500 mb-2">Connection Details:</p>
                  <div className="space-y-1 text-sm">
                    <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                    <div>Protocol: <span className="text-[var(--color-text)]">VNC</span></div>
                    <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                  </div>
                  <div className="mt-3 p-2 bg-blue-900/20 border border-blue-700 rounded text-xs text-blue-300">
                    <p>Note: Full VNC client functionality would require additional browser plugins or native applications.</p>
                  </div>
                </div>
              </div>
            );
          
          default:
            return (
              <div className="flex flex-col items-center justify-center h-full text-green-400">
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
          <div className="flex flex-col items-center justify-center h-full text-red-400">
            <AlertCircle size={48} className="mb-4" />
            <h3 className="text-lg font-medium mb-2">Connection Failed</h3>
            <p className="text-sm text-center text-[var(--color-textSecondary)] mb-4">
              Unable to connect to {session.hostname}
            </p>
            <div className="space-y-2">
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded transition-colors">
                Retry Connection
              </button>
              <p className="text-xs text-gray-500 text-center">
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
