import { useState, useEffect, useMemo, useCallback } from 'react';
import { TerminalMacro, SavedRecording } from '../types/macroTypes';
import * as macroService from '../utils/macroService';

export type MacroTab = 'macros' | 'recordings';

export function useMacroManager(isOpen: boolean) {
  const [activeTab, setActiveTab] = useState<MacroTab>('macros');
  const [macros, setMacros] = useState<TerminalMacro[]>([]);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingMacro, setEditingMacro] = useState<TerminalMacro | null>(null);
  const [editingRecording, setEditingRecording] = useState<SavedRecording | null>(null);

  const loadData = useCallback(async () => {
    const [m, r] = await Promise.all([macroService.loadMacros(), macroService.loadRecordings()]);
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

  const macrosByCategory = useMemo(() => {
    const groups: Record<string, TerminalMacro[]> = {};
    filteredMacros.forEach((m) => {
      const cat = m.category || 'Uncategorized';
      (groups[cat] ??= []).push(m);
    });
    return groups;
  }, [filteredMacros]);

  // ---- Macro CRUD ----
  const handleNewMacro = useCallback(() => {
    const macro: TerminalMacro = {
      id: crypto.randomUUID(),
      name: 'New Macro',
      steps: [{ command: '', delayMs: 200, sendNewline: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingMacro(macro);
  }, []);

  const handleSaveMacro = useCallback(
    async (macro: TerminalMacro) => {
      macro.updatedAt = new Date().toISOString();
      await macroService.saveMacro(macro);
      setEditingMacro(null);
      await loadData();
    },
    [loadData],
  );

  const handleDeleteMacro = useCallback(
    async (id: string) => {
      await macroService.deleteMacro(id);
      if (editingMacro?.id === id) setEditingMacro(null);
      await loadData();
    },
    [editingMacro, loadData],
  );

  const handleDuplicateMacro = useCallback(
    async (macro: TerminalMacro) => {
      const dup: TerminalMacro = {
        ...macro,
        id: crypto.randomUUID(),
        name: `${macro.name} (Copy)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await macroService.saveMacro(dup);
      await loadData();
    },
    [loadData],
  );

  // ---- Recording CRUD ----
  const handleDeleteRecording = useCallback(
    async (id: string) => {
      await macroService.deleteRecording(id);
      if (editingRecording?.id === id) setEditingRecording(null);
      await loadData();
    },
    [editingRecording, loadData],
  );

  const handleRenameRecording = useCallback(
    async (rec: SavedRecording, name: string) => {
      rec.name = name;
      await macroService.saveRecording(rec);
      await loadData();
    },
    [loadData],
  );

  const handleExportRecording = useCallback(
    async (rec: SavedRecording, format: 'json' | 'asciicast' | 'script') => {
      const data = await macroService.exportRecording(rec.recording, format);
      const ext = format === 'asciicast' ? 'cast' : format === 'script' ? 'txt' : 'json';
      const blob = new Blob([data], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  // ---- Import / Export Macros ----
  const handleExportMacros = useCallback(() => {
    const data = JSON.stringify(macros, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'macros.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [macros]);

  const handleImportMacros = useCallback(() => {
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
  }, [loadData]);

  return {
    activeTab,
    setActiveTab,
    macros,
    recordings,
    searchQuery,
    setSearchQuery,
    editingMacro,
    setEditingMacro,
    editingRecording,
    setEditingRecording,
    filteredMacros,
    filteredRecordings,
    macrosByCategory,
    handleNewMacro,
    handleSaveMacro,
    handleDeleteMacro,
    handleDuplicateMacro,
    handleDeleteRecording,
    handleRenameRecording,
    handleExportRecording,
    handleExportMacros,
    handleImportMacros,
  };
}
