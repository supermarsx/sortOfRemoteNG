import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Edit2, Trash2, Save, Search, Download,
  ChevronDown, ChevronUp, Clock, Disc, Terminal,
  Monitor, Play, Film, HardDrive, Info,
} from 'lucide-react';
import {
  SavedRecording,
  SavedRdpRecording,
} from '../types/macroTypes';
import * as macroService from '../utils/macroService';

interface RecordingManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'ssh' | 'rdp';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [ssh, rdp] = await Promise.all([
      macroService.loadRecordings(),
      macroService.loadRdpRecordings(),
    ]);
    setSshRecordings(ssh);
    setRdpRecordings(rdp);
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

  // ---- Stats ----
  const sshTotalDuration = sshRecordings.reduce((s, r) => s + r.recording.metadata.duration_ms, 0);
  const rdpTotalSize = rdpRecordings.reduce((s, r) => s + r.sizeBytes, 0);
  const rdpTotalDuration = rdpRecordings.reduce((s, r) => s + r.durationMs, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl mx-4 h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800/60">
          <div className="flex items-center gap-3">
            <Disc size={18} className="text-red-400" />
            <h2 className="text-sm font-semibold text-white">Recording Manager</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => { setActiveTab('ssh'); setExpandedId(null); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ssh'
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
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
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Monitor size={14} />
            RDP Screen ({rdpRecordings.length})
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/40 border-b border-gray-700/50">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-gray-700/40 border border-gray-600/50 rounded-lg">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recordings..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
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
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-5 py-1.5 bg-gray-800/20 border-b border-gray-700/30 text-[10px] text-gray-500">
          {activeTab === 'ssh' ? (
            <>
              <span className="flex items-center gap-1"><HardDrive size={10} /> {sshRecordings.length} recording{sshRecordings.length !== 1 ? 's' : ''}</span>
              <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(sshTotalDuration)} total</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1"><Film size={10} /> {rdpRecordings.length} recording{rdpRecordings.length !== 1 ? 's' : ''}</span>
              <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(rdpTotalDuration)} total</span>
              <span className="flex items-center gap-1"><HardDrive size={10} /> {formatBytes(rdpTotalSize)}</span>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'ssh' ? (
            filteredSsh.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                {searchQuery ? 'No SSH recordings match your search' : 'No SSH terminal recordings yet. Start recording from an SSH session toolbar.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-700/50">
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
          ) : (
            filteredRdp.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                {searchQuery ? 'No RDP recordings match your search' : 'No RDP screen recordings yet. Enable "Auto-save to library" in Recording settings, or save from the RDP toolbar.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-700/50">
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
    <div className={isExpanded ? 'bg-gray-800/30' : ''}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-800/60"
      >
        <Terminal size={16} className="text-green-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{recording.name}</div>
          <div className="text-[10px] text-gray-400 flex items-center gap-2 flex-wrap">
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
              <span key={tag} className="px-1.5 py-0.5 text-[9px] bg-gray-700 text-gray-300 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
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
              <button onClick={() => setIsRenaming(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={() => onExport('asciicast')} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
                <Download size={12} /> Asciicast
              </button>
              <button onClick={() => onExport('script')} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
                <Download size={12} /> Script
              </button>
              <button onClick={() => onExport('json')} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
                <Download size={12} /> JSON
              </button>
              <button onClick={() => onExport('gif')} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
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
    <div className={isExpanded ? 'bg-gray-800/30' : ''}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-800/60"
      >
        <Monitor size={16} className="text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{recording.name}</div>
          <div className="text-[10px] text-gray-400 flex items-center gap-2 flex-wrap">
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
        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
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
              <button onClick={(e) => { e.stopPropagation(); onPlay(); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded">
                <Play size={12} /> Play
              </button>
              <button onClick={() => setIsRenaming(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={(e) => { e.stopPropagation(); onExport(); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">
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

export default RecordingManager;
