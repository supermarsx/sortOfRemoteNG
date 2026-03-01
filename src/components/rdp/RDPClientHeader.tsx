import { RDPClientHeaderProps } from "./rdpClientHeader/helpers";
import NameDisplay from "./rdpClientHeader/NameDisplay";
import ConnectionControls from "./rdpClientHeader/ConnectionControls";
import ClipboardButtons from "./rdpClientHeader/ClipboardButtons";
import SendKeysPopover from "./rdpClientHeader/SendKeysPopover";
import HostInfoPopover from "./rdpClientHeader/HostInfoPopover";
import TotpButton from "./rdpClientHeader/TotpButton";
import ToolbarButtons from "./rdpClientHeader/ToolbarButtons";
import RecordingControls from "./rdpClientHeader/RecordingControls";

export default function RDPClientHeader(p: RDPClientHeaderProps) {
  const mgr = useRDPClientHeader({
    connectionStatus: p.connectionStatus,
    connectionName: p.connectionName,
    onRenameConnection: p.onRenameConnection,
  });

  return (
    <div className="sor-toolbar-row">
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

