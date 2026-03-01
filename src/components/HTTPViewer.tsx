import React from 'react';
import {
  Globe,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Home,
  Lock,
  Unlock,
  ExternalLink,
  Maximize2,
  Minimize2,
  AlertCircle,
  Loader2,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useHTTPViewer } from '../hooks/protocol/useHTTPViewer';
import RDPTotpPanel from './rdp/RDPTotpPanel';

interface HTTPViewerProps {
  session: ConnectionSession;
}

type Mgr = ReturnType<typeof useHTTPViewer>;

/* ---------- sub-components ---------- */

function ErrorScreen({ m }: { m: Mgr }) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)] p-8">
      <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
      <h2 className="text-xl font-semibold mb-2">Connection Failed</h2>
      <p className="text-[var(--color-textSecondary)] mb-4 text-center max-w-md">{m.error}</p>
      <button onClick={m.initProxy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2">
        <RefreshCw className="w-4 h-4" />
        Retry Connection
      </button>
    </div>
  );
}

function ConnectingScreen({ m }: { m: Mgr }) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)]">
      <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
      <h2 className="text-lg font-medium">Connecting...</h2>
      <p className="text-[var(--color-textSecondary)] text-sm mt-2">{m.buildTargetUrl()}</p>
    </div>
  );
}

function NavButtons({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={m.goBack} disabled={m.historyIndex <= 0} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded disabled:opacity-50 disabled:cursor-not-allowed" title="Back">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button onClick={m.goForward} disabled={m.historyIndex >= m.history.length - 1} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded disabled:opacity-50 disabled:cursor-not-allowed" title="Forward">
        <ArrowRight className="w-4 h-4" />
      </button>
      <button onClick={m.refresh} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded" title="Refresh">
        <RefreshCw className="w-4 h-4" />
      </button>
      <button onClick={m.goHome} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded" title="Home">
        <Home className="w-4 h-4" />
      </button>
    </div>
  );
}

function UrlBar({ m }: { m: Mgr }) {
  return (
    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-border)]/50 border border-[var(--color-border)] rounded-lg">
      {m.isSecure ? <Lock className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Unlock className="w-4 h-4 text-yellow-500 flex-shrink-0" />}
      <span className="text-[var(--color-textSecondary)] text-sm truncate flex-1">{m.currentUrl}</span>
      {m.resolveCredentials() && (
        <span className="flex items-center gap-1 text-xs text-blue-400 flex-shrink-0">
          <Shield className="w-3 h-3" />
          Authenticated
        </span>
      )}
    </div>
  );
}

function ActionButtons({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={m.openExternal} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded" title="Open in Browser">
        <ExternalLink className="w-4 h-4" />
      </button>
      <div className="relative" ref={m.totpBtnRef}>
        <button type="button" onClick={() => m.setShowTotpPanel(!m.showTotpPanel)} className={`p-1.5 rounded relative ${m.showTotpPanel ? 'text-blue-400 bg-blue-600/20' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'}`} title="2FA Codes">
          <Shield className="w-4 h-4" />
          {m.totpConfigs.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gray-500 text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">{m.totpConfigs.length}</span>
          )}
        </button>
        {m.showTotpPanel && (
          <RDPTotpPanel configs={m.totpConfigs} onUpdate={m.handleUpdateTotpConfigs} onClose={() => m.setShowTotpPanel(false)} defaultIssuer={m.settings.totpIssuer} defaultDigits={m.settings.totpDigits} defaultPeriod={m.settings.totpPeriod} defaultAlgorithm={m.settings.totpAlgorithm} anchorRef={m.totpBtnRef} />
        )}
      </div>
      <button onClick={() => m.setShowSettings(!m.showSettings)} className={`p-1.5 rounded ${m.showSettings ? 'text-blue-400 bg-blue-600/20' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'}`} title="Settings">
        <Settings className="w-4 h-4" />
      </button>
      <button onClick={m.toggleFullscreen} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded" title={m.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
        {m.isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    </div>
  );
}

function SettingsPanel({ m }: { m: Mgr }) {
  if (!m.showSettings) return null;
  return (
    <div className="px-4 py-3 bg-[var(--color-surface)]/80 border-b border-[var(--color-border)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--color-text)]">Connection Settings</h3>
        <button onClick={() => m.setShowSettings(false)} className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-[var(--color-textSecondary)]">Target URL:</span>
          <p className="text-[var(--color-text)] truncate">{m.buildTargetUrl()}</p>
        </div>
        <div>
          <span className="text-[var(--color-textSecondary)]">Proxy Session:</span>
          <p className="text-[var(--color-text)] font-mono text-xs truncate">{m.proxySessionId || 'Direct'}</p>
        </div>
        <div>
          <span className="text-[var(--color-textSecondary)]">Authentication:</span>
          <p className="text-[var(--color-text)]">{m.resolveCredentials() ? 'Basic Auth' : 'None'}</p>
        </div>
        <div>
          <span className="text-[var(--color-textSecondary)]">Protocol:</span>
          <p className="text-[var(--color-text)]">{m.session.protocol.toUpperCase()}</p>
        </div>
      </div>
    </div>
  );
}

function IframeContent({ m }: { m: Mgr }) {
  return (
    <div className="flex-1 relative min-h-0">
      {m.proxyUrl && (
        <iframe ref={m.iframeRef} src={m.proxyUrl} className="absolute inset-0 w-full h-full border-0 bg-white" onLoad={m.handleIframeLoad} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals" title={`HTTP Viewer - ${m.connection?.name || m.session.hostname}`} />
      )}
    </div>
  );
}

function StatusBar({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-[var(--color-surface)] border-t border-[var(--color-border)] text-xs text-[var(--color-textSecondary)]">
      <div className="flex items-center gap-2">
        <Globe className="w-3 h-3" />
        <span>{m.connection?.name || m.session.hostname}</span>
      </div>
      <div className="flex items-center gap-4">
        {m.proxySessionId && <span className="text-gray-500">Proxied via localhost</span>}
        <span className={m.status === 'connected' ? 'text-green-400' : 'text-yellow-400'}>
          {m.status === 'connected' ? 'Connected' : 'Loading...'}
        </span>
      </div>
    </div>
  );
}

/* ---------- root ---------- */

export const HTTPViewer: React.FC<HTTPViewerProps> = ({ session }) => {
  const m = useHTTPViewer(session);

  if (m.status === 'error') return <ErrorScreen m={m} />;
  if (m.status === 'connecting') return <ConnectingScreen m={m} />;

  return (
    <div className={`flex flex-col h-full bg-[var(--color-background)] ${m.isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <NavButtons m={m} />
        <UrlBar m={m} />
        <ActionButtons m={m} />
      </div>
      <SettingsPanel m={m} />
      <IframeContent m={m} />
      <StatusBar m={m} />
    </div>
  );
};

export default HTTPViewer;
