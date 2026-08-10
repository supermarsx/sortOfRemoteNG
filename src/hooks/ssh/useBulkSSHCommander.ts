import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useConnections } from "../../contexts/useConnections";
import { invoke } from "@tauri-apps/api/core";
import { defaultBulkScripts } from "../../data/defaultBulkScripts";
import { useSSHCommandHistory } from "./useSSHCommandHistory";
import type { CommandExecution } from "../../types/ssh/sshCommandHistory";
import { useToastContext } from "../../contexts/ToastContext";
import {
  BULK_SCRIPT_TYPE_OPTIONS,
  DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG,
  MAX_BULK_SCRIPT_BYTES,
  MAX_BULK_SCRIPT_CATEGORY_LENGTH,
  MAX_BULK_SCRIPT_DESCRIPTION_LENGTH,
  MAX_BULK_SCRIPT_NAME_LENGTH,
  bulkScriptsStore,
  createEmptyBulkScriptLibrary,
  decorateBulkScript,
  inferBulkScriptType,
  isDestructiveBulkScript,
  shouldConfirmBulkScriptDelete,
  shouldConfirmBulkScriptRun,
  updateBulkScriptLibrary,
  type BulkScript,
  type BulkScriptDeleteConfirmation,
  type BulkScriptLibraryConfig,
  type BulkScriptLibraryMutation,
  type BulkScriptLibrarySnapshot,
  type BulkScriptRisk,
  type BulkScriptRunConfirmation,
  type BulkScriptType,
} from "./bulkScriptLibrary";
import { formatBulkTerminalPreview } from "./bulkTerminalPreview";
import {
  APP_DATA_STORE_CHANGED_EVENT,
  containsLikelySecretText,
} from "../../utils/storage/appDataJsonStore";

// ─── Types ─────────────────────────────────────────────────────────

export interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: Date;
  sessionIds: string[];
  results: Record<
    string,
    { detail: string; error?: string; status: "pending" | "cancelled" }
  >;
}

export interface SessionOutput {
  sessionId: string;
  sessionName: string;
  output: string;
  error?: string;
  status: "idle" | "running" | "dispatched" | "cancelled";
  previewedAt?: Date;
}

export type ViewMode = "tabs" | "mosaic";

const DEFAULT_LIBRARY_SCRIPTS = defaultBulkScripts.map(decorateBulkScript);

const createScriptId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bulk-script-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

// ─── Hook ──────────────────────────────────────────────────────────

