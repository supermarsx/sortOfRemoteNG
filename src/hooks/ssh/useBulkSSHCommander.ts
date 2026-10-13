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
import {
  requestPrompt,
  type PromptRequest,
} from "../../utils/prompts/promptQueue";
import {
  PROMPT_LIMITS,
  bulkCommandRunPrompt,
  bulkScriptDeletePrompt,
  bulkScriptTrashEmptyPrompt,
  toSingleLine,
} from "../../utils/prompts/runPromptRequests";

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

const RUN_PROMPT_UNAVAILABLE =
  "The confirmation could not be shown. Nothing was sent.";
const DELETE_PROMPT_UNAVAILABLE =
  "The confirmation could not be shown. Nothing was deleted.";

/** The button that has the focus when a prompt opens. */
type PromptFocus = NonNullable<PromptRequest["defaultAction"]>;

interface CommandRecipient {
  id: string;
  backendSessionId?: string;
}

/**
 * The same sessions, each still on the same backend session; order does not
 * matter. Sessions are told apart by id, never by name: two can share a
 * display name and a host.
 */
const sameRecipients = (
  reviewed: readonly CommandRecipient[],
  current: readonly CommandRecipient[],
): boolean =>
  reviewed.length === current.length &&
  reviewed.every((session) =>
    current.some(
      (candidate) =>
        candidate.id === session.id &&
        candidate.backendSessionId === session.backendSessionId,
    ),
  );

/**
 * The loaded script the editor's text derives from, with a mark for every text
 * the editor held while it did. `attached` goes false when the editor is
 * emptied or a history entry is put over the script, and true again when one
 * of the marked texts comes back.
 */
interface ScriptTrail {
  script: BulkScript;
  texts: Set<string>;
  attached: boolean;
}

/** Marks kept for one loaded script; beyond that its oldest edit is forgotten. */
const MAX_SCRIPT_TRAIL_TEXTS = 5_000;

/**
 * Recognises a text again without keeping it (a script can be 256 KiB, and
 * every keystroke makes another text): its length and a 53-bit hash, cyrb53.
 * Two texts with one mark only mean that a send is asked about once more.
 */
