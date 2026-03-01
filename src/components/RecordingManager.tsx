import React from "react";
import {
  X,
  Trash2,
  Search,
  Download,
  Clock,
  Disc,
  Terminal,
  Monitor,
  Film,
  HardDrive,
  Globe,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { SshRecordingRow, RdpRecordingRow, WebHarRecordingRow } from "./recordings";
import { formatDuration, formatBytes } from "../utils/formatters";
import { useRecordingManager } from "../hooks/recording/useRecordingManager";

type Mgr = ReturnType<typeof useRecordingManager>;

interface RecordingManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const RecordingHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
    <div className="flex items-center gap-3">
      <Disc size={18} className="text-red-400" />
      <h2 className="text-sm font-semibold text-[var(--color-text)]">
        Recording Manager
      </h2>
    </div>
    <button
      onClick={onClose}
      className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
    >
      <X size={16} />
    </button>
  </div>
);

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const tabs = [
    { id: "ssh" as const, label: "SSH Terminal", icon: Terminal, count: mgr.sshRecordings.length, activeColor: "border-green-500 text-green-400" },
    { id: "rdp" as const, label: "RDP Screen", icon: Monitor, count: mgr.rdpRecordings.length, activeColor: "border-blue-500 text-blue-400" },
    { id: "web" as const, label: "Web (HAR)", icon: Globe, count: mgr.webRecordings.length, activeColor: "border-cyan-500 text-cyan-400" },
    { id: "webVideo" as const, label: "Web (Video)", icon: Film, count: mgr.webVideoRecordings.length, activeColor: "border-purple-500 text-purple-400" },
  ];

  return (
    <div className="flex border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => mgr.switchTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              mgr.activeTab === tab.id
                ? tab.activeColor
                : "border-transparent text-[var(--color-textSecondary)] hover:text-gray-200"
            }`}
          >
            <Icon size={14} />
            {tab.label} ({tab.count})
          </button>
        );
      })}
    </div>
  );
};

const Toolbar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50">
    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-border)]/40 border border-[var(--color-border)]/50 rounded-lg">
      <Search size={14} className="text-[var(--color-textSecondary)]" />
      <input
        type="text"
        value={mgr.searchQuery}
        onChange={(e) => mgr.setSearchQuery(e.target.value)}
        placeholder="Search recordings..."
        className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-gray-500 outline-none"
      />
    </div>
    {mgr.activeTab === "ssh" && mgr.sshRecordings.length > 0 && (
      <button onClick={mgr.handleDeleteAllSsh} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg">
        <Trash2 size={14} /> Clear All
      </button>
    )}
    {mgr.activeTab === "rdp" && mgr.rdpRecordings.length > 0 && (
      <button onClick={mgr.handleDeleteAllRdp} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg">
        <Trash2 size={14} /> Clear All
      </button>
    )}
    {mgr.activeTab === "web" && mgr.webRecordings.length > 0 && (
      <button onClick={mgr.handleClearAllWeb} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg">
        <Trash2 size={14} /> Clear All
      </button>
    )}
    {mgr.activeTab === "webVideo" && mgr.webVideoRecordings.length > 0 && (
      <button onClick={mgr.handleClearAllWebVideo} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg">
        <Trash2 size={14} /> Clear All
      </button>
    )}
  </div>
);

const StatsBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center gap-4 px-5 py-1.5 bg-[var(--color-surface)]/20 border-b border-[var(--color-border)]/30 text-[10px] text-gray-500">
    {mgr.activeTab === "ssh" && (
      <>
        <span className="flex items-center gap-1">
          <HardDrive size={10} /> {mgr.sshRecordings.length} recording{mgr.sshRecordings.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} /> {formatDuration(mgr.sshTotalDuration)} total
        </span>
      </>
    )}
    {mgr.activeTab === "rdp" && (
      <>
        <span className="flex items-center gap-1">
          <Film size={10} /> {mgr.rdpRecordings.length} recording{mgr.rdpRecordings.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} /> {formatDuration(mgr.rdpTotalDuration)} total
        </span>
        <span className="flex items-center gap-1">
          <HardDrive size={10} /> {formatBytes(mgr.rdpTotalSize)}
        </span>
      </>
    )}
    {mgr.activeTab === "web" && (
      <span className="flex items-center gap-1">
        <Globe size={10} /> {mgr.webRecordings.length} recording{mgr.webRecordings.length !== 1 ? "s" : ""}
      </span>
    )}
    {mgr.activeTab === "webVideo" && (
      <>
        <span className="flex items-center gap-1">
          <Film size={10} /> {mgr.webVideoRecordings.length} recording{mgr.webVideoRecordings.length !== 1 ? "s" : ""}
        </span>
        {mgr.webVideoRecordings.length > 0 && (
          <span className="flex items-center gap-1">
            <HardDrive size={10} />{" "}
            {formatBytes(mgr.webVideoRecordings.reduce((s, r) => s + r.sizeBytes, 0))}
          </span>
        )}
      </>
    )}
  </div>
);

const RecordingContent: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto">
    {mgr.activeTab === "ssh" && <SshTabContent mgr={mgr} />}
    {mgr.activeTab === "rdp" && <RdpTabContent mgr={mgr} />}
    {mgr.activeTab === "web" && <WebTabContent mgr={mgr} />}
    {mgr.activeTab === "webVideo" && <WebVideoTabContent mgr={mgr} />}
  </div>
);

const SshTabContent: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.filteredSsh.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Terminal size={32} className="mb-3 opacity-50" />
      <p className="text-sm">{mgr.searchQuery ? "No SSH recordings match your search" : "No SSH terminal recordings yet"}</p>
      {!mgr.searchQuery && <p className="text-xs mt-1">Start recording from an SSH session toolbar</p>}
    </div>
  ) : (
    <div className="divide-y divide-[var(--color-border)]/50">
      {[...mgr.filteredSsh]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((rec) => (
          <SshRecordingRow
            key={rec.id}
            recording={rec}
            isExpanded={mgr.expandedId === rec.id}
            onToggle={() => mgr.setExpandedId(mgr.expandedId === rec.id ? null : rec.id)}
            onRename={(name) => mgr.handleRenameSsh(rec, name)}
            onDelete={() => mgr.handleDeleteSsh(rec.id)}
            onExport={(format) => mgr.handleExportSsh(rec, format)}
          />
        ))}
    </div>
  );

const RdpTabContent: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.filteredRdp.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Monitor size={32} className="mb-3 opacity-50" />
      <p className="text-sm">{mgr.searchQuery ? "No RDP recordings match your search" : "No RDP screen recordings yet"}</p>
      {!mgr.searchQuery && <p className="text-xs mt-1">Enable auto-save in Recording settings, or save from the RDP toolbar</p>}
    </div>
  ) : (
    <div className="divide-y divide-[var(--color-border)]/50">
      {[...mgr.filteredRdp]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((rec) => (
          <RdpRecordingRow
            key={rec.id}
            recording={rec}
            isExpanded={mgr.expandedId === rec.id}
            onToggle={() => mgr.setExpandedId(mgr.expandedId === rec.id ? null : rec.id)}
            onRename={(name) => mgr.handleRenameRdp(rec, name)}
            onDelete={() => mgr.handleDeleteRdp(rec.id)}
            onExport={() => mgr.handleExportRdp(rec)}
            onPlay={() => mgr.handlePlayRdp(rec)}
          />
        ))}
    </div>
  );

const WebTabContent: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.filteredWeb.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Globe size={32} className="mb-3 opacity-50" />
      <p className="text-sm">{mgr.searchQuery ? "No web recordings match your search" : "No web HAR recordings yet"}</p>
      {!mgr.searchQuery && <p className="text-xs mt-1">Start recording HTTP traffic from a web browser session</p>}
    </div>
  ) : (
    <div className="divide-y divide-[var(--color-border)]/50">
      {[...mgr.filteredWeb]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((rec) => (
          <WebHarRecordingRow
            key={rec.id}
            recording={rec}
            isExpanded={mgr.expandedId === rec.id}
            onToggle={() => mgr.setExpandedId(mgr.expandedId === rec.id ? null : rec.id)}
            onRename={(name) => mgr.handleRenameWeb(rec.id, name)}
            onDelete={() => mgr.handleDeleteWeb(rec.id)}
            onExport={(format) => mgr.handleExportWeb(rec, format)}
          />
        ))}
    </div>
  );

const WebVideoTabContent: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.filteredWebVideo.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Film size={32} className="mb-3 opacity-50" />
      <p className="text-sm">{mgr.searchQuery ? "No web video recordings match your search" : "No web video recordings yet"}</p>
      {!mgr.searchQuery && <p className="text-xs mt-1">Record your web browsing session as video</p>}
    </div>
  ) : (
    <div className="divide-y divide-[var(--color-border)]/50">
      {[...mgr.filteredWebVideo]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((rec) => (
          <div
            key={rec.id}
            className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)]/60"
          >
            <Film size={16} className="text-purple-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--color-text)] truncate">
                {rec.name}
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
                {rec.host && (
                  <>
                    <span>{rec.host}</span>
                    <span className="text-gray-600">&middot;</span>
                  </>
                )}
                <span>{formatDuration(rec.durationMs)}</span>
                <span className="text-gray-600">&middot;</span>
                <span>{formatBytes(rec.sizeBytes)}</span>
                <span className="text-gray-600">&middot;</span>
                <span className="uppercase">{rec.format}</span>
                <span className="text-gray-600">&middot;</span>
                <span>{new Date(rec.savedAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => mgr.handleExportWebVideo(rec)}
                className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                title="Download"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => mgr.handleDeleteWebVideo(rec.id)}
                className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
    </div>
  );

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const RecordingManager: React.FC<RecordingManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useRecordingManager(isOpen);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/60"
      panelClassName="max-w-5xl mx-4 h-[90vh] bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl shadow-2xl"
    >
      <RecordingHeader onClose={onClose} />
      <TabBar mgr={mgr} />
      <Toolbar mgr={mgr} />
      <StatsBar mgr={mgr} />
      <RecordingContent mgr={mgr} />
    </Modal>
  );
};

export default RecordingManager;
