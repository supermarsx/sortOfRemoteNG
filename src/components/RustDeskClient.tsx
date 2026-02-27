import React, { useState, useEffect } from 'react';
import { Monitor, Settings, Maximize2, Minimize2, Wifi, WifiOff } from 'lucide-react';
import { ConnectionSession } from '../types/connection';

interface RustDeskClientProps {
  session: ConnectionSession;
}

export const RustDeskClient: React.FC<RustDeskClientProps> = ({ session }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    quality: 'balanced',
    viewOnly: false,
    showCursor: true,
    enableAudio: true,
    enableClipboard: true,
    enableFileTransfer: true,
  });

  useEffect(() => {
    initializeRustDeskConnection();
    return () => {
      cleanup();
    };
  }, [session]);

  const initializeRustDeskConnection = async () => {
    try {
      setConnectionStatus('connecting');
      
      // Simulate RustDesk connection process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setIsConnected(true);
      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      console.error('RustDesk connection failed:', error);
    }
  };

  const cleanup = () => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-[var(--color-textSecondary)]';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  return (
    <div className={`flex flex-col bg-[var(--color-background)] ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* RustDesk Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-orange-400" />
          <span className="text-sm text-[var(--color-textSecondary)]">
            RustDesk - {session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{connectionStatus}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)]">
            <span>Quality: {settings.quality}</span>
          </div>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title="RustDesk Settings"
          >
            <Settings size={14} />
          </button>
          
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="block text-[var(--color-textSecondary)] mb-1">Quality</label>
              <select
                value={settings.quality}
                onChange={(e) => setSettings({...settings, quality: e.target.value})}
                className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs"
              >
                <option value="low">Low</option>
                <option value="balanced">Balanced</option>
                <option value="high">High</option>
                <option value="best">Best</option>
              </select>
            </div>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.viewOnly}
                onChange={(e) => setSettings({...settings, viewOnly: e.target.checked})}
                className="rounded"
              />
              <span className="text-[var(--color-textSecondary)]">View Only</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.showCursor}
                onChange={(e) => setSettings({...settings, showCursor: e.target.checked})}
                className="rounded"
              />
              <span className="text-[var(--color-textSecondary)]">Show Cursor</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.enableAudio}
                onChange={(e) => setSettings({...settings, enableAudio: e.target.checked})}
                className="rounded"
              />
              <span className="text-[var(--color-textSecondary)]">Audio</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.enableClipboard}
                onChange={(e) => setSettings({...settings, enableClipboard: e.target.checked})}
                className="rounded"
              />
              <span className="text-[var(--color-textSecondary)]">Clipboard</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.enableFileTransfer}
                onChange={(e) => setSettings({...settings, enableFileTransfer: e.target.checked})}
                className="rounded"
              />
              <span className="text-[var(--color-textSecondary)]">File Transfer</span>
            </label>
          </div>
        </div>
      )}

      {/* RustDesk Content */}
      <div className="flex-1 flex items-center justify-center bg-black">
        {connectionStatus === 'connecting' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mx-auto mb-4"></div>
            <p className="text-[var(--color-textSecondary)]">Connecting to RustDesk...</p>
            <p className="text-gray-500 text-sm mt-2">{session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <div className="text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2">RustDesk Connection Failed</p>
            <p className="text-gray-500 text-sm">Unable to connect to {session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'connected' && (
          <div className="w-full h-full bg-[var(--color-surface)] flex items-center justify-center">
            <div className="text-center">
              <Monitor size={64} className="text-orange-400 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-[var(--color-text)] mb-2">RustDesk Connected</h3>
              <p className="text-[var(--color-textSecondary)] mb-4">
                Remote desktop session active with {session.hostname}
              </p>
              <div className="bg-[var(--color-border)] rounded-lg p-4 max-w-md">
                <p className="text-xs text-gray-500 mb-2">Connection Details:</p>
                <div className="space-y-1 text-sm text-left">
                  <div>Host: <span className="text-[var(--color-text)]">{session.hostname}</span></div>
                  <div>Protocol: <span className="text-[var(--color-text)]">RustDesk</span></div>
                  <div>Quality: <span className="text-[var(--color-text)]">{settings.quality}</span></div>
                  <div>Started: <span className="text-[var(--color-text)]">{session.startTime.toLocaleTimeString()}</span></div>
                </div>
                <div className="mt-3 p-2 bg-orange-900/20 border border-orange-700 rounded text-xs text-orange-300">
                  <p>Note: RustDesk integration requires the RustDesk client to be installed and configured.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-[var(--color-surface)] border-t border-[var(--color-border)] px-4 py-2 flex items-center justify-between text-xs text-[var(--color-textSecondary)]">
        <div className="flex items-center space-x-4">
          <span>Session: {session.id.slice(0, 8)}</span>
          <span>Protocol: RustDesk</span>
          {isConnected && (
            <>
              <span>Quality: {settings.quality}</span>
              <span>Audio: {settings.enableAudio ? 'On' : 'Off'}</span>
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <span>RustDesk Remote Desktop</span>
        </div>
      </div>
    </div>
  );
};
