import React from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import type { WebNetworkReport } from "../../../utils/protocol/webNetworkReport";
import type { WebNetworkGuardStatus } from "../../../utils/protocol/webNetworkGuard";

export default function WebNetworkNotice({
  reports,
  guard,
  onReload,
}: {
  reports: readonly WebNetworkReport[];
  guard: WebNetworkGuardStatus | null;
  onReload: () => void;
}) {
  if (!reports.length && !guard) return null;
  const expired = reports.some((report) =>
    ["document-expired", "document-activation-failed"].includes(report.reason),
  );
  return (
    <section
      aria-label="Website network restrictions"
      className="shrink-0 border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert
          size={15}
          className="shrink-0 text-warning"
          aria-hidden="true"
        />
        <span className="font-medium">
          {expired
            ? "This page needs to be reloaded"
            : reports.length
              ? "Some website requests were blocked"
              : "Website proxy routing · partial browser enforcement"}
        </span>
        {expired && (
          <button
            type="button"
            className="sor-btn-secondary ml-auto inline-flex items-center gap-1"
            onClick={onReload}
          >
            <RefreshCw size={12} aria-hidden="true" />
            Reload page
          </button>
        )}
      </div>
      <details className="mt-1 text-[var(--color-textSecondary)]">
        <summary className="cursor-pointer">
          {reports.length
            ? `Review ${reports.length} network restriction${reports.length === 1 ? "" : "s"}`
            : "Protection details"}
        </summary>
        {guard && (
          <p className="mt-2">
            {guard.frameNavigation === "enforced"
              ? "Native frame navigation protection is active."
              : guard.frameNavigation === "unsupported"
                ? "Native frame navigation protection is not available on this platform."
                : "Native frame navigation protection is not ready."}{" "}
            Browser-wide network interception is not yet enforced.
          </p>
        )}
        <p className="mt-2">
          Other destinations are not yet approved or routed through this
          session. Workers, WebRTC and WebTransport are unsupported here. The
          page may be incomplete; no destination is approved by this notice.
        </p>
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
          {reports.map((report) => (
            <li
              key={`${report.kind}:${report.reason}:${report.origin}`}
              className="break-all"
            >
              <span className="font-medium">
                {report.origin ?? "This page"}
              </span>
              {" — "}
              {report.reason === "origin-not-approved"
                ? "Destination not yet approved/routed"
                : report.reason === "document-expired"
                  ? "Reload to establish a fresh session document"
                  : report.reason === "unsupported-network-context"
                    ? `Unsupported ${report.kind} request`
                    : report.reason === "request-body-too-large"
                      ? "Retargeted Request uploads are limited to 16 MiB; nothing was sent"
                      : "Request cannot use this session's routing policy"}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Only destination origins are shown. This notice is not proof that
          every browser network channel is intercepted.
        </p>
      </details>
    </section>
  );
}
