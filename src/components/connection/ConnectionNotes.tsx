import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_CONNECTION_NOTES_CODE_UNITS,
  MAX_CONNECTION_NOTES_UTF8_BYTES,
  readConnectionNotesSecret,
  saveConnectionNotesSecret,
} from "../../utils/storage/connectionNotesVault";
import {
  X,
  Bold,
  Italic,
  Heading,
  Code,
  Link,
  List,
  Eye,
  Edit,
  Columns,
  Save,
  Search,
  Tag,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Download,
  CheckSquare,
  Square,
  Clock,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RunbookStep {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
}

interface NotesData {
  content: string;
  tags: string[];
  lastModified: number;
  runbookSteps: RunbookStep[];
}

type ViewMode = "edit" | "preview" | "split";
type TabId = "notes" | "runbooks";
type NotesPersistenceState = "loading" | "available" | "unavailable";

interface ConnectionNotesProps {
  connectionId: string;
  connectionName: string;
  onClose?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = (id: string) => `sor-conn-notes-${id}`;
const MAX_NOTES_STORAGE_UTF8_BYTES = MAX_CONNECTION_NOTES_UTF8_BYTES;
const MAX_NOTES_SERIALIZED_CODE_UNITS = MAX_CONNECTION_NOTES_CODE_UNITS;
const MAX_NOTE_AGGREGATE_CODE_UNITS = 512;
const MAX_NOTE_CONTENT_CHARS = 512;
const MAX_NOTE_TAGS = 16;
const MAX_RUNBOOK_STEPS = 16;
const MAX_NOTE_LINES = 20_000;
const MAX_MARKDOWN_BLOCKS = 20_000;
const MAX_INLINE_MARKDOWN_TOKENS = 10_000;
const MAX_INLINE_MARKDOWN_DEPTH = 16;

const emptyNotes = (): NotesData => ({
  content: "",
  tags: [],
  lastModified: Date.now(),
  runbookSteps: [],
});

function normalizeNotes(value: unknown): NotesData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.content !== "string" ||
    raw.content.length > MAX_NOTE_CONTENT_CHARS ||
    !Array.isArray(raw.tags) ||
    raw.tags.length > MAX_NOTE_TAGS ||
    !raw.tags.every((tag) => typeof tag === "string" && tag.length <= 128) ||
    !Array.isArray(raw.runbookSteps) ||
    raw.runbookSteps.length > MAX_RUNBOOK_STEPS ||
    typeof raw.lastModified !== "number" ||
    !Number.isFinite(raw.lastModified)
  ) {
    return null;
  }

  const runbookSteps: RunbookStep[] = [];
  let aggregateCodeUnits =
    raw.content.length +
    (raw.tags as string[]).reduce((total, tag) => total + tag.length + 8, 0);
  if (aggregateCodeUnits > MAX_NOTE_AGGREGATE_CODE_UNITS) {
    return null;
  }
  for (const candidate of raw.runbookSteps) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return null;
    }
    const step = candidate as Record<string, unknown>;
    if (
      typeof step.id !== "string" ||
      step.id.length === 0 ||
      step.id.length > 128 ||
      typeof step.title !== "string" ||
      step.title.length > 512 ||
      typeof step.description !== "string" ||
      step.description.length > 16_384 ||
      typeof step.estimatedMinutes !== "number" ||
      !Number.isSafeInteger(step.estimatedMinutes) ||
      step.estimatedMinutes < 0 ||
      step.estimatedMinutes > 525_600 ||
      typeof step.completed !== "boolean"
    ) {
      return null;
    }
    aggregateCodeUnits +=
      step.id.length + step.title.length + step.description.length + 96;
    if (aggregateCodeUnits > MAX_NOTE_AGGREGATE_CODE_UNITS) {
      return null;
    }
    runbookSteps.push({
      id: step.id,
      title: step.title,
      description: step.description,
      estimatedMinutes: step.estimatedMinutes,
      completed: step.completed,
    });
  }

  return {
    content: raw.content,
    tags: [...new Set(raw.tags as string[])],
    lastModified: raw.lastModified,
    runbookSteps,
  };
}

interface LegacyNotesResult {
  data?: NotesData;
  warning?: string;
  plaintextRemovalFailed?: boolean;
}

