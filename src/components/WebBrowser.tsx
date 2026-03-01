import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldOff,
  Globe,
  Lock,
  AlertTriangle,
  User,
  ServerCrash,
  WifiOff,
  RefreshCw,
  Star,
  Pencil,
  Trash2,
  Copy,
  FolderPlus,
  ChevronRight,
  Download,
  ClipboardCopy,
  FolderOpen,
  Circle,
  Film,
  Square,
  Pause,
  Play as PlayIcon,
} from "lucide-react";
import { ConnectionSession, HttpBookmarkItem } from "../types/connection";
import { useWebBrowser, type WebBrowserMgr } from "../hooks/protocol/useWebBrowser";
import { invoke } from "@tauri-apps/api/core";
import RDPTotpPanel from "./rdp/RDPTotpPanel";
import { CertificateInfoPopup } from "./CertificateInfoPopup";
import { TrustWarningDialog } from "./TrustWarningDialog";
import { InputDialog } from "./InputDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { MenuSurface } from "./ui/overlays/MenuSurface";
import { PopoverSurface } from "./ui/overlays/PopoverSurface";
import {
  OptionEmptyState,
  OptionItemButton,
  OptionList,
} from "./ui/display/OptionList";
import { getStoredIdentity } from "../utils/trustStore";

/* ═══════════════════════════════════════════════════════════════
   Props
   ═══════════════════════════════════════════════════════════════ */

interface WebBrowserProps {
  session: ConnectionSession;
}

interface SectionProps {
  mgr: WebBrowserMgr;
}

/* ═══════════════════════════════════════════════════════════════
   Security Icon helpers
   ═══════════════════════════════════════════════════════════════ */

const SecurityIcon: React.FC<SectionProps> = ({ mgr }) => {
  if (mgr.isSecure) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mgr.setShowCertPopup((v) => !v);
        }}
        className="hover:bg-[var(--color-border)] rounded p-0.5 transition-colors"
        title="View certificate information"
      >
        <Lock size={14} className="text-green-400" />
      </button>
    );
  }
  return <ShieldAlert size={14} className="text-yellow-400" />;
};

const AuthIcon: React.FC<{ hasAuth: boolean }> = ({ hasAuth }) => {
  if (!hasAuth) return null;
  return (
    <span data-tooltip="Basic Authentication">
      <User size={14} className="text-blue-400" />
    </span>
  );
};

/* ═══════════════════════════════════════════════════════════════
   RecordingControls
   ═══════════════════════════════════════════════════════════════ */

