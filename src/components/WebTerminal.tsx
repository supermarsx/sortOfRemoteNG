import React from "react";
import "@xterm/xterm/css/xterm.css";
import {
  Clipboard,
  Copy,
  FileCode,
  Maximize2,
  Minimize2,
  RotateCcw,
  StopCircle,
  Trash2,
  X,
  Play,
  Search,
  Filter,
  Unplug,
  Fingerprint,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Circle,
  CircleDot,
  PlayCircle,
  Square as SquareIcon,
} from "lucide-react";
import RDPTotpPanel from "./rdp/RDPTotpPanel";
import {
  OSTag,
  OS_TAG_LABELS,
  OS_TAG_ICONS,
} from "./ScriptManager";
import { CertificateInfoPopup } from "./CertificateInfoPopup";
import { TrustWarningDialog } from "./TrustWarningDialog";
import {
  getStoredIdentity,
  formatFingerprint,
} from "../utils/trustStore";
import { Modal } from "./ui/Modal";
import { PopoverSurface } from "./ui/PopoverSurface";
import {
  OptionEmptyState,
  OptionItemButton,
  OptionList,
} from "./ui/OptionList";
import { ConnectionSession } from "../types/connection";
import { useWebTerminal, type WebTerminalMgr } from "../hooks/ssh/useWebTerminal";

/* ── Props ─────────────────────────────────────────────────────── */

interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

/* ── Sub-components ────────────────────────────────────────────── */

function RecordingButton({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.terminalRecorder.isRecording) {
    return (
      <button
        onClick={mgr.handleStartRecording}
        className="app-bar-button p-2"
        data-tooltip="Record Session"
        aria-label="Record Session"
        disabled={mgr.status !== "connected"}
      >
        <Circle size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={mgr.handleStopRecording}
      className="app-bar-button p-2 text-red-400"
      data-tooltip="Stop Recording"
      aria-label="Stop Recording"
    >
      <SquareIcon size={12} fill="currentColor" />
      <span className="ml-1 text-[10px] font-mono animate-pulse">
        REC {mgr.formatDuration(mgr.terminalRecorder.duration)}
      </span>
    </button>
  );
}

function MacroRecordButton({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.macroRecorder.isRecording) {
    return (
      <button
        onClick={mgr.handleStartMacroRecording}
        className="app-bar-button p-2"
        data-tooltip="Record Macro"
        aria-label="Record Macro"
        disabled={mgr.status !== "connected"}
      >
        <CircleDot size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={mgr.handleStopMacroRecording}
      className="app-bar-button p-2 text-orange-400"
      data-tooltip="Stop Macro Recording"
      aria-label="Stop Macro Recording"
    >
      <SquareIcon size={12} fill="currentColor" />
      <span className="ml-1 text-[10px] font-mono animate-pulse">
        MACRO
      </span>
    </button>
  );
}

function MacroReplayPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.macroListRef}>
      {mgr.replayingMacro ? (
        <button
          onClick={mgr.handleStopReplay}
          className="app-bar-button p-2 text-orange-400"
          data-tooltip="Stop Replay"
          aria-label="Stop Replay"
        >
          <StopCircle size={14} />
        </button>
      ) : (
        <button
          onClick={() => mgr.setShowMacroList((v) => !v)}
          className={`app-bar-button p-2 ${mgr.showMacroList ? "text-blue-400" : ""}`}
          data-tooltip="Replay Macro"
          aria-label="Replay Macro"
          disabled={mgr.status !== "connected"}
        >
          <PlayCircle size={14} />
        </button>
      )}
      <PopoverSurface
        isOpen={mgr.showMacroList}
        onClose={() => mgr.setShowMacroList(false)}
        anchorRef={mgr.macroListRef}
        className="sor-popover-panel w-64 max-h-64 overflow-y-auto"
        dataTestId="web-terminal-macro-popover"
      >
        <OptionList>
          {mgr.savedMacros.length === 0 ? (
            <OptionEmptyState>No saved macros</OptionEmptyState>
          ) : (
            mgr.savedMacros.map((m) => (
              <OptionItemButton
                key={m.id}
                onClick={() => mgr.handleReplayMacro(m)}
                divider
                className="text-sm"
              >
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {m.steps.length} steps
                </div>
              </OptionItemButton>
            ))
          )}
        </OptionList>
      </PopoverSurface>
    </div>
  );
}

function HostKeyPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.keyPopupRef}>
      <button
        type="button"
        onClick={() => mgr.setShowKeyPopup((v) => !v)}
        className="app-bar-button p-2"
        data-tooltip="Host key info"
        aria-label="Host key info"
      >
        <Fingerprint size={14} />
      </button>
      {mgr.showKeyPopup && (
        <CertificateInfoPopup
          type="ssh"
          host={mgr.session.hostname}
          port={mgr.connection?.port || 22}
          currentIdentity={mgr.hostKeyIdentity ?? undefined}
          trustRecord={getStoredIdentity(
            mgr.session.hostname,
            mgr.connection?.port || 22,
            "ssh",
            mgr.connection?.id,
          )}
          connectionId={mgr.connection?.id}
          triggerRef={mgr.keyPopupRef}
          onClose={() => mgr.setShowKeyPopup(false)}
        />
      )}
    </div>
  );
}

function TotpPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.totpBtnRef}>
      <button
        type="button"
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        className={`app-bar-button p-2 relative ${mgr.showTotpPanel ? "text-blue-400" : ""}`}
        data-tooltip="2FA Codes"
        aria-label="2FA Codes"
      >
        <Shield size={14} />
        {mgr.totpConfigs.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gray-500 text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
            {mgr.totpConfigs.length}
          </span>
        )}
      </button>
      {mgr.showTotpPanel && (
        <RDPTotpPanel
          configs={mgr.totpConfigs}
          onUpdate={mgr.handleUpdateTotpConfigs}
          onClose={() => mgr.setShowTotpPanel(false)}
          defaultIssuer={mgr.settings.totpIssuer}
          defaultDigits={mgr.settings.totpDigits}
          defaultPeriod={mgr.settings.totpPeriod}
          defaultAlgorithm={mgr.settings.totpAlgorithm}
          anchorRef={mgr.totpBtnRef}
        />
      )}
    </div>
  );
}

