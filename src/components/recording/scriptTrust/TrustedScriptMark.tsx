import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { ScriptTrustScope } from "../../../utils/recording/scriptRunTrust";

/**
 * "Trusted", shown beside a script or macro that would run now without being
 * asked. It is a hint before the click: the run itself still consults the
 * record. The revoke button is a sibling of the row's own button, never its
 * child, and the click on it never reaches the row.
 */

export interface TrustedScriptMarkProps {
  scope: ScriptTrustScope;
  /** The script's or macro's name, for the accessible names. */
  name: string;
  /** Without it the mark has no revoke button. */
  onRevoke?: () => unknown;
  className?: string;
}

const trustedScriptMarkLabel = (scope: ScriptTrustScope): string =>
  scope === "connection" ? "trusted on this connection" : "trusted everywhere";

export const TrustedScriptMark: React.FC<TrustedScriptMarkProps> = ({
  scope,
  name,
  onRevoke,
  className,
}) => {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const revoke = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      if (!onRevoke || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await onRevoke();
      } catch {
        // The caller reports a failed revoke; the mark stays as it is.
      } finally {
        busyRef.current = false;
        if (live.current) setBusy(false);
      }
    },
    [onRevoke],
  );

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-[var(--color-textSecondary)] ${className ?? ""}`}
    >
      <span
        data-testid="trusted-script-mark"
        role="img"
        aria-label={`${name}: ${trustedScriptMarkLabel(scope)}`}
        title={
          scope === "connection"
            ? "Trusted on this connection: runs without asking"
            : "Trusted everywhere: runs without asking"
        }
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-[var(--color-border)]"
      >
        <ShieldCheck size={12} aria-hidden="true" />
        <span aria-hidden="true">Trusted</span>
      </span>
      {onRevoke && (
        <button
          type="button"
          data-testid="trusted-script-mark-revoke"
          aria-label={`Revoke trust for ${name}`}
          aria-disabled={busy || undefined}
          title="Revoke: ask again before it runs"
          onClick={revoke}
          onKeyDown={(event) => event.stopPropagation()}
          className="sor-btn-secondary-sm inline-flex items-center gap-1"
        >
          <X size={12} aria-hidden="true" />
          <span aria-hidden="true">Revoke</span>
        </button>
      )}
    </span>
  );
};

export default TrustedScriptMark;