interface LoadedNotes {
  data: NotesData;
  persistence: NotesPersistenceState;
  warning?: string;
  cleanupBlocked: boolean;
}

function consumeLegacyNotes(connectionId: string): LegacyNotesResult {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY(connectionId));
  } catch {
    return {
      warning:
        "Legacy note storage could not be inspected. Secure persistence is disabled.",
      plaintextRemovalFailed: true,
    };
  }

  try {
    localStorage.removeItem(STORAGE_KEY(connectionId));
    if (localStorage.getItem(STORAGE_KEY(connectionId)) !== null) {
      return {
        warning:
          "Legacy plaintext notes could not be removed. Secure persistence is disabled.",
        plaintextRemovalFailed: true,
      };
    }
  } catch {
    return {
      warning:
        "Legacy plaintext notes could not be removed. Secure persistence is disabled.",
      plaintextRemovalFailed: true,
    };
  }

  if (!raw) return {};
  if (raw.length > MAX_NOTES_SERIALIZED_CODE_UNITS) {
    return {
      warning:
        "Oversized legacy plaintext notes were removed and were not loaded.",
    };
  }
  try {
    const parsed = normalizeNotes(JSON.parse(raw));
    return parsed
      ? { data: parsed }
      : {
          warning:
            "Malformed legacy plaintext notes were removed and were not loaded.",
        };
  } catch {
    return {
      warning:
        "Malformed legacy plaintext notes were removed and were not loaded.",
    };
  }
}

function serializeNotes(data: NotesData): string {
  const normalized = normalizeNotes(data);
  if (!normalized) {
    throw new Error("Notes exceed a structural safety limit.");
  }
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_NOTES_SERIALIZED_CODE_UNITS) {
    throw new Error("Notes exceed the secure-storage size limit.");
  }
  const encoded = new TextEncoder().encode(serialized);
  if (encoded.byteLength > MAX_NOTES_STORAGE_UTF8_BYTES) {
    throw new Error("Notes exceed the secure-storage UTF-8 byte limit.");
  }
  return serialized;
}

async function loadNotes(connectionId: string): Promise<LoadedNotes> {
  if (!connectionId || connectionId.length > 256) {
    return {
      data: emptyNotes(),
      persistence: "unavailable",
      warning:
        "Notes cannot be persisted because the connection ID is invalid.",
      cleanupBlocked: false,
    };
  }
  const legacy = consumeLegacyNotes(connectionId);
  try {
    const stored = await readConnectionNotesSecret(connectionId);
    if (stored.length > MAX_NOTES_SERIALIZED_CODE_UNITS) {
      throw new Error("Stored notes exceed the safety limit.");
    }
    const parsed = normalizeNotes(JSON.parse(stored));
    if (!parsed) throw new Error("Stored notes are malformed.");
    return {
      data: parsed,
      persistence: legacy.plaintextRemovalFailed ? "unavailable" : "available",
      warning: legacy.plaintextRemovalFailed
        ? legacy.warning
        : legacy.data
          ? "A redundant plaintext note copy was removed; the secure vault copy was retained."
          : legacy.warning,
      cleanupBlocked: legacy.plaintextRemovalFailed === true,
    };
  } catch {
    if (legacy.data) {
      try {
        await saveConnectionNotesSecret(
          connectionId,
          serializeNotes(legacy.data),
        );
        return {
          data: legacy.data,
          persistence: "available",
          warning: "Legacy plaintext notes were migrated to the OS vault.",
          cleanupBlocked: false,
        };
      } catch {
        return {
          data: legacy.data,
          persistence: "unavailable",
          warning:
            "Legacy plaintext was removed. Notes are in memory only because the OS vault is unavailable.",
          cleanupBlocked: false,
        };
      }
    }
    return {
      data: emptyNotes(),
      persistence: "unavailable",
      warning:
        legacy.warning ??
        "Secure note persistence is unavailable. New notes remain in memory only until a secure save succeeds.",
      cleanupBlocked: legacy.plaintextRemovalFailed === true,
    };
  }
}

