import React, { useEffect, useState } from "react";
import { AlertTriangle, Info, LoaderCircle } from "lucide-react";
import { tauriOriginBrowserTransport } from "../../../hooks/protocol/useOriginBrowser";
import type {
  OriginBrowserOwner,
  OriginBrowserUnavailableReason,
} from "../../../types/protocols/originBrowser";

/** Capability lookup needs no unlock token and must remain visible when owner
 * proof is unavailable. This never creates a host, profile or proxy session. */
export default function OriginBrowserCapabilityNotice({
  owner,
}: {
  owner: OriginBrowserOwner;
}) {
  const { ownerDatabaseId, connectionId, sessionId } = owner;
  const scope = JSON.stringify([ownerDatabaseId, connectionId, sessionId]);
  const [result, setResult] = useState<{
    scope: string;
    text: string;
    tone: "info" | "warning" | "error";
  } | null>(null);
  useEffect(() => {
    let current = true;
    if (
      ![ownerDatabaseId, connectionId, sessionId].every(
        (value) => value && value.length <= 256,
      )
    )
      return;
    void tauriOriginBrowserTransport
      .status({ owner: { ownerDatabaseId, connectionId, sessionId } })
      .then((status) => {
        if (!current) return;
        const reasons: Record<OriginBrowserUnavailableReason, string> = {
          "runtime-missing": "packaged runtime missing",
          "platform-unsupported": "platform unsupported",
          "containment-unverified": "network containment unverified",
          "policy-unavailable": "required policies unavailable",
          "owner-unavailable": "owner unavailable",
          "host-unavailable": "host unavailable",
        };
        setResult({
          scope,
          tone:
            status.capability.availability === "unavailable"
              ? "warning"
              : "info",
          text:
            status.capability.availability === "available"
              ? "Native runtime reports available; owner access is still required."
              : status.capability.availability === "deferred"
                ? "The native browser starts after access to this connection's owning database is authorized. Runtime policies are checked during startup."
                : `Experimental native browser unavailable: ${Object.prototype.hasOwnProperty.call(reasons, status.capability.reason) ? reasons[status.capability.reason] : "host unavailable"}.`,
        });
      })
      .catch(() => {
        if (current)
          setResult({
            scope,
            tone: "error",
            text: "Experimental native browser capability check failed.",
          });
      });
    return () => {
      current = false;
    };
  }, [ownerDatabaseId, connectionId, sessionId, scope]);
  const tone = result?.scope === scope ? result.tone : "info";
  const checking = result?.scope !== scope && !!ownerDatabaseId;
  return (
    <p
      role="status"
      className={`mx-3 my-2 flex items-start gap-2 text-xs leading-relaxed ${
        tone === "error"
          ? "sor-alert-error text-[var(--color-text)]"
          : tone === "warning"
            ? "sor-alert-warning text-[var(--color-text)]"
            : "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-textSecondary)]"
      }`}
      data-testid="origin-browser-capability"
    >
      {checking ? (
        <LoaderCircle
          size={16}
          aria-hidden="true"
          className="shrink-0 animate-spin motion-reduce:animate-none text-primary"
        />
      ) : tone === "info" ? (
        <Info size={16} aria-hidden="true" className="shrink-0 text-primary" />
      ) : (
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className={`shrink-0 ${tone === "error" ? "text-error" : "text-warning"}`}
        />
      )}
      <span>
        {result?.scope === scope
          ? result.text
          : ownerDatabaseId
            ? "Checking experimental native browser availability…"
            : "Native capability lookup requires a saved database owner."}
      </span>
    </p>
  );
}