function TerminalToolbar({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={mgr.copySelection}
        className="app-bar-button p-2"
        data-tooltip="Copy selection"
        aria-label="Copy selection"
      >
        <Copy size={14} />
      </button>
      <button
        onClick={mgr.pasteFromClipboard}
        className="app-bar-button p-2"
        data-tooltip="Paste"
        aria-label="Paste"
      >
        <Clipboard size={14} />
      </button>
      {mgr.isSsh && (
        <>
          <button
            onClick={() => mgr.setShowScriptSelector(true)}
            className="app-bar-button p-2"
            data-tooltip="Run Script"
            aria-label="Run Script"
          >
            <FileCode size={14} />
          </button>
          <button
            onClick={mgr.sendCancel}
            className="app-bar-button p-2 hover:text-red-500"
            data-tooltip="Send Ctrl+C"
            aria-label="Send Ctrl+C"
          >
            <StopCircle size={14} />
          </button>
          <button
            onClick={mgr.disconnectSsh}
            className="app-bar-button p-2 hover:text-red-500"
            data-tooltip="Disconnect"
            aria-label="Disconnect"
            disabled={mgr.status !== "connected"}
          >
            <Unplug size={14} />
          </button>
          <button
            onClick={mgr.handleReconnect}
            className="app-bar-button p-2"
            data-tooltip="Reconnect"
            aria-label="Reconnect"
          >
            <RotateCcw size={14} />
          </button>
          <RecordingButton mgr={mgr} />
          <MacroRecordButton mgr={mgr} />
          <MacroReplayPopover mgr={mgr} />
          <HostKeyPopover mgr={mgr} />
        </>
      )}
      <TotpPopover mgr={mgr} />
      <button
        onClick={mgr.clearTerminal}
        className="app-bar-button p-2"
        data-tooltip="Clear"
        aria-label="Clear"
      >
        <Trash2 size={14} />
      </button>
      <button
        onClick={mgr.toggleFullscreen}
        className="app-bar-button p-2"
        data-tooltip={mgr.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        aria-label={mgr.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {mgr.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}

function TerminalStatusBar({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[10px] uppercase tracking-[0.2em]">
      <span className={`app-badge ${mgr.statusToneClass}`}>
        {mgr.status === "connected"
          ? "Connected"
          : mgr.status === "connecting"
            ? "Connecting"
            : mgr.status === "error"
              ? "Error"
              : "Idle"}
      </span>
      {mgr.error && (
        <span className="app-badge app-badge--error normal-case tracking-normal">
          {mgr.error}
        </span>
      )}
      {mgr.isSsh && (
        <span className="app-badge app-badge--info">SSH lib: Rust</span>
      )}
      {mgr.terminalRecorder.isRecording && (
        <span className="app-badge app-badge--error animate-pulse">
          REC {mgr.formatDuration(mgr.terminalRecorder.duration)}
        </span>
      )}
      {mgr.macroRecorder.isRecording && (
        <span className="app-badge app-badge--warning animate-pulse">
          MACRO ({mgr.macroRecorder.steps.length} steps)
        </span>
      )}
      {mgr.replayingMacro && (
        <span className="app-badge app-badge--info animate-pulse">
          Replaying...
        </span>
      )}
      <HostKeyTrustBadges mgr={mgr} />
    </div>
  );
}

function HostKeyTrustBadges({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.isSsh || !mgr.hostKeyIdentity || !mgr.hostKeyIdentity.fingerprint) return null;

  const sshPort = mgr.connection?.port || 22;
  const stored = getStoredIdentity(
    mgr.session.hostname,
    sshPort,
    "ssh",
    mgr.connection?.id,
  );
  const trustLabel = stored
    ? stored.userApproved
      ? "Trusted"
      : "Remembered (TOFU)"
    : "Unknown";
  const trustBadge = stored
    ? stored.userApproved
      ? "app-badge--success"
      : "app-badge--info"
    : "app-badge--warning";
  const TrustBadgeIcon = stored
    ? stored.userApproved
      ? ShieldCheck
      : Shield
    : ShieldAlert;
  const shortFp =
    formatFingerprint(mgr.hostKeyIdentity.fingerprint).slice(0, 23) + "…";

  return (
    <>
      <span
        className={`app-badge ${trustBadge}`}
        title={`Host key: ${trustLabel}`}
      >
        <TrustBadgeIcon size={10} className="mr-1 inline" />
        {trustLabel}
      </span>
      {mgr.hostKeyIdentity.keyType && (
        <span
          className="app-badge app-badge--neutral"
          title="Host key algorithm"
        >
          <Key size={10} className="mr-1 inline" />
          {mgr.hostKeyIdentity.keyType}
          {mgr.hostKeyIdentity.keyBits
            ? ` (${mgr.hostKeyIdentity.keyBits})`
            : ""}
        </span>
      )}
      <span
        className="app-badge app-badge--neutral normal-case tracking-normal font-mono cursor-pointer hover:opacity-80"
        title={`SHA-256: ${formatFingerprint(mgr.hostKeyIdentity.fingerprint)}`}
        onClick={() => mgr.setShowKeyPopup((v) => !v)}
      >
        <Fingerprint size={10} className="mr-1 inline" />
        {shortFp}
      </span>
    </>
  );
}

function ScriptSelectorModal({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.showScriptSelector) return null;
  return (
    <Modal
      isOpen={mgr.showScriptSelector}
      onClose={mgr.closeScriptSelector}
      backdropClassName="bg-black/50"
      panelClassName="max-w-[500px] mx-4"
      dataTestId="web-terminal-script-selector-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-h-[70vh] flex flex-col border border-[var(--color-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <FileCode size={18} className="text-green-500" />
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              Run Script
            </h3>
          </div>
          <button
            onClick={mgr.closeScriptSelector}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-[var(--color-border)]">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            />
            <input
              type="text"
              value={mgr.scriptSearchQuery}
              onChange={(e) => mgr.setScriptSearchQuery(e.target.value)}
              placeholder="Search scripts..."
              className="w-full pl-9 pr-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500/50"
              autoFocus
            />
          </div>
        </div>

        {/* Compact Filters Bar */}
        <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[var(--color-textMuted)]">
            <Filter size={12} />
            <span className="text-xs font-medium">Filters:</span>
          </div>
          <select
            value={mgr.scriptCategoryFilter}
            onChange={(e) => mgr.setScriptCategoryFilter(e.target.value)}
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
          >
            <option value="all">All Categories</option>
            {mgr.uniqueCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select
            value={mgr.scriptLanguageFilter}
            onChange={(e) => mgr.setScriptLanguageFilter(e.target.value)}
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
          >
            <option value="all">All Languages</option>
            {mgr.uniqueLanguages.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <select
            value={mgr.scriptOsTagFilter}
            onChange={(e) => mgr.setScriptOsTagFilter(e.target.value)}
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
          >
            <option value="all">All Platforms</option>
            {mgr.uniqueOsTags.map((tag) => (
              <option key={tag} value={tag}>
                {OS_TAG_ICONS[tag as OSTag]} {OS_TAG_LABELS[tag as OSTag]}
              </option>
            ))}
          </select>
          {(mgr.scriptCategoryFilter !== "all" ||
            mgr.scriptLanguageFilter !== "all" ||
            mgr.scriptOsTagFilter !== "all") && (
            <button
              onClick={() => {
                mgr.setScriptCategoryFilter("all");
                mgr.setScriptLanguageFilter("all");
                mgr.setScriptOsTagFilter("all");
              }}
              className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors ml-auto"
            >
              Clear
            </button>
          )}
        </div>

        {/* Script List */}
        <div className="flex-1 overflow-auto p-2">
          {Object.keys(mgr.scriptsByCategory).length === 0 ? (
            <div className="text-center py-8 text-[var(--color-textMuted)]">
              <FileCode size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scripts found</p>
              <p className="text-xs mt-1">Add scripts in the Script Manager</p>
            </div>
          ) : (
            Object.entries(mgr.scriptsByCategory).map(([category, categoryScripts]) => (
              <div key={category} className="mb-3">
                <div className="text-xs font-semibold text-[var(--color-textMuted)] uppercase tracking-wider px-2 py-1">
                  {category}
                </div>
                <div className="space-y-1">
                  {categoryScripts.map((script) => (
                    <button
                      key={script.id}
                      onClick={() => mgr.runScript(script)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surfaceHover)] transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-text)] truncate">
                              {script.name}
                            </span>
                            {script.osTags && script.osTags.length > 0 && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {script.osTags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[10px]"
                                    title={OS_TAG_LABELS[tag]}
                                  >
                                    {OS_TAG_ICONS[tag]}
                                  </span>
                                ))}
                                {script.osTags.length > 2 && (
                                  <span className="text-[10px] text-[var(--color-textMuted)]">
                                    +{script.osTags.length - 2}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {script.description && (
                            <div className="text-xs text-[var(--color-textMuted)] truncate">
                              {script.description}
                            </div>
                          )}
                        </div>
                        <Play
                          size={14}
                          className="text-green-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function SshTrustDialog({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.sshTrustPrompt || !mgr.hostKeyIdentity) return null;
  return (
    <TrustWarningDialog
      type="ssh"
      host={mgr.session.hostname}
      port={mgr.connection?.port || 22}
      reason={mgr.sshTrustPrompt.status === "mismatch" ? "mismatch" : "first-use"}
      receivedIdentity={mgr.hostKeyIdentity}
      storedIdentity={
        mgr.sshTrustPrompt.status === "mismatch"
          ? mgr.sshTrustPrompt.stored
          : undefined
      }
      onAccept={() => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.(true);
        mgr.sshTrustResolveRef.current = null;
      }}
      onReject={() => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.(false);
        mgr.sshTrustResolveRef.current = null;
      }}
    />
  );
}

/* ── Root component ────────────────────────────────────────────── */

const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const mgr = useWebTerminal(session, onResize);

  return (
    <div
      className={`flex flex-col ${mgr.isFullscreen ? "fixed inset-0 z-50" : "h-full"}`}
      style={{
        backgroundColor: "var(--color-background)",
        color: "var(--color-text)",
      }}
    >
      <div className="app-bar border-b relative z-20 overflow-visible">
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {session.name || "Terminal"}
            </div>
            <div className="truncate text-xs uppercase tracking-[0.2em] text-[var(--color-textSecondary)]">
              {session.protocol.toUpperCase()} - {session.hostname}
            </div>
          </div>
          <TerminalToolbar mgr={mgr} />
        </div>
        <TerminalStatusBar mgr={mgr} />
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          ref={mgr.containerRef}
          className="h-full w-full rounded-lg border relative overflow-hidden"
          style={{
            backgroundColor: "var(--color-background)",
            borderColor: "var(--color-border)",
          }}
        />
      </div>

      <ScriptSelectorModal mgr={mgr} />
      <SshTrustDialog mgr={mgr} />
    </div>
  );
};

export { WebTerminal };
export default WebTerminal;
