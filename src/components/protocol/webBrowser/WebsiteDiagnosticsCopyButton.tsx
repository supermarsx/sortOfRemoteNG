import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, TriangleAlert } from "lucide-react";

export interface WebsiteDiagnosticsCopyButtonProps {
  /** Already-sanitized diagnostic summary. Never pass raw URLs, headers or bodies. */
  text: string;
  disabled?: boolean;
  /** Renders a labelled button instead of the compact icon-only control. */
  label?: string;
  /** Button classes for the labelled variant, so it can match its action bar. */
  className?: string;
}

/** Clipboard access follows the app's user-initiated navigator.clipboard convention. */
export function WebsiteDiagnosticsCopyButton({
  text,
  disabled = false,
  label,
  className,
}: WebsiteDiagnosticsCopyButtonProps) {
  const [feedback, setFeedback] = useState<{
    source: string;
    result: "copied" | "failed";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const currentText = useRef(text);
  currentText.current = text;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const result = feedback?.source === text ? feedback.result : null;
  const message =
    result === "copied"
      ? "Diagnostics copied."
      : result === "failed"
        ? "Could not copy diagnostics. Check clipboard permission and try again."
        : "";
  const Icon = busy
    ? Loader2
    : result === "copied"
      ? Check
      : result === "failed"
        ? TriangleAlert
        : Copy;

  const copy = async () => {
    if (disabled || !text.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    const suppliedText = text;
    try {
      await navigator.clipboard.writeText(suppliedText);
      if (mounted.current && currentText.current === suppliedText)
        setFeedback({ source: suppliedText, result: "copied" });
    } catch {
      // Clipboard failures may contain platform details; do not display or log them.
      if (mounted.current && currentText.current === suppliedText)
        setFeedback({ source: suppliedText, result: "failed" });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Copy diagnostics"
        aria-busy={busy}
        data-tooltip={message || "Copy diagnostics"}
        title={message || "Copy diagnostics"}
        disabled={disabled || busy || !text.trim()}
        className={label ? className : "sor-icon-btn-sm"}
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
      >
        <Icon
          size={label ? 15 : 14}
          aria-hidden="true"
          className={busy ? "animate-spin" : undefined}
        />
        {label}
      </button>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </span>
    </span>
  );
}
