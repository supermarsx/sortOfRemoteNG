import RecordingControls from "./RecordingControls";
import SecurityIcon from "./SecurityIcon";
import React from "react";
import { ArrowLeft, ArrowRight, RotateCcw, ExternalLink, Shield, ShieldOff, Globe, Star, Copy, Download, ClipboardCopy } from "lucide-react";
import RDPTotpPanel from "../../rdp/RDPTotpPanel";
import { CertificateInfoPopup } from "../../security/CertificateInfoPopup";
import { getStoredIdentity } from "../../../utils/trustStore";

const NavigationBar: React.FC<SectionProps> = ({ mgr }) => (
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
      >
        <ArrowLeft size={16} />
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
      >
        <ArrowRight size={16} />
      </button>
      <button
        onClick={mgr.handleRefresh}
        className="sor-icon-btn-sm"
        title="Refresh"
      >
        <RotateCcw size={16} />
      </button>
    </div>

    {/* URL Bar */}
    <form onSubmit={mgr.handleUrlSubmit} className="flex-1 flex items-center">
      <div className="flex-1 relative">
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
          <div className="relative" ref={mgr.certPopupRef}>
            <SecurityIcon mgr={mgr} />
            {mgr.showCertPopup && mgr.isSecure && (
              <CertificateInfoPopup
                type="tls"
                host={mgr.session.hostname}
                port={mgr.connection?.port || 443}
                currentIdentity={mgr.certIdentity ?? undefined}
                trustRecord={getStoredIdentity(
                  mgr.session.hostname,
                  mgr.connection?.port || 443,
                  "tls",
                  mgr.connection?.id,
                )}
                connectionId={mgr.connection?.id}
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
              <ShieldOff size={14} className="text-red-400" />
            </span>
          )}
          <AuthIcon hasAuth={mgr.hasAuth} />
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
          className="w-full pr-4 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
          ? "text-yellow-400"
          : "text-[var(--color-textSecondary)] hover:text-yellow-400"
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
      title="Save page as PDF"
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
        className={`p-2 rounded transition-colors relative ${mgr.showTotpPanel ? "text-blue-400 bg-blue-600/20" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"}`}
        title="2FA Codes"
      >
        <Shield size={16} />
        {mgr.totpConfigs.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--color-secondary)] text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
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

export default NavigationBar;