const textMark = (text: string): string => {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${text.length}:${hash.toString(36)}`;
};

const markText = (trail: ScriptTrail, text: string) => {
  trail.texts.add(textMark(text));
  if (trail.texts.size <= MAX_SCRIPT_TRAIL_TEXTS) return;
  // The script's own text is the first mark and is never the one dropped.
  const marks = trail.texts.values();
  marks.next();
  const oldestEdit = marks.next().value;
  if (oldestEdit !== undefined) trail.texts.delete(oldestEdit);
};

/** No character a user types is longer than this, in UTF-16 units. */
const MAX_TYPED_CHARACTER_UNITS = 64;

interface GraphemeSegmenter {
  segment(text: string): Iterable<unknown>;
}

/**
 * The characters of a text as a user counts them: an emoji with its modifiers
 * is one, and so is a letter with its accents. Where the runtime cannot tell,
 * code points: a character made of several then counts as more than one, which
 * only means that a send is asked about once more.
 */
const charactersOf = (text: string): Iterable<unknown> => {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locales: undefined,
        options: { granularity: "grapheme" },
      ) => GraphemeSegmenter;
    }
  ).Segmenter;
  return typeof Segmenter === "function"
    ? new Segmenter(undefined, { granularity: "grapheme" }).segment(text)
    : text;
};

const isOneCharacter = (text: string): boolean => {
  const characters = charactersOf(text)[Symbol.iterator]();
  return characters.next().done !== true && characters.next().done === true;
};

/**
 * True when `next` is `previous` with one character put in and nothing else
 * changed, which is what a keystroke does. It is a question about the two
 * texts and not about their lengths: an undo or a paste can bring back a text
 * that merely is one character longer than what the editor held.
 */
const isOneCharacterInserted = (previous: string, next: string): boolean => {
  const added = next.length - previous.length;
  if (added < 1 || added > MAX_TYPED_CHARACTER_UNITS) return false;
  let before = 0;
  while (
    before < previous.length &&
    previous.charCodeAt(before) === next.charCodeAt(before)
  ) {
    before += 1;
  }
  let after = 0;
  while (
    after < previous.length &&
    previous.charCodeAt(previous.length - 1 - after) ===
      next.charCodeAt(next.length - 1 - after)
  ) {
    after += 1;
  }
  // Every place where `previous` can be cut so that `next` is its two parts
  // around something new. Where a neighbour repeats there are several, and
  // the new part must be one character at one of them.
  const first = previous.length - after;
  const last = Math.min(before, first + added);
  for (let at = first; at <= last; at += 1) {
    if (isOneCharacter(next.slice(at, at + added))) return true;
  }
  return false;
};

/**
 * The changes a text area reports for a key press. Anything else it reports
 * (an undo, a redo, a paste, a drop, a delete) is not typing, whatever the
 * text before and after look like.
 */
const TYPED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertText",
  "insertCompositionText",
]);

const SCRIPT_EDITED_NOTE = " (edited)";

/**
 * The script named on the run prompt: its name while the editor holds the
 * script's own text; the name marked as edited for a script flagged
 * destructive whose text was changed, because that flag is why the user is
 * asked; nothing for any other edited script.
 */
const promptScriptName = (
  script: BulkScript | null,
  command: string,
): string | null => {
  if (!script) return null;
  if (script.script === command) return script.name;
  if (script.risk !== "destructive") return null;
  // Room for the note, and for the ellipsis a shortened name ends with: the
  // prompt bounds the whole name, and must not cut the note off.
  const name = toSingleLine(
    script.name,
    PROMPT_LIMITS.nameInTitle - SCRIPT_EDITED_NOTE.length - 1,
  );
  return `${name}${SCRIPT_EDITED_NOTE}`;
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
  // The script the editor's text derives from: loaded, and perhaps edited since.
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

  const selectedSessions = useMemo(
    () => sshSessions.filter((session) => selectedSessionIds.has(session.id)),
    [selectedSessionIds, sshSessions],
  );

  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const outputListenersRef = useRef<Map<string, () => void>>(new Map());
  const liveSessionIdsRef = useRef(liveSessionIds);
  const previewRequestCounterRef = useRef(0);
  const previewRequestTokensRef = useRef<Map<string, number>>(new Map());
  // What a run prompt is checked against once it is answered: the prompt does
  // not stop the window, so the editor and the recipients can change under it.
  const runStateRef = useRef({ command, selectedSessions });
  // The commander's open prompt, if any: it shows one at a time.
  const promptAbortRef = useRef<AbortController | null>(null);
  // `isExecuting` as of now, for a callback that an earlier render created.
  const isExecutingRef = useRef(false);
  // The editor's text as of now, and the loaded script it derives from.
  const editorTextRef = useRef("");
  const scriptTrailRef = useRef<ScriptTrail | null>(null);
  // How the text area says its next change was made ("insertText",
  // "historyUndo", ...), read once by `setCommand`; null when it did not say.
  const editorInputTypeRef = useRef<string | null>(null);
  // The history entry the arrow keys put in the editor, until anything else
  // writes there: an entry they recalled is not the user's text yet.
  const historyShownRef = useRef<string | null>(null);
  liveSessionIdsRef.current = liveSessionIds;
  runStateRef.current = { command, selectedSessions };

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

  // A prompt belongs to the open commander: closing or unmounting it answers
  // "no", so the prompt goes away and nothing is sent or deleted.
  useEffect(() => () => promptAbortRef.current?.abort(), [isOpen]);

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

  const selectedCount = selectedSessions.length;
  const totalCount = sshSessions.length;

  /** Puts `text` in the editor, with the script it derives from now. */
  const writeEditor = useCallback((text: string) => {
    const trail = scriptTrailRef.current;
    editorTextRef.current = text;
    historyShownRef.current = null;
    setCommandState(text);
    setLoadedScript(trail?.attached ? trail.script : null);
  }, []);

  /**
   * The editor's input event, which reaches here just before its change
   * reaches `setCommand`: notes what kind of change the text area says it is.
   */
  const noteEditorInput = useCallback((event: { nativeEvent: Event }) => {
    const { inputType } = event.nativeEvent as Partial<InputEvent>;
    editorInputTypeRef.current =
      typeof inputType === "string" ? inputType : null;
  }, []);

  /**
   * The editor's text after an edit. A loaded script stays attached through
   * any edit, so a script flagged destructive is still asked about when its
   * text was changed. Emptying the editor lets go of it. It comes back as
   * soon as the editor holds one of its texts again, by an undo or a paste,
   * with one exception: a keystroke, that is, one character put into the
   * text that was there just before. Typing a new command may pass through
   * a text the script was erased down to, and does not bring it back. Where
   * the text area said how the text changed, only a change it reports for a
   * key press can be a keystroke: an undo is never one, even when it puts
   * back a single character.
   *
   * The history panel sets its entries through here as well, which cannot be
   * told from an edit: a script stays attached under them.
   */
  const setCommand = useCallback(
    (value: string) => {
      const inputType = editorInputTypeRef.current;
      editorInputTypeRef.current = null;
      const trail = scriptTrailRef.current;
      if (trail?.attached) {
        if (value.trim() === "") trail.attached = false;
        else markText(trail, value);
      } else if (trail) {
        const typed =
          (inputType === null || TYPED_INPUT_TYPES.has(inputType)) &&
          isOneCharacterInserted(editorTextRef.current, value);
        trail.attached = trail.texts.has(textMark(value)) && !typed;
      }
      writeEditor(value);
    },
    [writeEditor],
  );

  /**
   * Puts a history entry in the editor. That lets go of a loaded script, which
   * comes back when the entry is one of its texts: Arrow Down past the newest
   * entry restores what was being edited.
   */
  const replaceCommand = useCallback(
    (text: string) => {
      const trail = scriptTrailRef.current;
      if (trail) trail.attached = trail.texts.has(textMark(text));
      writeEditor(text);
    },
    [writeEditor],
  );

  const setExecuting = useCallback((executing: boolean) => {
    isExecutingRef.current = executing;
    setIsExecuting(executing);
  }, []);

  /**
   * Asks through the window's themed prompt, which does not stop the window.
   * `focus` is the button that has the focus when the prompt opens: the
   * commander states it for every prompt instead of leaning on a default.
   * Resolves true only when the user confirmed this very prompt. A second
   * request while one is open, a cancel, an abort and a window that cannot
   * show the prompt all resolve false: nothing may be sent or deleted.
   *
   * The guard is this commander's own open prompt, never a key made of
   * session names, and a request is never joined with another one.
   */
  const confirmInApp = useCallback(
    async (
      buildRequest: () => PromptRequest,
      focus: PromptFocus,
      unavailableMessage: string,
    ): Promise<boolean> => {
      if (promptAbortRef.current) return false;
      const controller = new AbortController();
      promptAbortRef.current = controller;
      try {
        const decision = await requestPrompt(
          { ...buildRequest(), defaultAction: focus },
          { signal: controller.signal },
        );
        return decision.confirmed === true && !controller.signal.aborted;
      } catch {
        if (!controller.signal.aborted) toast.error(unavailableMessage);
        return false;
      } finally {
        if (promptAbortRef.current === controller) {
          promptAbortRef.current = null;
        }
      }
    },
    [toast],
  );

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
    if (
      !command.trim() ||
      selectedSessions.length === 0 ||
      isExecuting ||
      isExecutingRef.current
    ) {
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      console.warn("Bulk SSH commander requires Tauri runtime");
      return;
    }

    const normalizedCommand = command.trim();
    // A loaded script keeps its destructive flag however its text was edited;
    // any text is destructive when the classifier says so.
    const commandRisk: BulkScriptRisk =
      loadedScript?.risk === "destructive" ||
      isDestructiveBulkScript(normalizedCommand)
        ? "destructive"
        : "standard";
    if (
      shouldConfirmBulkScriptRun(
        scriptLibraryConfig.runConfirmation,
        commandRisk,
      )
    ) {
      const confirmed = await confirmInApp(
        () =>
          bulkCommandRunPrompt({
            command: normalizedCommand,
            sessions: selectedSessions,
            destructive: commandRisk === "destructive",
            scriptName: promptScriptName(loadedScript, normalizedCommand),
            policy: scriptLibraryConfig.runConfirmation,
          }),
        commandRisk === "destructive" ? "cancel" : "confirm",
        RUN_PROMPT_UNAVAILABLE,
      );
      if (!confirmed) return;
      // The user reviewed `normalizedCommand` for `selectedSessions`. Send
      // only that, and only while the editor and the selection still say so.
      const current = runStateRef.current;
      if (current.command !== command) {
        toast.warning(
          "The command changed while you were reviewing. Nothing was sent.",
        );
        return;
      }
      if (!sameRecipients(selectedSessions, current.selectedSessions)) {
        toast.warning(
          "The selected sessions changed while you were reviewing. Nothing was sent.",
        );
        return;
      }
    }

    setExecuting(true);
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
          connectionId: session.connectionId,
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

    setExecuting(false);
    // A completed send ends the loaded script's hold on the editor.
    scriptTrailRef.current = null;
    writeEditor("");
    commandInputRef.current?.focus();
  }, [
    command,
    selectedSessions,
    isExecuting,
    trackHistory,
    historyMgr,
    loadedScript,
    scriptLibraryConfig.runConfirmation,
    confirmInApp,
    setExecuting,
    toast,
    writeEditor,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        executeCommand();
        return;
      }
      // Arrow-key history navigation, only for single-line input: a one-line
      // or empty editor, and on through an entry the keys themselves put
      // there. In any other text of several lines the arrow keys are left to
      // the text area, which moves the caret, and the text is not touched.
      const stepsThroughHistory =
        !/[\r\n]/.test(command) || historyShownRef.current === command;
      if (e.key === "ArrowUp" && !e.shiftKey && stepsThroughHistory) {
        const cmd = historyMgr.navigateUp(command);
        if (cmd !== null) {
          e.preventDefault();
          replaceCommand(cmd);
          historyShownRef.current = cmd;
        }
      }
      // Arrow Down only steps back out of a navigation in progress; with none
      // there is nothing newer to show, and the text stays as it is.
      if (
        e.key === "ArrowDown" &&
        !e.shiftKey &&
        stepsThroughHistory &&
        historyMgr.navigationIndex >= 0
      ) {
        const cmd = historyMgr.navigateDown();
        if (cmd !== null) {
          e.preventDefault();
          replaceCommand(cmd);
          historyShownRef.current = cmd;
        }
      }
    },
    [executeCommand, command, historyMgr, replaceCommand],
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
    setExecuting(false);
  }, [sshSessions, selectedSessionIds, setExecuting]);

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
      replaceCommand(historyItem.command);
      setShowHistory(false);
      commandInputRef.current?.focus();
    },
    [replaceCommand],
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

  // Loading only fills the editor and sends nothing, so it does not ask. A
  // destructive script is confirmed when it is sent, where the prompt shows
  // the command and every recipient; it stays attached to the editor until
  // then, so editing it first does not get round the question.
  const loadScript = useCallback(
    (script: BulkScript) => {
      scriptTrailRef.current = {
        script,
        texts: new Set([textMark(script.script)]),
        attached: true,
      };
      writeEditor(script.script);
      setShowScriptLibrary(false);
      commandInputRef.current?.focus();
    },
    [writeEditor],
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
        !(await confirmInApp(
          () => bulkScriptDeletePrompt({ name: script.name, permanent: false }),
          "confirm",
          DELETE_PROMPT_UNAVAILABLE,
        ))
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
    [confirmInApp, persistAndApplyLibrary, savedScripts, scriptLibraryConfig],
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
        !(await confirmInApp(
          () => bulkScriptDeletePrompt({ name: script.name, permanent: true }),
          "cancel",
          DELETE_PROMPT_UNAVAILABLE,
        ))
      ) {
        return;
      }
      await persistAndApplyLibrary((current) => ({
        ...current,
        trash: current.trash.filter((candidate) => candidate.id !== scriptId),
      }));
    },
    [confirmInApp, persistAndApplyLibrary, scriptLibraryConfig, trashedScripts],
  );

  const emptyScriptTrash = useCallback(async () => {
    if (trashedScripts.length === 0) return;
    if (
      shouldConfirmBulkScriptDelete(
        scriptLibraryConfig.deleteConfirmation,
        true,
      ) &&
      !(await confirmInApp(
        () => bulkScriptTrashEmptyPrompt({ count: trashedScripts.length }),
        "cancel",
        DELETE_PROMPT_UNAVAILABLE,
      ))
    ) {
      return;
    }
    const confirmedIds = new Set(trashedScripts.map((script) => script.id));
    await persistAndApplyLibrary((current) => ({
      ...current,
      trash: current.trash.filter((script) => !confirmedIds.has(script.id)),
    }));
  }, [
    confirmInApp,
    persistAndApplyLibrary,
    scriptLibraryConfig,
    trashedScripts,
  ]);

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
    noteEditorInput,
    replaceCommand,
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
