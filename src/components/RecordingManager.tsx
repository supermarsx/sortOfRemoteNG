import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Edit2, Trash2, Save, Search, Download,
  ChevronDown, ChevronUp, Clock, Disc, Terminal,
  Monitor, Play, Film, HardDrive, Globe,
} from 'lucide-react';
import {
  SavedRecording,
  SavedRdpRecording,
  SavedWebRecording,
  SavedWebVideoRecording,
} from '../types/macroTypes';
import * as macroService from '../utils/macroService';

interface RecordingManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'ssh' | 'rdp' | 'web' | 'webVideo';

const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = s % 60;
  const min = m % 60;
  if (h > 0) return `${h}h ${min}m ${sec}s`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const RecordingManager: React.FC<RecordingManagerProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('ssh');
  const [sshRecordings, setSshRecordings] = useState<SavedRecording[]>([]);
  const [rdpRecordings, setRdpRecordings] = useState<SavedRdpRecording[]>([]);
  const [webRecordings, setWebRecordings] = useState<SavedWebRecording[]>([]);
  const [webVideoRecordings, setWebVideoRecordings] = useState<SavedWebVideoRecording[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [ssh, rdp, web, webVideo] = await Promise.all([
      macroService.loadRecordings(),
      macroService.loadRdpRecordings(),
      macroService.loadWebRecordings(),
      macroService.loadWebVideoRecordings(),
    ]);
    setSshRecordings(ssh);
    setRdpRecordings(rdp);
    setWebRecordings(web);
    setWebVideoRecordings(webVideo);
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  // ---- Filtered lists ----
  const filteredSsh = useMemo(() => {
    if (!searchQuery.trim()) return sshRecordings;
    const q = searchQuery.toLowerCase();
    return sshRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.recording.metadata.host.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [sshRecordings, searchQuery]);

  const filteredRdp = useMemo(() => {
    if (!searchQuery.trim()) return rdpRecordings;
    const q = searchQuery.toLowerCase();
    return rdpRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.host?.toLowerCase().includes(q) ||
        r.connectionName?.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rdpRecordings, searchQuery]);

  const filteredWeb = useMemo(() => {
    if (!searchQuery.trim()) return webRecordings;
    const q = searchQuery.toLowerCase();
    return webRecordings.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.host?.toLowerCase().includes(q) ||
      r.connectionName?.toLowerCase().includes(q) ||
      r.recording.metadata.target_url.toLowerCase().includes(q)
    );
  }, [webRecordings, searchQuery]);

  const filteredWebVideo = useMemo(() => {
    if (!searchQuery.trim()) return webVideoRecordings;
    const q = searchQuery.toLowerCase();
    return webVideoRecordings.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.host?.toLowerCase().includes(q) ||
      r.connectionName?.toLowerCase().includes(q)
    );
  }, [webVideoRecordings, searchQuery]);

  // ---- SSH actions ----
  const handleRenameSsh = async (rec: SavedRecording, name: string) => {
    rec.name = name;
    await macroService.saveRecording(rec);
    await loadData();
  };

  const handleDeleteSsh = async (id: string) => {
    await macroService.deleteRecording(id);
    if (expandedId === id) setExpandedId(null);
    await loadData();
  };

  const handleExportSsh = async (rec: SavedRecording, format: 'json' | 'asciicast' | 'script' | 'gif') => {
    const data = await macroService.exportRecording(rec.recording, format);
    if (format === 'gif') {
      // data is a Blob for GIF
      const blob = data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.gif`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const ext = format === 'asciicast' ? 'cast' : format === 'script' ? 'txt' : 'json';
      const blob = new Blob([data as string], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleDeleteAllSsh = async () => {
    await macroService.saveRecordings([]);
    setExpandedId(null);
    await loadData();
  };

  // ---- RDP actions ----
  const handleRenameRdp = async (rec: SavedRdpRecording, name: string) => {
    rec.name = name;
    await macroService.saveRdpRecording(rec);
    await loadData();
  };

  const handleDeleteRdp = async (id: string) => {
    await macroService.deleteRdpRecording(id);
    if (expandedId === id) setExpandedId(null);
    await loadData();
  };

  const handleExportRdp = (rec: SavedRdpRecording) => {
    const blob = macroService.rdpRecordingToBlob(rec);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = rec.format === 'gif' ? 'gif' : rec.format || 'webm';
    a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePlayRdp = (rec: SavedRdpRecording) => {
    const blob = macroService.rdpRecordingToBlob(rec);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleDeleteAllRdp = async () => {
    await macroService.saveRdpRecordings([]);
    setExpandedId(null);
    await loadData();
  };

  // ---- Web HAR actions ----
  const handleRenameWeb = async (id: string, name: string) => {
    const rec = webRecordings.find(r => r.id === id);
    if (!rec) return;
    await macroService.saveWebRecording({ ...rec, name });
    loadData();
  };

  const handleDeleteWeb = async (id: string) => {
    await macroService.deleteWebRecording(id);
    loadData();
  };

  const handleExportWeb = async (rec: SavedWebRecording, format: 'json' | 'har') => {
    const content = await macroService.exportWebRecording(rec.recording, format);
    const ext = format === 'har' ? '.har' : '.json';
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAllWeb = async () => {
    await macroService.saveWebRecordings([]);
    loadData();
  };

  // ---- Web Video actions ----
  const handleRenameWebVideo = async (id: string, name: string) => {
    const rec = webVideoRecordings.find(r => r.id === id);
    if (!rec) return;
    await macroService.saveWebVideoRecording({ ...rec, name });
    loadData();
  };

  const handleDeleteWebVideo = async (id: string) => {
    await macroService.deleteWebVideoRecording(id);
    loadData();
  };

  const handleExportWebVideo = (rec: SavedWebVideoRecording) => {
    const blob = macroService.webVideoRecordingToBlob(rec);
    const ext = rec.format === 'mp4' ? '.mp4' : '.webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAllWebVideo = async () => {
    await macroService.saveWebVideoRecordings([]);
    loadData();
  };

  // ---- Stats ----
  const sshTotalDuration = sshRecordings.reduce((s, r) => s + r.recording.metadata.duration_ms, 0);
  const rdpTotalSize = rdpRecordings.reduce((s, r) => s + r.sizeBytes, 0);
  const rdpTotalDuration = rdpRecordings.reduce((s, r) => s + r.durationMs, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-5xl mx-4 h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
          <div className="flex items-center gap-3">
            <Disc size={18} className="text-red-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Recording Manager</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            onClick={() => { setActiveTab('ssh'); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ssh'
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'
            }`}
          >
            <Terminal size={14} />
            SSH Terminal ({sshRecordings.length})
          </button>
          <button
            onClick={() => { setActiveTab('rdp'); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'rdp'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'
            }`}
          >
            <Monitor size={14} />
            RDP Screen ({rdpRecordings.length})
          </button>
          <button
            onClick={() => { setActiveTab('web'); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'web'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'
            }`}
          >
            <Globe size={14} />
            Web (HAR) ({webRecordings.length})
          </button>
          <button
            onClick={() => { setActiveTab('webVideo'); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'webVideo'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'
            }`}
          >
            <Film size={14} />
            Web (Video) ({webVideoRecordings.length})
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-border)]/40 border border-[var(--color-border)]/50 rounded-lg">
            <Search size={14} className="text-[var(--color-textSecondary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recordings..."
              className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-gray-500 outline-none"
            />
          </div>
          {activeTab === 'ssh' && sshRecordings.length > 0 && (
            <button
              onClick={handleDeleteAllSsh}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 size={14} /> Clear All
            </button>
          )}
          {activeTab === 'rdp' && rdpRecordings.length > 0 && (
            <button
              onClick={handleDeleteAllRdp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 size={14} /> Clear All
            </button>
          )}
          {activeTab === 'web' && webRecordings.length > 0 && (
            <button
              onClick={handleClearAllWeb}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 size={14} /> Clear All
            </button>
          )}
          {activeTab === 'webVideo' && webVideoRecordings.length > 0 && (
            <button
              onClick={handleClearAllWebVideo}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 size={14} /> Clear All
            </button>
          )}
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-5 py-1.5 bg-[var(--color-surface)]/20 border-b border-[var(--color-border)]/30 text-[10px] text-gray-500">
          {activeTab === 'ssh' && (
            <>
              <span className="flex items-center gap-1"><HardDrive size={10} /> {sshRecordings.length} recording{sshRecordings.length !== 1 ? 's' : ''}</span>
              <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(sshTotalDuration)} total</span>
            </>
          )}
          {activeTab === 'rdp' && (
            <>
              <span className="flex items-center gap-1"><Film size={10} /> {rdpRecordings.length} recording{rdpRecordings.length !== 1 ? 's' : ''}</span>
              <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(rdpTotalDuration)} total</span>
              <span className="flex items-center gap-1"><HardDrive size={10} /> {formatBytes(rdpTotalSize)}</span>
            </>
          )}
          {activeTab === 'web' && (
            <>
              <span className="flex items-center gap-1"><Globe size={10} /> {webRecordings.length} recording{webRecordings.length !== 1 ? 's' : ''}</span>
            </>
          )}
          {activeTab === 'webVideo' && (
            <>
              <span className="flex items-center gap-1"><Film size={10} /> {webVideoRecordings.length} recording{webVideoRecordings.length !== 1 ? 's' : ''}</span>
              {webVideoRecordings.length > 0 && (
                <span className="flex items-center gap-1"><HardDrive size={10} /> {formatBytes(webVideoRecordings.reduce((s, r) => s + r.sizeBytes, 0))}</span>
              )}
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'ssh' && (
            filteredSsh.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <Terminal size={32} className="mb-3 opacity-50" />
                <p className="text-sm">{searchQuery ? 'No SSH recordings match your search' : 'No SSH terminal recordings yet'}</p>
                {!searchQuery && <p className="text-xs mt-1">Start recording from an SSH session toolbar</p>}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/50">
                {filteredSsh
                  .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                  .map((rec) => (
                    <SshRecordingRow
                      key={rec.id}
                      recording={rec}
                      isExpanded={expandedId === rec.id}
                      onToggle={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                      onRename={(name) => handleRenameSsh(rec, name)}
                      onDelete={() => handleDeleteSsh(rec.id)}
                      onExport={(format) => handleExportSsh(rec, format)}
                    />
                  ))}
              </div>
            )
          )}

          {activeTab === 'rdp' && (
            filteredRdp.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <Monitor size={32} className="mb-3 opacity-50" />
                <p className="text-sm">{searchQuery ? 'No RDP recordings match your search' : 'No RDP screen recordings yet'}</p>
                {!searchQuery && <p className="text-xs mt-1">Enable auto-save in Recording settings, or save from the RDP toolbar</p>}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/50">
                {filteredRdp
                  .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                  .map((rec) => (
                    <RdpRecordingRow
                      key={rec.id}
                      recording={rec}
                      isExpanded={expandedId === rec.id}
                      onToggle={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                      onRename={(name) => handleRenameRdp(rec, name)}
                      onDelete={() => handleDeleteRdp(rec.id)}
                      onExport={() => handleExportRdp(rec)}
                      onPlay={() => handlePlayRdp(rec)}
                    />
                  ))}
              </div>
            )
          )}

          {activeTab === 'web' && (
            filteredWeb.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <Globe size={32} className="mb-3 opacity-50" />
                <p className="text-sm">{searchQuery ? 'No web recordings match your search' : 'No web HAR recordings yet'}</p>
                {!searchQuery && <p className="text-xs mt-1">Start recording HTTP traffic from a web browser session</p>}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/50">
                {filteredWeb.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()).map(rec => (
                  <WebHarRecordingRow
                    key={rec.id}
                    recording={rec}
                    isExpanded={expandedId === rec.id}
                    onToggle={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                    onRename={(name) => handleRenameWeb(rec.id, name)}
                    onDelete={() => handleDeleteWeb(rec.id)}
                    onExport={(format) => handleExportWeb(rec, format)}
                  />
                ))}
              </div>
            )
          )}

          {activeTab === 'webVideo' && (
            filteredWebVideo.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <Film size={32} className="mb-3 opacity-50" />
                <p className="text-sm">{searchQuery ? 'No web video recordings match your search' : 'No web video recordings yet'}</p>
                {!searchQuery && <p className="text-xs mt-1">Record your web browsing session as video</p>}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/50">
                {filteredWebVideo
                  .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                  .map(rec => (
                    <div key={rec.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)]/60">
                      <Film size={16} className="text-purple-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--color-text)] truncate">{rec.name}</div>
                        <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
                          {rec.host && (
                            <>
                              <span>{rec.host}</span>
                              <span className="text-gray-600">·</span>
                            </>
                          )}
                          <span>{formatDuration(rec.durationMs)}</span>
                          <span className="text-gray-600">·</span>
                          <span>{formatBytes(rec.sizeBytes)}</span>
                          <span className="text-gray-600">·</span>
                          <span className="uppercase">{rec.format}</span>
                          <span className="text-gray-600">·</span>
                          <span>{new Date(rec.savedAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleExportWebVideo(rec)}
                          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteWebVideo(rec.id)}
                          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

// ─── SSH Recording Row ─────────────────────────────────────────────

const SshRecordingRow: React.FC<{
  recording: SavedRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: 'json' | 'asciicast' | 'script' | 'gif') => void;
}> = ({ recording, isExpanded, onToggle, onRename, onDelete, onExport }) => {
  const [editName, setEditName] = useState(recording.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const meta = recording.recording.metadata;

  return (
    <div className={isExpanded ? 'bg-[var(--color-surface)]/30' : ''}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Terminal size={16} className="text-green-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">{recording.name}</div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            <span>{meta.host}</span>
            <span className="text-gray-600">·</span>
            <span>{meta.username}@</span>
            <span className="text-gray-600">·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span className="text-gray-600">·</span>
            <span>{meta.entry_count} entries</span>
            <span className="text-gray-600">·</span>
            <span>{meta.cols}x{meta.rows}</span>
            <span className="text-gray-600">·</span>
            <span>{new Date(recording.savedAt).toLocaleString()}</span>
          </div>
        </div>
        {recording.tags && recording.tags.length > 0 && (
          <div className="flex gap-1">
            {recording.tags.map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 text-[9px] bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
        {isExpanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-2 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename(editName); setIsRenaming(false); }
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
              />
              <button onClick={() => { onRename(editName); setIsRenaming(false); }} className="p-1 text-green-400 hover:text-green-300">
                <Save size={14} />
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => setIsRenaming(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={() => onExport('asciicast')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Download size={12} /> Asciicast
              </button>
              <button onClick={() => onExport('script')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Download size={12} /> Script
              </button>
              <button onClick={() => onExport('json')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Download size={12} /> JSON
              </button>
              <button onClick={() => onExport('gif')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Film size={12} /> GIF
              </button>
              <div className="flex-1" />
              <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded">
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── RDP Recording Row ─────────────────────────────────────────────

const RdpRecordingRow: React.FC<{
  recording: SavedRdpRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onPlay: () => void;
}> = ({ recording, isExpanded, onToggle, onRename, onDelete, onExport, onPlay }) => {
  const [editName, setEditName] = useState(recording.name);
  const [isRenaming, setIsRenaming] = useState(false);

  return (
    <div className={isExpanded ? 'bg-[var(--color-surface)]/30' : ''}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Monitor size={16} className="text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">{recording.name}</div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            {recording.host && (
              <>
                <span>{recording.host}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            {recording.connectionName && (
              <>
                <span>{recording.connectionName}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            <span>{formatDuration(recording.durationMs)}</span>
            <span className="text-gray-600">·</span>
            <span>{recording.width}x{recording.height}</span>
            <span className="text-gray-600">·</span>
            <span>{recording.format.toUpperCase()}</span>
            <span className="text-gray-600">·</span>
            <span>{formatBytes(recording.sizeBytes)}</span>
            <span className="text-gray-600">·</span>
            <span>{new Date(recording.savedAt).toLocaleString()}</span>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-2 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename(editName); setIsRenaming(false); }
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
              />
              <button onClick={() => { onRename(editName); setIsRenaming(false); }} className="p-1 text-green-400 hover:text-green-300">
                <Save size={14} />
              </button>
            </div>
          ) : (
            <>
              <button onClick={(e) => { e.stopPropagation(); onPlay(); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded">
                <Play size={12} /> Play
              </button>
              <button onClick={() => setIsRenaming(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={(e) => { e.stopPropagation(); onExport(); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                <Download size={12} /> Save to File
              </button>
              <div className="flex-1" />
              <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded">
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Web HAR Recording Row ────────────────────────────────────────

const WebHarRecordingRow: React.FC<{
  recording: SavedWebRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: 'json' | 'har') => void;
}> = ({ recording, isExpanded, onToggle, onRename, onDelete, onExport }) => {
  const [editName, setEditName] = useState(recording.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const meta = recording.recording.metadata;

  return (
    <div className={isExpanded ? 'bg-[var(--color-surface)]/30' : ''}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Globe size={16} className="text-cyan-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">{recording.name}</div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            {recording.host && (
              <>
                <span>{recording.host}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            <span>{meta.entry_count} requests</span>
            <span className="text-gray-600">·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span className="text-gray-600">·</span>
            <span>{formatBytes(meta.total_bytes_transferred)}</span>
            <span className="text-gray-600">·</span>
            <span>{new Date(recording.savedAt).toLocaleString()}</span>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 px-2 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] outline-none focus:border-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { onRename(editName); setIsRenaming(false); }
                    if (e.key === 'Escape') setIsRenaming(false);
                  }}
                />
                <button onClick={() => { onRename(editName); setIsRenaming(false); }} className="p-1 text-green-400 hover:text-green-300">
                  <Save size={14} />
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => setIsRenaming(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                  <Edit2 size={12} /> Rename
                </button>
                <button onClick={() => onExport('har')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                  <Download size={12} /> HAR
                </button>
                <button onClick={() => onExport('json')} className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded">
                  <Download size={12} /> JSON
                </button>
                <div className="flex-1" />
                <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded">
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
          {/* Request table */}
          <div className="max-h-60 overflow-y-auto rounded border border-[var(--color-border)]/50">
            <table className="w-full text-xs">
              <thead className="text-gray-500 sticky top-0 bg-[var(--color-surface)]">
                <tr>
                  <th className="text-left py-1 px-2">Method</th>
                  <th className="text-left py-1 px-2">URL</th>
                  <th className="text-left py-1 px-2">Status</th>
                  <th className="text-left py-1 px-2">Type</th>
                  <th className="text-right py-1 px-2">Size</th>
                  <th className="text-right py-1 px-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {recording.recording.entries.map((entry, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]/50 hover:bg-[var(--color-surface)]/60">
                    <td className="py-1 px-2 font-mono text-blue-400">{entry.method}</td>
                    <td className="py-1 px-2 text-[var(--color-textSecondary)] truncate max-w-[300px]" title={entry.url}>
                      {entry.url.replace(meta.target_url, '') || '/'}
                    </td>
                    <td className={`py-1 px-2 font-mono ${entry.status >= 400 ? 'text-red-400' : entry.status >= 300 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {entry.status}
                    </td>
                    <td className="py-1 px-2 text-gray-500 truncate max-w-[120px]">
                      {entry.content_type?.split(';')[0] || '-'}
                    </td>
                    <td className="py-1 px-2 text-right text-gray-500">{formatBytes(entry.response_body_size)}</td>
                    <td className="py-1 px-2 text-right text-gray-500">{entry.duration_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecordingManager;
