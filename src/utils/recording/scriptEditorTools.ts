import { getInvoke } from "../tauri/invoke";
import {
  MAX_SCRIPT_DIAGNOSTICS,
  MAX_SCRIPT_TOOL_BYTES,
  type ScriptEditorLanguage,
} from "../../components/ui/editor/scriptEditorTypes";

export interface ScriptToolCapability {
  analysisAvailable: boolean;
  formatAvailable: boolean;
  analyzer: string | null;
  formatter: string | null;
  reason: string | null;
}
export interface ScriptToolDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}
export type NativeScriptLanguage = Exclude<
  ScriptEditorLanguage,
  "javascript" | "typescript"
>;
export type ScriptToolCapabilities = Record<
  NativeScriptLanguage,
  ScriptToolCapability
>;
export const withinScriptToolLimit = (source: string) =>
  new TextEncoder().encode(source).length <= MAX_SCRIPT_TOOL_BYTES;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The local tool returned an invalid response.");
  return value as Record<string, unknown>;
};
const optionalText = (value: unknown, max = 4096): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max)
    throw new Error("The local tool returned invalid text.");
  return value;
};
const flag = (value: unknown) => {
  if (typeof value !== "boolean")
    throw new Error("The local tool returned an invalid capability.");
  return value;
};
export async function loadScriptToolCapabilities(): Promise<ScriptToolCapabilities> {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error(
      "Installed shell tooling is available only in the desktop app. JavaScript tools work locally in this editor.",
    );
  const raw = object(
    object(await invoke("script_tooling_capabilities")).languages,
  );
  const result = {} as ScriptToolCapabilities;
  for (const language of ["bash", "sh", "powershell", "batch"] as const) {
    const value = object(raw[language]);
    result[language] = {
      analysisAvailable: flag(value.analysisAvailable),
      formatAvailable: flag(value.formatAvailable),
      analyzer: optionalText(value.analyzer, 128),
      formatter: optionalText(value.formatter, 128),
      reason: optionalText(value.reason),
    };
  }
  return result;
}
export async function analyzeInstalledScript(
  language: NativeScriptLanguage,
  source: string,
) {
  if (!withinScriptToolLimit(source))
    throw new Error(
      "Static tooling is limited to 64 KiB. The draft has not been truncated.",
    );
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Local static tools require the desktop app.");
  const raw = object(
    await invoke("script_tooling_analyze", { language, source }),
  );
  if (!flag(raw.available))
    throw new Error(
      optionalText(raw.reason) ||
        "No installed analyzer is available for this language.",
    );
  const tool = optionalText(raw.tool, 128);
  if (
    !Array.isArray(raw.diagnostics) ||
    raw.diagnostics.length > MAX_SCRIPT_DIAGNOSTICS
  )
    throw new Error(
      "The local analyzer returned too many or invalid diagnostics.",
    );
  const diagnostics = raw.diagnostics.map((item): ScriptToolDiagnostic => {
    const value = object(item);
    for (const field of ["line", "column", "endLine", "endColumn"])
      if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 1)
        throw new Error(
          "The local analyzer returned an invalid diagnostic position.",
        );
    if (!["error", "warning", "info"].includes(value.severity as string))
      throw new Error(
        "The local analyzer returned an invalid diagnostic severity.",
      );
    return {
      line: value.line as number,
      column: value.column as number,
      endLine: value.endLine as number,
      endColumn: value.endColumn as number,
      severity: value.severity as ScriptToolDiagnostic["severity"],
      code: optionalText(value.code, 128) ?? "",
      message: optionalText(value.message) ?? "Diagnostic",
    };
  });
  return { tool, diagnostics };
}
export async function formatInstalledScript(
  language: NativeScriptLanguage,
  source: string,
): Promise<{ formatted: string; tool: string | null }> {
  if (!withinScriptToolLimit(source))
    throw new Error(
      "Static tooling is limited to 64 KiB. The draft has not been truncated.",
    );
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Local static tools require the desktop app.");
  const raw = object(
    await invoke("script_tooling_format", { language, source }),
  );
  if (!flag(raw.available))
    throw new Error(
      optionalText(raw.reason) ||
        "No installed formatter is available for this language.",
    );
  if (
    typeof raw.formatted !== "string" ||
    !withinScriptToolLimit(raw.formatted)
  )
    throw new Error(
      "The formatter returned invalid or oversized output; the draft was not changed.",
    );
  return { formatted: raw.formatted, tool: optionalText(raw.tool, 128) };
}
export async function formatJavaScript(
  source: string,
  language: "javascript" | "typescript" = "javascript",
): Promise<string> {
  if (!withinScriptToolLimit(source))
    throw new Error(
      "Formatting is limited to 64 KiB. The draft has not been truncated.",
    );
  const [prettier, babel, estree] = await Promise.all([
    import("prettier/standalone"),
    language === "typescript"
      ? import("prettier/plugins/typescript")
      : import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ]);
  const formatted = await prettier.format(source, {
    parser: language === "typescript" ? "typescript" : "babel",
    plugins: [babel, estree],
    tabWidth: 2,
    embeddedLanguageFormatting: "off",
  });
  if (!withinScriptToolLimit(formatted))
    throw new Error(
      "Formatted output exceeds 64 KiB; the draft was not changed.",
    );
  return formatted;
}
