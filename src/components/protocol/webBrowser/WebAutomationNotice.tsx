import { useState } from "react";
import type { WebBrowserMgr } from "../../../hooks/protocol/useWebBrowser";

/** Read-only error presentation; retry never unlocks storage or replays an action. */
export default function WebAutomationNotice({
  automation,
}: {
  automation: Pick<WebBrowserMgr["automation"], "error" | "busy" | "reload">;
}) {
  const [reloading, setReloading] = useState(false);
  if (!automation.error) return null;
  return (
    <section
      aria-label="Website automation issue"
      className="border-b border-[var(--color-border)] px-3 py-3 text-xs"
    >
      <h3 className="font-medium text-warning">
        Website automation needs attention
      </h3>
      <p
        role="alert"
        className="mt-2 break-words text-[var(--color-textSecondary)]"
      >
        {automation.error}
      </p>
      <button
        type="button"
        className="sor-btn-secondary mt-2"
        disabled={reloading || automation.busy}
        onClick={async () => {
          setReloading(true);
          try {
            await automation.reload();
          } finally {
            setReloading(false);
          }
        }}
      >
        {reloading ? "Reloading…" : "Reload library"}
      </button>
    </section>
  );
}
