export type ScriptEditorLanguage =
  "bash" | "sh" | "powershell" | "batch" | "javascript";
export interface ScriptCodeEditorProps {
  code: string;
  language: ScriptEditorLanguage;
  onChange: (code: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  minHeight?: number;
  /** Distinguishes identical text belonging to different library drafts. */
  documentKey?: string;
}
export const MAX_SCRIPT_TOOL_BYTES = 64 * 1024;
export const MAX_SCRIPT_DIAGNOSTICS = 200;
export const SCRIPT_EDITOR_LABELS: Record<ScriptEditorLanguage, string> = {
  bash: "Bash",
  sh: "POSIX shell",
  powershell: "PowerShell",
  batch: "Batch (cmd)",
  javascript: "JavaScript",
};
