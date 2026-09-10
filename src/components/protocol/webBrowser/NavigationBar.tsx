import type { SectionProps } from "./types";
import RecordingControls from "./RecordingControls";
import SecurityIcon, { AuthIcon } from "./SecurityIcon";
import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  ExternalLink,
  Shield,
  ShieldOff,
  Globe,
  Star,
  Copy,
  Download,
  ClipboardCopy,
  X,
  ChevronDown,
  Eraser,
} from "lucide-react";
import WebTotpPanel from "./WebTotpPanel";
import { CertificateInfoPopup } from "../../security/CertificateInfoPopup";
import { useCertificateTrustRecord } from "../../../hooks/security/useCertificateTrustRecord";
import { MenuSurface } from "../../ui/overlays/MenuSurface";

const NavigationBar: React.FC<SectionProps> = ({ mgr }) => {
  const [historyMenu, setHistoryMenu] = useState<{
    direction: "back" | "forward";
    x: number;
    y: number;
  } | null>(null);
  const backMenuRef = useRef<HTMLButtonElement>(null);
  const forwardMenuRef = useRef<HTMLButtonElement>(null);
  const historyEntries =
    historyMenu?.direction === "back"
      ? (mgr.backHistory ?? [])
      : (mgr.forwardHistory ?? []);
  const openHistory = (
    direction: "back" | "forward",
    button: HTMLButtonElement,
  ) => {
    const rect = button.getBoundingClientRect();
    setHistoryMenu((previous) =>
      previous?.direction === direction
        ? null
        : { direction, x: rect.left, y: rect.bottom + 4 },
    );
  };
  const trust = useCertificateTrustRecord(
    mgr.showCertPopup && mgr.isSecure,
    mgr.certificateHost,
    mgr.connection?.port || 443,
    "https",
    mgr.connection?.id,
  );
  return (
    <div className="flex items-center space-x-3 mb-3">
      {/* Nav buttons */}
      <div className="flex space-x-1">
        <button
          onClick={mgr.handleBack}
          disabled={!mgr.canGoBack}
          className={`p-2 rounded transition-colors ${
            mgr.canGoBack
              ? "hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              : "text-[var(--color-textMuted)] cursor-not-allowed"
          }`}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          ref={backMenuRef}
          type="button"
          onClick={(event) => openHistory("back", event.currentTarget)}
          disabled={!mgr.canGoBack}
          title="Back history"
          aria-label="Back history"
          aria-haspopup="menu"
          aria-expanded={historyMenu?.direction === "back"}
          className="sor-icon-btn-sm px-1 disabled:opacity-40"
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={mgr.handleForward}
          disabled={!mgr.canGoForward}
          className={`p-2 rounded transition-colors ${
            mgr.canGoForward
              ? "hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              : "text-[var(--color-textMuted)] cursor-not-allowed"
          }`}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={16} />
        </button>
        <button
          ref={forwardMenuRef}
          type="button"
          onClick={(event) => openHistory("forward", event.currentTarget)}
          disabled={!mgr.canGoForward}
          title="Forward history"
          aria-label="Forward history"
          aria-haspopup="menu"
          aria-expanded={historyMenu?.direction === "forward"}
          className="sor-icon-btn-sm px-1 disabled:opacity-40"
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={mgr.isLoading ? mgr.handleCancelLoading : mgr.handleRefresh}
          className="sor-icon-btn-sm"
          title={mgr.isLoading ? "Stop loading" : "Refresh"}
          aria-label={mgr.isLoading ? "Stop loading" : "Refresh"}
          type="button"
        >
          {mgr.isLoading ? <X size={16} /> : <RotateCcw size={16} />}
        </button>
        <button
          type="button"
          className="sor-icon-btn-sm"
          title="Clear session data"
          aria-label="Clear session data"
          disabled={mgr.clearingSession}
          onClick={() => mgr.setShowClearSessionConfirm(true)}
        >
          <Eraser size={16} />
        </button>
      </div>
      <MenuSurface
        isOpen={historyMenu !== null}
        onClose={() => setHistoryMenu(null)}
        position={historyMenu}
        ignoreRefs={[backMenuRef, forwardMenuRef]}
        ariaLabel={
          historyMenu?.direction === "back" ? "Back history" : "Forward history"
        }
        className="w-80 max-w-[calc(100vw-1rem)] max-h-[min(60vh,24rem)] overflow-y-auto rounded-lg py-1"
      >
        <div className="px-3 py-2 text-xs text-[var(--color-textMuted)]">
          Jump {historyMenu?.direction === "back" ? "back" : "forward"} to a
          page
        </div>
        {historyEntries.map((entry, distance) => (
          <button
            key={entry.index}
            type="button"
            role="menuitem"
            className="sor-menu-item gap-2 py-2 text-xs"
            title={entry.url}
            aria-label={`${distance + 1} ${distance === 0 ? "page" : "pages"} ${historyMenu?.direction === "back" ? "back" : "forward"}: ${entry.url}`}
            onClick={() => {
              mgr.handleHistoryJump(entry.index);
              setHistoryMenu(null);
            }}
          >
            <span className="shrink-0 tabular-nums text-[var(--color-textMuted)]">
              {distance + 1}
            </span>
            <span className="min-w-0 truncate">{entry.url}</span>
          </button>
        ))}
      </MenuSurface>

      {/* URL Bar */}
      <form onSubmit={mgr.handleUrlSubmit} className="flex-1 flex items-center">
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
            <div className="relative" ref={mgr.certPopupRef}>
              <SecurityIcon mgr={mgr} />
              {mgr.showCertPopup && mgr.isSecure && (
                <CertificateInfoPopup
                  type="https"
                  key={`${mgr.certificateHost}:${mgr.connection?.port || 443}:${mgr.connection?.id}`}
                  host={mgr.certificateHost}
                  port={mgr.connection?.port || 443}
                  currentIdentity={mgr.certIdentity ?? undefined}
                  trustRecord={trust.record}
                  connectionId={trust.connectionId}
                  trustLookup={trust}
                  inspection={mgr.certificateInspection ?? undefined}
                  requiresApproval={
                    mgr.trustPrompt?.status === "first-use" &&
                    mgr.trustPrompt.requiresApproval
                  }
                  triggerRef={mgr.certPopupRef}
                  onClose={() => mgr.setShowCertPopup(false)}
                />
              )}
            </div>
            {mgr.sslVerifyDisabled && (
              <span
                title="SSL verification is disabled for this connection"
                className="flex items-center"
              >
                <ShieldOff size={14} className="text-error" />
              </span>
            )}
            <AuthIcon hasAuth={mgr.hasAuth} authLabel={mgr.authLabel} />
            <Globe
              size={14}
              className="text-[var(--color-textSecondary)] flex-shrink-0"
            />
            <div className="w-px h-4 bg-[var(--color-surfaceHover)] flex-shrink-0" />
          </div>
          <input
            type="text"
            value={mgr.inputUrl}
            onChange={(e) => mgr.setInputUrl(e.target.value)}
            className="w-full pr-4 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
            style={{ paddingLeft: `${mgr.iconPadding}px` }}
            placeholder="Enter URL..."
          />
        </div>
      </form>

      {/* Action buttons */}
      <button
        onClick={mgr.handleAddBookmark}
        className={`p-2 hover:bg-[var(--color-border)] rounded transition-colors ${
          mgr.isCurrentPageBookmarked
            ? "text-warning"
            : "text-[var(--color-textSecondary)] hover:text-warning"
        }`}
        title={
          mgr.isCurrentPageBookmarked
            ? "Page is bookmarked"
            : "Bookmark this page"
        }
      >
        <Star
          size={16}
          fill={mgr.isCurrentPageBookmarked ? "currentColor" : "none"}
        />
      </button>
      <button
        onClick={mgr.handleSavePage}
        className="sor-icon-btn-sm"
        title="Print / Save as PDF"
      >
        <Download size={16} />
      </button>
      <button
        onClick={mgr.handleCopyAll}
        className="sor-icon-btn-sm"
        title="Copy all page content"
      >
        <ClipboardCopy size={16} />
      </button>
      <button
        onClick={mgr.handleOpenInNewTab}
        className="sor-icon-btn-sm"
        title="Open in new tab"
      >
        <Copy size={16} />
      </button>
      {/* 2FA / TOTP */}
      <div className="relative" ref={mgr.totpBtnRef}>
        <button
          type="button"
          onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
          className={`p-2 rounded transition-colors relative ${mgr.showTotpPanel ? "text-primary bg-primary/20" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"}`}
          title="2FA Codes — manually copy a configured authenticator code"
          aria-label="2FA Codes"
        >
          <Shield size={16} />
          {mgr.totpConfigs.length > 0 && (
            <span className="sor-notification-dot">
              {mgr.totpConfigs.length}
            </span>
          )}
        </button>
        {mgr.showTotpPanel && (
          <WebTotpPanel
            configs={mgr.totpConfigs}
            autoMfa={mgr.autoMfa}
            ownerDatabaseId={mgr.session.ownerDatabaseId}
            connectionId={mgr.connection?.id}
            anchorRef={mgr.totpBtnRef}
            onClose={() => mgr.setShowTotpPanel(false)}
          />
        )}
      </div>
      <RecordingControls mgr={mgr} />
      <button
        onClick={mgr.handleOpenExternal}
        className="sor-icon-btn-sm"
        title="Open in external browser"
      >
        <ExternalLink size={16} />
      </button>
    </div>
  );
};

export default NavigationBar;
