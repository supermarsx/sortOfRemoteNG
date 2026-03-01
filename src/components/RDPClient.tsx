import React from 'react';
import { ConnectionSession } from '../types/connection';
import {
  Monitor,
  Wifi,
  WifiOff,
  ZoomIn,
} from 'lucide-react';
import RdpErrorScreen from './RdpErrorScreen';
import { ConnectingSpinner } from './ui/display';
import { TrustWarningDialog } from './TrustWarningDialog';
import { RDPInternalsPanel } from './rdp/RDPInternalsPanel';
import { RDPStatusBar } from './rdp/RDPStatusBar';
import RDPClientHeader from './rdp/RDPClientHeader';
import { RDPSettingsPanel } from './rdp/RDPSettingsPanel';
import { useRDPClient, type RDPClientMgr } from '../hooks/rdp/useRDPClient';

// ─── Props ───────────────────────────────────────────────────────────

interface RDPClientProps {
  session: ConnectionSession;
}

// ─── Status helpers ──────────────────────────────────────────────────

function getStatusColor(connectionStatus: string): string {
  switch (connectionStatus) {
    case 'connected': return 'text-green-400';
    case 'connecting': return 'text-yellow-400';
    case 'reconnecting': return 'text-amber-400';
    case 'error': return 'text-red-400';
    default: return 'text-[var(--color-textSecondary)]';
  }
}

function getStatusIcon(connectionStatus: string): React.ReactNode {
  switch (connectionStatus) {
    case 'connected': return <Wifi size={14} />;
    case 'connecting': return <Wifi size={14} className="animate-pulse" />;
    case 'reconnecting': return <Wifi size={14} className="animate-pulse" />;
    default: return <WifiOff size={14} />;
  }
}

// ─── Sub-components ──────────────────────────────────────────────────

const MagnifierOverlay: React.FC<{ mgr: RDPClientMgr }> = ({ mgr }) => (
  <>
    <canvas
      ref={mgr.magnifierCanvasRef}
      className="absolute pointer-events-none border-2 border-blue-500 rounded-full shadow-lg shadow-blue-900/50"
      style={{
        left: `${mgr.magnifierPos.x - 80}px`,
        top: `${mgr.magnifierPos.y - 80}px`,
        width: '160px',
        height: '160px',
      }}
      width={160}
      height={160}
    />
    <div className="absolute top-2 right-2 bg-blue-600 bg-opacity-80 text-[var(--color-text)] text-xs px-2 py-1 rounded flex items-center gap-1">
      <ZoomIn size={12} />
      {mgr.magnifierZoom}x
    </div>
  </>
);

const ConnectingOverlay: React.FC<{ mgr: RDPClientMgr; session: ConnectionSession }> = ({ mgr, session }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60">
    <ConnectingSpinner
      message="Connecting to RDP server..."
      detail={session.name !== session.hostname ? `${session.name} (${session.hostname})` : session.hostname}
      statusMessage={mgr.statusMessage || undefined}
    />
  </div>
);

const ErrorOverlay: React.FC<{ mgr: RDPClientMgr; session: ConnectionSession }> = ({ mgr, session }) => (
  <RdpErrorScreen
    sessionId={mgr.rdpSessionId || session.id}
    hostname={session.hostname}
    errorMessage={mgr.statusMessage || `Unable to connect to ${session.hostname}`}
    onRetry={mgr.handleRetry}
    connectionDetails={{
      port: mgr.connection?.port || 3389,
      username: mgr.connection?.username || '',
      password: mgr.connection?.password || '',
      domain: (mgr.connection as Record<string, unknown> | undefined)?.domain as string | undefined,
      rdpSettings: mgr.rdpSettings,
    }}
  />
);

const DisconnectedOverlay: React.FC = () => (
  <div className="text-center">
    <Monitor size={48} className="text-gray-600 mx-auto mb-4" />
    <p className="text-[var(--color-textSecondary)]">Disconnected</p>
  </div>
);

const CanvasArea: React.FC<{ mgr: RDPClientMgr; session: ConnectionSession }> = ({ mgr, session }) => (
  <div ref={mgr.containerRef} className="flex-1 flex items-center justify-center bg-black p-1 relative min-h-0 overflow-hidden">
    <canvas
      ref={mgr.canvasRef}
      className="border border-[var(--color-border)] max-w-full max-h-full"
      style={{
        cursor: mgr.magnifierActive ? 'crosshair' : mgr.pointerStyle,
        imageRendering: 'auto',
        objectFit: 'contain',
        display: mgr.connectionStatus !== 'disconnected' ? 'block' : 'none',
      }}
      onMouseMove={mgr.handleMouseMove}
      onMouseDown={mgr.handleMouseDown}
      onMouseUp={mgr.handleMouseUp}
      onWheel={mgr.handleWheel}
      onKeyDown={mgr.handleKeyDown}
      onKeyUp={mgr.handleKeyUp}
      onContextMenu={mgr.handleContextMenu}
      tabIndex={0}
      width={mgr.desktopSize.width}
      height={mgr.desktopSize.height}
    />

    {mgr.magnifierEnabled && mgr.magnifierActive && mgr.isConnected && (
      <MagnifierOverlay mgr={mgr} />
    )}

    {mgr.connectionStatus === 'connecting' && (
      <ConnectingOverlay mgr={mgr} session={session} />
    )}

    {mgr.connectionStatus === 'error' && (
      <ErrorOverlay mgr={mgr} session={session} />
    )}

    {mgr.connectionStatus === 'disconnected' && (
      <DisconnectedOverlay />
    )}
  </div>
);