async function saveNotes(connectionId: string, data: NotesData): Promise<void> {
  if (!connectionId || connectionId.length > 256) {
    throw new Error("Connection ID is invalid.");
  }
  await saveConnectionNotesSecret(connectionId, serializeNotes(data));
}

function uid(): string {
  return crypto.randomUUID();
}

function sanitizeMarkdownHref(rawUrl: string): string | null {
  const candidate = rawUrl.trim();
  if (
    !candidate ||
    Array.from(candidate).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return null;
  }

  try {
    const protocol = new URL(candidate).protocol.toLowerCase();
    return protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

interface InlineMarkdownBudget {
  remainingTokens: number;
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  depth = 0,
  budget: InlineMarkdownBudget = {
    remainingTokens: MAX_INLINE_MARKDOWN_TOKENS,
  },
): React.ReactNode[] {
  if (depth >= MAX_INLINE_MARKDOWN_DEPTH || budget.remainingTokens <= 0) {
    return [text];
  }
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (budget.remainingTokens-- <= 0) {
      nodes.push(text.slice(cursor));
      return nodes;
    }
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${tokenIndex++}`;

    if (match[2] !== undefined) {
      nodes.push(
        <code className="sor-notes-inline-code" key={key}>
          {match[2]}
        </code>,
      );
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = sanitizeMarkdownHref(match[4]);
      const label = renderInlineMarkdown(
        match[3],
        `${key}-label`,
        depth + 1,
        budget,
      );
      nodes.push(
        href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" key={key}>
            {label}
          </a>
        ) : (
          <React.Fragment key={key}>{label}</React.Fragment>
        ),
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <strong key={key}>
          {renderInlineMarkdown(match[5], `${key}-bold`, depth + 1, budget)}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      nodes.push(
        <em key={key}>
          {renderInlineMarkdown(match[6], `${key}-italic`, depth + 1, budget)}
        </em>,
      );
    }

    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Minimal Markdown renderer that never turns note content into raw HTML. */
function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown
    .slice(0, MAX_NOTE_CONTENT_CHARS)
    .replace(/\r\n?/g, "\n")
    .split("\n", MAX_NOTE_LINES);
  const blocks: React.ReactNode[] = [];
  let lineIndex = 0;
  let blockIndex = 0;

  while (lineIndex < lines.length && blockIndex < MAX_MARKDOWN_BLOCKS) {
    const line = lines[lineIndex];

    if (/^```/.test(line)) {
      const code: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !/^```\s*$/.test(lines[lineIndex])) {
        code.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      blocks.push(
        <pre className="sor-notes-code-block" key={`code-${blockIndex++}`}>
          <code>{code.join("\n").trim()}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = renderInlineMarkdown(heading[2], `heading-${blockIndex}`);
      const key = `heading-${blockIndex++}`;
      blocks.push(
        heading[1].length === 1 ? (
          <h1 key={key}>{content}</h1>
        ) : heading[1].length === 2 ? (
          <h2 key={key}>{content}</h2>
        ) : (
          <h3 key={key}>{content}</h3>
        ),
      );
      lineIndex += 1;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (lineIndex < lines.length) {
        const item = /^-\s+(.+)$/.exec(lines[lineIndex]);
        if (!item) break;
        items.push(
          <li key={`item-${blockIndex}-${items.length}`}>
            {renderInlineMarkdown(
              item[1],
              `item-${blockIndex}-${items.length}`,
            )}
          </li>,
        );
        lineIndex += 1;
      }
      if (items.length === 0) {
        blocks.push(
          <p key={`malformed-list-${blockIndex++}`}>
            {renderInlineMarkdown(line, `malformed-list-${blockIndex}`)}
          </p>,
        );
        lineIndex += 1;
        continue;
      }
      blocks.push(<ul key={`list-${blockIndex++}`}>{items}</ul>);
      continue;
    }

    if (!line.trim()) {
      lineIndex += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (
      lineIndex < lines.length &&
      lines[lineIndex].trim() &&
      !/^```/.test(lines[lineIndex]) &&
      !/^(#{1,3})\s+/.test(lines[lineIndex]) &&
      !/^-\s+/.test(lines[lineIndex])
    ) {
      paragraph.push(lines[lineIndex]);
      lineIndex += 1;
    }
    if (paragraph.length === 0) {
      blocks.push(
        <p key={`fallback-${blockIndex++}`}>
          {renderInlineMarkdown(line, `fallback-${blockIndex}`)}
        </p>,
      );
      lineIndex += 1;
      continue;
    }
    blocks.push(
      <p key={`paragraph-${blockIndex}`}>
        {renderInlineMarkdown(
          paragraph.join("\n"),
          `paragraph-${blockIndex++}`,
        )}
      </p>,
    );
  }

  return <>{blocks}</>;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/* ------------------------------------------------------------------ */
/*  Toolbar                                                            */
/* ------------------------------------------------------------------ */

interface ToolbarAction {
  icon: React.ReactNode;
  label: string;
  insert: string;
  wrap?: boolean;
}

const mkActions = (t: (k: string) => string): ToolbarAction[] => [
  {
    icon: <Bold size={14} />,
    label: t("notes.bold"),
    insert: "**",
    wrap: true,
  },
  {
    icon: <Italic size={14} />,
    label: t("notes.italic"),
    insert: "*",
    wrap: true,
  },
  { icon: <Heading size={14} />, label: t("notes.heading"), insert: "# " },
  { icon: <Code size={14} />, label: t("notes.code"), insert: "`", wrap: true },
  { icon: <Link size={14} />, label: t("notes.link"), insert: "[text](url)" },
  { icon: <List size={14} />, label: t("notes.list"), insert: "- " },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ConnectionNotes: React.FC<ConnectionNotesProps> = ({
  connectionId,
  connectionName,
  onClose,
}) => {
  const { t } = useTranslation();

  /* ---- core state ---- */
  const [data, setData] = useState<NotesData>(() => emptyNotes());
  const [tab, setTab] = useState<TabId>("notes");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [persistenceState, setPersistenceState] =
    useState<NotesPersistenceState>("loading");
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(
    null,
  );
  const [runMode, setRunMode] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeConnectionIdRef = useRef(connectionId);
  const loadGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const plaintextCleanupBlockedRef = useRef(false);
  activeConnectionIdRef.current = connectionId;

  /* ---- persistence with debounce ---- */
  const persist = useCallback(
    (next: NotesData) => {
      try {
        serializeNotes(next);
      } catch {
        setPersistenceWarning(
          "This change was rejected because secure notes are limited to a 2 KiB UTF-8 payload.",
        );
        setSaving(false);
        return;
      }
      setSaving(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const targetConnectionId = connectionId;
      const saveGeneration = ++saveGenerationRef.current;
      saveTimer.current = setTimeout(() => {
        void saveNotes(targetConnectionId, next).then(
          () => {
            if (
              activeConnectionIdRef.current !== targetConnectionId ||
              saveGenerationRef.current !== saveGeneration
            ) {
              return;
            }
            if (plaintextCleanupBlockedRef.current) {
              setPersistenceState("unavailable");
              setPersistenceWarning(
                "Legacy plaintext notes could not be removed. Vault saves may succeed, but persistence cannot be reported as secure.",
              );
            } else {
              setPersistenceState("available");
              setPersistenceWarning(null);
            }
            setSaving(false);
          },
          () => {
            if (
              activeConnectionIdRef.current !== targetConnectionId ||
              saveGenerationRef.current !== saveGeneration
            ) {
              return;
            }
            setPersistenceState("unavailable");
            setPersistenceWarning(
              "Secure note persistence failed. This note remains in memory only.",
            );
            setSaving(false);
          },
        );
      }, 2000);
    },
    [connectionId],
  );

  const update = useCallback(
    (patch: Partial<NotesData>) => {
      setData((prev) => {
        const next = { ...prev, ...patch, lastModified: Date.now() };
        const normalized = normalizeNotes(next);
        if (!normalized) {
          setPersistenceWarning(
            "This change was rejected because it exceeds a note safety limit.",
          );
          return prev;
        }
        try {
          serializeNotes(normalized);
        } catch {
          setPersistenceWarning(
            "This change was rejected because secure notes are limited to a 2 KiB UTF-8 payload.",
          );
          return prev;
        }
        persist(normalized);
        return normalized;
      });
    },
    [persist],
  );

  /* securely re-load when connectionId changes */
  useEffect(() => {
    let cancelled = false;
    const targetConnectionId = connectionId;
    const loadGeneration = ++loadGenerationRef.current;
    saveGenerationRef.current += 1;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(false);
    setPersistenceState("loading");
    setPersistenceWarning(null);
    void loadNotes(targetConnectionId).then((loaded) => {
      if (
        cancelled ||
        activeConnectionIdRef.current !== targetConnectionId ||
        loadGenerationRef.current !== loadGeneration
      ) {
        return;
      }
      plaintextCleanupBlockedRef.current = loaded.cleanupBlocked;
      setData(loaded.data);
      setPersistenceState(loaded.persistence);
      setPersistenceWarning(loaded.warning ?? null);
    });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [connectionId]);

  /* ---- toolbar insert ---- */
  const handleToolbar = useCallback(
    (action: ToolbarAction) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = data.content.slice(start, end);
      let replacement: string;
      if (action.wrap && selected) {
        replacement = `${action.insert}${selected}${action.insert}`;
      } else {
        replacement = action.insert;
      }
      const next =
        data.content.slice(0, start) + replacement + data.content.slice(end);
      update({ content: next });
      requestAnimationFrame(() => {
        ta.focus();
        const cursor = start + replacement.length;
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [data.content, update],
  );

  /* ---- tags ---- */
  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (v && !data.tags.includes(v)) update({ tags: [...data.tags, v] });
    setTagInput("");
  };
  const removeTag = (tag: string) =>
    update({ tags: data.tags.filter((t) => t !== tag) });

  /* ---- runbook helpers ---- */
  const addStep = () => {
    const step: RunbookStep = {
      id: uid(),
      title: "",
      description: "",
      estimatedMinutes: 5,
      completed: false,
    };
    update({ runbookSteps: [...data.runbookSteps, step] });
  };
  const removeStep = (id: string) =>
    update({ runbookSteps: data.runbookSteps.filter((s) => s.id !== id) });
  const updateStep = (id: string, patch: Partial<RunbookStep>) => {
    update({
      runbookSteps: data.runbookSteps.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    const steps = [...data.runbookSteps];
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[idx], steps[target]] = [steps[target], steps[idx]];
    update({ runbookSteps: steps });
  };
  const toggleRunMode = () => {
    setRunMode((p) => !p);
    setCurrentStepIdx(0);
  };
  const completedCount = data.runbookSteps.filter((s) => s.completed).length;
  const progressPct = data.runbookSteps.length
    ? Math.round((completedCount / data.runbookSteps.length) * 100)
    : 0;

  const exportRunbook = () => {
    const lines = data.runbookSteps.map(
      (s, i) =>
        `${i + 1}. **${s.title || "Untitled"}** (~${s.estimatedMinutes}m)\n   ${s.description}`,
    );
    const md = `# Runbook — ${connectionName}\n\n${lines.join("\n\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runbook-${connectionId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---- search highlight ---- */
  const highlightedContent = useMemo(() => {
    if (!searchQuery) return null;
    const idx = data.content.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return null;
    return idx;
  }, [data.content, searchQuery]);

  const toolbarActions = useMemo(() => mkActions(t), [t]);
  const previewTruncated = useMemo(
    () =>
      data.content.split(/\r\n?|\n/, MAX_NOTE_LINES + 1).length >
      MAX_NOTE_LINES,
    [data.content],
  );

  const lastModStr = new Date(data.lastModified).toLocaleString();

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="sor-notes-panel flex flex-col h-full bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Header */}
      <header className="sor-notes-header flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Edit size={16} className="text-warning" />
          <h2 className="text-sm font-semibold truncate">
            {t("notes.title", "Notes")} — {connectionName}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="sor-notes-saving text-xs text-warning animate-pulse">
              <Save size={12} /> {t("notes.saving", "Saving…")}
            </span>
          )}
          {persistenceState === "loading" && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("notes.loadingSecure", "Loading secure notes…")}
            </span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="sor-option-chip p-1 rounded hover:bg-[var(--color-border)]"
              aria-label={t("common.close", "Close")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      {(persistenceWarning || previewTruncated) && (
        <div
          className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning"
          role="alert"
        >
          {persistenceWarning}
          {persistenceWarning && previewTruncated ? " " : null}
          {previewTruncated
            ? t(
                "notes.previewTruncated",
                `Preview is limited to ${MAX_NOTE_LINES.toLocaleString()} lines; the full note remains editable.`,
              )
            : null}
        </div>
      )}

      {/* Tabs */}
      <nav className="sor-notes-tabs flex gap-1 px-4 pt-2">
        {(["notes", "runbooks"] as TabId[]).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${tab === id ? "bg-[var(--color-border)] text-warning" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
          >
            {id === "notes"
              ? t("notes.tabNotes", "Notes")
              : t("notes.tabRunbooks", "Runbooks")}
          </button>
        ))}
      </nav>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "notes" ? (
          /* ---------- NOTES TAB ---------- */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search + Tags + View toggles */}
            <div className="sor-notes-toolbar flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
              {/* Search */}
              <div className="flex items-center gap-1 bg-[var(--color-border)] rounded px-2 py-1 text-xs">
                <Search size={12} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("notes.search", "Search…")}
                  className="bg-transparent outline-none w-28 text-[var(--color-text)]"
                />
                {searchQuery && highlightedContent !== null && (
                  <span className="text-warning text-[10px]">
                    {t("notes.found", "Found")}
                  </span>
                )}
              </div>

              {/* View mode buttons */}
              <div className="flex gap-0.5 ml-auto">
                {(
                  [
                    ["edit", <Edit size={12} key="e" />],
                    ["preview", <Eye size={12} key="p" />],
                    ["split", <Columns size={12} key="s" />],
                  ] as [ViewMode, React.ReactNode][]
                ).map(([mode, icon]) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`p-1 rounded text-xs ${viewMode === mode ? "bg-warning/20 text-warning" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
                    title={mode}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Toolbar */}
            {viewMode !== "preview" && (
              <div className="sor-notes-md-toolbar flex items-center gap-1 px-4 py-1 border-b border-[var(--color-border)]">
                {toolbarActions.map((a, i) => (
                  <button
                    key={a.label}
                    onClick={() => handleToolbar(a)}
                    className="sor-option-chip p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    title={a.label}
                  >
                    {a.icon}
                  </button>
                ))}
              </div>
            )}

            {/* Editor / Preview */}
            <div className="flex-1 flex overflow-hidden">
              {(viewMode === "edit" || viewMode === "split") && (
                <textarea
                  ref={textareaRef}
                  value={data.content}
                  disabled={persistenceState === "loading"}
                  onChange={(e) => {
                    if (e.target.value.length > MAX_NOTE_CONTENT_CHARS) {
                      setPersistenceWarning(
                        `Note content is limited to ${MAX_NOTE_CONTENT_CHARS.toLocaleString()} characters. The oversized edit was rejected.`,
                      );
                      return;
                    }
                    update({ content: e.target.value });
                  }}
                  className="sor-notes-editor flex-1 resize-none bg-transparent p-4 text-sm font-mono outline-none"
                  placeholder={t("notes.placeholder", "Write your notes here…")}
                  spellCheck
                />
              )}
              {(viewMode === "preview" || viewMode === "split") && (
                <div className="sor-notes-preview flex-1 p-4 text-sm overflow-y-auto prose prose-invert max-w-none border-l border-[var(--color-border)]">
                  <MarkdownPreview markdown={data.content} />
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="sor-notes-tags flex items-center gap-2 px-4 py-1.5 border-t border-[var(--color-border)] text-xs">
              <Tag size={12} className="text-[var(--color-textSecondary)]" />
              {data.tags.map((tag) => (
                <span
                  key={tag}
                  className="sor-notes-tag inline-flex items-center gap-1 bg-warning/15 text-warning rounded px-1.5 py-0.5"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:text-error"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("notes.addTag", "Add tag…")}
                className="bg-transparent outline-none w-20 text-[var(--color-text)]"
              />
            </div>

            {/* Footer stats */}
            <div className="sor-notes-footer flex items-center justify-between px-4 py-1 border-t border-[var(--color-border)] text-[10px] text-[var(--color-textSecondary)]">
              <span>
                {data.content.length}/{MAX_NOTE_CONTENT_CHARS.toLocaleString()}{" "}
                {t("notes.chars", "chars")} · {wordCount(data.content)}{" "}
                {t("notes.words", "words")}
              </span>
              <span>
                {t("notes.modified", "Modified")}: {lastModStr}
              </span>
            </div>
          </div>
        ) : (
          /* ---------- RUNBOOKS TAB ---------- */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Runbook toolbar */}
            <div className="sor-runbook-toolbar flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
              <button
                onClick={addStep}
                className="sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded bg-warning/15 text-warning hover:bg-warning/25"
              >
                <Plus size={12} /> {t("notes.addStep", "Add Step")}
              </button>
              <button
                onClick={toggleRunMode}
                className={`sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded ${runMode ? "bg-success/20 text-success" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
              >
                <Play size={12} />{" "}
                {runMode
                  ? t("notes.stopRun", "Stop Run")
                  : t("notes.runRunbook", "Run Runbook")}
              </button>
              <button
                onClick={exportRunbook}
                className="sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <Download size={12} /> {t("notes.export", "Export")}
              </button>

              {/* Progress */}
              <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <span>
                  {completedCount}/{data.runbookSteps.length}
                </span>
                <div className="sor-runbook-progress w-24 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                  <div
                    className="h-full bg-warning transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span>{progressPct}%</span>
              </div>
            </div>

            {/* Steps list */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {data.runbookSteps.length === 0 && (
                <p className="text-sm text-[var(--color-textSecondary)] text-center py-8">
                  {t(
                    "notes.noSteps",
                    'No runbook steps yet. Click "Add Step" to begin.',
                  )}
                </p>
              )}
              {data.runbookSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={`sor-runbook-step rounded-lg border p-3 transition-colors ${
                    runMode && idx === currentStepIdx
                      ? "border-warning bg-warning/10"
                      : step.completed
                        ? "border-success/30 bg-success/[0.05]"
                        : "border-[var(--color-border)] bg-[var(--color-bg)]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Completed toggle */}
                    <button
                      onClick={() => {
                        updateStep(step.id, { completed: !step.completed });
                        if (
                          runMode &&
                          !step.completed &&
                          idx === currentStepIdx
                        ) {
                          setCurrentStepIdx((p) =>
                            Math.min(p + 1, data.runbookSteps.length - 1),
                          );
                        }
                      }}
                      className="mt-0.5 shrink-0"
                    >
                      {step.completed ? (
                        <CheckSquare size={16} className="text-success" />
                      ) : (
                        <Square
                          size={16}
                          className="text-[var(--color-textSecondary)]"
                        />
                      )}
                    </button>

                    {/* Step number */}
                    <span className="sor-runbook-step-num text-xs font-bold text-warning mt-0.5 shrink-0 w-5 text-center">
                      {idx + 1}
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        value={step.title}
                        onChange={(e) =>
                          updateStep(step.id, { title: e.target.value })
                        }
                        placeholder={t("notes.stepTitle", "Step title…")}
                        className="w-full bg-transparent outline-none text-sm font-medium text-[var(--color-text)]"
                      />
                      <textarea
                        value={step.description}
                        onChange={(e) =>
                          updateStep(step.id, { description: e.target.value })
                        }
                        placeholder={t(
                          "notes.stepDesc",
                          "Description (markdown)…",
                        )}
                        rows={2}
                        className="w-full bg-transparent outline-none text-xs text-[var(--color-textSecondary)] resize-none"
                      />
                      <div className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
                        <Clock size={10} />
                        <input
                          type="number"
                          min={1}
                          value={step.estimatedMinutes}
                          onChange={(e) =>
                            updateStep(step.id, {
                              estimatedMinutes: Math.max(1, +e.target.value),
                            })
                          }
                          className="w-12 bg-[var(--color-border)] rounded px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
                        />
                        <span>{t("notes.minutes", "min")}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => moveStep(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveStep(idx, 1)}
                        disabled={idx === data.runbookSteps.length - 1}
                        className="p-0.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        onClick={() => removeStep(step.id)}
                        className="p-0.5 rounded hover:bg-error/20 text-[var(--color-textSecondary)] hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionNotes;
