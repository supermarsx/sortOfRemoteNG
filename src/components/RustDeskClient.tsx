import React from 'react';
import { Monitor, Settings, Maximize2, Minimize2, Wifi, WifiOff } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useRustDeskClient } from '../hooks/protocol/useRustDeskClient';
import { StatusBar, ConnectingSpinner } from './ui/display';
import { Checkbox, Select } from './ui/forms';

type Mgr = ReturnType<typeof useRustDeskClient>;

interface RustDeskClientProps {
  session: ConnectionSession;
}

export const RustDeskClient: React.FC<RustDeskClientProps> = ({ session }) => {
  const mgr = useRustDeskClient(session);

  const getStatusIcon = () => {
    switch (mgr.connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  return (
    <div className={`flex flex-col bg-[var(--color-background)] ${mgr.isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* RustDesk Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-orange-400" />
          <span className="text-sm text-[var(--color-textSecondary)]">
            RustDesk - {session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${mgr.getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{mgr.connectionStatus}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)]">
            <span>Quality: {mgr.settings.quality}</span>
          </div>
          
          <button
            onClick={() => mgr.setShowSettings(!mgr.showSettings)}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title="RustDesk Settings"
          >
            <Settings size={14} />
          </button>
          
          <button
            onClick={() => mgr.setIsFullscreen(!mgr.isFullscreen)}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title={mgr.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {mgr.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {mgr.showSettings && (
        <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="block text-[var(--color-textSecondary)] mb-1">Quality</label>
              <Select value={mgr.settings.quality} onChange={(v: string) => mgr.setSettings({...mgr.settings, quality: v})} options={[{ value: "low", label: "Low" }, { value: "balanced", label: "Balanced" }, { value: "high", label: "High" }, { value: "best", label: "Best" }]} className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs" />
            </div>
            
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.settings.viewOnly} onChange={(v: boolean) => mgr.setSettings({...mgr.settings, viewOnly: v})} className="rounded" />
              <span className="text-[var(--color-textSecondary)]">View Only</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.settings.showCursor} onChange={(v: boolean) => mgr.setSettings({...mgr.settings, showCursor: v})} className="rounded" />
              <span className="text-[var(--color-textSecondary)]">Show Cursor</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.settings.enableAudio} onChange={(v: boolean) => mgr.setSettings({...mgr.settings, enableAudio: v})} className="rounded" />
              <span className="text-[var(--color-textSecondary)]">Audio</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.settings.enableClipboard} onChange={(v: boolean) => mgr.setSettings({...mgr.settings, enableClipboard: v})} className="rounded" />
              <span className="text-[var(--color-textSecondary)]">Clipboard</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.settings.enableFileTransfer} onChange={(v: boolean) => mgr.setSettings({...mgr.settings, enableFileTransfer: v})} className="rounded" />
              <span className="text-[var(--color-textSecondary)]">File Transfer</span>
            </label>
          </div>
        </div>
      )}

      {/* RustDesk Content */}
      <div className="flex-1 flex items-center justify-center bg-black">
        {mgr.connectionStatus === 'connecting' && (
          <ConnectingSpinner
            message="Connecting to RustDesk..."
            detail={session.hostname}
            color="border-orange-400"
          />
        )}
        
        {mgr.connectionStatus === 'error' && (
          <div className="text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2">RustDesk Connection Failed</p>
            <p className="text-gray-500 text-sm">Unable to connect to {session.hostname}</p>
          </div>
        )}
        
        {mgr.connectionStatus === 'connected' && (
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
                  <div>Quality: <span className="text-[var(--color-text)]">{mgr.settings.quality}</span></div>
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
      <StatusBar
        left={
          <div className="flex items-center space-x-4">
            <span>Session: {session.id.slice(0, 8)}</span>
            <span>Protocol: RustDesk</span>
            {mgr.isConnected && (
              <>
                <span>Quality: {mgr.settings.quality}</span>
                <span>Audio: {mgr.settings.enableAudio ? 'On' : 'Off'}</span>
              </>
            )}
          </div>
        }
        right={
          <div className="flex items-center space-x-2">
            <span>RustDesk Remote Desktop</span>
          </div>
        }
      />
    </div>
  );
};
