import React, { useEffect, useState } from 'react';
import { ConnectionSession } from '../../types/connection';
import { useConnections } from '../../contexts/useConnections';
import { Monitor, ExternalLink, AlertCircle } from 'lucide-react';

interface AnyDeskClientProps {
  session: ConnectionSession;
}

export const AnyDeskClient: React.FC<AnyDeskClientProps> = ({ session }) => {
  const { state } = useConnections();
  const connection = state.connections.find(c => c.id === session.connectionId);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunchAnyDesk = async () => {
    if (!connection) return;

    setIsLaunching(true);
    setError(null);

    try {
      // For AnyDesk, we'll attempt to launch the external application
      // This is a placeholder implementation - in a real scenario, you might:
      // 1. Use Tauri to launch the AnyDesk executable with parameters
      // 2. Use AnyDesk's API if available
      // 3. Open a URL scheme like anydesk://<id>

      const anydeskId = connection.hostname || connection.name;

      // Try to open AnyDesk URL scheme
      window.open(`anydesk://${anydeskId}`, '_blank');

      // Alternative: Try to launch via command line (would need Tauri backend)
      // await invoke('launch_anydesk', { id: anydeskId });

    } catch (err) {
      setError('Failed to launch AnyDesk. Please ensure AnyDesk is installed and try again.');
      console.error('AnyDesk launch error:', err);
    } finally {
      setIsLaunching(false);
    }
  };

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)]">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
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
          <Monitor className="h-5 w-5 text-blue-400" />
          <div>
            <h3 className="font-medium">{connection.name}</h3>
            <p className="text-sm text-[var(--color-textSecondary)]">AnyDesk Connection</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <Monitor className="mx-auto h-16 w-16 text-blue-400 mb-6" />
          <h3 className="text-xl font-medium mb-4">AnyDesk Remote Desktop</h3>
          <p className="text-[var(--color-textSecondary)] mb-6">
            AnyDesk provides high-performance remote desktop access.
            Click the button below to launch AnyDesk with the configured connection.
          </p>

          {connection.hostname && (
            <div className="bg-[var(--color-surface)] rounded-lg p-4 mb-6">
              <p className="text-sm text-[var(--color-textSecondary)]">
                <span className="font-medium">AnyDesk ID:</span> {connection.hostname}
              </p>
            </div>
          )}

          <button
            onClick={handleLaunchAnyDesk}
            disabled={isLaunching}
            className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-[var(--color-text)] font-medium rounded-lg transition-colors duration-200"
          >
            <ExternalLink className="h-5 w-5 mr-2" />
            {isLaunching ? 'Launching AnyDesk...' : 'Launch AnyDesk'}
          </button>

          {error && (
            <div className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
          )}

          <div className="mt-6 text-xs text-[var(--color-textMuted)]">
            <p>Make sure AnyDesk is installed on your system.</p>
            <p>If AnyDesk doesn't open automatically, you may need to enter the ID manually.</p>
          </div>
        </div>
      </div>
    </div>
  );
};