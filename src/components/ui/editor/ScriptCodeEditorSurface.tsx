"use client";

import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { undo, redo, toggleComment, indentWithTab } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";
import { openSearchPanel } from "@codemirror/search";
import {
  linter,
  setDiagnostics,
  diagnosticCount,
  openLintPanel,
  type Diagnostic,
} from "@codemirror/lint";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Braces, CheckCheck, Search, Undo2, Redo2, Wand2 } from "lucide-react";
import {
  scriptLanguageExtension,
  javaScriptSyntaxDiagnostics,
  nativeScriptDiagnostics,
} from "../../../utils/recording/scriptEditorLanguage";
import {
  loadScriptToolCapabilities,
  analyzeInstalledScript,
  formatInstalledScript,
  formatJavaScript,
  withinScriptToolLimit,
  type ScriptToolCapabilities,
} from "../../../utils/recording/scriptEditorTools";
import {
  SCRIPT_EDITOR_LABELS,
  isWebScriptLanguage,
  type ScriptCodeEditorProps,
} from "./scriptEditorTypes";

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-text)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "var(--color-text)", padding: "12px 0" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-textMuted)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--color-surfaceHover)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--color-surfaceHover)" },
  ".cm-cursor": { borderLeftColor: "var(--color-text)" },
  ".cm-tooltip, .cm-panels": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-primary)",
    color: "var(--color-text)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--color-surfaceHover)",
    outline: "1px solid var(--color-primary)",
  },
  ".cm-panels input, .cm-panels button": {
    color: "var(--color-text)",
    background: "var(--color-surfaceHover)",
    border: "1px solid var(--color-border)",
  },
  "&.cm-focused": {
    outline: "2px solid var(--color-primary)",
    outlineOffset: "-2px",
  },
});
const highlights = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--color-primary)" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--color-success)",
  },
  { tag: [tags.number, tags.bool], color: "var(--color-warning)" },
  { tag: tags.comment, color: "var(--color-textMuted)", fontStyle: "italic" },
  {
    tag: [tags.variableName, tags.definition(tags.variableName)],
    color: "var(--color-text)",
  },
  { tag: tags.function(tags.variableName), color: "var(--color-info)" },
  {
    tag: [tags.operator, tags.punctuation],
    color: "var(--color-textSecondary)",
  },
]);
const languageExtensions = (
  language: ScriptCodeEditorProps["language"],
  active = true,
) => [
  scriptLanguageExtension(language),
  isWebScriptLanguage(language) && active
    ? linter(
        (editor) =>
          javaScriptSyntaxDiagnostics(editor.state.doc.toString(), language),
        { delay: 400 },
      )
    : [],
];

