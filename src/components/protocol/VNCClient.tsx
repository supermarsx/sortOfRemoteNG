import React from "react";
import {
  AlertTriangle,
  Bell,
  Copy,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer,
  RefreshCw,
  Settings,
  Unplug,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  useVNCClient,
  type VNCSettings,
} from "../../hooks/protocol/useVNCClient";
import { ConnectingSpinner, StatusBar } from "../ui/display";
import { Checkbox } from "../ui/forms";
import { SessionFullscreenExitControl } from "../session/SessionFullscreenExitControl";

interface VNCClientProps {
  session: ConnectionSession;
}

type Mgr = ReturnType<typeof useVNCClient>;

function VNCHeader({ m }: { m: Mgr }) {
  const statusIcon = m.getStatusIcon();
  return (
    <div className="sor-toolbar-row">
      <div className="flex items-center space-x-3">
        <Monitor size={16} className="text-primary" />
        <span className="text-sm text-[var(--color-textSecondary)]">
          VNC - {m.session.hostname}
        </span>
        <div className={`flex items-center space-x-1 ${m.getStatusColor()}`}>
          {statusIcon === "connected" ? (
            <Wifi size={14} />
          ) : statusIcon === "connecting" ? (
            <Wifi size={14} className="animate-pulse" />
          ) : (
            <WifiOff size={14} />
          )}
          <span className="text-xs capitalize">{m.connectionStatus}</span>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={() => void m.sendClipboardFromSystem()}
          disabled={!m.isConnected || m.settings.viewOnly}
          className="sor-icon-btn-sm"
          title="Send local clipboard to VNC"
          aria-label="Send local clipboard to VNC"
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          onClick={() => void m.sendCtrlAltDel()}
          disabled={!m.isConnected || m.settings.viewOnly}
          className="rounded bg-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-surfaceHover)] disabled:opacity-50"
          title="Send Ctrl+Alt+Del"
        >
          Ctrl+Alt+Del
        </button>
        <button
          type="button"
          onClick={() => m.setShowSettings(!m.showSettings)}
          className="sor-icon-btn-sm"
          title="VNC Settings"
        >
          <Settings size={14} />
        </button>
        {(m.connectionStatus === "disconnected" ||
          m.connectionStatus === "error") && (
          <button
            type="button"
            onClick={() => void m.reconnect()}
            className="sor-icon-btn-sm"
            title="Reconnect VNC"
            aria-label="Reconnect VNC"
          >
            <RefreshCw size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void m.disconnect()}
          disabled={!m.backendSessionId}
          className="sor-icon-btn-sm text-error"
          title="Disconnect VNC"
          aria-label="Disconnect VNC"
        >
          <Unplug size={14} />
        </button>
        <button
          type="button"
          onClick={m.toggleFullscreen}
          className="sor-icon-btn-sm"
          title={m.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={m.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={m.isFullscreen}
          data-session-fullscreen-trigger={m.session.id}
        >
          {m.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({ m }: { m: Mgr }) {
  if (!m.showSettings) return null;
  const toggle = (key: keyof VNCSettings) => (value: boolean) =>
    m.setSettings({ ...m.settings, [key]: value });
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <label className="flex items-center space-x-2">
          <Checkbox
            checked={m.settings.viewOnly}
            onChange={toggle("viewOnly")}
            className="rounded"
          />
          <span className="text-[var(--color-textSecondary)]">View Only</span>
        </label>
        <label className="flex items-center space-x-2">
          <Checkbox
            checked={m.settings.scaleViewport}
            onChange={toggle("scaleViewport")}
            className="rounded"
          />
          <span className="text-[var(--color-textSecondary)]">
            Scale Viewport
          </span>
        </label>
        <label className="flex items-center space-x-2">
          <Checkbox
            checked={m.settings.clipViewport}
            onChange={toggle("clipViewport")}
            className="rounded"
          />
          <span className="text-[var(--color-textSecondary)]">
            Clip Viewport
          </span>
        </label>
        <label className="flex items-center space-x-2">
          <Checkbox
            checked={m.settings.localCursor}
            onChange={toggle("localCursor")}
            className="rounded"
          />
          <span className="text-[var(--color-textSecondary)]">
            Local Cursor
          </span>
        </label>
      </div>
    </div>
  );
}

function CanvasArea({ m }: { m: Mgr }) {
  return (
    <div
      className={`relative flex flex-1 items-center justify-center bg-black ${m.isFullscreen ? "p-0" : "p-4"}`}
    >
      <canvas
        ref={m.canvasRef}
        data-session-focus-target
        className={`${m.isFullscreen ? "max-h-full max-w-full border-0" : "max-h-full max-w-full border border-[var(--color-border)]"} ${m.settings.viewOnly ? "cursor-default" : "cursor-crosshair"} ${m.connectionStatus === "connected" ? "block" : "absolute pointer-events-none opacity-0"}`}
        onClick={m.handleCanvasClick}
        onKeyDown={m.handleKeyDown}
        onKeyUp={m.handleKeyUp}
        tabIndex={0}
        style={{
          imageRendering: "pixelated",
          objectFit: "contain",
          aspectRatio: m.sessionInfo
            ? `${m.sessionInfo.framebuffer_width} / ${m.sessionInfo.framebuffer_height}`
            : undefined,
        }}
      />
      {m.connectionStatus === "connecting" && (
        <ConnectingSpinner
          message="Connecting through the native VNC transport..."
          detail={m.session.hostname}
        />
      )}
      {m.connectionStatus === "error" && (
        <div className="text-center">
          <WifiOff size={48} className="mx-auto mb-4 text-error" />
          <p className="mb-2 text-error">VNC Connection Failed</p>
          <p className="text-sm text-[var(--color-textMuted)]">
            Unable to connect safely to {m.session.hostname}
          </p>
          {m.errorMessage && (
            <p
              role="alert"
              className="mt-3 max-w-md rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs text-[var(--color-textSecondary)]"
            >
              {m.errorMessage}
            </p>
          )}
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
            onClick={() => void m.reconnect()}
          >
            <RefreshCw size={14} /> Retry native VNC
          </button>
        </div>
      )}
      {m.connectionStatus === "disconnected" && (
        <div className="text-center text-[var(--color-textSecondary)]">
          <WifiOff size={36} className="mx-auto mb-3" />
          <p>VNC session disconnected</p>
        </div>
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
          <span>Protocol: Native VNC</span>
          {m.sessionInfo && (
            <>
              <span>
                {m.sessionInfo.framebuffer_width}x
                {m.sessionInfo.framebuffer_height}
              </span>
              <span>
                Security: {m.sessionInfo.security_type || "negotiating"}
              </span>
            </>
          )}
        </div>
      }
      right={
        <div className="flex items-center space-x-2">
          {m.bellCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Bell size={12} /> {m.bellCount}
            </span>
          )}
          {m.remoteClipboardAvailable && (
            <button
              type="button"
              className="inline-flex items-center gap-1 underline"
              onClick={() => void m.copyRemoteClipboard()}
            >
              <Copy size={12} /> Copy remote clipboard
            </button>
          )}
          <MousePointer size={12} />
          <Keyboard size={12} />
        </div>
      }
    />
  );
}

export const VNCClient: React.FC<VNCClientProps> = ({ session }) => {
  const manager = useVNCClient(session);
  return (
    <div
      className={`flex flex-col bg-[var(--color-background)] ${manager.isFullscreen ? "fixed inset-0 z-[1200] overflow-hidden" : "h-full"}`}
      data-session-fullscreen-root={session.id}
      tabIndex={-1}
    >
      <SessionFullscreenExitControl
        sessionId={session.id}
        sessionName={session.name || session.hostname}
        isFullscreen={manager.isFullscreen}
        onExit={manager.toggleFullscreen}
      />
      {!manager.isFullscreen && <VNCHeader m={manager} />}
      {!manager.isFullscreen && <SettingsPanel m={manager} />}
      {!manager.isFullscreen && manager.unsafeConsentLabels.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-error/40 bg-error/10 px-4 py-2 text-xs text-error"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Explicit VNC exceptions enabled:{" "}
          {manager.unsafeConsentLabels.join(", ")}.
        </div>
      )}
      <CanvasArea m={manager} />
      {!manager.isFullscreen && <VNCStatusBar m={manager} />}
    </div>
  );
};
