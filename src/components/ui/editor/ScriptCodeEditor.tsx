"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { ScriptCodeEditorProps } from "./scriptEditorTypes";
export type {
  ScriptCodeEditorProps,
  ScriptEditorLanguage,
} from "./scriptEditorTypes";

/** The application shell imports only this small loader, never editor engines. */
export default function ScriptCodeEditor(props: ScriptCodeEditorProps) {
  const [Surface, setSurface] =
    useState<ComponentType<ScriptCodeEditorProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void import("./ScriptCodeEditorSurface")
      .then((module) => {
        if (current) setSurface(() => module.default);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);
  if (Surface) return <Surface {...props} />;
  return (
    <div className="space-y-2">
      <textarea
        aria-label={props.ariaLabel ?? "Script code"}
        value={props.code}
        onChange={(event) => props.onChange(event.target.value)}
        readOnly={props.readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-sm"
        style={{ minHeight: props.minHeight ?? 280 }}
      />
      <p className="text-xs text-[var(--color-textMuted)]" role="status">
        {failed
          ? "Code editor could not load. Plain-text editing is still available; no code was changed."
          : "Loading code editor…"}
      </p>
    </div>
  );
}
