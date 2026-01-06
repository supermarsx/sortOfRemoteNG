import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { 
  X, Terminal, Send, Square, CheckSquare, 
  Grid3x3, Rows, History, Trash2, Copy, Clock,
  AlertCircle, Check, Save, FileCode, FolderOpen, ExternalLink,
  StopCircle
} from 'lucide-react';
import { useConnections } from '../contexts/useConnections';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

interface BulkSSHCommanderProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: Date;
  sessionIds: string[];
  results: Record<string, { output: string; error?: string; status: 'pending' | 'success' | 'error' }>;
}

interface SessionOutput {
  sessionId: string;
  sessionName: string;
  output: string;
  error?: string;
  status: 'idle' | 'running' | 'success' | 'error';
}

interface SavedScript {
  id: string;
  name: string;
  description: string;
  script: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = 'tabs' | 'mosaic';

const SCRIPTS_STORAGE_KEY = 'bulkSshScripts';

// Default script templates
const defaultScripts: SavedScript[] = [
  {
    id: 'default-1',
    name: 'System Info',
    description: 'Get basic system information',
    script: 'uname -a && cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-2',
    name: 'Disk Usage',
    description: 'Check disk space usage',
    script: 'df -h',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-3',
    name: 'Memory Usage',
    description: 'Check memory usage',
    script: 'free -h',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-4',
    name: 'Running Processes',
    description: 'List top processes by CPU',
    script: 'ps aux --sort=-%cpu | head -10',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-5',
    name: 'Network Connections',
    description: 'Show active network connections',
    script: 'netstat -tuln 2>/dev/null || ss -tuln',
    category: 'Network',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-6',
    name: 'Uptime',
    description: 'Show system uptime',
    script: 'uptime',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const BulkSSHCommander: React.FC<BulkSSHCommanderProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { state } = useConnections();
  
  // Filter only active SSH sessions
  const sshSessions = useMemo(() => {
    return state.sessions.filter(
      s => s.protocol === 'ssh' && (s.status === 'connected' || s.status === 'connecting')
    );
  }, [state.sessions]);

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);
  const [sessionOutputs, setSessionOutputs] = useState<Record<string, SessionOutput>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('mosaic');
  const [isExecuting, setIsExecuting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<string | null>(null);
  
  // Script library state
  const [showScriptLibrary, setShowScriptLibrary] = useState(false);
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [editingScript, setEditingScript] = useState<SavedScript | null>(null);
  const [newScriptName, setNewScriptName] = useState('');
  const [newScriptDescription, setNewScriptDescription] = useState('');
  const [newScriptCategory, setNewScriptCategory] = useState('Custom');
  const [scriptFilter, setScriptFilter] = useState('');
  
  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const outputListenersRef = useRef<Map<string, () => void>>(new Map());

  // Load saved scripts from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSavedScripts([...defaultScripts, ...parsed]);
      } else {
        setSavedScripts(defaultScripts);
      }
    } catch {
      setSavedScripts(defaultScripts);
    }
  }, []);

  // Save scripts to localStorage (excluding defaults)
  const saveScriptsToStorage = useCallback((scripts: SavedScript[]) => {
    const customScripts = scripts.filter(s => !s.id.startsWith('default-'));
    localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify(customScripts));
  }, []);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(savedScripts.map(s => s.category));
    return Array.from(cats).sort();
  }, [savedScripts]);

  // Filter scripts
  const filteredScripts = useMemo(() => {
    if (!scriptFilter) return savedScripts;
    const lower = scriptFilter.toLowerCase();
    return savedScripts.filter(s => 
      s.name.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower) ||
      s.category.toLowerCase().includes(lower) ||
      s.script.toLowerCase().includes(lower)
    );
  }, [savedScripts, scriptFilter]);

  // Initialize session outputs when sessions change
  useEffect(() => {
    setSessionOutputs(prev => {
      const newOutputs: Record<string, SessionOutput> = {};
      sshSessions.forEach(session => {
        newOutputs[session.id] = prev[session.id] || {
          sessionId: session.id,
          sessionName: session.name,
          output: '',
          status: 'idle',
        };
      });
      return newOutputs;
    });
    
    // Set first session as active tab if none selected
    setActiveOutputTab(prev => {
      if (!prev && sshSessions.length > 0) {
        return sshSessions[0].id;
      }
      return prev;
    });
  }, [sshSessions]);

  // Select all sessions by default
  useEffect(() => {
    if (isOpen && sshSessions.length > 0) {
      setSelectedSessionIds(prev => {
        if (prev.size === 0) {
          return new Set(sshSessions.map(s => s.id));
        }
        return prev;
      });
    }
  }, [isOpen, sshSessions]);

  // Clean up listeners on unmount
  useEffect(() => {
    const listeners = outputListenersRef.current;
    return () => {
      listeners.forEach(unlisten => unlisten());
      listeners.clear();
    };
  }, []);

  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const selectAllSessions = useCallback(() => {
    if (selectedSessionIds.size === sshSessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(sshSessions.map(s => s.id)));
    }
  }, [sshSessions, selectedSessionIds]);

  const executeCommand = useCallback(async () => {
    if (!command.trim() || selectedSessionIds.size === 0 || isExecuting) return;

    const isTauri = typeof window !== 'undefined' && 
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    
    if (!isTauri) {
      console.warn('Bulk SSH commander requires Tauri runtime');
      return;
    }

    setIsExecuting(true);
    const commandId = Date.now().toString();
    const selectedSessions = sshSessions.filter(s => selectedSessionIds.has(s.id));
    
    // Initialize output states for selected sessions
    const initialOutputs: Record<string, SessionOutput> = {};
    selectedSessions.forEach(session => {
      initialOutputs[session.id] = {
        sessionId: session.id,
        sessionName: session.name,
        output: '',
        status: 'running',
      };
    });
    setSessionOutputs(prev => ({ ...prev, ...initialOutputs }));

    // Add to history
    const historyItem: CommandHistoryItem = {
      id: commandId,
      command: command.trim(),
      timestamp: new Date(),
      sessionIds: Array.from(selectedSessionIds),
      results: {},
    };

    // Send command to each selected session
    const commandPromises = selectedSessions.map(async (session) => {
      try {
        // Get the backend session ID from the session
        const backendSessionId = session.backendSessionId;
        if (!backendSessionId) {
          throw new Error('No backend session ID');
        }

        // Send the command with a newline to execute
        await invoke('send_ssh_input', { 
          sessionId: backendSessionId, 
          data: command.trim() + '\n' 
        });

        // Mark as success (output will come through event listener)
        setSessionOutputs(prev => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            status: 'success',
            output: prev[session.id]?.output + `\n$ ${command.trim()}\n`,
          },
        }));

        historyItem.results[session.id] = {
          output: `Command sent successfully`,
          status: 'success',
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setSessionOutputs(prev => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            status: 'error',
            error: errorMsg,
          },
        }));
        historyItem.results[session.id] = {
          output: '',
          error: errorMsg,
          status: 'error',
        };
      }
    });

    await Promise.all(commandPromises);
    
    setCommandHistory(prev => [historyItem, ...prev].slice(0, 50));
    setIsExecuting(false);
    setCommand('');
    commandInputRef.current?.focus();
  }, [command, selectedSessionIds, sshSessions, isExecuting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeCommand();
    }
  }, [executeCommand]);

  // Send Ctrl+C (SIGINT) to selected sessions
  const sendCancel = useCallback(async () => {
    const isTauri = typeof window !== 'undefined' && 
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    
    if (!isTauri) return;

    const selectedSessions = sshSessions.filter(s => selectedSessionIds.has(s.id));
    
    // Send Ctrl+C character (ASCII 0x03) to each selected session
    const cancelPromises = selectedSessions.map(async (session) => {
      try {
        const backendSessionId = session.backendSessionId;
        if (!backendSessionId) return;

        // Send ETX (End of Text) character - Ctrl+C
        await invoke('send_ssh_input', { 
          sessionId: backendSessionId, 
          data: '\x03' 
        });

        setSessionOutputs(prev => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            output: prev[session.id]?.output + '\n^C\n',
            status: 'idle',
          },
        }));
      } catch (error) {
        console.error('Failed to send cancel to session:', session.id, error);
      }
    });

    await Promise.all(cancelPromises);
    setIsExecuting(false);
  }, [sshSessions, selectedSessionIds]);

  const clearOutputs = useCallback(() => {
    const clearedOutputs: Record<string, SessionOutput> = {};
    sshSessions.forEach(session => {
      clearedOutputs[session.id] = {
        sessionId: session.id,
        sessionName: session.name,
        output: '',
        status: 'idle',
      };
    });
    setSessionOutputs(clearedOutputs);
  }, [sshSessions]);

  const loadHistoryCommand = useCallback((historyItem: CommandHistoryItem) => {
    setCommand(historyItem.command);
    setShowHistory(false);
    commandInputRef.current?.focus();
  }, []);

  // Script library functions
  const loadScript = useCallback((script: SavedScript) => {
    setCommand(script.script);
    setShowScriptLibrary(false);
    commandInputRef.current?.focus();
  }, []);

  const saveCurrentAsScript = useCallback(() => {
    if (!command.trim() || !newScriptName.trim()) return;
    
    const newScript: SavedScript = {
      id: Date.now().toString(),
      name: newScriptName.trim(),
      description: newScriptDescription.trim(),
      script: command.trim(),
      category: newScriptCategory || 'Custom',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const updated = [...savedScripts, newScript];
    setSavedScripts(updated);
    saveScriptsToStorage(updated);
    setNewScriptName('');
    setNewScriptDescription('');
    setEditingScript(null);
  }, [command, newScriptName, newScriptDescription, newScriptCategory, savedScripts, saveScriptsToStorage]);

  const deleteScript = useCallback((scriptId: string) => {
    if (scriptId.startsWith('default-')) return; // Can't delete defaults
    const updated = savedScripts.filter(s => s.id !== scriptId);
    setSavedScripts(updated);
    saveScriptsToStorage(updated);
  }, [savedScripts, saveScriptsToStorage]);

  // Detach window
  const handleDetach = useCallback(async () => {
    const isTauri = typeof window !== 'undefined' && 
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    
    if (isTauri) {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const webview = new WebviewWindow('bulk-ssh-commander', {
          url: '/bulk-ssh-commander',
          title: 'Bulk SSH Commander',
          width: 1200,
          height: 800,
          center: true,
          resizable: true,
          decorations: true,
        });
        
        webview.once('tauri://created', () => {
          onClose();
        });
        
        webview.once('tauri://error', (e) => {
          console.error('Failed to create detached window:', e);
        });
      } catch (error) {
        console.error('Failed to detach window:', error);
      }
    }
  }, [onClose]);

  if (!isOpen) return null;

  const selectedCount = selectedSessionIds.size;
  const totalCount = sshSessions.length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* Background glow effects - only show in dark mode */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-green-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-emerald-500/6 rounded-full blur-3xl" />
        <div className="absolute top-[50%] right-[25%] w-64 h-64 bg-teal-500/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Terminal size={16} className="text-green-600 dark:text-green-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t('bulkSsh.title', 'Bulk SSH Commander')}
            </h2>
            <span className="text-sm text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
              {selectedCount}/{totalCount} {t('bulkSsh.sessions', 'sessions')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center bg-[var(--color-surfaceHover)] rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('tabs')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'tabs' 
                    ? 'bg-green-600 text-white' 
                    : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
                title={t('bulkSsh.tabView', 'Tab View')}
              >
                <Rows size={14} />
              </button>
              <button
                onClick={() => setViewMode('mosaic')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'mosaic' 
                    ? 'bg-green-600 text-white' 
                    : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
                title={t('bulkSsh.mosaicView', 'Mosaic View')}
              >
                <Grid3x3 size={14} />
              </button>
            </div>
            {/* Detach button */}
            <button
              onClick={handleDetach}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title={t('bulkSsh.detach', 'Detach to Window')}
            >
              <ExternalLink size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              aria-label={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Secondary toolbar */}
        <div className="border-b border-[var(--color-border)] px-5 py-2 flex items-center justify-between bg-[var(--color-surfaceHover)]/30">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowScriptLibrary(!showScriptLibrary); setShowHistory(false); }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors ${
                showScriptLibrary 
                  ? 'bg-green-500/20 text-green-700 dark:text-green-400' 
                  : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]'
              }`}
            >
              <FileCode size={14} />
              {t('bulkSsh.scripts', 'Scripts')}
            </button>
            <button
              onClick={() => { setShowHistory(!showHistory); setShowScriptLibrary(false); }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors ${
                showHistory 
                  ? 'bg-green-500/20 text-green-700 dark:text-green-400' 
                  : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]'
              }`}
            >
              <History size={14} />
              {t('bulkSsh.history', 'History')}
            </button>
            <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
            <button
              onClick={clearOutputs}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded-md transition-colors"
            >
              <Trash2 size={14} />
              {t('bulkSsh.clearOutputs', 'Clear')}
            </button>
          </div>
          <div className="text-xs text-[var(--color-textSecondary)]">
            {t('bulkSsh.hint', 'Ctrl+Enter to execute')}
          </div>
        </div>

        {/* Script Library Panel */}
        {showScriptLibrary && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-72 overflow-hidden flex flex-col">
            <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3 bg-[var(--color-surfaceHover)]/30">
              <input
                type="text"
                value={scriptFilter}
                onChange={(e) => setScriptFilter(e.target.value)}
                placeholder={t('bulkSsh.searchScripts', 'Search scripts...')}
                className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              {command.trim() && (
                <button
                  onClick={() => setEditingScript({ id: '', name: '', description: '', script: command, category: 'Custom', createdAt: '', updatedAt: '' })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
                >
                  <Save size={14} />
                  {t('bulkSsh.saveAsScript', 'Save Current')}
                </button>
              )}
            </div>
            
            {/* Save script form */}
            {editingScript && (
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-green-500/5 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newScriptName}
                    onChange={(e) => setNewScriptName(e.target.value)}
                    placeholder={t('bulkSsh.scriptName', 'Script name')}
                    className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <select
                    value={newScriptCategory}
                    onChange={(e) => setNewScriptCategory(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newScriptDescription}
                    onChange={(e) => setNewScriptDescription(e.target.value)}
                    placeholder={t('bulkSsh.scriptDescription', 'Description (optional)')}
                    className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <button
                    onClick={saveCurrentAsScript}
                    disabled={!newScriptName.trim()}
                    className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:opacity-50 text-white rounded-md transition-colors"
                  >
                    {t('common.save', 'Save')}
                  </button>
                  <button
                    onClick={() => setEditingScript(null)}
                    className="px-4 py-1.5 text-sm bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            )}
            
            {/* Script list by category */}
            <div className="flex-1 overflow-y-auto">
              {categories.map(category => {
                const categoryScripts = filteredScripts.filter(s => s.category === category);
                if (categoryScripts.length === 0) return null;
                return (
                  <div key={category}>
                    <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)]/50 uppercase tracking-wide">
                      {category}
                    </div>
                    {categoryScripts.map(script => (
                      <div
                        key={script.id}
                        className="px-4 py-2 hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 cursor-pointer group"
                        onClick={() => loadScript(script)}
                      >
                        <FileCode size={14} className="text-green-600 dark:text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--color-text)] truncate">
                            {script.name}
                          </div>
                          {script.description && (
                            <div className="text-xs text-[var(--color-textSecondary)] truncate">
                              {script.description}
                            </div>
                          )}
                        </div>
                        <code className="text-xs text-[var(--color-textMuted)] font-mono truncate max-w-[200px] hidden sm:block">
                          {script.script.substring(0, 40)}{script.script.length > 40 ? '...' : ''}
                        </code>
                        {!script.id.startsWith('default-') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteScript(script.id); }}
                            className="p-1 text-[var(--color-textSecondary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('common.delete', 'Delete')}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {filteredScripts.length === 0 && (
                <div className="px-4 py-8 text-center text-[var(--color-textSecondary)]">
                  <FileCode size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('bulkSsh.noScriptsFound', 'No scripts found')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Command history dropdown */}
        {showHistory && commandHistory.length > 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-48 overflow-y-auto">
            {commandHistory.map((item) => (
              <button
                key={item.id}
                onClick={() => loadHistoryCommand(item)}
                className="w-full px-4 py-2 text-left hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 last:border-0"
              >
                <Clock size={12} className="text-[var(--color-textSecondary)] flex-shrink-0" />
                <code className="flex-1 text-sm font-mono text-[var(--color-text)] truncate">
                  {item.command}
                </code>
                <span className="text-xs text-[var(--color-textSecondary)]">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        )}

        {showHistory && commandHistory.length === 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center text-[var(--color-textSecondary)]">
            <History size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('bulkSsh.noHistory', 'No command history yet')}</p>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Left panel - Session selection */}
          <div className="w-64 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--color-text)]">
                  {t('bulkSsh.sshSessions', 'SSH Sessions')}
                </span>
                <button
                  onClick={selectAllSessions}
                  className="text-xs text-green-700 dark:text-green-400 hover:underline"
                >
                  {selectedSessionIds.size === sshSessions.length 
                    ? t('bulkSsh.deselectAll', 'Deselect All') 
                    : t('bulkSsh.selectAll', 'Select All')}
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sshSessions.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-textSecondary)]">
                  <Terminal size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('bulkSsh.noSessions', 'No active SSH sessions')}</p>
                  <p className="text-xs mt-1">{t('bulkSsh.connectFirst', 'Connect to SSH servers first')}</p>
                </div>
              ) : (
                sshSessions.map(session => {
                  const isSelected = selectedSessionIds.has(session.id);
                  const output = sessionOutputs[session.id];
                  return (
                    <button
                      key={session.id}
                      onClick={() => toggleSessionSelection(session.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected 
                          ? 'bg-green-500/20 border border-green-500/40' 
                          : 'hover:bg-[var(--color-surfaceHover)] border border-transparent'
                      }`}
                    >
                      {isSelected ? (
                        <CheckSquare size={14} className="text-green-600 dark:text-green-500 flex-shrink-0" />
                      ) : (
                        <Square size={14} className="text-[var(--color-textSecondary)] flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--color-text)] truncate">
                          {session.name}
                        </div>
                        <div className="text-xs text-[var(--color-textSecondary)] truncate">
                          {session.hostname}
                        </div>
                      </div>
                      {output?.status === 'running' && (
                        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                      )}
                      {output?.status === 'success' && (
                        <Check size={12} className="text-green-600 dark:text-green-500" />
                      )}
                      {output?.status === 'error' && (
                        <AlertCircle size={12} className="text-red-500" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Main content area */}
          <div className="flex-1 flex flex-col">
            {/* Command input area */}
            <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex gap-3">
                <div className="flex-1">
                  <textarea
                    ref={commandInputRef}
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('bulkSsh.commandPlaceholder', 'Enter command to send to all selected sessions...')}
                    className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 font-mono text-sm resize-none"
                    rows={3}
                    disabled={isExecuting || selectedCount === 0}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={executeCommand}
                    disabled={!command.trim() || selectedCount === 0 || isExecuting}
                    className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
                  >
                    {isExecuting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t('bulkSsh.executing', 'Running...')}
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        {t('bulkSsh.send', 'Send')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={sendCancel}
                    disabled={selectedCount === 0}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                    title={t('bulkSsh.sendCancel', 'Send Ctrl+C')}
                  >
                    <StopCircle size={14} />
                  </button>
                  <button
                    onClick={() => setShowScriptLibrary(!showScriptLibrary)}
                    className="px-4 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                    title={t('bulkSsh.loadScript', 'Load Script')}
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Output area */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {viewMode === 'tabs' ? (
                /* Tab view */
                <>
                  <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
                    {sshSessions.filter(s => selectedSessionIds.has(s.id)).map(session => (
                      <button
                        key={session.id}
                        onClick={() => setActiveOutputTab(session.id)}
                        className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                          activeOutputTab === session.id
                            ? 'border-green-500 text-green-700 dark:text-green-400 bg-green-500/10'
                            : 'border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]'
                        }`}
                      >
                        {session.name}
                        {sessionOutputs[session.id]?.status === 'running' && (
                          <span className="ml-2 w-2 h-2 inline-block bg-yellow-500 rounded-full animate-pulse" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
                    {activeOutputTab && sessionOutputs[activeOutputTab] && (
                      <div className="font-mono text-sm">
                        {sessionOutputs[activeOutputTab].error ? (
                          <div className="text-red-600 dark:text-red-400">
                            {sessionOutputs[activeOutputTab].error}
                          </div>
                        ) : (
                          <pre className="text-green-800 dark:text-green-400 whitespace-pre-wrap">
                            {sessionOutputs[activeOutputTab].output || t('bulkSsh.noOutput', 'No output yet. Send a command to see results.')}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* Mosaic view */
                <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
                  <div className={`grid gap-4 h-full ${
                    selectedCount <= 1 ? 'grid-cols-1' :
                    selectedCount <= 2 ? 'grid-cols-2' :
                    selectedCount <= 4 ? 'grid-cols-2' :
                    selectedCount <= 6 ? 'grid-cols-3' :
                    'grid-cols-4'
                  }`}>
                    {sshSessions.filter(s => selectedSessionIds.has(s.id)).map(session => {
                      const output = sessionOutputs[session.id];
                      return (
                        <div
                          key={session.id}
                          className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-h-[200px]"
                        >
                          <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surfaceHover)] border-b border-[var(--color-border)]">
                            <div className="flex items-center gap-2">
                              <Terminal size={12} className="text-green-600 dark:text-green-500" />
                              <span className="text-sm font-medium text-[var(--color-text)] truncate">
                                {session.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {output?.status === 'running' && (
                                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                              )}
                              {output?.status === 'success' && (
                                <Check size={12} className="text-green-600 dark:text-green-500" />
                              )}
                              {output?.status === 'error' && (
                                <AlertCircle size={12} className="text-red-500" />
                              )}
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(output?.output || '');
                                }}
                                className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors"
                                title={t('common.copy', 'Copy')}
                              >
                                <Copy size={12} className="text-[var(--color-textSecondary)]" />
                              </button>
                            </div>
                          </div>
                          <div className="flex-1 p-3 overflow-auto bg-[var(--color-background)]">
                            <pre className="font-mono text-xs text-green-800 dark:text-green-400 whitespace-pre-wrap">
                              {output?.error ? (
                                <span className="text-red-600 dark:text-red-400">{output.error}</span>
                              ) : (
                                output?.output || <span className="text-[var(--color-textMuted)]">{t('bulkSsh.waitingOutput', 'Waiting for output...')}</span>
                              )}
                            </pre>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedCount === 0 && (
                    <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)]">
                      <div className="text-center">
                        <Grid3x3 size={48} className="mx-auto mb-4 opacity-30" />
                        <p>{t('bulkSsh.selectSessions', 'Select SSH sessions from the left panel')}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
