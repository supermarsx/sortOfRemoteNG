import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import type { ProxyRequestLogEntry } from "../../hooks/network/useInternalProxyManager";
import { proxyLogClipboard } from "../../utils/network/proxyLogClipboard";

export function CopyLatestProxyLogButton({
  entries,
}: {
  entries: readonly ProxyRequestLogEntry[];
}) {
  const mounted = useRef(false);
  const pending = useRef(false);
  const logLifetime = useRef({ empty: entries.length === 0, epoch: 0 });
  if (entries.length === 0 && !logLifetime.current.empty)
    logLifetime.current.epoch += 1;
  logLifetime.current.empty = entries.length === 0;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    epoch: number;
    message: string;
    success: boolean;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const result =
    feedback?.epoch === logLifetime.current.epoch ? feedback : null;
  const copy = async () => {
    if (pending.current || entries.length === 0) return;
    const source = entries;
    const epoch = logLifetime.current.epoch;
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const snapshot = proxyLogClipboard(source);
      await navigator.clipboard.writeText(snapshot.text);
      if (mounted.current && logLifetime.current.epoch === epoch)
        setFeedback({
          epoch,
          success: true,
          message: `Copied ${snapshot.count} proxy log entries (oldest to newest).`,
        });
    } catch {
      if (mounted.current && logLifetime.current.epoch === epoch)
        setFeedback({
          epoch,
          success: false,
          message:
            "Could not copy proxy log. Check clipboard permission and try again.",
        });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const Icon = busy ? Loader2 : result?.success ? Check : Copy;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="sor-option-chip text-xs"
        disabled={entries.length === 0 || busy}
        aria-busy={busy}
        title="Copy up to 1,000 latest retained entries across all pages, oldest to newest. Paths, queries and sensitive details are omitted."
        onClick={() => void copy()}
      >
        <Icon
          size={12}
          aria-hidden="true"
          className={busy ? "animate-spin" : undefined}
        />
        <span>Copy latest 1,000</span>
      </button>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`text-xs ${result && !result.success ? "text-error" : "text-[var(--color-textMuted)]"}`}
      >
        {result?.message}
      </span>
    </div>
  );
}