export default function ScriptCodeEditorSurface({
  code,
  language,
  onChange,
  readOnly = false,
  ariaLabel = "Script code",
  minHeight = 280,
  documentKey,
}: ScriptCodeEditorProps) {
  const container = useRef<HTMLDivElement>(null),
    viewRef = useRef<EditorView | null>(null);
  const languageConfig = useRef(new Compartment()),
    accessConfig = useRef(new Compartment());
  const latest = useRef({ code, language, onChange, readOnly, documentKey });
  const revision = useRef(0),
    alive = useRef(false),
    busyRef = useRef(false),
    updating = useRef(false);
  if (
    latest.current.code !== code ||
    latest.current.language !== language ||
    latest.current.readOnly !== readOnly ||
    latest.current.documentKey !== documentKey
  )
    revision.current++;
  latest.current = { code, language, onChange, readOnly, documentKey };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null);
  const [capabilities, setCapabilities] =
    useState<ScriptToolCapabilities | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const lastAutomaticRevision = useRef(-1);
  const runAutomatic = useRef<() => void>(() => undefined);
  const [count, setCount] = useState(0),
    [cursor, setCursor] = useState({ line: 1, column: 1 });
  const bounded = withinScriptToolLimit(code);
  const capability = isWebScriptLanguage(language)
    ? null
    : capabilities?.[language];
  const applyDiagnostics = (diagnostics: Diagnostic[]) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, diagnostics));
    setCount(diagnostics.length);
  };
  useEffect(() => {
    const visibilityChanged = () => {
      revision.current++;
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
  }, []);
  useEffect(() => {
    if (!container.current) return;
    alive.current = true;
    const operations = revision;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: latest.current.code,
        extensions: [
          basicSetup,
          editorTheme,
          syntaxHighlighting(highlights),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          keymap.of([indentWithTab]),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
          }),
          languageConfig.current.of(
            languageExtensions(latest.current.language),
          ),
          accessConfig.current.of([
            EditorState.readOnly.of(latest.current.readOnly),
            EditorView.editable.of(!latest.current.readOnly),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !updating.current) {
              operations.current++;
              const value = update.state.doc.toString();
              latest.current.onChange(value);
              setStatus(null);
              setError(null);
            }
            const head = update.state.selection.main.head,
              line = update.state.doc.lineAt(head);
            setCursor({ line: line.number, column: head - line.from + 1 });
            setCount(diagnosticCount(update.state));
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      alive.current = false;
      operations.current++;
      viewRef.current = null;
      view.destroy();
    };
  }, [ariaLabel, documentKey]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === code) {
      if (!isWebScriptLanguage(language)) {
        view.dispatch(setDiagnostics(view.state, []));
        setCount(0);
      }
      return;
    }
    updating.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
      view.dispatch(setDiagnostics(view.state, []));
    } finally {
      updating.current = false;
    }
  }, [code, language]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        languageConfig.current.reconfigure(
          languageExtensions(language, visible && !readOnly),
        ),
        accessConfig.current.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      ],
    });
    view.dispatch(setDiagnostics(view.state, []));
    setCount(0);
    setStatus(null);
    setError(null);
  }, [language, readOnly, documentKey, visible]);
  const withView = (action: (view: EditorView) => boolean) => {
    if (viewRef.current) {
      action(viewRef.current);
      viewRef.current.focus();
    }
  };
  const discover = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const captured = revision.current;
    try {
      const result = await loadScriptToolCapabilities();
      if (alive.current && captured === revision.current) {
        setCapabilities(result);
        if (
          !isWebScriptLanguage(latest.current.language) &&
          result[latest.current.language].analysisAvailable
        )
          setAutoAnalyze(true);
        setStatus(
          "Local tools checked. Available automatic analysis is enabled; disable Analyze as I type to keep checks manual.",
        );
      }
    } catch (failure) {
      if (alive.current && captured === revision.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Local tools could not be checked.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const runTool = async (
    operation: "analyze" | "format",
    automatic = false,
  ) => {
    const view = viewRef.current;
    if (
      !view ||
      busyRef.current ||
      latest.current.readOnly ||
      document.visibilityState === "hidden" ||
      !withinScriptToolLimit(view.state.doc.toString())
    )
      return;
    const captured = revision.current,
      source = view.state.doc.toString(),
      selectedLanguage = latest.current.language;
    if (automatic) lastAutomaticRevision.current = captured;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    const current = () =>
      alive.current &&
      revision.current === captured &&
      viewRef.current === view &&
      !latest.current.readOnly &&
      latest.current.language === selectedLanguage;
    try {
      if (operation === "analyze") {
        const result = isWebScriptLanguage(selectedLanguage)
          ? {
              diagnostics: javaScriptSyntaxDiagnostics(
                source,
                selectedLanguage,
              ),
              tool: `${SCRIPT_EDITOR_LABELS[selectedLanguage]} syntax parser`,
            }
          : await analyzeInstalledScript(selectedLanguage, source).then(
              (result) => ({
                diagnostics: nativeScriptDiagnostics(
                  source,
                  result.diagnostics,
                  result.tool,
                ),
                tool: result.tool,
              }),
            );
        if (!current()) return;
        applyDiagnostics(result.diagnostics);
        setStatus(
          `${result.tool ?? "Analyzer"}: ${result.diagnostics.length} diagnostic(s). This does not execute the script or prove it is safe to run.`,
        );
        if (result.diagnostics.length && !automatic) openLintPanel(view);
      } else {
        const result = isWebScriptLanguage(selectedLanguage)
          ? {
              formatted: await formatJavaScript(source, selectedLanguage),
              tool: "Prettier",
            }
          : await formatInstalledScript(selectedLanguage, source);
        if (!current()) return;
        if (result.formatted !== source)
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: result.formatted,
            },
          });
        setStatus(
          `${result.tool ?? "Formatter"} updated the draft only. Review and save explicitly; Undo is available.`,
        );
      }
    } catch (failure) {
      if (current())
        setError(
          failure instanceof Error
            ? failure.message
            : "The static tool failed. The draft was not changed.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  runAutomatic.current = () => {
    void runTool("analyze", true);
  };
  useEffect(() => {
    if (
      !autoAnalyze ||
      !visible ||
      readOnly ||
      busy ||
      !bounded ||
      isWebScriptLanguage(language) ||
      !capability?.analysisAvailable ||
      lastAutomaticRevision.current === revision.current
    )
      return;
    const timer = setTimeout(() => runAutomatic.current(), 1000);
    return () => clearTimeout(timer);
  }, [
    autoAnalyze,
    visible,
    readOnly,
    busy,
    bounded,
    language,
    capability,
    code,
    documentKey,
  ]);
  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)]"
      data-testid="script-code-editor"
      data-language={language}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <span className="mr-auto px-1 text-xs font-medium">
          {SCRIPT_EDITOR_LABELS[language]}
          {readOnly ? " · Read only" : ""}
        </span>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={readOnly}
          onClick={() => withView(undo)}
          title="Undo (Ctrl/Cmd+Z)"
          aria-label="Undo code edit"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={readOnly}
          onClick={() => withView(redo)}
          title="Redo"
          aria-label="Redo code edit"
        >
          <Redo2 size={14} />
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          onClick={() => withView(openSearchPanel)}
          title="Find / replace (Ctrl/Cmd+F)"
        >
          <Search size={14} />
          Find
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={readOnly}
          onClick={() => withView(startCompletion)}
          title="Keyword and snippet suggestions (Ctrl+Space)"
        >
          <Braces size={14} />
          Suggest
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={readOnly}
          onClick={() => withView(toggleComment)}
          title="Toggle line comment (Ctrl/Cmd+/)"
        >
          Comment
        </button>
        {!isWebScriptLanguage(language) && (
          <button
            type="button"
            className="sor-btn-secondary-sm"
            onClick={() => void discover()}
            disabled={busy}
          >
            Check local tools
          </button>
        )}
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={
            readOnly ||
            busy ||
            !bounded ||
            (!isWebScriptLanguage(language) && !capability?.analysisAvailable)
          }
          onClick={() => void runTool("analyze")}
          title={capability?.analyzer ?? "JavaScript parser syntax diagnostics"}
        >
          <CheckCheck size={14} />
          {isWebScriptLanguage(language) ? "Syntax check" : "Analyze"}
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={
            readOnly ||
            busy ||
            !bounded ||
            (!isWebScriptLanguage(language) && !capability?.formatAvailable)
          }
          onClick={() => void runTool("format")}
          title={
            isWebScriptLanguage(language)
              ? "Format draft with local Prettier"
              : (capability?.formatter ?? "No installed formatter is available")
          }
        >
          <Wand2 size={14} />
          Format
        </button>
      </div>
      <div
        ref={container}
        style={{ height: Math.max(160, Math.min(800, minHeight)) }}
        className="min-w-0"
      />
      <div className="space-y-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-textMuted)]">
        {!isWebScriptLanguage(language) && capability?.analysisAvailable && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(event) => {
                lastAutomaticRevision.current = -1;
                setAutoAnalyze(event.target.checked);
              }}
            />
            Analyze as I type (local installed tool, after 1 second idle)
          </label>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <button type="button" onClick={() => withView(openLintPanel)}>
            {count} diagnostic(s)
          </button>
          <span>Ctrl+Space: suggestions · Esc then Tab: leave editor</span>
        </div>
        {!bounded ? (
          <p className="text-warning">
            Tooling is limited to 64 KiB. This larger draft is retained in full;
            no content was truncated.
          </p>
        ) : isWebScriptLanguage(language) ? (
          <p>
            Local {SCRIPT_EDITOR_LABELS[language]} syntax checking, snippets and
            local-variable completion; Prettier formatting. Not semantic type
            checking, full ESLint or a security audit.
          </p>
        ) : language === "batch" ? (
          <p>
            Batch lexical highlighting and command snippets. No formal Batch
            linter or formatter is bundled.
          </p>
        ) : (
          <p>
            Syntax highlighting and keyword/snippet completion. Analyze/Format
            use installed static tools only; no script execution.
          </p>
        )}
        {!isWebScriptLanguage(language) && (
          <p>
            {capability
              ? `${capability.analyzer ? `Analyzer: ${capability.analyzer}. ` : ""}${capability.formatter ? `Formatter: ${capability.formatter}. ` : ""}${capability.reason ?? ""}`
              : "Choose Check local tools to discover available analyzers and formatters. Nothing is installed automatically."}
          </p>
        )}
        {busy && (
          <p role="status">
            Waiting for static tooling… Edits made now will invalidate this
            result.
          </p>
        )}
        {status && <p role="status">{status}</p>}
        {error && (
          <p role="alert" className="break-words text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