const RecordingControls: React.FC<SectionProps> = ({ mgr }) => (
  <>
    <div className="w-px h-5 bg-gray-600 mx-1" />
    {/* HAR Recording */}
    {!mgr.webRecorder.isRecording ? (
      <button
        onClick={mgr.handleStartHarRecording}
        disabled={!mgr.proxySessionIdRef.current}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Record HTTP traffic (HAR)"
      >
        <Circle size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-red-900/40 rounded text-red-400 text-xs font-mono animate-pulse">
          <Circle size={10} fill="currentColor" />
          HAR {Math.floor(mgr.webRecorder.duration / 60000)}:
          {String(
            Math.floor((mgr.webRecorder.duration % 60000) / 1000),
          ).padStart(2, "0")}
          <span className="text-[var(--color-textSecondary)] ml-1">
            {mgr.webRecorder.entryCount} req
          </span>
        </span>
        <button
          onClick={mgr.handleStopHarRecording}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-red-400 hover:text-red-300"
          title="Stop HAR recording"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    )}
    {/* Video Recording */}
    {!mgr.displayRecorder.state.isRecording ? (
      <button
        onClick={mgr.handleStartVideoRecording}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-blue-400"
        title="Record screen video"
      >
        <Film size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 rounded text-blue-400 text-xs font-mono animate-pulse">
          <Film size={10} />
          VIDEO {Math.floor(mgr.displayRecorder.state.duration / 60)}:
          {String(mgr.displayRecorder.state.duration % 60).padStart(2, "0")}
        </span>
        {mgr.displayRecorder.state.isPaused ? (
          <button
            onClick={() => mgr.displayRecorder.resumeRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400"
            title="Resume video recording"
          >
            <PlayIcon size={14} />
          </button>
        ) : (
          <button
            onClick={() => mgr.displayRecorder.pauseRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400"
            title="Pause video recording"
          >
            <Pause size={14} />
          </button>
        )}
        <button
          onClick={mgr.handleStopVideoRecording}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400 hover:text-blue-300"
          title="Stop video recording"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    )}
  </>
);

/* ═══════════════════════════════════════════════════════════════
   NavigationBar — back/forward/refresh/url/actions/recording
   ═══════════════════════════════════════════════════════════════ */

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
            : "text-gray-600 cursor-not-allowed"
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
            : "text-gray-600 cursor-not-allowed"
        }`}
        title="Forward"
      >
        <ArrowRight size={16} />
      </button>
      <button
        onClick={mgr.handleRefresh}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
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
          <div className="w-px h-4 bg-gray-600 flex-shrink-0" />
        </div>
        <input
          type="text"
          value={mgr.inputUrl}
          onChange={(e) => mgr.setInputUrl(e.target.value)}
          className="w-full pr-4 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      title="Save page as PDF"
    >
      <Download size={16} />
    </button>
    <button
      onClick={mgr.handleCopyAll}
      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      title="Copy all page content"
    >
      <ClipboardCopy size={16} />
    </button>
    <button
      onClick={mgr.handleOpenInNewTab}
      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
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
    <RecordingControls mgr={mgr} />
    <button
      onClick={mgr.handleOpenExternal}
      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      title="Open in external browser"
    >
      <ExternalLink size={16} />
    </button>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   SecurityInfoBar
   ═══════════════════════════════════════════════════════════════ */

const SecurityInfoBar: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex items-center space-x-2 text-xs">
    {mgr.isSecure ? (
      <div className="flex items-center space-x-1 text-green-400">
        <Shield size={12} />
        <span>Secure connection (HTTPS)</span>
      </div>
    ) : (
      <div className="flex items-center space-x-1 text-yellow-400">
        <AlertTriangle size={12} />
        <span>Not secure (HTTP)</span>
      </div>
    )}
    <span className="text-gray-500">•</span>
    <span className="text-[var(--color-textSecondary)]">
      Connected to {mgr.session.hostname}
    </span>
    {mgr.hasAuth && (
      <>
        <span className="text-gray-500">•</span>
        <span className="text-blue-400">
          Basic Auth: {mgr.resolvedCreds?.username}
        </span>
      </>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   BookmarkChip — a single non-folder bookmark
   ═══════════════════════════════════════════════════════════════ */

const BookmarkChip: React.FC<{
  mgr: WebBrowserMgr;
  bm: HttpBookmarkItem;
  idx: number;
  baseUrl: string;
}> = ({ mgr, bm, idx, baseUrl }) => {
  if (bm.isFolder) return null;
  const bookmarkUrl = baseUrl + bm.path;
  const isActive = bm.path === mgr.currentPath;

  if (mgr.editingBmIdx === idx) {
    return (
      <input
        ref={mgr.editBmRef}
        type="text"
        value={mgr.editBmName}
        onChange={(e) => mgr.setEditBmName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            mgr.handleRenameBookmark(idx, mgr.editBmName);
            mgr.setEditingBmIdx(null);
          } else if (e.key === "Escape") {
            mgr.setEditingBmIdx(null);
          }
        }}
        onBlur={() => {
          mgr.handleRenameBookmark(idx, mgr.editBmName);
          mgr.setEditingBmIdx(null);
        }}
        className="text-xs px-2 py-0.5 rounded bg-[var(--color-background)] border border-[var(--color-primary)] text-[var(--color-text)] w-28 focus:outline-none"
      />
    );
  }

  return (
    <button
      draggable
      onDragStart={mgr.handleDragStart(idx)}
      onDragOver={mgr.handleDragOver(idx)}
      onDrop={mgr.handleDrop(idx)}
      onDragEnd={mgr.handleDragEnd}
      onClick={() => {
        mgr.navigateToUrl(bookmarkUrl);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mgr.setBmBarContextMenu(null);
        mgr.setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
      }}
      className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${
        mgr.dragOverIdx === idx ? "ring-1 ring-[var(--color-primary)]" : ""
      } ${
        isActive
          ? "text-yellow-400 font-semibold bg-[var(--color-surfaceHover)]"
          : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      }`}
      title={bm.path}
    >
      {isActive && <Star size={9} fill="currentColor" />}
      {bm.name}
    </button>
  );
};

