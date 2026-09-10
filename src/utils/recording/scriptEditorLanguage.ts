import {
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from "@codemirror/language";
import {
  javascript,
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import {
  completeFromList,
  snippetCompletion,
  type Completion,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import { Text, type Extension } from "@codemirror/state";
import {
  MAX_SCRIPT_DIAGNOSTICS,
  isWebScriptLanguage,
  type ScriptEditorLanguage,
} from "../../components/ui/editor/scriptEditorTypes";
import {
  withinScriptToolLimit,
  type ScriptToolDiagnostic,
} from "./scriptEditorTools";

// Lexical highlighting only. This is intentionally not a Batch parser/linter.
export const batchKeywords = new Set(
  "if else for do in goto call exit echo set setlocal endlocal pushd popd rem pause cls copy move del mkdir rmdir cd dir type find findstr sort more errorlevel exist not defined equ neq lss leq gtr geq off on".split(
    " ",
  ),
);
export const batchSyntax: StreamParser<{ quoted: boolean }> = {
  startState: () => ({ quoted: false }),
  token(stream: StringStream, state) {
    if (stream.sol()) {
      state.quoted = false;
      if (stream.match(/\s*(?:@?rem\b|::).*/i)) return "comment";
      if (stream.match(/\s*:[\w.-]+/)) return "labelName";
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/%(?:[^%\s]+%|%?[a-z0-9*])/i) || stream.match(/![^!\s]+!/))
      return "variableName";
    if (stream.peek() === '"') {
      state.quoted = !state.quoted;
      stream.next();
      return "string";
    }
    if (state.quoted) {
      const start = stream.pos;
      while (!stream.eol() && !['"', "%", "!"].includes(stream.peek() ?? ""))
        stream.next();
      if (stream.pos === start) stream.next();
      return "string";
    }
    if (stream.match(/\^[\s\S]/)) return "escape";
    if (stream.match(/[&|<>()[\]=@]+/)) return "operator";
    if (stream.match(/\d+/)) return "number";
    if (stream.match(/[a-z_][\w.-]*/i))
      return batchKeywords.has(stream.current().toLowerCase())
        ? "keyword"
        : null;
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "rem " } },
};
const unix = [
  "echo",
  "printf",
  "read",
  "cd",
  "pwd",
  "test",
  "export",
  "unset",
  "exit",
  "return",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "do",
  "done",
  "case",
  "esac",
];
const powershell = [
  "Get-ChildItem",
  "Get-Content",
  "Write-Output",
  "Write-Host",
  "ForEach-Object",
  "Where-Object",
  "Select-Object",
  "Get-Help",
  "param",
  "function",
  "if",
  "else",
  "foreach",
  "try",
  "catch",
  "finally",
  "return",
];
export function scriptCompletions(
  language: ScriptEditorLanguage,
): Completion[] {
  if (isWebScriptLanguage(language)) return [];
  const words =
    language === "batch"
      ? [...batchKeywords]
      : language === "powershell"
        ? powershell
        : language === "bash"
          ? [...unix, "function", "local", "declare", "source"]
          : unix;
  const result: Completion[] = words.map((label) => ({
    label,
    type: "keyword",
  }));
  const templates =
    language === "batch"
      ? [
          ["if-exist", 'if exist "${path}" (\n\t${echo Found}\n)'],
          ["for-files", "for %%f in (${*.txt}) do (\n\t${echo %%f}\n)"],
        ]
      : language === "powershell"
        ? [
            [
              "foreach-loop",
              "foreach ($${item} in $${items}) {\n\t${Write-Output $item}\n}",
            ],
            [
              "try-catch",
              "try {\n\t${Write-Output 'Ready'}\n} catch {\n\tWrite-Error $_\n}",
            ],
          ]
        : [
            [
              "if-then",
              "if ${test -f file}; then\n\t${printf '%s\\n' 'Found'}\nfi",
            ],
            [
              "for-loop",
              "for ${item} in ${*}; do\n\tprintf '%s\\n' \"$${item}\"\ndone",
            ],
          ];
  for (const [label, template] of templates)
    result.push(
      snippetCompletion(template, {
        label,
        detail: "snippet",
        type: "keyword",
      }),
    );
  return result;
}
export function scriptLanguageExtension(
  language: ScriptEditorLanguage,
): Extension {
  if (isWebScriptLanguage(language))
    return javascript({ typescript: language === "typescript" });
  const mode = StreamLanguage.define(
    language === "powershell"
      ? powerShell
      : language === "batch"
        ? batchSyntax
        : shell,
  );
  return [
    mode,
    mode.data.of({
      autocomplete: completeFromList(scriptCompletions(language)),
    }),
  ];
}
/** Actual Lezer grammar recovery nodes, not heuristic regex lint. */
export function javaScriptSyntaxDiagnostics(
  source: string,
  language: "javascript" | "typescript" = "javascript",
): Diagnostic[] {
  if (!withinScriptToolLimit(source)) return [];
  const diagnostics: Diagnostic[] = [];
  const label = language === "typescript" ? "TypeScript" : "JavaScript";
  (language === "typescript" ? typescriptLanguage : javascriptLanguage).parser
    .parse(source)
    .iterate({
      enter(node) {
        if (diagnostics.length >= MAX_SCRIPT_DIAGNOSTICS) return false;
        if (node.type.isError)
          diagnostics.push({
            from: node.from,
            to: Math.min(source.length, Math.max(node.to, node.from + 1)),
            severity: "error",
            source: `${label} syntax`,
            message: `${label} syntax error near this position.`,
          });
      },
    });
  return diagnostics;
}
/** Native positions are explicitly 1-based UTF-16, just like CM offsets. */
export function nativeScriptDiagnostics(
  source: string,
  diagnostics: ScriptToolDiagnostic[],
  tool: string | null,
): Diagnostic[] {
  const doc = Text.of(source.split("\n"));
  const offset = (line: number, column: number) => {
    if (line > doc.lines) return doc.length;
    const current = doc.line(line);
    return current.from + Math.min(current.length, column - 1);
  };
  return diagnostics.slice(0, MAX_SCRIPT_DIAGNOSTICS).map((item) => {
    const from = offset(item.line, item.column),
      to = offset(item.endLine, item.endColumn);
    return {
      from,
      to: Math.max(from, to),
      severity: item.severity,
      source: tool ?? "Local static tool",
      message: `${item.code ? `${item.code}: ` : ""}${item.message}`,
    };
  });
}
