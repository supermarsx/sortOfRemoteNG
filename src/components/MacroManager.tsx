import React from 'react';
import {
  X, Plus, Edit2, Trash2, Save, Search,
  CircleDot, ChevronDown, ChevronUp,
  Download, Upload,
  ListVideo, Disc,
} from 'lucide-react';
import { SavedRecording } from '../types/macroTypes';
import { Modal } from './ui/Modal';
import { MacroEditor } from './MacroEditor';
import { formatDuration } from '../utils/formatters';
import { useInlineRename } from '../hooks/window/useInlineRename';
import { useMacroManager } from '../hooks/recording/useMacroManager';

type Mgr = ReturnType<typeof useMacroManager>;

// ─── Sub-components ─────────────────────────────────────────────────

const ManagerHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
    <div className="flex items-center gap-3">
      <ListVideo size={18} className="text-blue-400" />
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Macro & Recording Manager</h2>
    </div>
    <button onClick={onClose} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"><X size={16} /></button>
  </div>
);

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex border-b border-[var(--color-border)]">
    <button onClick={() => mgr.setActiveTab('macros')} className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mgr.activeTab === 'macros' ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'}`}>
      <CircleDot size={14} />Macros ({mgr.macros.length})
    </button>
    <button onClick={() => mgr.setActiveTab('recordings')} className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mgr.activeTab === 'recordings' ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200'}`}>
      <Disc size={14} />Recordings ({mgr.recordings.length})
    </button>
  </div>
);

const Toolbar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50">
    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-border)]/40 border border-[var(--color-border)]/50 rounded-lg">
      <Search size={14} className="text-[var(--color-textSecondary)]" />
      <input type="text" value={mgr.searchQuery} onChange={(e) => mgr.setSearchQuery(e.target.value)} placeholder="Search..." className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-gray-500 outline-none" />
    </div>
    {mgr.activeTab === 'macros' && (
      <>
        <button onClick={mgr.handleNewMacro} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg"><Plus size={14} /> New</button>
        <button onClick={mgr.handleImportMacros} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg"><Upload size={14} /> Import</button>
        <button onClick={mgr.handleExportMacros} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg" disabled={mgr.macros.length === 0}><Download size={14} /> Export</button>
      </>
    )}
  </div>
);

const MacroList: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="w-[340px] border-r border-[var(--color-border)] overflow-y-auto">
    {Object.keys(mgr.macrosByCategory).length === 0 ? (
      <div className="p-6 text-center text-gray-500 text-sm">{mgr.searchQuery ? 'No macros match your search' : 'No macros yet. Click "New" to create one.'}</div>
    ) : (
      Object.entries(mgr.macrosByCategory).map(([cat, catMacros]) => (
        <div key={cat}>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-gray-500 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50">{cat}</div>
          {catMacros.map((macro) => (
            <div key={macro.id} onClick={() => mgr.setEditingMacro(macro)} className={`px-3 py-2 border-b border-[var(--color-border)]/30 cursor-pointer hover:bg-[var(--color-surface)]/60 ${mgr.editingMacro?.id === macro.id ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : ''}`}>
              <div className="text-sm font-medium text-[var(--color-text)] truncate">{macro.name}</div>
              <div className="text-[10px] text-[var(--color-textSecondary)]">{macro.steps.length} step{macro.steps.length !== 1 ? 's' : ''}{macro.description && ` · ${macro.description}`}</div>
            </div>
          ))}
        </div>
      ))
    )}
  </div>
);

const MacroEditorPanel: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto p-4">
    {mgr.editingMacro ? (
      <MacroEditor macro={mgr.editingMacro} onChange={mgr.setEditingMacro} onSave={mgr.handleSaveMacro} onDelete={mgr.handleDeleteMacro} onDuplicate={mgr.handleDuplicateMacro} />
    ) : (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">Select a macro to edit or create a new one</div>
    )}
  </div>
);

const RecordingsList: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto">
    {mgr.filteredRecordings.length === 0 ? (
      <div className="p-6 text-center text-gray-500 text-sm">{mgr.searchQuery ? 'No recordings match your search' : 'No saved recordings yet.'}</div>
    ) : (
      <div className="divide-y divide-[var(--color-border)]/50">
        {mgr.filteredRecordings
          .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
          .map((rec) => (
            <RecordingRow
              key={rec.id}
              recording={rec}
              isEditing={mgr.editingRecording?.id === rec.id}
              onSelect={() => mgr.setEditingRecording(mgr.editingRecording?.id === rec.id ? null : rec)}
              onRename={(name) => mgr.handleRenameRecording(rec, name)}
              onDelete={() => mgr.handleDeleteRecording(rec.id)}
              onExport={(format) => mgr.handleExportRecording(rec, format)}
            />
          ))}
      </div>
    )}
  </div>
);

// ─── Root component ─────────────────────────────────────────────────

interface MacroManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MacroManager: React.FC<MacroManagerProps> = ({ isOpen, onClose }) => {
  const mgr = useMacroManager(isOpen);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop closeOnEscape backdropClassName="bg-black/60" panelClassName="max-w-5xl mx-4 h-[90vh] bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl shadow-2xl">
      <ManagerHeader onClose={onClose} />
      <TabBar mgr={mgr} />
      <Toolbar mgr={mgr} />
      <div className="flex-1 overflow-hidden flex">
        {mgr.activeTab === 'macros' ? (
          <div className="flex-1 flex overflow-hidden">
            <MacroList mgr={mgr} />
            <MacroEditorPanel mgr={mgr} />
          </div>
        ) : (
          <RecordingsList mgr={mgr} />
        )}
      </div>
    </Modal>
  );
};

// ─── Recording Row ─────────────────────────────────────────────────

interface RecordingRowProps {
  recording: SavedRecording;
  isEditing: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: "json" | "asciicast" | "script") => void;
}

const RecordingRow: React.FC<RecordingRowProps> = ({
  recording,
  isEditing,
  onSelect,
  onRename,
  onDelete,
  onExport,
}) => {
  const rename = useInlineRename(recording.name, onRename);
  const meta = recording.recording.metadata;

  return (
    <div className={`${isEditing ? "bg-[var(--color-surface)]/40" : ""}`}>
      <div
        onClick={onSelect}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Disc size={16} className="text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {recording.name}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2">
            <span>{meta.host}</span>
            <span>·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span>·</span>
            <span>{meta.entry_count} entries</span>
            <span>·</span>
            <span>{new Date(recording.savedAt).toLocaleDateString()}</span>
          </div>
        </div>
        {isEditing ? (
          <ChevronUp size={14} className="text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        )}
      </div>
      {isEditing && (
        <div className="px-4 pb-3 flex items-center gap-2">
          {rename.isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={rename.draft}
                onChange={(e) => rename.setDraft(e.target.value)}
                className="flex-1 px-2 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={rename.handleKeyDown}
              />
              <button
                onClick={rename.commitRename}
                className="p-1 text-green-400 hover:text-green-300"
              >
                <Save size={14} />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={rename.startRename}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Edit2 size={12} /> Rename
              </button>
              <button
                onClick={() => onExport("asciicast")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> Asciicast
              </button>
              <button
                onClick={() => onExport("script")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> Script
              </button>
              <button
                onClick={() => onExport("json")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> JSON
              </button>
              <div className="flex-1" />
              <button
                onClick={onDelete}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded"
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MacroManager;
