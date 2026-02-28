import React from "react";
import {
  Monitor,
  Activity,
  Settings,
  Camera,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Circle,
  Play,
  Pause,
  Square,
  Search,
  Maximize2,
  Minimize2,
  RefreshCw,
  Unplug,
  Keyboard,
  Shield,
  Fingerprint,
  Info,
  Pencil,
  Check,
  X,
  LogOut,
  Power,
} from "lucide-react";
import { TOTPConfig } from "../../types/settings";
import RDPTotpPanel from "./RDPTotpPanel";
import { ConfirmDialog } from "../ConfirmDialog";
import { PopoverSurface } from "../ui/PopoverSurface";
import { OptionGroup, OptionItemButton, OptionList } from "../ui/OptionList";
import { useRDPClientHeader } from "../../hooks/useRDPClientHeader";

type Mgr = ReturnType<typeof useRDPClientHeader>;

interface RDPClientHeaderProps {
  sessionName: string;
  sessionHostname: string;
  connectionStatus: string;
  statusMessage: string;
  desktopSize: { width: number; height: number };
  colorDepth: number;
  perfLabel: string;
  magnifierEnabled: boolean;
  magnifierActive: boolean;
  showInternals: boolean;
  showSettings: boolean;
  isFullscreen: boolean;
  recState: { isRecording: boolean; isPaused: boolean; duration: number };
  getStatusColor: () => string;
  getStatusIcon: () => React.ReactNode;
  setMagnifierActive: (v: boolean) => void;
  setShowInternals: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  handleScreenshot: () => void;
  handleScreenshotToClipboard: () => void;
  handleStopRecording: () => void;
  toggleFullscreen: () => void;
  startRecording: (format: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  handleReconnect: () => void;
  handleDisconnect: () => void;
  handleCopyToClipboard: () => void;
  handlePasteFromClipboard: () => void;
  handleSendKeys: (combo: string) => void;
  handleSignOut: () => void;
  handleForceReboot: () => void;
  connectionId: string;
  certFingerprint: string;
  connectionName: string;
  onRenameConnection: (name: string) => void;
  totpConfigs?: TOTPConfig[];
  onUpdateTotpConfigs: (configs: TOTPConfig[]) => void;
  handleAutoTypeTOTP?: (code: string) => void;
  totpDefaultIssuer?: string;
  totpDefaultDigits?: number;
  totpDefaultPeriod?: number;
  totpDefaultAlgorithm?: string;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const btnBase = "p-1 hover:bg-[var(--color-border)] rounded transition-colors";
const btnDefault = `${btnBase} text-[var(--color-textSecondary)] hover:text-[var(--color-text)]`;
const btnActive = `${btnBase} text-[var(--color-text)] bg-[var(--color-border)]`;
const btnDisabled = `${btnBase} text-[var(--color-textSecondary)] cursor-not-allowed`;
const SEND_KEY_OPTIONS = [
  { id: "ctrl-alt-del", label: "Ctrl + Alt + Del" },
  { id: "alt-tab", label: "Alt + Tab" },
  { id: "win", label: "Windows Key" },
  { id: "win-l", label: "Win + L (Lock)" },
  { id: "win-r", label: "Win + R (Run)" },
  { id: "alt-f4", label: "Alt + F4" },
  { id: "print-screen", label: "Print Screen" },
] as const;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const NameDisplay: React.FC<{
  mgr: Mgr;
  sessionName: string;
  sessionHostname: string;
}> = ({ mgr, sessionName, sessionHostname }) =>
  mgr.isEditingName ? (
    <div className="flex items-center space-x-1">
      <input
        ref={mgr.nameInputRef}
        type="text"
        value={mgr.editName}
        onChange={(e) => mgr.setEditName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") mgr.confirmRename();
          if (e.key === "Escape") mgr.cancelRename();
        }}
        onBlur={mgr.confirmRename}
        className="px-2 py-0.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] w-48"
      />
    </div>
  ) : (
    <span
      className="text-sm text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] transition-colors"
      onDoubleClick={mgr.startEditing}
      title="Double-click to rename"
    >
      RDP -{" "}
      {sessionName !== sessionHostname
        ? `${sessionName} (${sessionHostname})`
        : sessionHostname}
    </span>
  );

const ConnectionControls: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => (
  <>
    <button
      onClick={p.handleReconnect}
      className={mgr.canReconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canReconnect}
      title="Reconnect"
    >
      <RefreshCw size={14} />
    </button>
    <button
      onClick={p.handleDisconnect}
      className={mgr.canDisconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canDisconnect}
      title="Disconnect"
    >
      <Unplug size={14} />
    </button>
    <button
      onClick={p.handleSignOut}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      title="Sign out remote session"
    >
      <LogOut size={14} />
    </button>
    <button
      onClick={() => mgr.setShowRebootConfirm(true)}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      title="Reboot remote machine"
    >
      <Power size={14} />
    </button>
  </>
);

const ClipboardButtons: React.FC<{
  isConnected: boolean;
  onCopy: () => void;
  onPaste: () => void;
}> = ({ isConnected, onCopy, onPaste }) => (
  <>
    <button
      onClick={onCopy}
      className={isConnected ? btnDefault : btnDisabled}
      disabled={!isConnected}
      title="Copy to clipboard"
    >
      <Copy size={14} />
    </button>
    <button
      onClick={onPaste}
      className={isConnected ? btnDefault : btnDisabled}
      disabled={!isConnected}
      title="Paste from clipboard"
    >
      <ClipboardPaste size={14} />
    </button>
  </>
);

const SendKeysPopover: React.FC<{
  mgr: Mgr;
  handleSendKeys: (combo: string) => void;
}> = ({ mgr, handleSendKeys }) => (
  <div ref={mgr.sendKeysRef} className="relative">
    <button
      onClick={() => mgr.setShowSendKeys(!mgr.showSendKeys)}
      className={mgr.showSendKeys ? btnActive : btnDefault}
      title="Send key combination"
    >
      <Keyboard size={14} />
    </button>
    <PopoverSurface
      isOpen={mgr.showSendKeys}
      onClose={() => mgr.setShowSendKeys(false)}
      anchorRef={mgr.sendKeysRef}
      className="sor-popover-panel w-48 overflow-hidden"
      dataTestId="rdp-send-keys-popover"
    >
      <OptionList>
        <OptionGroup label="Send Key Sequence">
          {SEND_KEY_OPTIONS.map((item) => (
            <OptionItemButton
              key={item.id}
              onClick={() => {
                handleSendKeys(item.id);
                mgr.setShowSendKeys(false);
              }}
              disabled={!mgr.isConnected}
              className="text-xs"
            >
              {item.label}
            </OptionItemButton>
          ))}
        </OptionGroup>
      </OptionList>
    </PopoverSurface>
  </div>
);

const HostInfoPopover: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => (
  <div ref={mgr.hostInfoRef} className="relative">
    <button
      onClick={() => mgr.setShowHostInfo(!mgr.showHostInfo)}
      className={mgr.showHostInfo ? btnActive : btnDefault}
      title="Host info &amp; certificate"
    >
      <Info size={14} />
    </button>
    <PopoverSurface
      isOpen={mgr.showHostInfo}
      onClose={() => mgr.setShowHostInfo(false)}
      anchorRef={mgr.hostInfoRef}
      className="sor-popover-panel w-72 overflow-hidden"
      dataTestId="rdp-host-info-popover"
    >
      <div>
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1.5">
            Friendly Name
          </div>
          {mgr.isEditingName ? (
            <div className="flex items-center space-x-1">
              <input
                ref={mgr.nameInputRef}
                type="text"
                value={mgr.editName}
                onChange={(e) => mgr.setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") mgr.confirmRename();
                  if (e.key === "Escape") mgr.cancelRename();
                }}
                className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
              />
              <button
                onClick={mgr.confirmRename}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <Check size={12} />
              </button>
              <button
                onClick={mgr.cancelRename}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-textSecondary)]">
                {p.connectionName}
              </span>
              <button
                onClick={mgr.startEditing}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                title="Edit name"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
        </div>
        <div className="px-3 py-2 border-b border-[var(--color-border)] space-y-1">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1">
            Host
          </div>
          <div className="text-xs text-[var(--color-textSecondary)]">
            {p.sessionHostname}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)]">
            Status:{" "}
            <span className="capitalize">{p.connectionStatus}</span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)]">
            Resolution: {p.desktopSize.width}x{p.desktopSize.height} ·{" "}
            {p.colorDepth}-bit
          </div>
        </div>
        <div className="px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1">
            Certificate
          </div>
          <div className="flex items-start space-x-2">
            <Fingerprint
              size={12}
              className="text-[var(--color-textSecondary)] flex-shrink-0 mt-0.5"
            />
            <div className="text-[10px] text-[var(--color-textSecondary)] min-w-0">
              {p.certFingerprint ? (
                <span className="font-mono break-all">
                  {p.certFingerprint}
                </span>
              ) : (
                <span className="italic">No certificate available</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </PopoverSurface>
  </div>
);

const TotpButton: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => {
  const configs = p.totpConfigs ?? [];
  return (
    <div ref={mgr.totpBtnRef} className="relative">
      <button
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        className={`${mgr.showTotpPanel ? btnActive : btnDefault} relative`}
        title="2FA Codes"
      >
        <Shield size={14} />
        {configs.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--color-border)] text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
            {configs.length}
          </span>
        )}
      </button>
      {mgr.showTotpPanel && (
        <RDPTotpPanel
          configs={configs}
          onUpdate={p.onUpdateTotpConfigs}
          onClose={() => mgr.setShowTotpPanel(false)}
          onAutoType={p.handleAutoTypeTOTP}
          defaultIssuer={p.totpDefaultIssuer}
          defaultDigits={p.totpDefaultDigits}
          defaultPeriod={p.totpDefaultPeriod}
          defaultAlgorithm={p.totpDefaultAlgorithm}
          anchorRef={mgr.totpBtnRef}
        />
      )}
    </div>
  );
};

