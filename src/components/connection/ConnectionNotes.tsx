import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
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

interface ConnectionNotesProps {
  connectionId: string;
  connectionName: string;
  onClose?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = (id: string) => `sor-conn-notes-${id}`;

function loadNotes(connectionId: string): NotesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(connectionId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { content: "", tags: [], lastModified: Date.now(), runbookSteps: [] };
}

function saveNotes(connectionId: string, data: NotesData) {
  localStorage.setItem(STORAGE_KEY(connectionId), JSON.stringify(data));
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Minimal markdown-to-HTML renderer. */
function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // fenced code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_m, code) =>
    `<pre class="sor-notes-code-block"><code>${code.trim()}</code></pre>`);

  // headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // inline code
  html = html.replace(/`([^`]+)`/g, '<code class="sor-notes-inline-code">$1</code>');

  // links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safeUrl = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // unordered list items
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // paragraphs
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/* ------------------------------------------------------------------ */
/*  Toolbar                                                            */
/* ------------------------------------------------------------------ */

interface ToolbarAction { icon: React.ReactNode; label: string; insert: string; wrap?: boolean }

const mkActions = (t: (k: string) => string): ToolbarAction[] => [
  { icon: <Bold size={14} />, label: t("notes.bold"), insert: "**", wrap: true },
  { icon: <Italic size={14} />, label: t("notes.italic"), insert: "*", wrap: true },
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
  const [data, setData] = useState<NotesData>(() => loadNotes(connectionId));
  const [tab, setTab] = useState<TabId>("notes");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [runMode, setRunMode] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- persistence with debounce ---- */
  const persist = useCallback((next: NotesData) => {
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNotes(connectionId, next);
      setSaving(false);
    }, 2000);
  }, [connectionId]);

  const update = useCallback((patch: Partial<NotesData>) => {
    setData((prev) => {
      const next = { ...prev, ...patch, lastModified: Date.now() };
      persist(next);
      return next;
    });
  }, [persist]);

  /* cleanup timer on unmount */
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  /* re-load when connectionId changes */
  useEffect(() => { setData(loadNotes(connectionId)); }, [connectionId]);

  /* ---- toolbar insert ---- */
  const handleToolbar = useCallback((action: ToolbarAction) => {
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
    const next = data.content.slice(0, start) + replacement + data.content.slice(end);
    update({ content: next });
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + replacement.length;
      ta.setSelectionRange(cursor, cursor);
    });
  }, [data.content, update]);

  /* ---- tags ---- */
  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (v && !data.tags.includes(v)) update({ tags: [...data.tags, v] });
    setTagInput("");
  };
  const removeTag = (tag: string) => update({ tags: data.tags.filter((t) => t !== tag) });

  /* ---- runbook helpers ---- */
  const addStep = () => {
    const step: RunbookStep = { id: uid(), title: "", description: "", estimatedMinutes: 5, completed: false };
    update({ runbookSteps: [...data.runbookSteps, step] });
  };
  const removeStep = (id: string) => update({ runbookSteps: data.runbookSteps.filter((s) => s.id !== id) });
  const updateStep = (id: string, patch: Partial<RunbookStep>) => {
    update({ runbookSteps: data.runbookSteps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    const steps = [...data.runbookSteps];
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[idx], steps[target]] = [steps[target], steps[idx]];
    update({ runbookSteps: steps });
  };
  const toggleRunMode = () => { setRunMode((p) => !p); setCurrentStepIdx(0); };
  const completedCount = data.runbookSteps.filter((s) => s.completed).length;
  const progressPct = data.runbookSteps.length ? Math.round((completedCount / data.runbookSteps.length) * 100) : 0;

  const exportRunbook = () => {
    const lines = data.runbookSteps.map((s, i) =>
      `${i + 1}. **${s.title || "Untitled"}** (~${s.estimatedMinutes}m)\n   ${s.description}`);
    const md = `# Runbook — ${connectionName}\n\n${lines.join("\n\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `runbook-${connectionId}.md`; a.click();
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
          {saving && <span className="sor-notes-saving text-xs text-warning animate-pulse"><Save size={12} /> {t("notes.saving", "Saving…")}</span>}
          {onClose && (
            <button onClick={onClose} className="sor-option-chip p-1 rounded hover:bg-[var(--color-border)]" aria-label={t("common.close", "Close")}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="sor-notes-tabs flex gap-1 px-4 pt-2">
        {(["notes", "runbooks"] as TabId[]).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${tab === id ? "bg-[var(--color-border)] text-warning" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
          >
            {id === "notes" ? t("notes.tabNotes", "Notes") : t("notes.tabRunbooks", "Runbooks")}
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
                  <span className="text-warning text-[10px]">{t("notes.found", "Found")}</span>
                )}
              </div>

              {/* View mode buttons */}
              <div className="flex gap-0.5 ml-auto">
                {([["edit", <Edit size={12} key="e" />], ["preview", <Eye size={12} key="p" />], ["split", <Columns size={12} key="s" />]] as [ViewMode, React.ReactNode][]).map(([mode, icon]) => (
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
                  onChange={(e) => update({ content: e.target.value })}
                  className="sor-notes-editor flex-1 resize-none bg-transparent p-4 text-sm font-mono outline-none"
                  placeholder={t("notes.placeholder", "Write your notes here…")}
                  spellCheck
                />
              )}
              {(viewMode === "preview" || viewMode === "split") && (
                <div
                  className="sor-notes-preview flex-1 p-4 text-sm overflow-y-auto prose prose-invert max-w-none border-l border-[var(--color-border)]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }}
                />
              )}
            </div>

            {/* Tags */}
            <div className="sor-notes-tags flex items-center gap-2 px-4 py-1.5 border-t border-[var(--color-border)] text-xs">
              <Tag size={12} className="text-[var(--color-textSecondary)]" />
              {data.tags.map((tag) => (
                <span key={tag} className="sor-notes-tag inline-flex items-center gap-1 bg-warning/15 text-warning rounded px-1.5 py-0.5">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-error"><X size={10} /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder={t("notes.addTag", "Add tag…")}
                className="bg-transparent outline-none w-20 text-[var(--color-text)]"
              />
            </div>

            {/* Footer stats */}
            <div className="sor-notes-footer flex items-center justify-between px-4 py-1 border-t border-[var(--color-border)] text-[10px] text-[var(--color-textSecondary)]">
              <span>{data.content.length} {t("notes.chars", "chars")} · {wordCount(data.content)} {t("notes.words", "words")}</span>
              <span>{t("notes.modified", "Modified")}: {lastModStr}</span>
            </div>
          </div>
        ) : (
          /* ---------- RUNBOOKS TAB ---------- */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Runbook toolbar */}
            <div className="sor-runbook-toolbar flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
              <button onClick={addStep} className="sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded bg-warning/15 text-warning hover:bg-warning/25">
                <Plus size={12} /> {t("notes.addStep", "Add Step")}
              </button>
              <button onClick={toggleRunMode} className={`sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded ${runMode ? "bg-success/20 text-success" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}>
                <Play size={12} /> {runMode ? t("notes.stopRun", "Stop Run") : t("notes.runRunbook", "Run Runbook")}
              </button>
              <button onClick={exportRunbook} className="sor-option-chip flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
                <Download size={12} /> {t("notes.export", "Export")}
              </button>

              {/* Progress */}
              <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <span>{completedCount}/{data.runbookSteps.length}</span>
                <div className="sor-runbook-progress w-24 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                  <div className="h-full bg-warning transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span>{progressPct}%</span>
              </div>
            </div>

            {/* Steps list */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {data.runbookSteps.length === 0 && (
                <p className="text-sm text-[var(--color-textSecondary)] text-center py-8">{t("notes.noSteps", "No runbook steps yet. Click \"Add Step\" to begin.")}</p>
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
                        if (runMode && !step.completed && idx === currentStepIdx) {
                          setCurrentStepIdx((p) => Math.min(p + 1, data.runbookSteps.length - 1));
                        }
                      }}
                      className="mt-0.5 shrink-0"
                    >
                      {step.completed
                        ? <CheckSquare size={16} className="text-success" />
                        : <Square size={16} className="text-[var(--color-textSecondary)]" />}
                    </button>

                    {/* Step number */}
                    <span className="sor-runbook-step-num text-xs font-bold text-warning mt-0.5 shrink-0 w-5 text-center">{idx + 1}</span>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        value={step.title}
                        onChange={(e) => updateStep(step.id, { title: e.target.value })}
                        placeholder={t("notes.stepTitle", "Step title…")}
                        className="w-full bg-transparent outline-none text-sm font-medium text-[var(--color-text)]"
                      />
                      <textarea
                        value={step.description}
                        onChange={(e) => updateStep(step.id, { description: e.target.value })}
                        placeholder={t("notes.stepDesc", "Description (markdown)…")}
                        rows={2}
                        className="w-full bg-transparent outline-none text-xs text-[var(--color-textSecondary)] resize-none"
                      />
                      <div className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
                        <Clock size={10} />
                        <input
                          type="number"
                          min={1}
                          value={step.estimatedMinutes}
                          onChange={(e) => updateStep(step.id, { estimatedMinutes: Math.max(1, +e.target.value) })}
                          className="w-12 bg-[var(--color-border)] rounded px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
                        />
                        <span>{t("notes.minutes", "min")}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-0.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30">
                        <ChevronUp size={12} />
                      </button>
                      <button onClick={() => moveStep(idx, 1)} disabled={idx === data.runbookSteps.length - 1} className="p-0.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30">
                        <ChevronDown size={12} />
                      </button>
                       <button onClick={() => removeStep(step.id)} className="p-0.5 rounded hover:bg-error/20 text-[var(--color-textSecondary)] hover:text-error">
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
