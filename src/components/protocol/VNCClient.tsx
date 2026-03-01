import React from 'react';
import { 
  Monitor, 
  Maximize2, 
  Minimize2, 
  Settings, 
  Wifi, 
  WifiOff,
  MousePointer,
  Keyboard,
  Copy,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection';
import { useVNCClient, VNCSettings } from '../../hooks/protocol/useVNCClient';
import { StatusBar, ConnectingSpinner } from '../ui/display';
import { Checkbox } from '../ui/forms';

interface VNCClientProps {
  session: ConnectionSession;
}

type Mgr = ReturnType<typeof useVNCClient>;

/* ---------- sub-components ---------- */

function VNCHeader({ m }: { m: Mgr }) {
  const statusIcon = m.getStatusIcon();
  return (
    <div className="sor-toolbar-row">
      <div className="flex items-center space-x-3">
        <Monitor size={16} className="text-blue-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">VNC - {m.session.hostname}</span>
        <div className={`flex items-center space-x-1 ${m.getStatusColor()}`}>
          {statusIcon === 'connected' ? <Wifi size={14} /> : statusIcon === 'connecting' ? <Wifi size={14} className="animate-pulse" /> : <WifiOff size={14} />}
          <span className="text-xs capitalize">{m.connectionStatus}</span>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)]">
          <span>1024x768</span>
          <span>·</span>
          <span>24-bit</span>
        </div>
        <button onClick={m.sendCtrlAltDel} className="px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded transition-colors" title="Send Ctrl+Alt+Del">Ctrl+Alt+Del</button>
        <button onClick={() => m.setShowSettings(!m.showSettings)} className="sor-icon-btn-sm" title="VNC Settings"><Settings size={14} /></button>
        <button onClick={m.toggleFullscreen} className="sor-icon-btn-sm" title={m.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{m.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>
    </div>
  );
}

function SettingsPanel({ m }: { m: Mgr }) {
  if (!m.showSettings) return null;
  const toggle = (key: keyof VNCSettings) => (v: boolean) => m.setSettings({ ...m.settings, [key]: v });
  return (
    <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <label className="flex items-center space-x-2"><Checkbox checked={m.settings.viewOnly} onChange={toggle('viewOnly')} className="rounded" /><span className="text-[var(--color-textSecondary)]">View Only</span></label>
        <label className="flex items-center space-x-2"><Checkbox checked={m.settings.scaleViewport} onChange={toggle('scaleViewport')} className="rounded" /><span className="text-[var(--color-textSecondary)]">Scale Viewport</span></label>
        <label className="flex items-center space-x-2"><Checkbox checked={m.settings.clipViewport} onChange={toggle('clipViewport')} className="rounded" /><span className="text-[var(--color-textSecondary)]">Clip Viewport</span></label>
        <label className="flex items-center space-x-2"><Checkbox checked={m.settings.localCursor} onChange={toggle('localCursor')} className="rounded" /><span className="text-[var(--color-textSecondary)]">Local Cursor</span></label>
      </div>
    </div>
  );
}

function CanvasArea({ m }: { m: Mgr }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-black p-4">
      {m.connectionStatus === 'connecting' && (
        <ConnectingSpinner
          message="Connecting to VNC server..."
          detail={m.session.hostname}
        />
      )}
      {m.connectionStatus === 'error' && (
        <div className="text-center">
          <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-red-400 mb-2">VNC Connection Failed</p>
          <p className="text-[var(--color-textMuted)] text-sm">Unable to connect to {m.session.hostname}</p>
        </div>
      )}
      {m.connectionStatus === 'connected' && (
        <canvas ref={m.canvasRef} className="border border-[var(--color-border)] cursor-crosshair max-w-full max-h-full" onClick={m.handleCanvasClick} onKeyDown={m.handleKeyDown} onKeyUp={m.handleKeyUp} tabIndex={0} style={{ imageRendering: 'pixelated', objectFit: 'contain' }} />
      )}
    </div>
  );
}

function VNCStatusBar({ m }: { m: Mgr }) {
  return (
    <StatusBar
      left={
        <div className="flex items-center space-x-4">
          <span>Session: {m.session.id.slice(0, 8)}</span>
          <span>Protocol: VNC</span>
          {m.isConnected && (
            <>
              <span>Encoding: Raw</span>
              <span>Compression: Level {m.settings.compressionLevel}</span>
            </>
          )}
        </div>
      }
      right={
        <div className="flex items-center space-x-2">
          <MousePointer size={12} />
          <Keyboard size={12} />
          <Copy size={12} />
        </div>
      }
    />
  );
}

/* ---------- root ---------- */

export const VNCClient: React.FC<VNCClientProps> = ({ session }) => {
  const m = useVNCClient(session);
  return (
    <div className={`flex flex-col bg-[var(--color-background)] ${m.isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      <VNCHeader m={m} />
      <SettingsPanel m={m} />
      <CanvasArea m={m} />
      <VNCStatusBar m={m} />
    </div>
  );
};