export function useBulkSSHCommander(isOpen: boolean) {
  const { state } = useConnections();
  const { toast } = useToastContext();
  const historyMgr = useSSHCommandHistory();

  const sshSessions = useMemo(() => {
    return state.sessions.filter(
      (s) =>
        s.protocol === "ssh" &&
        (s.status === "connected" || s.status === "connecting"),
    );
  }, [state.sessions]);
  const liveSessionIds = useMemo(
    () => new Set(sshSessions.map((session) => session.id)),
    [sshSessions],
  );

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [command, setCommandState] = useState("");
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>(
    [],
  );
  const [sessionOutputs, setSessionOutputs] = useState<
    Record<string, SessionOutput>
  >({});
  const [viewMode, setViewMode] = useState<ViewMode>("mosaic");
  const [isExecuting, setIsExecuting] = useState(false);
  const [trackHistory, setTrackHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<string | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [previewLoadingSessionIds, setPreviewLoadingSessionIds] = useState<
    Set<string>
  >(new Set());
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>(
    {},
  );

  // Script library state
  const [showScriptLibrary, setShowScriptLibrary] = useState(false);
  const [savedScripts, setSavedScripts] = useState<BulkScript[]>(
    DEFAULT_LIBRARY_SCRIPTS,
  );
  const [trashedScripts, setTrashedScripts] = useState<BulkScript[]>([]);
  const [scriptLibraryConfig, setScriptLibraryConfig] =
    useState<BulkScriptLibraryConfig>({
      ...DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG,
    });
  const [scriptLibraryLoaded, setScriptLibraryLoaded] = useState(false);
  const [scriptLibrarySection, setScriptLibrarySection] = useState<
    "active" | "trash"
  >("active");
  const [loadedScript, setLoadedScript] = useState<BulkScript | null>(null);
  const [editingScript, setEditingScript] = useState<BulkScript | null>(null);
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptDescription, setNewScriptDescription] = useState("");
  const [newScriptCategory, setNewScriptCategory] = useState("Custom");
  const [newScriptType, setNewScriptType] = useState<BulkScriptType>("shell");
  const [newScriptRisk, setNewScriptRisk] =
    useState<BulkScriptRisk>("standard");
  const [scriptFilter, setScriptFilter] = useState("");
  const [scriptStorageError, setScriptStorageError] = useState<string | null>(
    null,
  );

  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const outputListenersRef = useRef<Map<string, () => void>>(new Map());
  const liveSessionIdsRef = useRef(liveSessionIds);
  const previewRequestCounterRef = useRef(0);
  const previewRequestTokensRef = useRef<Map<string, number>>(new Map());
  liveSessionIdsRef.current = liveSessionIds;

  // ─── Effects ────────────────────────────────────────────────────

  const applyLibrarySnapshot = useCallback(
    (snapshot: BulkScriptLibrarySnapshot) => {
      setSavedScripts([...DEFAULT_LIBRARY_SCRIPTS, ...snapshot.active]);
      setTrashedScripts(snapshot.trash);
      setScriptLibraryConfig(snapshot.config);
    },
    [],
  );

  // Load saved scripts from app-data storage (or the browser test fallback).
  useEffect(() => {
    let cancelled = false;
    bulkScriptsStore
      .load()
      .then((result) => {
        if (cancelled) return;
        applyLibrarySnapshot(result.value ?? createEmptyBulkScriptLibrary());
        if (result.sanitized) {
          const message =
            "Malformed or possible credential-bearing Bulk SSH scripts were removed while normalizing secure app-data storage.";
          setScriptStorageError(message);
          toast.warning(message);
        }
        setScriptLibraryLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = `Bulk SSH scripts could not be loaded: ${String(error)}`;
        setScriptStorageError(message);
        toast.error(message);
        applyLibrarySnapshot(createEmptyBulkScriptLibrary());
        setScriptLibraryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applyLibrarySnapshot, toast]);

  // Keep sibling hook instances in this webview synchronized with durable
  // mutations performed through AppDataJsonStore.
  useEffect(() => {
    if (!scriptLibraryLoaded || typeof window === "undefined") return;
    let cancelled = false;
    const refreshLibrary = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key !== bulkScriptsStore.key) return;
      void bulkScriptsStore
        .load()
        .then((result) => {
          if (!cancelled) {
            applyLibrarySnapshot(
              result.value ?? createEmptyBulkScriptLibrary(),
            );
          }
        })
        .catch((error) => {
          if (cancelled) return;
          const message = `Bulk SSH scripts could not be refreshed: ${String(error)}`;
          setScriptStorageError(message);
          toast.error(message);
        });
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, refreshLibrary);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, refreshLibrary);
    };
  }, [applyLibrarySnapshot, scriptLibraryLoaded, toast]);

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
    setSelectedSessionIds(
      (current) => new Set([...current].filter((id) => liveSessionIds.has(id))),
    );
    setPreviewSessionId((prev) =>
      prev && liveSessionIds.has(prev) ? prev : null,
    );
    setPreviewLoadingSessionIds(
      (current) => new Set([...current].filter((id) => liveSessionIds.has(id))),
    );
    setPreviewErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => liveSessionIds.has(id)),
      ),
    );
    for (const sessionId of previewRequestTokensRef.current.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        previewRequestTokensRef.current.delete(sessionId);
      }
    }
  }, [liveSessionIds, sshSessions]);

  // The active output tab must always correspond to a selected recipient or
  // the one explicitly peeked session.
  useEffect(() => {
    const outputSessionIds = sshSessions
      .filter(
        (session) =>
          selectedSessionIds.has(session.id) || previewSessionId === session.id,
      )
      .map((session) => session.id);
    const validIds = new Set(outputSessionIds);
    setActiveOutputTab((current) =>
      current && validIds.has(current)
        ? current
        : (outputSessionIds[0] ?? null),
    );
  }, [previewSessionId, selectedSessionIds, sshSessions]);

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
        s.type.toLowerCase().includes(lower) ||
        s.risk.toLowerCase().includes(lower) ||
        s.script.toLowerCase().includes(lower),
    );
  }, [savedScripts, scriptFilter]);

  const filteredTrashedScripts = useMemo(() => {
    if (!scriptFilter) return trashedScripts;
    const lower = scriptFilter.toLowerCase();
    return trashedScripts.filter(
      (script) =>
        script.name.toLowerCase().includes(lower) ||
        script.description.toLowerCase().includes(lower) ||
        script.category.toLowerCase().includes(lower) ||
        script.type.toLowerCase().includes(lower) ||
        script.risk.toLowerCase().includes(lower) ||
        script.script.toLowerCase().includes(lower),
    );
  }, [scriptFilter, trashedScripts]);

  const selectedCount = sshSessions.filter((session) =>
    selectedSessionIds.has(session.id),
  ).length;
  const totalCount = sshSessions.length;

  const setCommand = useCallback((value: string) => {
    setCommandState(value);
    setLoadedScript((current) => (current?.script === value ? current : null));
  }, []);

  // ─── Session selection ────────────────────────────────────────

  const toggleSessionSelection = useCallback(
    (sessionId: string) => {
      if (!liveSessionIds.has(sessionId)) return;
      setSelectedSessionIds((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
    },
    [liveSessionIds],
  );

  const selectAllSessions = useCallback(() => {
    if (selectedCount === sshSessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(sshSessions.map((s) => s.id)));
    }
  }, [selectedCount, sshSessions]);

  /**
   * Fetch a one-off, memory-only snapshot of an individual terminal. Peeking
   * never writes to SSH command history, even when history tracking is on.
   */
  const peekSession = useCallback(
    async (sessionId: string) => {
      const session = sshSessions.find(
        (candidate) => candidate.id === sessionId,
      );
      if (!session) return;

      const requestToken = ++previewRequestCounterRef.current;
      previewRequestTokensRef.current.set(session.id, requestToken);
      const requestIsCurrent = () =>
        previewRequestTokensRef.current.get(session.id) === requestToken &&
        liveSessionIdsRef.current.has(session.id);

      setPreviewSessionId(session.id);
      setActiveOutputTab(session.id);
      setPreviewLoadingSessionIds((current) => {
        const next = new Set(current);
        next.add(session.id);
        return next;
      });
      setPreviewErrors((current) => {
        if (!(session.id in current)) return current;
        const next = { ...current };
        delete next[session.id];
        return next;
      });

      try {
        if (!session.backendSessionId) {
          throw new Error("No backend session ID");
        }
        const buffer = await invoke<string>("get_terminal_buffer", {
          sessionId: session.backendSessionId,
        });
        if (!requestIsCurrent()) return;
        setSessionOutputs((current) => ({
          ...current,
          [session.id]: {
            ...(current[session.id] ?? {
              sessionId: session.id,
              sessionName: session.name,
              status: "idle" as const,
            }),
            output: formatBulkTerminalPreview(buffer),
            error: undefined,
            previewedAt: new Date(),
          },
        }));
      } catch (error) {
        if (!requestIsCurrent()) return;
        const message = error instanceof Error ? error.message : String(error);
        setPreviewErrors((current) => ({
          ...current,
          [session.id]: message,
        }));
        setSessionOutputs((current) => ({
          ...current,
          [session.id]: {
            ...(current[session.id] ?? {
              sessionId: session.id,
              sessionName: session.name,
              output: "",
              status: "idle" as const,
            }),
            previewedAt: undefined,
          },
        }));
      } finally {
        if (previewRequestTokensRef.current.get(session.id) === requestToken) {
          previewRequestTokensRef.current.delete(session.id);
          setPreviewLoadingSessionIds((current) => {
            if (!current.has(session.id)) return current;
            const next = new Set(current);
            next.delete(session.id);
            return next;
          });
        }
      }
    },
    [sshSessions],
  );

  // ─── Command execution ────────────────────────────────────────

  const executeCommand = useCallback(async () => {
    const selectedSessions = sshSessions.filter((session) =>
      selectedSessionIds.has(session.id),
    );
    if (!command.trim() || selectedSessions.length === 0 || isExecuting) return;

    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      console.warn("Bulk SSH commander requires Tauri runtime");
      return;
    }

    const normalizedCommand = command.trim();
    const commandRisk: BulkScriptRisk =
      loadedScript?.script === normalizedCommand
        ? loadedScript.risk
        : isDestructiveBulkScript(normalizedCommand)
          ? "destructive"
          : "standard";
    if (
      shouldConfirmBulkScriptRun(
        scriptLibraryConfig.runConfirmation,
        commandRisk,
      ) &&
      typeof window !== "undefined" &&
      !window.confirm(
        `${commandRisk === "destructive" ? "This command may make destructive changes." : "Run this command?"}\n\nDispatch to ${selectedSessions.length} selected SSH session${selectedSessions.length === 1 ? "" : "s"}?`,
      )
    ) {
      return;
    }

    setIsExecuting(true);
    const commandId = Date.now().toString();

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
      command: normalizedCommand,
      timestamp: new Date(),
      sessionIds: selectedSessions.map((session) => session.id),
      results: {},
    };

    const commandPromises = selectedSessions.map(async (session) => {
      try {
        const backendSessionId = session.backendSessionId;
        if (!backendSessionId) throw new Error("No backend session ID");

        await invoke("send_ssh_input", {
          sessionId: backendSessionId,
          data: normalizedCommand + "\n",
        });

        if (liveSessionIdsRef.current.has(session.id)) {
          setSessionOutputs((prev) => ({
            ...prev,
            [session.id]: {
              ...prev[session.id],
              status: "dispatched",
              output:
                prev[session.id]?.output +
                `\n$ ${normalizedCommand}\nCommand input was dispatched; this path did not capture remote completion evidence.\n`,
            },
          }));
        }

        historyItem.results[session.id] = {
          detail:
            "Command input was dispatched; no remote completion evidence was captured by this path.",
          status: "pending",
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (liveSessionIdsRef.current.has(session.id)) {
          setSessionOutputs((prev) => ({
            ...prev,
            [session.id]: {
              ...prev[session.id],
              status: "cancelled",
              error: errorMsg,
            },
          }));
        }
        historyItem.results[session.id] = {
          detail: "Command input dispatch failed.",
          error: errorMsg,
          status: "cancelled",
        };
      }
    });

    await Promise.all(commandPromises);
    if (trackHistory) {
      setCommandHistory((prev) => [historyItem, ...prev].slice(0, 50));
    }

    // Persist to the dedicated SSH command history
    const persistentExecutions: CommandExecution[] = selectedSessions.map(
      (session) => {
        const result = historyItem.results[session.id];
        return {
          sessionId: session.id,
          sessionName: session.name,
          hostname: session.hostname ?? "",
          status: result?.status ?? "cancelled",
          source: "bulk-dispatch",
          evidence:
            result?.status === "pending"
              ? "dispatch-accepted"
              : "dispatch-failed",
          errorMessage: result?.error,
        };
      },
    );
    if (trackHistory) {
      historyMgr.addEntry(normalizedCommand, persistentExecutions);
    }

    setIsExecuting(false);
    setCommandState("");
    setLoadedScript(null);
    commandInputRef.current?.focus();
  }, [
    command,
    selectedSessionIds,
    sshSessions,
    isExecuting,
    trackHistory,
    historyMgr,
    loadedScript,
    scriptLibraryConfig.runConfirmation,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        executeCommand();
        return;
      }
      // Arrow-key history navigation (only for single-line input)
      if (e.key === "ArrowUp" && !e.shiftKey) {
        const cmd = historyMgr.navigateUp(command);
        if (cmd !== null) {
          e.preventDefault();
          setCommand(cmd);
        }
      }
      if (e.key === "ArrowDown" && !e.shiftKey) {
        const cmd = historyMgr.navigateDown();
        if (cmd !== null) {
          e.preventDefault();
          setCommand(cmd);
        }
      }
    },
    [executeCommand, command, historyMgr, setCommand],
  );

  const sendCancel = useCallback(async () => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
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
        if (liveSessionIdsRef.current.has(session.id)) {
          setSessionOutputs((prev) => ({
            ...prev,
            [session.id]: {
              ...prev[session.id],
              output: prev[session.id]?.output + "\n^C\n",
              status: "idle",
            },
          }));
        }
      } catch (error) {
        console.error("Failed to send cancel to session:", session.id, error);
      }
    });

    await Promise.all(cancelPromises);
    setIsExecuting(false);
  }, [sshSessions, selectedSessionIds]);

  const clearOutputs = useCallback(() => {
    previewRequestTokensRef.current.clear();
    setPreviewLoadingSessionIds(new Set());
    setPreviewErrors({});
    setPreviewSessionId(null);
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
    [setCommand],
  );

  // ─── Script library ───────────────────────────────────────────

  const persistAndApplyLibrary = useCallback(
    async (mutation: BulkScriptLibraryMutation): Promise<boolean> => {
      if (!scriptLibraryLoaded) {
        toast.warning(
          "Bulk SSH scripts are still loading; wait for the library before changing it.",
        );
        return false;
      }
      try {
        const saved = await updateBulkScriptLibrary((current) => {
          const next = mutation(current);
          const unsafe = [...next.active, ...next.trash].find((script) =>
            [
              script.name,
              script.description,
              script.category,
              script.script,
            ].some(containsLikelySecretText),
          );
          if (unsafe) {
            throw new Error(
              `Bulk SSH script "${unsafe.name}" appears to contain literal credential material and was not persisted.`,
            );
          }
          return next;
        });
        setScriptStorageError(null);
        applyLibrarySnapshot(saved);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = detail.startsWith("Bulk SSH script ")
          ? detail
          : `Bulk SSH scripts could not be saved: ${detail}`;
        setScriptStorageError(message);
        toast.error(message);
        return false;
      }
    },
    [applyLibrarySnapshot, scriptLibraryLoaded, toast],
  );

  const loadScript = useCallback(
    (script: BulkScript) => {
      if (
        script.risk === "destructive" &&
        scriptLibraryConfig.runConfirmation !== "never" &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Load destructive script "${script.name}" into the command editor? Loading does not run it; execution is confirmed separately.`,
        )
      ) {
        return;
      }
      setCommandState(script.script);
      setLoadedScript(script);
      setShowScriptLibrary(false);
      commandInputRef.current?.focus();
    },
    [scriptLibraryConfig.runConfirmation],
  );

  const saveCurrentAsScript = useCallback(async () => {
    if (!command.trim() || !newScriptName.trim()) return;

    const scriptName = newScriptName.trim();
    const scriptDescription = newScriptDescription.trim();
    const scriptCategory = newScriptCategory.trim() || "Custom";
    const scriptBody = command.trim();
    const validationError =
      scriptName.length > MAX_BULK_SCRIPT_NAME_LENGTH
        ? `Bulk SSH script names cannot exceed ${MAX_BULK_SCRIPT_NAME_LENGTH} characters.`
        : scriptDescription.length > MAX_BULK_SCRIPT_DESCRIPTION_LENGTH
          ? `Bulk SSH script descriptions cannot exceed ${MAX_BULK_SCRIPT_DESCRIPTION_LENGTH} characters.`
          : scriptCategory.length > MAX_BULK_SCRIPT_CATEGORY_LENGTH
            ? `Bulk SSH script categories cannot exceed ${MAX_BULK_SCRIPT_CATEGORY_LENGTH} characters.`
            : new TextEncoder().encode(scriptBody).length >
                MAX_BULK_SCRIPT_BYTES
              ? `Bulk SSH scripts cannot exceed ${MAX_BULK_SCRIPT_BYTES} UTF-8 bytes.`
              : null;
    if (validationError) {
      setScriptStorageError(validationError);
      toast.error(validationError);
      return;
    }

    const now = new Date().toISOString();
    const newScript: BulkScript = {
      id: createScriptId(),
      name: scriptName,
      description: scriptDescription,
      script: scriptBody,
      category: scriptCategory,
      createdAt: now,
      updatedAt: now,
      type: newScriptType || inferBulkScriptType(scriptCategory, scriptBody),
      risk:
        newScriptRisk === "destructive" || isDestructiveBulkScript(scriptBody)
          ? "destructive"
          : "standard",
    };

    if (
      !(await persistAndApplyLibrary((current) => ({
        ...current,
        active: [...current.active, newScript],
      })))
    ) {
      return;
    }
    setNewScriptName("");
    setNewScriptDescription("");
    setNewScriptCategory("Custom");
    setNewScriptType("shell");
    setNewScriptRisk("standard");
    setEditingScript(null);
  }, [
    command,
    newScriptName,
    newScriptDescription,
    newScriptCategory,
    newScriptType,
    newScriptRisk,
    persistAndApplyLibrary,
    toast,
  ]);

  const deleteScript = useCallback(
    async (scriptId: string) => {
      if (scriptId.startsWith("default-")) return;
      const script = savedScripts.find(
        (candidate) => candidate.id === scriptId,
      );
      if (!script) return;
      if (
        shouldConfirmBulkScriptDelete(
          scriptLibraryConfig.deleteConfirmation,
          false,
        ) &&
        typeof window !== "undefined" &&
        !window.confirm(`Move "${script.name}" to Bulk SSH script trash?`)
      ) {
        return;
      }
      const deletedAt = new Date().toISOString();
      await persistAndApplyLibrary((current) => {
        const latest = current.active.find(
          (candidate) => candidate.id === scriptId,
        );
        if (!latest) return current;
        return {
          ...current,
          active: current.active.filter(
            (candidate) => candidate.id !== scriptId,
          ),
          trash: [
            { ...latest, deletedAt },
            ...current.trash.filter((candidate) => candidate.id !== scriptId),
          ],
        };
      });
    },
    [persistAndApplyLibrary, savedScripts, scriptLibraryConfig],
  );

  const restoreScript = useCallback(
    async (scriptId: string) => {
      const script = trashedScripts.find(
        (candidate) => candidate.id === scriptId,
      );
      if (!script) return;
      if (savedScripts.some((candidate) => candidate.id === scriptId)) {
        toast.error(
          `Bulk SSH script "${script.name}" could not be restored because its ID is already active.`,
        );
        return;
      }
      const restoredAt = new Date().toISOString();
      await persistAndApplyLibrary((current) => {
        const latest = current.trash.find(
          (candidate) => candidate.id === scriptId,
        );
        if (
          !latest ||
          current.active.some((candidate) => candidate.id === scriptId)
        ) {
          return current;
        }
        const { deletedAt: _deletedAt, ...activeScript } = latest;
        return {
          ...current,
          active: [
            ...current.active,
            { ...activeScript, updatedAt: restoredAt },
          ],
          trash: current.trash.filter((candidate) => candidate.id !== scriptId),
        };
      });
    },
    [persistAndApplyLibrary, savedScripts, toast, trashedScripts],
  );

  const permanentlyDeleteScript = useCallback(
    async (scriptId: string) => {
      const script = trashedScripts.find(
        (candidate) => candidate.id === scriptId,
      );
      if (!script) return;
      if (
        shouldConfirmBulkScriptDelete(
          scriptLibraryConfig.deleteConfirmation,
          true,
        ) &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Permanently delete Bulk SSH script "${script.name}"? This cannot be undone.`,
        )
      ) {
        return;
      }
      await persistAndApplyLibrary((current) => ({
        ...current,
        trash: current.trash.filter((candidate) => candidate.id !== scriptId),
      }));
    },
    [persistAndApplyLibrary, scriptLibraryConfig, trashedScripts],
  );

  const emptyScriptTrash = useCallback(async () => {
    if (trashedScripts.length === 0) return;
    if (
      shouldConfirmBulkScriptDelete(
        scriptLibraryConfig.deleteConfirmation,
        true,
      ) &&
      typeof window !== "undefined" &&
      !window.confirm(
        `Permanently delete ${trashedScripts.length} trashed Bulk SSH script${trashedScripts.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    const confirmedIds = new Set(trashedScripts.map((script) => script.id));
    await persistAndApplyLibrary((current) => ({
      ...current,
      trash: current.trash.filter((script) => !confirmedIds.has(script.id)),
    }));
  }, [persistAndApplyLibrary, scriptLibraryConfig, trashedScripts]);

  const updateScriptLibraryConfig = useCallback(
    async (updates: Partial<BulkScriptLibraryConfig>) => {
      await persistAndApplyLibrary((current) => ({
        ...current,
        config: { ...current.config, ...updates },
      }));
    },
    [persistAndApplyLibrary],
  );

  const setScriptRunConfirmation = useCallback(
    (policy: BulkScriptRunConfirmation) =>
      updateScriptLibraryConfig({ runConfirmation: policy }),
    [updateScriptLibraryConfig],
  );

  const setScriptDeleteConfirmation = useCallback(
    (policy: BulkScriptDeleteConfirmation) =>
      updateScriptLibraryConfig({ deleteConfirmation: policy }),
    [updateScriptLibraryConfig],
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
    peekSession,

    // Command
    command,
    setCommand,
    commandInputRef,
    commandHistory,
    isExecuting,
    trackHistory,
    setTrackHistory,
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
    previewSessionId,
    previewLoadingSessionIds,
    previewErrors,

    // Panels
    showHistory,
    showScriptLibrary,
    toggleHistory,
    toggleScriptLibrary,

    // Scripts
    savedScripts,
    trashedScripts,
    scriptLibraryConfig,
    scriptLibraryLoaded,
    scriptLibrarySection,
    setScriptLibrarySection,
    loadedScript,
    editingScript,
    setEditingScript,
    newScriptName,
    setNewScriptName,
    newScriptDescription,
    setNewScriptDescription,
    newScriptCategory,
    setNewScriptCategory,
    newScriptType,
    setNewScriptType,
    newScriptRisk,
    setNewScriptRisk,
    scriptTypeOptions: BULK_SCRIPT_TYPE_OPTIONS,
    scriptFilter,
    scriptStorageError,
    setScriptFilter,
    categories,
    filteredScripts,
    filteredTrashedScripts,
    loadScript,
    saveCurrentAsScript,
    deleteScript,
    restoreScript,
    permanentlyDeleteScript,
    emptyScriptTrash,
    setScriptRunConfirmation,
    setScriptDeleteConfirmation,

    // Persistent command history manager
    historyMgr,
  };
}