/* ═══════════════════════════════════════════════════════════════
   FolderChip — a folder bookmark with dropdown
   ═══════════════════════════════════════════════════════════════ */

const FolderChip: React.FC<{
  mgr: WebBrowserMgr;
  bm: HttpBookmarkItem;
  idx: number;
  baseUrl: string;
}> = ({ mgr, bm, idx, baseUrl }) => {
  if (!bm.isFolder) return null;
  const isOpen = mgr.openFolders.has(idx);
  return (
    <div className="relative flex-shrink-0">
      <button
        ref={(node) => {
          mgr.folderButtonRefs.current[idx] = node;
        }}
        onClick={() =>
          mgr.setOpenFolders((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
          })
        }
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mgr.setBmBarContextMenu(null);
          mgr.setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
        }}
        draggable
        onDragStart={mgr.handleDragStart(idx)}
        onDragOver={mgr.handleDragOver(idx)}
        onDrop={mgr.handleDrop(idx)}
        onDragEnd={mgr.handleDragEnd}
        className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors whitespace-nowrap flex items-center gap-1 ${
          mgr.dragOverIdx === idx ? "ring-1 ring-[var(--color-primary)]" : ""
        }`}
        title={bm.name}
      >
        <FolderOpen size={11} />
        {bm.name}
        <ChevronRight
          size={10}
          className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      {isOpen && (
        <PopoverSurface
          isOpen={isOpen}
          onClose={() => mgr.closeFolderDropdown(idx)}
          anchorRef={{ current: mgr.folderButtonRefs.current[idx] }}
          align="start"
          offset={2}
          className="sor-popover-panel min-w-[140px] py-0.5"
          dataTestId={`web-browser-folder-popover-${idx}`}
        >
          <OptionList>
            {bm.children.length === 0 && (
              <OptionEmptyState className="italic text-[var(--color-textMuted,var(--color-textSecondary))]">
                Empty folder
              </OptionEmptyState>
            )}
            {bm.children.map((child, cIdx) => {
              if (child.isFolder) return null;
              const childUrl = baseUrl + child.path;
              const isActive = child.path === mgr.currentPath;
              return (
                <OptionItemButton
                  key={cIdx}
                  onClick={() => mgr.navigateToUrl(childUrl)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mgr.setBmBarContextMenu(null);
                    mgr.setBmContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      idx,
                      folderPath: [cIdx],
                    });
                  }}
                  compact
                  selected={isActive}
                  className="whitespace-nowrap text-xs"
                  title={child.path}
                >
                  <span className="flex items-center gap-1">
                    {isActive && <Star size={9} fill="currentColor" />}
                    {child.name}
                  </span>
                </OptionItemButton>
              );
            })}
          </OptionList>
        </PopoverSurface>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   BookmarkContextMenu
   ═══════════════════════════════════════════════════════════════ */

const BookmarkContextMenu: React.FC<SectionProps> = ({ mgr }) => {
  const { bmContextMenu, connection } = mgr;
  if (!bmContextMenu) return null;

  return (
    <MenuSurface
      isOpen={Boolean(bmContextMenu)}
      onClose={() => mgr.setBmContextMenu(null)}
      position={{ x: bmContextMenu.x, y: bmContextMenu.y }}
      className="min-w-[170px] rounded-lg py-1"
      dataTestId="web-browser-bookmark-menu"
    >
      {bmContextMenu.folderPath ? (
        <button
          className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
          onClick={() => {
            mgr.handleRemoveFromFolder(
              bmContextMenu.idx,
              bmContextMenu.folderPath![0],
            );
            mgr.setBmContextMenu(null);
          }}
        >
          <Trash2 size={12} /> Remove from folder
        </button>
      ) : (
        <>
          <button
            className="sor-menu-item text-xs py-1.5"
            onClick={() => {
              const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
              if (bm) {
                mgr.setEditBmName(bm.name);
                mgr.setEditingBmIdx(bmContextMenu.idx);
              }
              mgr.setBmContextMenu(null);
            }}
          >
            <Pencil size={12} /> Rename
          </button>
          {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
                if (bm && !bm.isFolder) {
                  const baseUrl = mgr.buildTargetUrl().replace(/\/+$/, "");
                  navigator.clipboard
                    .writeText(baseUrl + bm.path)
                    .catch(() => {});
                }
                mgr.setBmContextMenu(null);
              }}
            >
              <Copy size={12} /> Copy URL
            </button>
          )}
          {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
                if (bm && !bm.isFolder) {
                  const baseUrl = mgr.buildTargetUrl().replace(/\/+$/, "");
                  invoke("open_url_external", {
                    url: baseUrl + bm.path,
                  }).catch(() => {
                    window.open(
                      baseUrl + bm.path,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  });
                }
                mgr.setBmContextMenu(null);
              }}
            >
              <ExternalLink size={12} /> Open externally
            </button>
          )}
          <div className="sor-menu-divider" />
          {/* Move to folder */}
          {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder &&
            (connection?.httpBookmarks || []).some(
              (b, i) => b.isFolder && i !== bmContextMenu.idx,
            ) && (
              <>
                {(connection?.httpBookmarks || []).map((b, i) =>
                  b.isFolder && i !== bmContextMenu.idx ? (
                    <button
                      key={i}
                      className="sor-menu-item text-xs py-1.5"
                      onClick={() => {
                        mgr.handleMoveToFolder(bmContextMenu.idx, i);
                        mgr.setBmContextMenu(null);
                      }}
                    >
                      <FolderOpen size={12} /> Move to {b.name}
                    </button>
                  ) : null,
                )}
                <div className="sor-menu-divider" />
              </>
            )}
          {bmContextMenu.idx > 0 && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                mgr.handleMoveBookmark(
                  bmContextMenu.idx,
                  bmContextMenu.idx - 1,
                );
                mgr.setBmContextMenu(null);
              }}
            >
              <ArrowLeft size={12} /> Move left
            </button>
          )}
          {bmContextMenu.idx <
            (connection?.httpBookmarks || []).length - 1 && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                mgr.handleMoveBookmark(
                  bmContextMenu.idx,
                  bmContextMenu.idx + 1,
                );
                mgr.setBmContextMenu(null);
              }}
            >
              <ArrowRight size={12} /> Move right
            </button>
          )}
          <div className="sor-menu-divider" />
          <button
            className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
            onClick={() => {
              mgr.handleRemoveBookmark(bmContextMenu.idx);
              mgr.setBmContextMenu(null);
            }}
          >
            <Trash2 size={12} /> Remove
          </button>
        </>
      )}
    </MenuSurface>
  );
};

/* ═══════════════════════════════════════════════════════════════
   BarContextMenu (right-click empty bookmark bar area)
   ═══════════════════════════════════════════════════════════════ */

const BarContextMenu: React.FC<SectionProps> = ({ mgr }) => {
  if (!mgr.bmBarContextMenu) return null;
  return (
    <MenuSurface
      isOpen={Boolean(mgr.bmBarContextMenu)}
      onClose={() => mgr.setBmBarContextMenu(null)}
      position={{ x: mgr.bmBarContextMenu.x, y: mgr.bmBarContextMenu.y }}
      className="min-w-[170px] rounded-lg py-1"
      dataTestId="web-browser-bookmark-bar-menu"
    >
      <button
        className="sor-menu-item text-xs py-1.5"
        onClick={() => {
          mgr.handleAddFolder();
          mgr.setBmBarContextMenu(null);
        }}
      >
        <FolderPlus size={12} /> New folder
      </button>
      <button
        className="sor-menu-item text-xs py-1.5"
        onClick={() => {
          mgr.handleAddBookmark();
          mgr.setBmBarContextMenu(null);
        }}
      >
        <Star size={12} /> Bookmark this page
      </button>
      {(mgr.connection?.httpBookmarks || []).length > 0 && (
        <>
          <div className="sor-menu-divider" />
          <button
            className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
            onClick={() => {
              mgr.handleDeleteAllBookmarks();
              mgr.setBmBarContextMenu(null);
            }}
          >
            <Trash2 size={12} /> Delete all bookmarks
          </button>
        </>
      )}
    </MenuSurface>
  );
};

/* ═══════════════════════════════════════════════════════════════
   BookmarkBar
   ═══════════════════════════════════════════════════════════════ */

const BookmarkBar: React.FC<SectionProps> = ({ mgr }) => {
  const baseUrl = mgr.buildTargetUrl().replace(/\/+$/, "");
  return (
    <div
      className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1 flex items-center gap-1 overflow-x-auto min-h-[28px] relative"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          mgr.setBmContextMenu(null);
          mgr.setBmBarContextMenu({ x: e.clientX, y: e.clientY });
        }
      }}
    >
      <Star
        size={11}
        className={`flex-shrink-0 ${mgr.isCurrentPageBookmarked ? "text-yellow-400" : "text-yellow-400/60"}`}
        fill={mgr.isCurrentPageBookmarked ? "currentColor" : "none"}
      />
      {(mgr.connection?.httpBookmarks || []).map((bm, idx) =>
        bm.isFolder ? (
          <FolderChip
            key={`folder-${idx}`}
            mgr={mgr}
            bm={bm}
            idx={idx}
            baseUrl={baseUrl}
          />
        ) : (
          <BookmarkChip
            key={idx}
            mgr={mgr}
            bm={bm}
            idx={idx}
            baseUrl={baseUrl}
          />
        ),
      )}
      {(mgr.connection?.httpBookmarks || []).length === 0 && (
        <span className="text-xs text-[var(--color-textMuted,var(--color-textSecondary))] italic select-none">
          Right-click bar to add folders — use ★ to save pages
        </span>
      )}
      <BookmarkContextMenu mgr={mgr} />
      <BarContextMenu mgr={mgr} />
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ErrorPage — categorized error display
   ═══════════════════════════════════════════════════════════════ */

const ERROR_BASE =
  "flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors";
const ERROR_PRIMARY = `${ERROR_BASE} bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]`;
const ERROR_SECONDARY = `${ERROR_BASE} bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)]`;
const ERROR_WARNING = `${ERROR_BASE} bg-orange-600 hover:bg-orange-700 text-[var(--color-text)] disabled:opacity-50`;

const ErrorPage: React.FC<SectionProps> = ({ mgr }) => {
  const { loadError, session, handleRefresh, handleOpenExternal, hasAuth } =
    mgr;

  // Certificate / TLS error
  if (
    loadError.includes("certificate") ||
    loadError.includes("Certificate") ||
    loadError.includes("SSL") ||
    loadError.includes("CERT_") ||
    loadError.includes("self-signed") ||
    loadError.includes("trust provider")
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-orange-900/30 flex items-center justify-center mb-4">
          <ShieldAlert size={32} className="text-orange-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Certificate Error
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          The connection to{" "}
          <span className="text-yellow-400">{session.hostname}</span> failed
          because the server&apos;s SSL/TLS certificate is not trusted.
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            This usually means:
          </p>
          <ul className="sor-guidance-list sor-guidance-list-disc">
            <li>
              The server is using a{" "}
              <span className="text-orange-400">self-signed certificate</span>
            </li>
            <li>
              The certificate chain is incomplete or issued by an untrusted CA
            </li>
            <li>The certificate has expired or is not yet valid</li>
            <li>
              The hostname does not match the certificate&apos;s subject
            </li>
          </ul>
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mt-3 mb-2">
            To fix this:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>
              Edit this connection and{" "}
              <span className="text-blue-400">
                uncheck &quot;Verify SSL Certificate&quot;
              </span>{" "}
              to trust self-signed certs
            </li>
            <li>
              Or install the server&apos;s CA certificate into your system trust
              store
            </li>
          </ol>
        </div>
        <details className="mb-4 max-w-lg text-left">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-[var(--color-textSecondary)]">
            Technical details
          </summary>
          <pre className="mt-2 text-xs text-gray-500 bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3 whitespace-pre-wrap break-all">
            {loadError}
          </pre>
        </details>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Retry Connection</span>
          </button>
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Internal proxy failure
  if (
    loadError.includes("refused") ||
    loadError.includes("Upstream request failed") ||
    loadError.includes("proxy")
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4">
          <ServerCrash size={32} className="text-red-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Internal Proxy Error
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            Troubleshooting steps:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>
              Open the{" "}
              <span className="text-blue-400">Internal Proxy Manager</span>{" "}
              from the toolbar and check the proxy status
            </li>
            <li>
              Verify the target host{" "}
              <span className="text-yellow-400">{session.hostname}</span> is
              reachable on your network
            </li>
            <li>
              Check the proxy error log for detailed failure information
            </li>
            <li>Try restarting the proxy session via the manager</li>
          </ol>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Retry Connection</span>
          </button>
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Timeout error
  if (loadError.includes("timed out")) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
          <WifiOff size={32} className="text-yellow-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Connection Timed Out
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            Possible causes:
          </p>
          <ul className="sor-guidance-list sor-guidance-list-disc">
            <li>
              The server at{" "}
              <span className="text-yellow-400">{session.hostname}</span> is
              not responding
            </li>
            <li>A firewall is blocking the connection</li>
            <li>The hostname or port may be incorrect</li>
            <li>
              Network connectivity issues between you and the target
            </li>
            <li>The internal proxy session may have died</li>
          </ul>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Try Again</span>
          </button>
          {hasAuth && (
            <button
              onClick={mgr.handleRestartProxy}
              disabled={mgr.proxyRestarting}
              className={ERROR_WARNING}
            >
              <RefreshCw
                size={14}
                className={mgr.proxyRestarting ? "animate-spin" : ""}
              />{" "}
              <span>
                {mgr.proxyRestarting ? "Restarting…" : "Reconnect Proxy"}
              </span>
            </button>
          )}
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Auth error
  if (loadError.includes("Authentication required")) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-blue-900/30 flex items-center justify-center mb-4">
          <Shield size={32} className="text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Authentication Required
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            To fix this:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>Edit this connection in the sidebar</li>
            <li>
              Set Authentication Type to{" "}
              <span className="text-blue-400">Basic Authentication</span>
            </li>
            <li>Enter the correct username and password</li>
            <li>Save and reconnect</li>
          </ol>
        </div>
        <button onClick={handleRefresh} className={ERROR_PRIMARY}>
          <RefreshCw size={14} /> <span>Try Again</span>
        </button>
      </div>
    );
  }

  // Generic error
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
        <AlertTriangle size={32} className="text-yellow-400" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
        Unable to Load Webpage
      </h3>
      <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
        {loadError}
      </p>
      <div className="sor-surface-card sor-web-error-panel text-left">
        <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
          Common issues:
        </p>
        <ul className="sor-guidance-list sor-guidance-list-disc">
          <li>The website blocks embedding (X-Frame-Options)</li>
          <li>CORS restrictions prevent loading</li>
          <li>The server is not responding</li>
          <li>The internal proxy may have died unexpectedly</li>
          <li>Invalid URL or hostname</li>
        </ul>
      </div>
      <div className="flex items-center space-x-3">
        <button onClick={handleRefresh} className={ERROR_PRIMARY}>
          <RefreshCw size={14} /> <span>Try Again</span>
        </button>
        {hasAuth && (
          <button
            onClick={mgr.handleRestartProxy}
            disabled={mgr.proxyRestarting}
            className={ERROR_WARNING}
          >
            <RefreshCw
              size={14}
              className={mgr.proxyRestarting ? "animate-spin" : ""}
            />{" "}
            <span>
              {mgr.proxyRestarting ? "Restarting…" : "Reconnect Proxy"}
            </span>
          </button>
        )}
        <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
          <ExternalLink size={14} /> <span>Open Externally</span>
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ContentArea — iframe, loading spinner, error pages, proxy banner
   ═══════════════════════════════════════════════════════════════ */

const ContentArea: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex-1 relative">
    {/* Proxy-dead banner */}
    {mgr.hasAuth && !mgr.proxyAlive && !mgr.isLoading && !mgr.loadError && (
      <div className="absolute top-0 inset-x-0 z-20 bg-red-900/90 border-b border-red-700 px-4 py-2 flex items-center justify-between text-xs text-red-200">
        <div className="flex items-center gap-2">
          <WifiOff size={14} className="text-red-400" />
          <span>Internal proxy session died unexpectedly.</span>
        </div>
        <button
          onClick={mgr.handleRestartProxy}
          disabled={mgr.proxyRestarting}
          className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-[var(--color-text)] transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={mgr.proxyRestarting ? "animate-spin" : ""}
          />
          {mgr.proxyRestarting ? "Restarting…" : "Reconnect proxy"}
        </button>
      </div>
    )}

    {mgr.isLoading && (
      <div className="absolute inset-0 bg-[var(--color-background)] flex items-center justify-center z-10">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-[var(--color-textSecondary)] mb-2">
            Loading {mgr.currentUrl}...
          </p>
          <p className="text-gray-600 text-xs">
            Taking too long?{" "}
            <button
              onClick={mgr.handleCancelLoading}
              className="text-blue-500 hover:text-blue-400 underline"
            >
              Cancel
            </button>
          </p>
        </div>
      </div>
    )}

    {mgr.loadError ? (
      <ErrorPage mgr={mgr} />
    ) : (
      <iframe
        ref={mgr.iframeRef}
        src="about:blank"
        className="w-full h-full border-0"
        title={mgr.session.name}
        onLoad={mgr.handleIframeLoad}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   BrowserDialogs — trust warning, folder, confirm, recording name
   ═══════════════════════════════════════════════════════════════ */

const BrowserDialogs: React.FC<SectionProps> = ({ mgr }) => (
  <>
    {mgr.trustPrompt && mgr.certIdentity && (
      <TrustWarningDialog
        type="tls"
        host={mgr.session.hostname}
        port={mgr.connection?.port || 443}
        reason={
          mgr.trustPrompt.status === "mismatch" ? "mismatch" : "first-use"
        }
        receivedIdentity={mgr.certIdentity}
        storedIdentity={
          mgr.trustPrompt.status === "mismatch"
            ? mgr.trustPrompt.stored
            : undefined
        }
        onAccept={mgr.handleTrustAccept}
        onReject={mgr.handleTrustReject}
      />
    )}
    <InputDialog
      isOpen={mgr.showNewFolderDialog}
      title="New Folder"
      message="Enter a name for the new bookmark folder:"
      placeholder="Folder name"
      confirmText="Create"
      onConfirm={mgr.confirmAddFolder}
      onCancel={() => mgr.setShowNewFolderDialog(false)}
    />
    <ConfirmDialog
      isOpen={mgr.showDeleteAllConfirm}
      title="Delete All Bookmarks"
      message="Are you sure you want to delete all bookmarks for this connection? This cannot be undone."
      confirmText="Delete All"
      variant="danger"
      onConfirm={mgr.confirmDeleteAllBookmarks}
      onCancel={() => mgr.setShowDeleteAllConfirm(false)}
    />
    {mgr.showRecordingNamePrompt && (
      <InputDialog
        isOpen={true}
        title={
          mgr.showRecordingNamePrompt === "har"
            ? "Save Web Recording"
            : "Save Video Recording"
        }
        message="Enter a name for this recording:"
        defaultValue={`${mgr.connection?.name || mgr.session.hostname} - ${new Date().toLocaleString()}`}
        onConfirm={(name) => {
          if (mgr.showRecordingNamePrompt === "har") {
            mgr.handleSaveHarRecording(name);
          } else {
            mgr.handleSaveVideoRecording(name);
          }
        }}
        onCancel={() => {
          mgr.pendingRecordingRef.current = null;
          mgr.setShowRecordingNamePrompt(null);
        }}
      />
    )}
  </>
);

/* ═══════════════════════════════════════════════════════════════
   WebBrowser — root component
   ═══════════════════════════════════════════════════════════════ */

export const WebBrowser: React.FC<WebBrowserProps> = ({ session }) => {
  const mgr = useWebBrowser(session);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Browser Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-3">
        <NavigationBar mgr={mgr} />
        <SecurityInfoBar mgr={mgr} />
      </div>

      <BookmarkBar mgr={mgr} />
      <ContentArea mgr={mgr} />
      <BrowserDialogs mgr={mgr} />
    </div>
  );
};
