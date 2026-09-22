import React, { useEffect, useState } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import type {
  WebNetworkReport,
  WebNetworkRoutingStatus,
} from "../../../utils/protocol/webNetworkReport";
import type { WebNetworkGuardStatus } from "../../../utils/protocol/webNetworkGuard";
import NativeHttpObservations from "./NativeHttpObservations";
import { WebsiteDiagnosticsCopyButton } from "./WebsiteDiagnosticsCopyButton";
import { websiteDiagnosticsText } from "../../../utils/protocol/websiteDiagnosticsText";

export default function WebNetworkNotice({
  reports,
  guard,
  routing,
  proxyOrigin,
  quickConnectRelevant = false,
  onReload,
}: {
  reports: readonly WebNetworkReport[];
  guard: WebNetworkGuardStatus | null;
  routing?: WebNetworkRoutingStatus | null;
  proxyOrigin?: string;
  quickConnectRelevant?: boolean;
  onReload: () => void;
}) {
  const [disclosure, setDisclosure] = useState({
    source: proxyOrigin,
    open: false,
  });
  const detailsOpen = disclosure.source === proxyOrigin && disclosure.open;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setDisclosure({ source: proxyOrigin, open: false });
    setAdvancedOpen(false);
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
  const pageMediationActive =
    routing?.status === "current" && routing.pageNetworkInterception;
  const nativeHttpGuardActive =
    guard?.platform === "windows" && guard.allNetworkRequestsMediated;
  return (
    <section
      aria-label="Website network restrictions"
      className="space-y-3 text-xs text-[var(--color-textSecondary)]"
    >
      <h3 className="flex items-center gap-2 font-medium text-[var(--color-text)]">
        <ShieldAlert
          size={14}
          aria-hidden="true"
          className="text-[var(--color-textMuted)]"
        />
        Proxy routing
        <span className="ml-auto font-normal text-[var(--color-textMuted)]">
          {pageMediationActive
            ? "Cross-platform page mediation"
            : "Page mediation unconfirmed"}
        </span>
        <WebsiteDiagnosticsCopyButton
          text={websiteDiagnosticsText(
            reports,
            guard,
            routing,
            quickConnectRelevant,
          )}
        />
      </h3>
      <p>
        {pageMediationActive
          ? "Portable page routing hooks are active. Strict response policy and the protected proxy independently deny direct HTTP(S) fallback."
          : "Page request mediation is not confirmed for this document."}
      </p>
      {attention && (
        <p className="rounded bg-[var(--color-background)] p-3 font-medium text-warning">
          {expired
            ? "This page needs to be reloaded"
            : routing?.status === "missing"
              ? "Page routing module is not confirmed"
              : routing?.status === "mismatch"
                ? "Page routing settings do not match this connection"
                : reports.length
                  ? "Some website requests were blocked"
                  : "Native frame navigation protection is not ready."}
        </p>
      )}
      <details
        key={proxyOrigin}
        open={detailsOpen}
        onToggle={(event) => {
          setDisclosure({
            source: proxyOrigin,
            open: event.currentTarget.open,
          });
          if (!event.currentTarget.open) setAdvancedOpen(false);
        }}
      >
        <summary className="cursor-pointer text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]">
          Protection details
        </summary>
        <div className="mt-3 space-y-3">
          {guard && (
            <p className="mt-2">
              {guard.frameNavigation === "enforced"
                ? "Native frame navigation protection is active."
                : guard.frameNavigation === "unsupported"
                  ? "Native frame navigation protection is not available on this platform."
                  : "Native frame navigation protection is not ready."}{" "}
              {guard.platform === "windows"
                ? nativeHttpGuardActive
                  ? "The Windows native HTTP(S) guard is active."
                  : "The Windows native HTTP(S) guard is not active."
                : "A Windows native HTTP(S) guard is not available on this platform."}
            </p>
          )}
          {routing && (
            <div className="space-y-2" data-testid="web-network-routing-status">
              {routing.status === "missing" ? (
                "This page did not report the current routing module. It may come from an older desktop process. Restart the desktop application and reopen the website tab; refreshing the application UI alone does not update native proxy code."
              ) : routing.status === "mismatch" ? (
                "The page's routing capabilities differ from the current connection settings. Reopen this website from its saved connection after checking its default destinations and database access."
              ) : (
                <>
                  <p className="text-[var(--color-textMuted)]">
                    Page routing module v6 reported
                  </p>
                  <dl className="rounded bg-[var(--color-background)] p-3 space-y-2">
                    {(
                      [
                        ["Fetch interception", routing.fetchInterception],
                        ["XHR interception", routing.xhrInterception],
                        [
                          "Page request mediation",
                          routing.pageNetworkInterception,
                        ],
                      ] as const
                    ).map(([label, active]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-3"
                      >
                        <dt>{label}</dt>
                        <dd className="shrink-0 text-[var(--color-textMuted)]">
                          {active ? "Active" : "Not active"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {quickConnectRelevant && (
                    <dl className="rounded bg-[var(--color-background)] p-3 space-y-2">
                      {(
                        [
                          [
                            "QuickConnect navigation",
                            routing.quickConnectNavigation,
                          ],
                          ["Discovery", routing.quickConnectDiscovery],
                          [
                            "Same-NAS probe routes",
                            routing.quickConnectDiscovered,
                          ],
                          [
                            "Direct navigation",
                            routing.quickConnectDirectNavigation,
                          ],
                          [
                            "Regional navigation",
                            routing.quickConnectRegionalNavigation,
                          ],
                        ] as const
                      ).map(([label, available]) => (
                        <div
                          key={label}
                          className="flex items-start justify-between gap-3"
                        >
                          <dt>{label}</dt>
                          <dd className="shrink-0 text-[var(--color-textMuted)]">
                            {available ? "Available" : "Off"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {quickConnectRelevant && (
                    <p className="text-[var(--color-textMuted)]">
                      Off means off or unavailable for this source. Available
                      routes still require native request validation.
                    </p>
                  )}
                </>
              )}
              <p className="text-[var(--color-textMuted)]">
                Tactical RMM API route:{" "}
                {routing.status === "missing"
                  ? routing.tacticalRmmApiExpected
                    ? "Expected; page module not reported"
                    : "Not reported"
                  : routing.status === "current" &&
                      routing.tacticalRmmApi === routing.tacticalRmmApiExpected
                    ? routing.tacticalRmmApi
                      ? "Available"
                      : "Off"
                    : routing.tacticalRmmApiExpected
                      ? "Expected, unavailable"
                      : "Unexpectedly available"}
              </p>
              {routing.tacticalRmmApiOrigins.length > 0 && (
                <p className="text-[var(--color-textMuted)] break-words">
                  Tactical RMM API origins:{" "}
                  {routing.tacticalRmmApiOrigins.join(", ")}
                </p>
              )}
              {routing.googleSession && (
                <p className="text-[var(--color-textMuted)]">
                  Google session routing:{" "}
                  {routing.googleSession.status === "ready"
                    ? "Available for the exact session destinations"
                    : "Incomplete or unavailable"}
                  . HTTP cookies stay in the native session and the WebView
                  User-Agent is passed through unchanged. Browser-visible
                  cookies are synchronized with the native, domain-scoped
                  session without exposing HttpOnly values. This does not
                  confirm successful sign-in; Google may reject embedded
                  browsers.
                </p>
              )}
              <p className="text-[var(--color-textMuted)]">
                This advisory receipt does not approve destinations. Strict CSP
                and native proxy validation apply independently.
              </p>
            </div>
          )}
          <p className="mt-2">
            Redirect approval is separate from background-request routing. A
            permitted destination can still have requests without a supported
            proxy route. Workers, WebRTC and WebTransport are disabled or fail
            closed. No destination is approved by this notice.
          </p>
          <ul className="space-y-2">
            {reports.map((report) => (
              <li
                key={`${report.kind}:${report.reason}:${report.origin}`}
                className="rounded bg-[var(--color-background)] p-3 break-words"
              >
                <span className="block break-all font-mono text-[var(--color-textMuted)]">
                  {report.origin ?? "This page"}
                </span>
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
            every browser or native network channel is intercepted.
          </p>
          {reports.length > 0 && (
            <p className="mt-2">
              A console SecurityError alone does not identify the blocked
              request. Match it to these reports; unrelated page errors are not
              suppressed.
            </p>
          )}
          {guard?.platform === "windows" && (
            <details
              open={detailsOpen && advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]">
                Advanced diagnostics
              </summary>
              <NativeHttpObservations
                proxyOrigin={proxyOrigin}
                active={detailsOpen && advancedOpen}
                contained={false}
              />
            </details>
          )}
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
