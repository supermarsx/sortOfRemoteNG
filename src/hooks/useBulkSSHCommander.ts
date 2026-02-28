import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useConnections } from "../contexts/useConnections";
import { invoke } from "@tauri-apps/api/core";
import {
  SavedBulkScript,
  defaultBulkScripts,
} from "../data/defaultBulkScripts";

// ─── Types ─────────────────────────────────────────────────────────

export interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: Date;
  sessionIds: string[];
  results: Record<
    string,
    { output: string; error?: string; status: "pending" | "success" | "error" }
  >;
}

export interface SessionOutput {
  sessionId: string;
  sessionName: string;
  output: string;
  error?: string;
  status: "idle" | "running" | "success" | "error";
}

export type ViewMode = "tabs" | "mosaic";

const SCRIPTS_STORAGE_KEY = "bulkSshScripts";

// ─── Hook ──────────────────────────────────────────────────────────

export function useBulkSSHCommander(isOpen: boolean) {
  const { state } = useConnections();

  const sshSessions = useMemo(() => {
    return state.sessions.filter(
      (s) =>
        s.protocol === "ssh" &&
        (s.status === "connected" || s.status === "connecting"),
    );
  }, [state.sessions]);

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [command, setCommand] = useState("");
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>(
    [],
  );
  const [sessionOutputs, setSessionOutputs] = useState<
    Record<string, SessionOutput>
  >({});
  const [viewMode, setViewMode] = useState<ViewMode>("mosaic");
  const [isExecuting, setIsExecuting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<string | null>(null);

  // Script library state
  const [showScriptLibrary, setShowScriptLibrary] = useState(false);
  const [savedScripts, setSavedScripts] = useState<SavedBulkScript[]>([]);
  const [editingScript, setEditingScript] = useState<SavedBulkScript | null>(
    null,
  );
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptDescription, setNewScriptDescription] = useState("");
  const [newScriptCategory, setNewScriptCategory] = useState("Custom");
  const [scriptFilter, setScriptFilter] = useState("");

  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const outputListenersRef = useRef<Map<string, () => void>>(new Map());

  // ─── Effects ────────────────────────────────────────────────────

  // Load saved scripts from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSavedScripts([...defaultBulkScripts, ...parsed]);
      } else {
        setSavedScripts(defaultBulkScripts);
      }
    } catch {
      setSavedScripts(defaultBulkScripts);
    }
  }, []);

  const saveScriptsToStorage = useCallback(
    (scripts: SavedBulkScript[]) => {
      const customScripts = scripts.filter(
        (s) => !s.id.startsWith("default-"),
      );
      localStorage.setItem(
        SCRIPTS_STORAGE_KEY,
        JSON.stringify(customScripts),
      );
    },
    [],
  );

  // Initialize session outputs when sessions change
  useEffect(() => {
    setSessionOutputs((prev) => {
      const newOutputs: Record<string, SessionOutput> = {};
      sshSessions.forEach((session) => {
        newOutputs[session.id] = prev[session.id] || {
          sessionId: session.id,
          sessionName: session.name,
          output: "",
          status: "idle",
        };
      });
      return newOutputs;
    });
    setActiveOutputTab((prev) => {
      if (!prev && sshSessions.length > 0) return sshSessions[0].id;
      return prev;
    });
  }, [sshSessions]);

  // Select all sessions by default
  useEffect(() => {
    if (isOpen && sshSessions.length > 0) {
      setSelectedSessionIds((prev) => {
        if (prev.size === 0) return new Set(sshSessions.map((s) => s.id));
        return prev;
      });
    }
  }, [isOpen, sshSessions]);

  // Clean up listeners on unmount
  useEffect(() => {
    const listeners = outputListenersRef.current;
    return () => {
      listeners.forEach((unlisten) => unlisten());
      listeners.clear();
    };
  }, []);

  // ─── Derived data ─────────────────────────────────────────────

  const categories = useMemo(() => {
    const cats = new Set(savedScripts.map((s) => s.category));
    return Array.from(cats).sort();
  }, [savedScripts]);

  const filteredScripts = useMemo(() => {
    if (!scriptFilter) return savedScripts;
    const lower = scriptFilter.toLowerCase();
    return savedScripts.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower) ||
        s.script.toLowerCase().includes(lower),
    );
  }, [savedScripts, scriptFilter]);

  const selectedCount = selectedSessionIds.size;
  const totalCount = sshSessions.length;

  // ─── Session selection ────────────────────────────────────────

  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const selectAllSessions = useCallback(() => {
    if (selectedSessionIds.size === sshSessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(sshSessions.map((s) => s.id)));
    }
  }, [sshSessions, selectedSessionIds]);

  // ─── Command execution ────────────────────────────────────────

  const executeCommand = useCallback(async () => {
    if (!command.trim() || selectedSessionIds.size === 0 || isExecuting) return;

    const isTauri =
      typeof window !== "undefined" &&
      Boolean(
        (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
      );
    if (!isTauri) {
      console.warn("Bulk SSH commander requires Tauri runtime");
      return;
    }

    setIsExecuting(true);
    const commandId = Date.now().toString();
    const selectedSessions = sshSessions.filter((s) =>
      selectedSessionIds.has(s.id),
    );

    const initialOutputs: Record<string, SessionOutput> = {};
    selectedSessions.forEach((session) => {
      initialOutputs[session.id] = {
        sessionId: session.id,
        sessionName: session.name,
        output: "",
        status: "running",
      };
    });
    setSessionOutputs((prev) => ({ ...prev, ...initialOutputs }));

    const historyItem: CommandHistoryItem = {
      id: commandId,
      command: command.trim(),
      timestamp: new Date(),
      sessionIds: Array.from(selectedSessionIds),
      results: {},
    };

    const commandPromises = selectedSessions.map(async (session) => {
      try {
        const backendSessionId = session.backendSessionId;
        if (!backendSessionId) throw new Error("No backend session ID");

        await invoke("send_ssh_input", {
          sessionId: backendSessionId,
          data: command.trim() + "\n",
        });

        setSessionOutputs((prev) => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            status: "success",
            output: prev[session.id]?.output + `\n$ ${command.trim()}\n`,
          },
        }));

        historyItem.results[session.id] = {
          output: "Command sent successfully",
          status: "success",
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        setSessionOutputs((prev) => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            status: "error",
            error: errorMsg,
          },
        }));
        historyItem.results[session.id] = {
          output: "",
          error: errorMsg,
          status: "error",
        };
      }
    });

    await Promise.all(commandPromises);
    setCommandHistory((prev) => [historyItem, ...prev].slice(0, 50));
    setIsExecuting(false);
    setCommand("");
    commandInputRef.current?.focus();
  }, [command, selectedSessionIds, sshSessions, isExecuting]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        executeCommand();
      }
    },
    [executeCommand],
  );

  const sendCancel = useCallback(async () => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean(
        (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
      );
    if (!isTauri) return;

    const selectedSessions = sshSessions.filter((s) =>
      selectedSessionIds.has(s.id),
    );

    const cancelPromises = selectedSessions.map(async (session) => {
      try {
        const backendSessionId = session.backendSessionId;
        if (!backendSessionId) return;
        await invoke("send_ssh_input", {
          sessionId: backendSessionId,
          data: "\x03",
        });
        setSessionOutputs((prev) => ({
          ...prev,
          [session.id]: {
            ...prev[session.id],
            output: prev[session.id]?.output + "\n^C\n",
            status: "idle",
          },
        }));
      } catch (error) {
        console.error(
          "Failed to send cancel to session:",
          session.id,
          error,
        );
      }
    });

    await Promise.all(cancelPromises);
    setIsExecuting(false);
  }, [sshSessions, selectedSessionIds]);

  const clearOutputs = useCallback(() => {
    const clearedOutputs: Record<string, SessionOutput> = {};
    sshSessions.forEach((session) => {
      clearedOutputs[session.id] = {
        sessionId: session.id,
        sessionName: session.name,
        output: "",
        status: "idle",
      };
    });
    setSessionOutputs(clearedOutputs);
  }, [sshSessions]);

  const loadHistoryCommand = useCallback(
    (historyItem: CommandHistoryItem) => {
      setCommand(historyItem.command);
      setShowHistory(false);
      commandInputRef.current?.focus();
    },
    [],
  );

  // ─── Script library ───────────────────────────────────────────

  const loadScript = useCallback((script: SavedBulkScript) => {
    setCommand(script.script);
    setShowScriptLibrary(false);
    commandInputRef.current?.focus();
  }, []);

  const saveCurrentAsScript = useCallback(() => {
    if (!command.trim() || !newScriptName.trim()) return;

    const newScript: SavedBulkScript = {
      id: Date.now().toString(),
      name: newScriptName.trim(),
      description: newScriptDescription.trim(),
      script: command.trim(),
      category: newScriptCategory || "Custom",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [...savedScripts, newScript];
    setSavedScripts(updated);
    saveScriptsToStorage(updated);
    setNewScriptName("");
    setNewScriptDescription("");
    setEditingScript(null);
  }, [
    command,
    newScriptName,
    newScriptDescription,
    newScriptCategory,
    savedScripts,
    saveScriptsToStorage,
  ]);

  const deleteScript = useCallback(
    (scriptId: string) => {
      if (scriptId.startsWith("default-")) return;
      const updated = savedScripts.filter((s) => s.id !== scriptId);
      setSavedScripts(updated);
      saveScriptsToStorage(updated);
    },
    [savedScripts, saveScriptsToStorage],
  );

  // ─── Panel toggles ───────────────────────────────────────────

  const toggleScriptLibrary = useCallback(() => {
    setShowScriptLibrary((prev) => !prev);
    setShowHistory(false);
  }, []);

  const toggleHistory = useCallback(() => {
    setShowHistory((prev) => !prev);
    setShowScriptLibrary(false);
  }, []);

  return {
    // Sessions
    sshSessions,
    selectedSessionIds,
    selectedCount,
    totalCount,
    sessionOutputs,
    toggleSessionSelection,
    selectAllSessions,

    // Command
    command,
    setCommand,
    commandInputRef,
    commandHistory,
    isExecuting,
    executeCommand,
    handleKeyDown,
    sendCancel,
    clearOutputs,
    loadHistoryCommand,

    // View
    viewMode,
    setViewMode,
    activeOutputTab,
    setActiveOutputTab,

    // Panels
    showHistory,
    showScriptLibrary,
    toggleHistory,
    toggleScriptLibrary,

    // Scripts
    savedScripts,
    editingScript,
    setEditingScript,
    newScriptName,
    setNewScriptName,
    newScriptDescription,
    setNewScriptDescription,
    newScriptCategory,
    setNewScriptCategory,
    scriptFilter,
    setScriptFilter,
    categories,
    filteredScripts,
    loadScript,
    saveCurrentAsScript,
    deleteScript,
  };
}