// ─── Root component ──────────────────────────────────────────────────

const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const mgr = useRDPClient(session);

  return (
    <div className={`flex flex-col bg-[var(--color-background)] ${mgr.isFullscreen ? 'fixed inset-0 z-50' : 'h-full overflow-hidden'}`}>
      <RDPClientHeader
        sessionName={session.name}
        sessionHostname={session.hostname}
        connectionStatus={mgr.connectionStatus}
        statusMessage={mgr.statusMessage}
        desktopSize={mgr.desktopSize}
        colorDepth={mgr.colorDepth}
        perfLabel={mgr.perfLabel}
        magnifierEnabled={mgr.magnifierEnabled}
        magnifierActive={mgr.magnifierActive}
        showInternals={mgr.showInternals}
        showSettings={mgr.showSettings}
        isFullscreen={mgr.isFullscreen}
        recState={mgr.recState}
        getStatusColor={() => getStatusColor(mgr.connectionStatus)}
        getStatusIcon={() => getStatusIcon(mgr.connectionStatus)}
        setMagnifierActive={mgr.setMagnifierActive}
        setShowInternals={mgr.setShowInternals}
        setShowSettings={mgr.setShowSettings}
        handleScreenshot={mgr.handleScreenshot}
        handleScreenshotToClipboard={mgr.handleScreenshotToClipboard}
        handleStopRecording={mgr.handleStopRecording}
        toggleFullscreen={mgr.toggleFullscreen}
        startRecording={mgr.startRecording}
        pauseRecording={mgr.pauseRecording}
        resumeRecording={mgr.resumeRecording}
        handleReconnect={mgr.handleReconnect}
        handleDisconnect={mgr.handleDisconnect}
        handleCopyToClipboard={mgr.handleCopyToClipboard}
        handlePasteFromClipboard={mgr.handlePasteFromClipboard}
        handleSendKeys={mgr.handleSendKeys}
        handleSignOut={mgr.handleSignOut}
        handleForceReboot={mgr.handleForceReboot}
        connectionId={session.connectionId}
        certFingerprint={mgr.certFingerprint ?? ''}
        connectionName={mgr.connection?.name || session.name}
        onRenameConnection={mgr.handleRenameConnection}
        totpConfigs={mgr.connection?.totpConfigs}
        onUpdateTotpConfigs={mgr.handleUpdateTotpConfigs}
        handleAutoTypeTOTP={mgr.handleAutoTypeTOTP}
        totpDefaultIssuer={mgr.settings.totpIssuer}
        totpDefaultDigits={mgr.settings.totpDigits}
        totpDefaultPeriod={mgr.settings.totpPeriod}
        totpDefaultAlgorithm={mgr.settings.totpAlgorithm}
      />

      {mgr.showSettings && (
        <RDPSettingsPanel
          rdpSettings={mgr.rdpSettings}
          colorDepth={mgr.colorDepth}
          audioEnabled={mgr.audioEnabled}
          clipboardEnabled={mgr.clipboardEnabled}
          perfLabel={mgr.perfLabel}
          certFingerprint={mgr.certFingerprint}
        />
      )}

      {mgr.showInternals && (
        <RDPInternalsPanel
          stats={mgr.stats}
          connectTiming={mgr.connectTiming}
          rdpSettings={mgr.rdpSettings}
          activeRenderBackend={mgr.activeRenderBackend}
          activeFrontendRenderer={mgr.activeFrontendRenderer}
          onClose={() => mgr.setShowInternals(false)}
        />
      )}

      <CanvasArea mgr={mgr} session={session} />

      <RDPStatusBar
        rdpSessionId={mgr.rdpSessionId}
        sessionId={session.id}
        isConnected={mgr.isConnected}
        desktopSize={mgr.desktopSize}
        stats={mgr.stats}
        certFingerprint={mgr.certFingerprint}
        audioEnabled={mgr.audioEnabled}
        clipboardEnabled={mgr.clipboardEnabled}
        magnifierActive={mgr.magnifierActive}
      />

      {mgr.trustPrompt && mgr.certIdentity && (
        <TrustWarningDialog
          type="tls"
          host={session.hostname}
          port={mgr.connection?.port || 3389}
          reason={mgr.trustPrompt.status === 'mismatch' ? 'mismatch' : 'first-use'}
          receivedIdentity={mgr.certIdentity}
          storedIdentity={mgr.trustPrompt.status === 'mismatch' ? mgr.trustPrompt.stored : undefined}
          onAccept={mgr.handleTrustAccept}
          onReject={mgr.handleTrustReject}
        />
      )}
    </div>
  );
};

export { RDPClient };
export default RDPClient;
