import { useState, useEffect, useMemo, useCallback } from 'react';
import { detectLanguage } from '../utils/scriptSyntax';
import { defaultScripts } from '../data/defaultScripts';
import type { ManagedScript, ScriptLanguage, OSTag } from '../components/ScriptManager';
import { SCRIPTS_STORAGE_KEY } from '../components/ScriptManager';

export function useScriptManager(onClose: () => void) {
  const [scripts, setScripts] = useState<ManagedScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<ManagedScript | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<ScriptLanguage | ''>('');
  const [osTagFilter, setOsTagFilter] = useState<OSTag | ''>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editLanguage, setEditLanguage] = useState<ScriptLanguage>('auto');
  const [editCategory, setEditCategory] = useState('Custom');
  const [editOsTags, setEditOsTags] = useState<OSTag[]>(['agnostic']);

  // Load scripts from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && 'customScripts' in parsed) {
          const { customScripts = [], modifiedDefaults = [], deletedDefaultIds = [] } = parsed;
          const activeDefaults = defaultScripts
            .filter(d => !deletedDefaultIds.includes(d.id))
            .map(d => modifiedDefaults.find((m: ManagedScript) => m.id === d.id) || d);
          setScripts([...activeDefaults, ...customScripts]);
        } else if (Array.isArray(parsed)) {
          setScripts([...defaultScripts, ...parsed]);
        } else {
          setScripts(defaultScripts);
        }
      } else {
        setScripts(defaultScripts);
      }
    } catch {
      setScripts(defaultScripts);
    }
  }, []);

  // Save scripts to localStorage
  const saveScripts = useCallback((newScripts: ManagedScript[]) => {
    const defaultIds = defaultScripts.map(s => s.id);
    const remainingDefaultIds = newScripts.filter(s => s.id.startsWith('default-')).map(s => s.id);
    const deletedDefaultIds = defaultIds.filter(id => !remainingDefaultIds.includes(id));
    const customScripts = newScripts.filter(s => !s.id.startsWith('default-'));
    const modifiedDefaults = newScripts.filter(s => s.id.startsWith('default-'));

    localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({
      customScripts,
      modifiedDefaults,
      deletedDefaultIds
    }));
    setScripts(newScripts);
  }, []);

  // Derived data
  const categories = useMemo(() => {
    const cats = new Set(scripts.map(s => s.category));
    return Array.from(cats).sort();
  }, [scripts]);

  const filteredScripts = useMemo(() => {
    return scripts.filter(script => {
      const matchesSearch = !searchFilter ||
        script.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        script.description.toLowerCase().includes(searchFilter.toLowerCase()) ||
        script.script.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesCategory = !categoryFilter || script.category === categoryFilter;
      const matchesLanguage = !languageFilter || script.language === languageFilter;
      const matchesOsTag = !osTagFilter || (script.osTags && script.osTags.includes(osTagFilter));
      return matchesSearch && matchesCategory && matchesLanguage && matchesOsTag;
    });
  }, [scripts, searchFilter, categoryFilter, languageFilter, osTagFilter]);

  // Handlers
  const handleNewScript = useCallback(() => {
    setSelectedScript(null);
    setEditName('');
    setEditDescription('');
    setEditScript('');
    setEditLanguage('auto');
    setEditCategory('Custom');
    setEditOsTags(['agnostic']);
    setIsEditing(true);
  }, []);

  const handleEditScript = useCallback((script: ManagedScript) => {
    setSelectedScript(script);
    setEditName(script.name);
    setEditDescription(script.description);
    setEditScript(script.script);
    setEditLanguage(script.language);
    setEditCategory(script.category);
    setEditOsTags(script.osTags || ['agnostic']);
    setIsEditing(true);
  }, []);

  const handleSaveScript = useCallback(() => {
    if (!editName.trim() || !editScript.trim()) return;

    const finalLanguage = editLanguage === 'auto' ? detectLanguage(editScript) : editLanguage;

    if (selectedScript) {
      const updated = scripts.map(s =>
        s.id === selectedScript.id
          ? {
              ...s,
              name: editName.trim(),
              description: editDescription.trim(),
              script: editScript,
              language: finalLanguage,
              category: editCategory,
              osTags: editOsTags,
              updatedAt: new Date().toISOString(),
            }
          : s
      );
      saveScripts(updated);
    } else {
      const newScript: ManagedScript = {
        id: Date.now().toString(),
        name: editName.trim(),
        description: editDescription.trim(),
        script: editScript,
        language: finalLanguage,
        category: editCategory,
        osTags: editOsTags,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveScripts([...scripts, newScript]);
    }

    setIsEditing(false);
    setSelectedScript(null);
  }, [editName, editDescription, editScript, editLanguage, editCategory, editOsTags, selectedScript, scripts, saveScripts]);

  const handleDeleteScript = useCallback((scriptId: string) => {
    saveScripts(scripts.filter(s => s.id !== scriptId));
    if (selectedScript?.id === scriptId) {
      setSelectedScript(null);
      setIsEditing(false);
    }
  }, [scripts, selectedScript, saveScripts]);

  const handleCopyScript = useCallback(async (script: ManagedScript) => {
    try {
      await navigator.clipboard.writeText(script.script);
      setCopiedId(script.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy script:', error);
    }
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSelectedScript(null);
  }, []);

  const handleDuplicateScript = useCallback((script: ManagedScript) => {
    setSelectedScript(null);
    setEditName(script.name + ' (Copy)');
    setEditDescription(script.description);
    setEditScript(script.script);
    setEditLanguage(script.language);
    setEditCategory(script.category);
    setEditOsTags(script.osTags || ['agnostic']);
    setIsEditing(true);
  }, []);

  const handleSelectScript = useCallback((script: ManagedScript) => {
    setSelectedScript(script);
    setIsEditing(false);
  }, []);

  const toggleOsTag = useCallback((tag: OSTag) => {
    setEditOsTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  return {
    // State
    scripts,
    selectedScript,
    isEditing,
    searchFilter,
    categoryFilter,
    languageFilter,
    osTagFilter,
    copiedId,
    editName,
    editDescription,
    editScript,
    editLanguage,
    editCategory,
    editOsTags,
    // Derived
    categories,
    filteredScripts,
    // Setters
    setSearchFilter,
    setCategoryFilter,
    setLanguageFilter,
    setOsTagFilter,
    setEditName,
    setEditDescription,
    setEditScript,
    setEditLanguage,
    setEditCategory,
    // Handlers
    handleNewScript,
    handleEditScript,
    handleSaveScript,
    handleDeleteScript,
    handleCopyScript,
    handleCancelEdit,
    handleDuplicateScript,
    handleSelectScript,
    toggleOsTag,
    // Props pass-through
    onClose,
  };
}

export type ScriptManagerMgr = ReturnType<typeof useScriptManager>;
