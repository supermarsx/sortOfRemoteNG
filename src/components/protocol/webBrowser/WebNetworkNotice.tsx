import React, { useEffect, useState } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import type {
  WebNetworkReport,
  WebNetworkRoutingStatus,
} from "../../../utils/protocol/webNetworkReport";
import type { WebNetworkGuardStatus } from "../../../utils/protocol/webNetworkGuard";
import NativeHttpObservations from "./NativeHttpObservations";

export default function WebNetworkNotice({
  reports,
  guard,
  routing,
  proxyOrigin,
  onReload,
}: {
  reports: readonly WebNetworkReport[];
  guard: WebNetworkGuardStatus | null;
  routing?: WebNetworkRoutingStatus | null;
  proxyOrigin?: string;
  onReload: () => void;
}) {
  const [disclosure, setDisclosure] = useState({
    source: proxyOrigin,
    open: false,
  });
  const detailsOpen = disclosure.source === proxyOrigin && disclosure.open;
  useEffect(() => {
    setDisclosure({ source: proxyOrigin, open: false });
  }, [proxyOrigin]);
  if (!reports.length && !guard && !routing) return null;
  const expired = reports.some((report) =>
    ["document-expired", "document-activation-failed"].includes(report.reason),
  );
  const attention =
    reports.length > 0 ||
    routing?.status === "missing" ||
    routing?.status === "mismatch" ||
    (guard && !["enforced", "unsupported"].includes(guard.frameNavigation));
  return (
    <section
      aria-label="Website network restrictions"
      className={`shrink-0 border-b px-3 py-1.5 text-xs ${attention ? "border-warning/30 bg-warning/5" : "border-[var(--color-border)] text-[var(--color-textSecondary)]"}`}
    >
      <details
        key={proxyOrigin}
        open={detailsOpen}
        onToggle={(event) =>
          setDisclosure({ source: proxyOrigin, open: event.currentTarget.open })
        }
      >
        <summary className="cursor-pointer">
          <ShieldAlert
            size={15}
            className={`mx-1 inline-block align-text-bottom ${attention ? "text-warning" : ""}`}
            aria-hidden="true"
          />
          <span className="font-medium">
            {expired
              ? "This page needs to be reloaded"
              : routing?.status === "missing"
                ? "Page routing module is not confirmed"
                : routing?.status === "mismatch"
                  ? "Page routing settings do not match this connection"
                  : reports.length
                    ? "Some website requests were blocked"
                    : "Website proxy routing · partial browser enforcement"}
          </span>
          <span className="ml-2 text-[var(--color-textMuted)]">
            {reports.length
              ? `Review ${reports.length} network restriction${reports.length === 1 ? "" : "s"}`
              : "Protection details"}
          </span>
        </summary>
        <div className="max-h-56 overflow-y-auto pr-1">
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
          {routing && (
            <p className="mt-2" data-testid="web-network-routing-status">
              {routing.status === "missing"
                ? "This page did not report the current routing module. It may come from an older desktop process. Restart the desktop application and reopen the website tab; refreshing the application UI alone does not update native proxy code."
                : routing.status === "mismatch"
                  ? "The page's routing capabilities differ from the current connection settings. Reopen this website from its saved connection after checking its default destinations and database access."
                  : `Page routing module v4 reported. QuickConnect navigation: ${routing.quickConnectNavigation ? "available" : "off or unavailable for this source"}; discovery: ${routing.quickConnectDiscovery ? "available" : "off or unavailable for this source"}; same-NAS probe routes: ${routing.quickConnectDiscovered ? "available; native request validation still required" : "off or unavailable for this source"}; direct navigation: ${routing.quickConnectDirectNavigation ? "available" : "off or unavailable for this source"}; regional navigation: ${routing.quickConnectRegionalNavigation ? "available" : "off or unavailable for this source"}.`}{" "}
              This is a page-module diagnostic, not proof that every request is
              captured.
            </p>
          )}
          <p className="mt-2">
            Redirect approval is separate from background-request routing. A
            permitted destination can still have requests without a supported
            proxy route. Workers, WebRTC and WebTransport are unsupported here.
            The page may be incomplete; no destination is approved by this
            notice.
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
                {report.kind === "font"
                  ? "Font request blocked; only explicitly routed font assets can load"
                  : report.reason === "origin-not-approved"
                    ? `No route for this request (${report.kind})`
                    : report.reason === "quickconnect-control-method"
                      ? "Only bounded QuickConnect control POSTs for discovery or relay setup can use this route"
                      : report.reason === "quickconnect-probe-method"
                        ? "Only the exact same-NAS discovery GET can use this probe route"
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
          {reports.length > 0 && (
            <p className="mt-2">
              A console SecurityError alone does not identify the blocked
              request. Match it to these reports; unrelated page errors are not
              suppressed.
            </p>
          )}
          <NativeHttpObservations
            proxyOrigin={proxyOrigin}
            active={detailsOpen && guard?.platform === "windows"}
          />
        </div>
      </details>
      {expired && (
        <button
          type="button"
          className="sor-btn-secondary mt-1 inline-flex items-center gap-1"
          onClick={onReload}
        >
          <RefreshCw size={12} aria-hidden="true" />
          Reload page
        </button>
      )}
    </section>
  );
}
