import React from 'react';
import { ConnectionSession } from '../../types/connection/connection';
import {
  Monitor,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import RDPErrorScreen from './RDPErrorScreen';
import { ConnectingSpinner } from '../ui/display';
import { TrustWarningDialog } from '../security/TrustWarningDialog';
import { RDPInternalsPanel } from './RDPInternalsPanel';
import { RDPStatusBar } from './RDPStatusBar';
import RDPClientHeader from './RDPClientHeader';
import { RDPSettingsPanel } from './RDPSettingsPanel';
import WindowsToolsBar from './WindowsToolsBar';
import { useRDPClient, type RDPClientMgr } from '../../hooks/rdp/useRDPClient';

// ─── Props ───────────────────────────────────────────────────────────

interface RDPClientProps {
  session: ConnectionSession;
  onActivateSession?: (sessionId: string) => void;
}

// ─── Status helpers ──────────────────────────────────────────────────

function getStatusColor(connectionStatus: string): string {
  switch (connectionStatus) {
    case 'connected': return 'text-success';
    case 'connecting': return 'text-warning';
    case 'reconnecting': return 'text-warning';
    case 'error': return 'text-error';
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

const MagnifierPiP: React.FC<{ mgr: RDPClientMgr }> = ({ mgr }) => {
  if (!mgr.magnifierActive || !mgr.isConnected) return null;

  const pipW = mgr.magnifierPipSize ?? 280;
  const pipH = Math.round(pipW * 0.75);
  const corner = mgr.magnifierCorner ?? 'bottom-right';

  // Position for each corner
  const positions: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 8, right: 8, top: 'auto', left: 'auto' },
    'bottom-left':  { bottom: 8, left: 8, top: 'auto', right: 'auto' },
    'top-right':    { top: 8, right: 8, bottom: 'auto', left: 'auto' },
    'top-left':     { top: 8, left: 8, bottom: 'auto', right: 'auto' },
  };

  return (
    <div
      className="absolute z-50 rounded-lg overflow-hidden shadow-2xl border border-[var(--color-border)]/50 pointer-events-none"
      style={{
        width: pipW,
        height: pipH,
        transition: 'top 300ms ease, bottom 300ms ease, left 300ms ease, right 300ms ease, width 200ms ease, height 200ms ease',
        ...positions[corner],
      }}
    >
      <canvas
        ref={mgr.magnifierCanvasRef}
        className="w-full h-full bg-black"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};

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
  <RDPErrorScreen
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
    <Monitor size={48} className="text-[var(--color-textMuted)] mx-auto mb-4" />
    <p className="text-[var(--color-textSecondary)]">Disconnected</p>
  </div>
);

const CanvasArea: React.FC<{ mgr: RDPClientMgr; session: ConnectionSession }> = ({ mgr, session }) => {
  // Smart sizing: scale the canvas to fit via CSS objectFit.
  // Resize to window: canvas buffer matches container — no CSS scaling needed.
  // Neither: fixed size, may overflow (scrollbars handled by container).
  const smartSizing = mgr.rdpSettings?.display?.smartSizing !== false;
  const resizeToWindow = mgr.rdpSettings?.display?.resizeToWindow === true;

  // File drag-drop state
  const [dragOver, setDragOver] = React.useState(false);
  const [dropStatus, setDropStatus] = React.useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [transferProgress, setTransferProgress] = React.useState<{ transferred: number; total: number; fileName: string } | null>(null);
  const dropDismissRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for file transfer progress events from backend
  React.useEffect(() => {
    if (!mgr.rdpSessionId) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ session_id: string; file_name: string; transferred: number; total: number }>(
        'rdp://file-transfer-progress',
        (event) => {
          if (event.payload.session_id !== mgr.rdpSessionId) return;
          setTransferProgress({
            transferred: event.payload.transferred,
            total: event.payload.total,
            fileName: event.payload.file_name,
          });
          // Clear progress when complete
          if (event.payload.transferred >= event.payload.total) {
            setTimeout(() => setTransferProgress(null), 2000);
          }
        },
      ).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [mgr.rdpSessionId]);

  // Resolve whether file drag-drop is enabled (per-connection → global)
  const fileDragDropEnabled =
    mgr.rdpSettings?.deviceRedirection?.fileDragDrop ??
    mgr.settings?.enableFileDragDropToRdp ??
    true;

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!fileDragDropEnabled || !mgr.isConnected) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, [fileDragDropEnabled, mgr.isConnected]);

  const handleDragLeave = React.useCallback(() => setDragOver(false), []);

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!fileDragDropEnabled || !mgr.isConnected || !mgr.rdpSessionId) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const sizeStr = totalSize < 1024 ? `${totalSize}B`
      : totalSize < 1024 * 1024 ? `${(totalSize / 1024).toFixed(1)}KB`
      : totalSize < 1024 * 1024 * 1024 ? `${(totalSize / (1024 * 1024)).toFixed(1)}MB`
      : `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)}GB`;

    try {
      setDropStatus({ message: `Staging ${files.length} file(s) (${sizeStr})...`, type: 'info' });

      // Stage files to a local transfer directory so the backend can read them
      const base = await appDataDir();
      const transferDir = await join(base, 'rdp-transfers');
      if (!(await exists(transferDir))) {
        await mkdir(transferDir, { recursive: true });
      }

      const fileEntries: { name: string; size: number; path: string }[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const dest = await join(transferDir, file.name);
        await writeFile(dest, new Uint8Array(buf));
        fileEntries.push({ name: file.name, size: file.size, path: dest });
      }

      // Send to backend for CLIPRDR file transfer via FileGroupDescriptorW
      await invoke('rdp_clipboard_copy_files', {
        sessionId: mgr.rdpSessionId,
        files: fileEntries,
      });

      setDropStatus({
        message: `${files.length} file(s) (${sizeStr}) sent to remote clipboard — use Ctrl+V on remote to paste`,
        type: 'info',
      });
    } catch (err) {
      setDropStatus({
        message: `File transfer failed: ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
      });
    }

    if (dropDismissRef.current) clearTimeout(dropDismissRef.current);
    dropDismissRef.current = setTimeout(() => setDropStatus(null), 8000);
  }, [fileDragDropEnabled, mgr.isConnected, mgr.rdpSessionId]);

  return (
  <div
    ref={mgr.containerRef}
    className="flex-1 flex items-center justify-center bg-black p-1 relative min-h-0"
    style={{ overflow: smartSizing || resizeToWindow ? 'hidden' : 'auto' }}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
  >
    {/* Drop overlay */}
    {dragOver && fileDragDropEnabled && (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary/20 border-2 border-dashed border-primary rounded-lg pointer-events-none">
        <div className="bg-[var(--color-surface)] px-6 py-4 rounded-xl shadow-2xl border border-primary/50 text-center">
          <div className="text-lg font-semibold text-primary mb-1">Drop files here</div>
          <div className="text-xs text-[var(--color-textSecondary)]">Files will be transferred to remote clipboard</div>
        </div>
      </div>
    )}

    {/* Drop status toast + progress bar */}
    {(dropStatus || transferProgress) && (
      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-80 rounded-lg shadow-xl border overflow-hidden ${
        dropStatus?.type === 'error' ? 'bg-error/20 border-error/50' :
        'bg-[var(--color-surface)] border-primary/50'
      }`}>
        {dropStatus && (
          <div className={`px-4 py-2.5 text-xs ${
            dropStatus.type === 'success' ? 'text-success' :
            dropStatus.type === 'error' ? 'text-error' :
            'text-primary'
          }`}>
            {dropStatus.message}
          </div>
        )}
        {transferProgress && transferProgress.total > 0 && (
          <div className="px-4 pb-3 pt-1">
            <div className="flex items-center justify-between text-[10px] text-[var(--color-textSecondary)] mb-1.5">
              <span className="truncate max-w-[60%]">{transferProgress.fileName}</span>
              <span>{Math.round((transferProgress.transferred / transferProgress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${Math.min(100, (transferProgress.transferred / transferProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    )}
    <canvas
      ref={mgr.canvasRef}
      className="border border-[var(--color-border)]"
      style={{
        cursor: !mgr.mouseEnabled ? 'not-allowed' : mgr.pointerStyle,
        imageRendering: 'auto',
        // Smart sizing: constrain canvas to container and scale with objectFit
        ...(smartSizing && !resizeToWindow ? {
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain' as const,
        } : {}),
        // Resize to window: canvas IS the container size — no scaling
        ...(resizeToWindow ? {
          width: '100%',
          height: '100%',
        } : {}),
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

    <MagnifierPiP mgr={mgr} />

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
};

// ─── Root component ──────────────────────────────────────────────────

const RDPClient: React.FC<RDPClientProps> = ({ session, onActivateSession }) => {
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
        magnifierActive={mgr.magnifierActive}
        magnifierZoom={mgr.magnifierZoom}
        magnifierPipSize={mgr.magnifierPipSize}
        setMagnifierZoom={mgr.setMagnifierZoom}
        setMagnifierPipSize={mgr.setMagnifierPipSize}
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
        serverCertValidation={mgr.connection?.rdpSettings?.security?.serverCertValidation}
        onUpdateServerCertValidation={mgr.handleUpdateServerCertValidation}
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

      {(mgr.connection?.osType === 'windows' || (!mgr.connection?.osType && session.protocol === 'rdp')) && (
        <WindowsToolsBar
          connectionId={session.connectionId}
          connectionName={mgr.connection?.name || session.name}
          hostname={session.hostname}
          focusOnWinmgmtTool={mgr.connection?.focusOnWinmgmtTool}
          enableWinrmTools={mgr.connection?.enableWinrmTools}
          onActivateSession={onActivateSession}
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
        mouseEnabled={mgr.mouseEnabled}
        keyboardEnabled={mgr.keyboardEnabled}
        rdpSettings={mgr.rdpSettings}
        onToggleInput={mgr.handleToggleInput}
        onToggleRedirection={mgr.handleToggleRedirection}
        onToggleAudio={mgr.handleToggleAudio}
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
