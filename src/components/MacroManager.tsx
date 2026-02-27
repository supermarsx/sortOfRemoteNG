import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Plus, Edit2, Trash2, Save, Copy, Search,
  PlayCircle, CircleDot, ChevronDown, ChevronUp,
  Download, Upload, GripVertical, Clock,
  ListVideo, Disc,
} from 'lucide-react';
import {
  TerminalMacro,
  MacroStep,
  SavedRecording,
} from '../types/macroTypes';
import * as macroService from '../utils/macroService';

interface MacroManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'macros' | 'recordings';

export const MacroManager: React.FC<MacroManagerProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('macros');
  const [macros, setMacros] = useState<TerminalMacro[]>([]);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingMacro, setEditingMacro] = useState<TerminalMacro | null>(null);
  const [editingRecording, setEditingRecording] = useState<SavedRecording | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    const [m, r] = await Promise.all([
      macroService.loadMacros(),
      macroService.loadRecordings(),
    ]);
    setMacros(m);
    setRecordings(r);
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  // Filtered lists
  const filteredMacros = useMemo(() => {
    if (!searchQuery.trim()) return macros;
    const q = searchQuery.toLowerCase();
    return macros.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [macros, searchQuery]);

  const filteredRecordings = useMemo(() => {
    if (!searchQuery.trim()) return recordings;
    const q = searchQuery.toLowerCase();
    return recordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.recording.metadata.host.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [recordings, searchQuery]);

  // Macros grouped by category
  const macrosByCategory = useMemo(() => {
    const groups: Record<string, TerminalMacro[]> = {};
    filteredMacros.forEach((m) => {
      const cat = m.category || 'Uncategorized';
      (groups[cat] ??= []).push(m);
    });
    return groups;
  }, [filteredMacros]);

  // ---- Macro CRUD ----
  const handleNewMacro = () => {
    const macro: TerminalMacro = {
      id: crypto.randomUUID(),
      name: 'New Macro',
      steps: [{ command: '', delayMs: 200, sendNewline: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingMacro(macro);
  };

  const handleSaveMacro = async (macro: TerminalMacro) => {
    macro.updatedAt = new Date().toISOString();
    await macroService.saveMacro(macro);
    setEditingMacro(null);
    await loadData();
  };

  const handleDeleteMacro = async (id: string) => {
    await macroService.deleteMacro(id);
    if (editingMacro?.id === id) setEditingMacro(null);
    await loadData();
  };

  const handleDuplicateMacro = async (macro: TerminalMacro) => {
    const dup: TerminalMacro = {
      ...macro,
      id: crypto.randomUUID(),
      name: `${macro.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await macroService.saveMacro(dup);
    await loadData();
  };

  // ---- Recording CRUD ----
  const handleDeleteRecording = async (id: string) => {
    await macroService.deleteRecording(id);
    if (editingRecording?.id === id) setEditingRecording(null);
    await loadData();
  };

  const handleRenameRecording = async (rec: SavedRecording, name: string) => {
    rec.name = name;
    await macroService.saveRecording(rec);
    await loadData();
  };

  const handleExportRecording = async (rec: SavedRecording, format: 'json' | 'asciicast' | 'script') => {
    const data = await macroService.exportRecording(rec.recording, format);
    const ext = format === 'asciicast' ? 'cast' : format === 'script' ? 'txt' : 'json';
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Import / Export Macros ----
  const handleExportMacros = () => {
    const data = JSON.stringify(macros, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'macros.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMacros = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as TerminalMacro[];
        if (!Array.isArray(imported)) return;
        for (const macro of imported) {
          macro.id = crypto.randomUUID();
          macro.createdAt = new Date().toISOString();
          macro.updatedAt = new Date().toISOString();
          await macroService.saveMacro(macro);
        }
        await loadData();
      } catch (err) {
        console.error('Import failed:', err);
      }
    };
    input.click();
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl mx-4 h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800/60">
          <div className="flex items-center gap-3">
            <ListVideo size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Macro & Recording Manager</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('macros')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'macros'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <CircleDot size={14} />
            Macros ({macros.length})
          </button>
          <button
            onClick={() => setActiveTab('recordings')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'recordings'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Disc size={14} />
            Recordings ({recordings.length})
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
              placeholder="Search..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
            />
          </div>
          {activeTab === 'macros' && (
            <>
              <button onClick={handleNewMacro} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                <Plus size={14} /> New
              </button>
              <button onClick={handleImportMacros} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
                <Upload size={14} /> Import
              </button>
              <button onClick={handleExportMacros} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg" disabled={macros.length === 0}>
                <Download size={14} /> Export
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'macros' ? (
            <div className="flex-1 flex overflow-hidden">
              {/* Macro list */}
              <div className="w-[340px] border-r border-gray-700 overflow-y-auto">
                {Object.keys(macrosByCategory).length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-sm">
                    {searchQuery ? 'No macros match your search' : 'No macros yet. Click "New" to create one.'}
                  </div>
                ) : (
                  Object.entries(macrosByCategory).map(([cat, catMacros]) => (
                    <div key={cat}>
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-gray-500 bg-gray-800/40 border-b border-gray-700/50">
                        {cat}
                      </div>
                      {catMacros.map((macro) => (
                        <div
                          key={macro.id}
                          onClick={() => setEditingMacro(macro)}
                          className={`px-3 py-2 border-b border-gray-700/30 cursor-pointer hover:bg-gray-800/60 ${
                            editingMacro?.id === macro.id ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : ''
                          }`}
                        >
                          <div className="text-sm font-medium text-white truncate">{macro.name}</div>
                          <div className="text-[10px] text-gray-400">
                            {macro.steps.length} step{macro.steps.length !== 1 ? 's' : ''}
                            {macro.description && ` · ${macro.description}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              {/* Macro editor */}
              <div className="flex-1 overflow-y-auto p-4">
                {editingMacro ? (
                  <MacroEditor
                    macro={editingMacro}
                    onChange={setEditingMacro}
                    onSave={handleSaveMacro}
                    onDelete={handleDeleteMacro}
                    onDuplicate={handleDuplicateMacro}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Select a macro to edit or create a new one
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Recordings tab */
            <div className="flex-1 overflow-y-auto">
              {filteredRecordings.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  {searchQuery ? 'No recordings match your search' : 'No saved recordings yet.'}
                </div>
              ) : (
                <div className="divide-y divide-gray-700/50">
                  {filteredRecordings
                    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                    .map((rec) => (
                      <RecordingRow
                        key={rec.id}
                        recording={rec}
                        isEditing={editingRecording?.id === rec.id}
                        onSelect={() => setEditingRecording(editingRecording?.id === rec.id ? null : rec)}
                        onRename={(name) => handleRenameRecording(rec, name)}
                        onDelete={() => handleDeleteRecording(rec.id)}
                        onExport={(format) => handleExportRecording(rec, format)}
                        formatDuration={formatDuration}
                      />
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Macro Editor ──────────────────────────────────────────────────

interface MacroEditorProps {
  macro: TerminalMacro;
  onChange: (m: TerminalMacro) => void;
  onSave: (m: TerminalMacro) => void;
  onDelete: (id: string) => void;
  onDuplicate: (m: TerminalMacro) => void;
}

const MacroEditor: React.FC<MacroEditorProps> = ({ macro, onChange, onSave, onDelete, onDuplicate }) => {
  const updateField = <K extends keyof TerminalMacro>(key: K, value: TerminalMacro[K]) => {
    onChange({ ...macro, [key]: value });
  };

  const updateStep = (idx: number, patch: Partial<MacroStep>) => {
    const steps = [...macro.steps];
    steps[idx] = { ...steps[idx], ...patch };
    onChange({ ...macro, steps });
  };

  const addStep = () => {
    onChange({ ...macro, steps: [...macro.steps, { command: '', delayMs: 200, sendNewline: true }] });
  };

  const removeStep = (idx: number) => {
    const steps = macro.steps.filter((_, i) => i !== idx);
    onChange({ ...macro, steps: steps.length > 0 ? steps : [{ command: '', delayMs: 200, sendNewline: true }] });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= macro.steps.length) return;
    const steps = [...macro.steps];
    [steps[idx], steps[target]] = [steps[target], steps[idx]];
    onChange({ ...macro, steps });
  };

  return (
    <div className="space-y-4">
      {/* Name + Category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Name</label>
          <input
            value={macro.name}
            onChange={(e) => updateField('name', e.target.value)}
            className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Category</label>
          <input
            value={macro.category || ''}
            onChange={(e) => updateField('category', e.target.value || undefined)}
            placeholder="General"
            className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Description</label>
        <input
          value={macro.description || ''}
          onChange={(e) => updateField('description', e.target.value || undefined)}
          placeholder="Optional description..."
          className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Tags (comma-separated)</label>
        <input
          value={macro.tags?.join(', ') || ''}
          onChange={(e) => updateField('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
          placeholder="e.g. deploy, linux, restart"
          className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] uppercase tracking-widest text-gray-400">Steps ({macro.steps.length})</label>
          <button onClick={addStep} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={12} /> Add Step
          </button>
        </div>
        <div className="space-y-2">
          {macro.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 p-2 bg-gray-800/60 border border-gray-700/50 rounded">
              <div className="flex flex-col items-center gap-0.5 pt-1">
                <button onClick={() => moveStep(i, -1)} className="text-gray-500 hover:text-gray-300" disabled={i === 0}>
                  <ChevronUp size={12} />
                </button>
                <GripVertical size={12} className="text-gray-600" />
                <button onClick={() => moveStep(i, 1)} className="text-gray-500 hover:text-gray-300" disabled={i === macro.steps.length - 1}>
                  <ChevronDown size={12} />
                </button>
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  value={step.command}
                  onChange={(e) => updateStep(i, { command: e.target.value })}
                  placeholder="Command..."
                  className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-sm text-white font-mono placeholder-gray-500 focus:border-blue-500 outline-none"
                />
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <label className="flex items-center gap-1.5">
                    <Clock size={10} />
                    <input
                      type="number"
                      value={step.delayMs}
                      onChange={(e) => updateStep(i, { delayMs: Math.max(0, Number(e.target.value)) })}
                      className="w-16 px-1.5 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-white outline-none"
                      min={0}
                    />
                    ms
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.sendNewline}
                      onChange={(e) => updateStep(i, { sendNewline: e.target.checked })}
                      className="rounded border-gray-600"
                    />
                    Send Enter
                  </label>
                </div>
              </div>
              <button onClick={() => removeStep(i)} className="p-1 text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
        <button onClick={() => onSave(macro)} className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
          <Save size={14} /> Save
        </button>
        <button onClick={() => onDuplicate(macro)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
          <Copy size={14} /> Duplicate
        </button>
        <div className="flex-1" />
        <button onClick={() => onDelete(macro.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-sm rounded-lg">
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
};

// ─── Recording Row ─────────────────────────────────────────────────

interface RecordingRowProps {
  recording: SavedRecording;
  isEditing: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: 'json' | 'asciicast' | 'script') => void;
  formatDuration: (ms: number) => string;
}

const RecordingRow: React.FC<RecordingRowProps> = ({
  recording,
  isEditing,
  onSelect,
  onRename,
  onDelete,
  onExport,
  formatDuration,
}) => {
  const [editName, setEditName] = useState(recording.name);
  const [isRenaming, setIsRenaming] = useState(false);

  const meta = recording.recording.metadata;

  return (
    <div className={`${isEditing ? 'bg-gray-800/40' : ''}`}>
      <div
        onClick={onSelect}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/60"
      >
        <Disc size={16} className="text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{recording.name}</div>
          <div className="text-[10px] text-gray-400 flex items-center gap-2">
            <span>{meta.host}</span>
            <span>·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span>·</span>
            <span>{meta.entry_count} entries</span>
            <span>·</span>
            <span>{new Date(recording.savedAt).toLocaleDateString()}</span>
          </div>
        </div>
        {isEditing ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </div>
      {isEditing && (
        <div className="px-4 pb-3 flex items-center gap-2">
          {isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onRename(editName);
                    setIsRenaming(false);
                  }
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

export default MacroManager;