const ToolbarButtons: React.FC<{ p: RDPClientHeaderProps }> = ({ p }) => (
  <>
    {p.magnifierEnabled && (
      <button
        onClick={() => p.setMagnifierActive(!p.magnifierActive)}
        className={p.magnifierActive ? btnActive : btnDefault}
        title="Magnifier Glass"
      >
        <Search size={14} />
      </button>
    )}
    <button
      onClick={() => p.setShowInternals(!p.showInternals)}
      className={p.showInternals ? btnActive : btnDefault}
      title="RDP Internals"
    >
      <Activity size={14} />
    </button>
    <button
      onClick={() => p.setShowSettings(!p.showSettings)}
      className={btnDefault}
      title="RDP Settings"
    >
      <Settings size={14} />
    </button>
    <button
      onClick={p.handleScreenshot}
      className={btnDefault}
      title="Save screenshot to file"
    >
      <Camera size={14} />
    </button>
    <button
      onClick={p.handleScreenshotToClipboard}
      className={btnDefault}
      title="Copy screenshot to clipboard"
    >
      <ClipboardCopy size={14} />
    </button>
  </>
);

const RecordingControls: React.FC<{
  recState: RDPClientHeaderProps["recState"];
  startRecording: (fmt: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  handleStopRecording: () => void;
}> = ({
  recState,
  startRecording,
  pauseRecording,
  resumeRecording,
  handleStopRecording,
}) =>
  !recState.isRecording ? (
    <button
      onClick={() => startRecording("webm")}
      className={btnDefault}
      title="Start recording"
    >
      <Circle size={14} className="fill-current" />
    </button>
  ) : (
    <div className="flex items-center space-x-1">
      <span className="text-[10px] text-[var(--color-textSecondary)] animate-pulse font-mono">
        REC {formatDuration(recState.duration)}
      </span>
      {recState.isPaused ? (
        <button
          onClick={resumeRecording}
          className={btnDefault}
          title="Resume recording"
        >
          <Play size={12} />
        </button>
      ) : (
        <button
          onClick={pauseRecording}
          className={btnDefault}
          title="Pause recording"
        >
          <Pause size={12} />
        </button>
      )}
      <button
        onClick={handleStopRecording}
        className={btnDefault}
        title="Stop and save recording"
      >
        <Square size={12} className="fill-current" />
      </button>
    </div>
  );

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export default function RDPClientHeader(p: RDPClientHeaderProps) {
  const mgr = useRDPClientHeader({
    connectionStatus: p.connectionStatus,
    connectionName: p.connectionName,
    onRenameConnection: p.onRenameConnection,
  });

  return (
    <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <Monitor size={16} className="text-[var(--color-textSecondary)]" />
        <NameDisplay
          mgr={mgr}
          sessionName={p.sessionName}
          sessionHostname={p.sessionHostname}
        />
        <div
          className={`flex items-center space-x-1 ${p.getStatusColor()}`}
        >
          {p.getStatusIcon()}
          <span className="text-xs capitalize">{p.connectionStatus}</span>
        </div>
        {p.statusMessage && (
          <span className="text-xs text-[var(--color-textSecondary)] ml-2 truncate max-w-xs">
            {p.statusMessage}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-1">
        <div className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)] mr-2">
          <span>
            {p.desktopSize.width}x{p.desktopSize.height}
          </span>
          <span>·</span>
          <span>{p.colorDepth}-bit</span>
          <span>·</span>
          <span className="capitalize">{p.perfLabel}</span>
        </div>

        <ConnectionControls mgr={mgr} p={p} />
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <ClipboardButtons
          isConnected={mgr.isConnected}
          onCopy={p.handleCopyToClipboard}
          onPaste={p.handlePasteFromClipboard}
        />
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <SendKeysPopover mgr={mgr} handleSendKeys={p.handleSendKeys} />
        <HostInfoPopover mgr={mgr} p={p} />
        <TotpButton mgr={mgr} p={p} />
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <ToolbarButtons p={p} />
        <RecordingControls
          recState={p.recState}
          startRecording={p.startRecording}
          pauseRecording={p.pauseRecording}
          resumeRecording={p.resumeRecording}
          handleStopRecording={p.handleStopRecording}
        />
        <button
          onClick={p.toggleFullscreen}
          className={btnDefault}
          title={p.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {p.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      <ConfirmDialog
        isOpen={mgr.showRebootConfirm}
        title="Reboot Remote Machine"
        message={`Are you sure you want to force reboot ${p.sessionHostname}? This will immediately restart the remote machine and terminate all running programs.`}
        confirmText="Reboot"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          mgr.setShowRebootConfirm(false);
          p.handleForceReboot();
        }}
        onCancel={() => mgr.setShowRebootConfirm(false)}
      />
    </div>
  );
}
