import React from 'react';
import { ConnectionSession } from '../../types/connection/connection';
import {
  Monitor,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { formatBytes } from '../../utils/core/formatters';
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

/** Fixed position styles for each magnifier corner. */
const magnifierPositions: Record<string, React.CSSProperties> = {
  'bottom-right': { bottom: 8, right: 8, top: 'auto', left: 'auto' },
  'bottom-left':  { bottom: 8, left: 8, top: 'auto', right: 'auto' },
  'top-right':    { top: 8, right: 8, bottom: 'auto', left: 'auto' },
  'top-left':     { top: 8, left: 8, bottom: 'auto', right: 'auto' },
};

const MagnifierPiP: React.FC<{ mgr: RDPClientMgr }> = ({ mgr }) => {
  if (!mgr.magnifierActive || !mgr.isConnected) return null;

  const pipW = mgr.magnifierPipSize ?? 280;
  const pipH = Math.round(pipW * 0.75);
  const corner = mgr.magnifierCorner ?? 'bottom-right';

  return (
    <div
      className="absolute z-50 rounded-lg overflow-hidden shadow-2xl border border-[var(--color-border)]/50 pointer-events-none"
      style={{
        width: pipW,
        height: pipH,
        transition: 'top 300ms ease, bottom 300ms ease, left 300ms ease, right 300ms ease, width 200ms ease, height 200ms ease',
        ...magnifierPositions[corner],
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
  const [dropStatus, setDropStatus] = React.useState<{ message: string; type: 'success' | 'info' | 'error'; spinning?: boolean } | null>(null);
  const [transferProgress, setTransferProgress] = React.useState<{
    transferred: number; total: number; fileName: string;
    fileCount: number; filesDone: number;
  } | null>(null);
  const dropDismissRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for file transfer progress events from backend
  React.useEffect(() => {
    if (!mgr.rdpSessionId) return;
    const listenPromise = import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ session_id: string; file_name: string; transferred: number; total: number; file_count: number; files_done: number }>(
        'rdp://file-transfer-progress',
        (event) => {
          if (event.payload.session_id !== mgr.rdpSessionId) return;
          setTransferProgress({
            transferred: event.payload.transferred,
            total: event.payload.total,
            fileName: event.payload.file_name,
            fileCount: event.payload.file_count,
            filesDone: event.payload.files_done,
          });
          // Clear progress when complete
          if (event.payload.transferred >= event.payload.total) {
            setTimeout(() => setTransferProgress(null), 2000);
          }
        },
      )
    );
    return () => { listenPromise.then(fn => fn()); };
  }, [mgr.rdpSessionId]);

  // Resolve whether file drag-drop is enabled (per-connection → global)
  const fileDragDropEnabled =
    mgr.rdpSettings?.deviceRedirection?.fileDragDrop ??
    mgr.settings?.enableFileDragDropToRdp ??
    true;
  const canvasAriaLabel = `Remote desktop session to ${session.hostname}. Press Ctrl+Alt+End to release keyboard focus.`;

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!mgr.isConnected) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fileDragDropEnabled ? 'copy' : 'none';
    if (fileDragDropEnabled) setDragOver(true);
  }, [fileDragDropEnabled, mgr.isConnected]);

  const handleDragLeave = React.useCallback(() => setDragOver(false), []);

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!mgr.isConnected || !mgr.rdpSessionId) return;

    if (!fileDragDropEnabled) {
      setDropStatus({ message: 'File drag & drop is disabled — enable it in the status bar or connection settings', type: 'error' });
      if (dropDismissRef.current) clearTimeout(dropDismissRef.current);
      dropDismissRef.current = setTimeout(() => setDropStatus(null), 5000);
      return;
    }

    type DropEntry = { name: string; size: number; path: string; isDirectory: boolean };

    // Live scan progress counters (mutated during walk, read by status updates)
    const scan = { files: 0, dirs: 0, bytes: 0, current: '', lastYield: Date.now() };
    /** Yield to the browser so React can paint status updates (throttled to avoid excessive delays). */
    const yieldToBrowser = async () => {
      const now = Date.now();
      if (now - scan.lastYield >= 80) {
        scan.lastYield = now;
        await new Promise<void>(r => setTimeout(r, 0));
      }
    };
    const scanMsg = () => {
      const parts = [
        scan.files > 0 ? `${scan.files} file${scan.files > 1 ? 's' : ''}` : '',
        scan.dirs > 0 ? `${scan.dirs} folder${scan.dirs > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(', ');
      return `Scanning: ${parts || '...'}${scan.bytes > 0 ? ` (${formatBytes(scan.bytes)})` : ''}${scan.current ? ` — ${scan.current}` : ''}`;
    };

    /** Recursively walk a FileSystemEntry tree and stage files to disk. */
    async function walkEntry(
      entry: FileSystemEntry,
      prefix: string,
      transferDir: string,
    ): Promise<DropEntry[]> {
      const out: DropEntry[] = [];
      const clipName = prefix ? `${prefix}\\${entry.name}` : entry.name;

      if (entry.isDirectory) {
        scan.dirs++;
        scan.current = entry.name;
        setDropStatus({ message: scanMsg(), type: 'info', spinning: true });
        await yieldToBrowser();
        out.push({ name: clipName, size: 0, path: '', isDirectory: true });

        const dirReader = (entry as FileSystemDirectoryEntry).createReader();
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          const all: FileSystemEntry[] = [];
          const readBatch = () => {
            dirReader.readEntries((batch) => {
              if (batch.length === 0) { resolve(all); return; }
              all.push(...batch);
              readBatch();
            }, reject);
          };
          readBatch();
        });

        for (const child of children) {
          out.push(...await walkEntry(child, clipName, transferDir));
        }
      } else {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        const relDir = prefix.replace(/\\/g, '/');
        if (relDir) {
          const sub = await join(transferDir, relDir);
          if (!(await exists(sub))) await mkdir(sub, { recursive: true });
        }
        const dest = await join(transferDir, clipName.replace(/\\/g, '/'));
        await writeFile(dest, new Uint8Array(await file.arrayBuffer()));
        scan.files++;
        scan.bytes += file.size;
        scan.current = file.name;
        setDropStatus({ message: scanMsg(), type: 'info', spinning: true });
        await yieldToBrowser();
        out.push({ name: clipName, size: file.size, path: dest, isDirectory: false });
      }
      return out;
    }

    // Capture entries synchronously — browser clears DataTransfer after the event handler returns
    const topEntries: FileSystemEntry[] = [];
    const fallbackFiles: File[] = [];
    const items = e.dataTransfer.items;
    if (items?.length) {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) topEntries.push(entry);
      }
    }
    if (topEntries.length === 0) {
      fallbackFiles.push(...Array.from(e.dataTransfer.files));
    }
    if (topEntries.length === 0 && fallbackFiles.length === 0) return;

    // Validate total size of dropped files (100 MB limit)
    const MAX_DROP_SIZE = 100 * 1024 * 1024;
    const allFiles = Array.from(e.dataTransfer.files);
    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_DROP_SIZE) {
      setDropStatus({ message: `Total file size (${formatBytes(totalSize)}) exceeds the 100 MB limit`, type: 'error' });
      if (dropDismissRef.current) clearTimeout(dropDismissRef.current);
      dropDismissRef.current = setTimeout(() => setDropStatus(null), 5000);
      return;
    }

    // Confirm transfer with user before proceeding
    const fileCount = allFiles.length;
    if (!window.confirm(`Transfer ${fileCount} file${fileCount > 1 ? 's' : ''} (${formatBytes(totalSize)}) to remote session?`)) {
      return;
    }

    try {
      setDropStatus({ message: 'Scanning dropped items...', type: 'info', spinning: true });
      await yieldToBrowser();

      const base = await appDataDir();
      const transferDir = await join(base, 'rdp-transfers');
      if (!(await exists(transferDir))) {
        await mkdir(transferDir, { recursive: true });
      }

      const allEntries: DropEntry[] = [];

      if (topEntries.length > 0) {
        for (const entry of topEntries) {
          allEntries.push(...await walkEntry(entry, '', transferDir));
        }
      } else {
        // Fallback: plain File objects (no directory support)
        for (const file of fallbackFiles) {
          const dest = await join(transferDir, file.name);
          await writeFile(dest, new Uint8Array(await file.arrayBuffer()));
          scan.files++;
          scan.bytes += file.size;
          setDropStatus({ message: scanMsg(), type: 'info', spinning: true });
          await yieldToBrowser();
          allEntries.push({ name: file.name, size: file.size, path: dest, isDirectory: false });
        }
      }

      if (allEntries.length === 0) return;

      const countStr = [
        scan.files > 0 ? `${scan.files} file${scan.files > 1 ? 's' : ''}` : '',
        scan.dirs > 0 ? `${scan.dirs} folder${scan.dirs > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(', ');
      const sizeStr = formatBytes(scan.bytes);

      setDropStatus({ message: `Sending ${countStr} (${sizeStr})...`, type: 'info', spinning: true });

      await invoke('rdp_clipboard_copy_files', {
        sessionId: mgr.rdpSessionId,
        files: allEntries,
      });

      setDropStatus({
        message: `${countStr} (${sizeStr}) sent to remote clipboard — use Ctrl+V on remote to paste`,
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
          <div className="text-xs text-[var(--color-textSecondary)]">Files and folders will be transferred to remote clipboard</div>
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
          <div className={`px-4 py-2.5 text-xs flex items-center gap-2 ${
            dropStatus.type === 'success' ? 'text-success' :
            dropStatus.type === 'error' ? 'text-error' :
            'text-primary'
          }`}>
            {dropStatus.spinning && <Loader2 size={12} className="animate-spin flex-shrink-0" />}
            <span className="min-w-0 truncate">{dropStatus.message}</span>
          </div>
        )}
        {transferProgress && transferProgress.total > 0 && (
          <div className="px-4 pb-3 pt-1 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-[var(--color-textSecondary)]">
              <span className="truncate max-w-[55%]" title={transferProgress.fileName}>{transferProgress.fileName}</span>
              <span className="text-[var(--color-textMuted)] flex-shrink-0">
                {transferProgress.filesDone + 1}/{transferProgress.fileCount} files
              </span>
            </div>
            <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${Math.min(100, (transferProgress.transferred / transferProgress.total) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-[var(--color-textMuted)]">
              <span>{formatBytes(transferProgress.transferred)} / {formatBytes(transferProgress.total)}</span>
              <span>{Math.round((transferProgress.transferred / transferProgress.total) * 100)}%</span>
            </div>
          </div>
        )}
      </div>
    )}
    <canvas
      ref={mgr.canvasRef}
      data-testid="rdp-canvas"
      className="border border-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      aria-label={canvasAriaLabel}
      aria-keyshortcuts="Control+Alt+End"
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
