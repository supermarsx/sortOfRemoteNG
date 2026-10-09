"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Bug, Copy, Info, Microscope, ShieldAlert } from "lucide-react";
import { APP_VERSION } from "../../../generated/version";
import type { OriginBrowserState } from "../../../hooks/protocol/useOriginBrowser";
import { nativeProxyConnectionFailure } from "../../../hooks/protocol/originBrowserSessionError";
import {
  getOriginBrowserFailureDetails,
  type BrowserRecoveryAction,
} from "../../../hooks/protocol/originBrowserFailureDetails";
import {
  useOriginBrowserDiagnostics,
  type OriginBrowserDiagnosticOutcome,
} from "../../../hooks/protocol/useOriginBrowserDiagnostics";
import {
  originBrowserFailureReason,
  originBrowserLoadFailure,
  originBrowserRuntimeFailure,
  type OriginBrowserLoadFailure,
} from "../../../types/protocols/originBrowser";

export interface OriginBrowserFailureDiagnosticsProps {
  state: OriginBrowserState;
  /** Only the HTTP(S) origin is displayed or copied; paths can contain tokens. */
  targetUrl: string;
  active: boolean;
  ownerAvailable: boolean;
  /** Recheck the live owner before actions that require database access. */
  assertOwner: () => void;
  onOpenDevTools?: () => Promise<boolean>;
  /** The shell opens the appropriate editor without changing saved settings. */
  onRecover?: (action: BrowserRecoveryAction) => void;
  recoveryAllowed?: boolean;
}

interface Presentation {
  title: string;
  guidance: readonly string[];
  stage?: "DNS" | "TCP" | "TLS" | "HTTP";
}

const loadPresentations: Record<
  OriginBrowserLoadFailure["category"],
  Presentation
> = {
  dns: {
    title: "The website name could not be resolved",
    stage: "DNS",
    guidance: [
      "Check the saved hostname and the DNS service used by the configured route.",
      "For an internal hostname, confirm the required VPN or proxy can resolve it.",
      "Retry after the network route is available. No direct route is substituted.",
    ],
  },
  connection: {
    title: "The connection could not be completed",
    stage: "TCP",
    guidance: [
      "Confirm the device and its web service are running on the saved port.",
      "Check firewall rules and every configured proxy or tunnel hop.",
      "A refused or reset connection does not establish a saved-password failure.",
    ],
  },
  timeout: {
    title: "The website request timed out",
    guidance: [
      "Check the service and the configured route for unavailable or slow hops.",
      "A firewall may be dropping traffic without returning an error.",
      "The load code alone does not identify which network stage timed out.",
    ],
  },
  "network-changed": {
    title: "The network changed during navigation",
    guidance: [
      "Wait for the network, VPN or proxy connection to settle, then retry explicitly.",
      "Review the saved route if its network adapter or upstream service changed.",
    ],
  },
  offline: {
    title: "The browser reported an unavailable network",
    guidance: [
      "Check the local network connection and any required VPN.",
      "Confirm the configured proxy is reachable before retrying.",
    ],
  },
  proxy: {
    title: "The configured proxy route failed",
    guidance: [
      "Review the saved proxy or tunnel configuration and its upstream availability.",
      "Check proxy authentication and whether the proxy permits this destination.",
      "Retry with the corrected saved route. The probe will not bypass it.",
    ],
  },
  certificate: {
    title: "The website certificate was not accepted",
    stage: "TLS",
    guidance: [
      "Check the certificate hostname, expiry, chain and this computer's clock.",
      "Review the owning database's certificate trust decision and saved HTTPS policy.",
      "Confirm the server identity before changing any trust setting.",
    ],
  },
  tls: {
    title: "The secure connection could not be negotiated",
    stage: "TLS",
    guidance: [
      "Confirm this port serves HTTPS and supports the required TLS version.",
      "Check the server and any TLS-inspecting proxy for handshake failures.",
      "A TLS failure alone does not establish a certificate or password rejection.",
    ],
  },
  blocked: {
    title: "The website request was blocked",
    guidance: [
      "Review the saved destination permissions, redirects and browser security policy.",
      "Check the blocked request in DevTools while this browser attempt remains available.",
      "Change a destination permission only after reviewing the intended website.",
    ],
  },
  http: {
    title: "The browser reported an HTTP request failure",
    stage: "HTTP",
    guidance: [
      "Inspect the failed request in DevTools for an available response status.",
      "Check the service and reverse-proxy logs for the corresponding request.",
      "The numeric CEF error is not an HTTP response status.",
    ],
  },
  redirect: {
    title: "The website redirect could not be completed",
    stage: "HTTP",
    guidance: [
      "Check the website's canonical hostname and HTTP-to-HTTPS redirect settings.",
      "Review destination permissions for each redirect and inspect the chain in DevTools.",
      "Browser cookies can affect redirects; an anonymous probe cannot validate the login session.",
    ],
  },
  cache: {
    title: "The browser could not reuse the requested page data",
    guidance: [
      "Retry the page explicitly; a previous form submission may need a fresh visit.",
      "Inspect the request in DevTools before changing browser storage settings.",
    ],
  },
  other: {
    title: "The browser could not load the page",
    guidance: [
      "Use the numeric CEF code and DevTools to inspect the failing request.",
      "Check destination permissions, the saved network route and site availability.",
    ],
  },
};

const startupStages = ["listen", "status", "owner-check", "create", "resync"];
const startupCategories = [
  "certificate-policy",
  "certificate-bridge",
  "connection",
  "runtime",
  "ipc",
];
const shellPhases = [
  "idle",
  "starting",
  "attached",
  "closing",
  "closed",
  "unavailable",
  "error",
];
const nativePhases = ["starting", "attached", "closing", "closed", "failed"];
const unknown = "Not reported";
// Fixed names from the pinned Chromium net_error_list; never native error text.
const cefErrorNames = new Map<number, string>([
  [-7, "TIMED_OUT"],
  [-20, "BLOCKED_BY_CLIENT"],
  [-100, "CONNECTION_CLOSED"],
  [-101, "CONNECTION_RESET"],
  [-102, "CONNECTION_REFUSED"],
  [-105, "NAME_NOT_RESOLVED"],
  [-107, "SSL_PROTOCOL_ERROR"],
  [-111, "TUNNEL_CONNECTION_FAILED"],
  [-118, "CONNECTION_TIMED_OUT"],
  [-130, "PROXY_CONNECTION_FAILED"],
  [-310, "TOO_MANY_REDIRECTS"],
]);
const probeUnavailable =
  "A separate probe requires a live native browser attempt and an unlocked owning database. Startup and closed-session failures cannot reuse a verified route. No request has been sent and no direct fallback will be used.";
const probeOutcomes: Record<OriginBrowserDiagnosticOutcome, string> = {
  response: "Anonymous HTTP response received",
  timeout: "The anonymous request timed out",
  "route-unavailable": "The saved private proxy route is unavailable",
  "tls-failed": "Strict PKI verification or the TLS handshake failed",
  "request-failed": "The anonymous HTTP request failed",
  "owner-unavailable":
    "The owning database or browser attempt became unavailable",
  busy: "A diagnostic request is already running for this browser attempt",
};
const probeTrust =
  "The HTTPS probe uses strict PKI verification, which can differ from the browser's saved database trust decisions. A probe TLS failure does not establish that the browser's certificate policy failed.";
const recoveryLabels: Record<BrowserRecoveryAction, string> = {
  connection: "Review connection settings",
  application: "Review application settings",
  credentials: "Review website credentials",
  permissions: "Review website permissions",
  network: "Review network route",
  "browser-session": "Review browser session settings",
  trust: "Review certificate trust",
  database: "Open database manager",
  "browser-settings": "Open Web Browser settings",
  "legacy-proxy": "Review internal proxy controls",
};

function known(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value) ? value : unknown;
}

function originOnly(value: string) {
  try {
    if (value.length > 16_384) return unknown;
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : unknown;
  } catch {
    return unknown;
  }
}

function presentationFor(
  state: OriginBrowserState,
  load: OriginBrowserLoadFailure | null,
): Presentation {
  if (load?.category === "proxy" && load.code === -130) {
    return {
      title: nativeProxyConnectionFailure.title,
      guidance: [
        nativeProxyConnectionFailure.problem,
        nativeProxyConnectionFailure.nextStep,
        "The code alone cannot distinguish a stopped listener, local interference, or an incorrect effective proxy endpoint. An anonymous network probe does not verify CEF's effective routing.",
      ],
    };
  }
  if (load) return loadPresentations[load.category];
  const category = state.startupFailure?.category;
  if (category === "certificate-bridge" || category === "certificate-policy") {
    return {
      title: "The saved HTTPS policy needs attention",
      guidance: [
        "Review the certificate guidance above and the installed native browser runtime.",
        "Keep the saved trust policy in place until the required certificate verifier is available.",
      ],
    };
  }
  if (state.startupFailure?.reason === "mfa-origin-mismatch") {
    return {
      title: "Automatic two-factor authentication needs review",
      guidance: [
        "Use the two-factor authentication repair action above to review the authenticator and HTTPS login origin.",
        "After saving the reviewed configuration, use Retry browser explicitly.",
      ],
    };
  }
  return {
    title:
      state.startupFailure || state.phase === "unavailable"
        ? "Browser startup diagnostics"
        : "Browser session diagnostics",
    guidance: [
      "Review the reported startup stage or native failure category before retrying.",
      "Confirm the owning database is unlocked and the saved destination and route are available.",
      "For repeated startup failures, inspect the native browser startup journal. A network probe cannot diagnose browser creation or renderer faults.",
    ],
  };
}

/** Detail slot inside the viewport's single alert. The shell owns retry, MFA
 * repair, scrolling and passive native-surface occlusion for the whole alert.
 * Never instantiate the legacy web hook or stringify native errors/snapshots. */
export function OriginBrowserFailureDiagnostics({
  state,
  targetUrl,
  active,
  ownerAvailable,
  assertOwner,
  onOpenDevTools,
  onRecover,
  recoveryAllowed = false,
}: OriginBrowserFailureDiagnosticsProps) {
  const load =
    originBrowserLoadFailure(
      state.snapshot?.phase,
      state.snapshot?.loadFailure,
    ) ?? null;
  const presentation = presentationFor(state, load);
  // The shared mapper emits fixed, allowlisted facts, never state.error text.
  const failureDetails = getOriginBrowserFailureDetails(state);
  const runtimeFailure =
    state.phase === "unavailable"
      ? originBrowserRuntimeFailure(state.runtimeFailure)
      : undefined;
  const snapshot = state.snapshot;
  const target = originOnly(targetUrl);
  const reason = originBrowserFailureReason(
    snapshot?.phase,
    snapshot?.failureReason,
  );
  const nativeAvailable = snapshot?.phase === "attached";
  // Identity is used only to fence asynchronous UI feedback; it is never copied.
  const scope = JSON.stringify([
    snapshot?.identity.ownerDatabaseId,
    snapshot?.identity.connectionId,
    snapshot?.identity.sessionId,
    snapshot?.identity.attemptId,
    snapshot?.sequence,
    state.phase,
    state.startupFailure?.stage,
    state.startupFailure?.category,
    state.startupFailure?.reason,
    targetUrl,
    load,
    failureDetails,
  ]);
  const probe = useOriginBrowserDiagnostics({
    identity: snapshot?.identity ?? null,
    origin: target,
    enabled: nativeAvailable && ownerAvailable && active,
    scope,
    assertOwner,
  });
  const facts: [string, string][] = [
    ["Browser engine", "Native CEF"],
    ["App version", APP_VERSION],
    ["Website origin", target],
    [
      "Failure category",
      load?.category ??
        reason ??
        known(state.startupFailure?.category, startupCategories),
    ],
    [
      "CEF load error",
      load
        ? `${load.code}${cefErrorNames.has(load.code) ? ` · ${cefErrorNames.get(load.code)}` : ""}`
        : unknown,
    ],
    ["Browser shell", known(state.phase, shellPhases)],
    ["Native lifecycle", known(snapshot?.phase, nativePhases)],
    ["Startup stage", known(state.startupFailure?.stage, startupStages)],
    ["Runtime startup stage", runtimeFailure?.stage ?? unknown],
    [
      "Native event sequence",
      Number.isSafeInteger(snapshot?.sequence) && snapshot!.sequence >= 0
        ? String(snapshot!.sequence)
        : unknown,
    ],
    [
      "Document loading",
      typeof snapshot?.loading === "boolean"
        ? snapshot.loading
          ? "In progress"
          : "Stopped"
        : unknown,
    ],
    [
      "Back / forward history",
      snapshot
        ? `${snapshot.canGoBack === true ? "Available" : "Unavailable"} / ${snapshot.canGoForward === true ? "Available" : "Unavailable"}`
        : unknown,
    ],
    ["HTTP response status", "Not exposed by the native snapshot"],
    [
      "Network route",
      "Native private proxy with saved route and destination permissions",
    ],
    [
      "Separate network probe",
      probe.running
        ? "Running"
        : probe.report
          ? probeOutcomes[probe.report.outcome]
          : probe.error
            ? "Unavailable"
            : "Not run",
    ],
  ];
  const probeFacts: [string, string][] = probe.report
    ? [
        ["Anonymous probe result", probeOutcomes[probe.report.outcome]],
        [
          "Anonymous probe HTTP status",
          probe.report.httpStatus === null
            ? unknown
            : String(probe.report.httpStatus),
        ],
        ["Anonymous probe elapsed", `${probe.report.elapsedMs} ms`],
        [
          "Advertised response length",
          probe.report.contentLength === null
            ? unknown
            : `${probe.report.contentLength} bytes`,
        ],
      ]
    : [];
  const diagnostics = [
    "Native browser failure diagnostics",
    "What failed",
    ...failureDetails.flatMap((detail) => [
      `Field / rule / stage: ${detail.field}`,
      `Failure code: ${detail.code}`,
      `Problem: ${detail.problem}`,
      `Next step: ${detail.nextStep}`,
      `Suggested action: ${recoveryLabels[detail.action]}`,
    ]),
    ...facts.map(([label, value]) => `${label}: ${value}`),
    ...probeFacts.map(([label, value]) => `${label}: ${value}`),
    "Separate anonymous GET to the origin root, using the native private proxy and owner/destination checks. No redirects followed; no browser login state or response body read.",
    "Probe DNS/TCP: delegated to the private proxy; no separate stage timings.",
    "An HTTP status may come from the relay or destination; it does not establish browser or login readiness.",
    probeTrust,
    "No saved credentials, cookies, URL paths, query values, fragments, page titles, response bodies or raw native errors are included.",
  ].join("\n");
  const epoch = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState<"copy" | "devtools" | null>(null);
  const [feedback, setFeedback] = useState("");
  useLayoutEffect(() => {
    mounted.current = true;
    ++epoch.current;
    pending.current = false;
    setBusy(null);
    setFeedback("");
    return () => {
      mounted.current = false;
    };
  }, [scope, active, ownerAvailable, recoveryAllowed]);

  const recover = (action: BrowserRecoveryAction) => {
    if (
      !mounted.current ||
      !active ||
      !recoveryAllowed ||
      !onRecover ||
      pending.current ||
      (!ownerAvailable && action !== "database")
    )
      return;
    try {
      // Opening the database manager must remain possible to restore access.
      // All other recovery uses the same live owner guard as native actions.
      if (ownerAvailable) assertOwner();
      setFeedback("");
      onRecover(action);
    } catch {
      setFeedback(
        "Could not open the recovery settings. Check database access and try again.",
      );
    }
  };

  const run = async (action: "copy" | "devtools") => {
    if (!active || !ownerAvailable || pending.current || !mounted.current)
      return;
    const generation = epoch.current;
    const current = () => mounted.current && generation === epoch.current;
    try {
      assertOwner();
      if (action === "devtools" && (!nativeAvailable || !onOpenDevTools))
        return;
      pending.current = true;
      setBusy(action);
      setFeedback("");
      const success =
        action === "copy"
          ? await navigator.clipboard.writeText(diagnostics).then(() => true)
          : await onOpenDevTools!();
      if (!current()) return;
      assertOwner();
      setFeedback(
        success
          ? action === "copy"
            ? "Diagnostics copied."
            : "DevTools opened for this browser attempt."
          : "DevTools could not be opened for this browser attempt.",
      );
    } catch {
      if (current())
        setFeedback(
          action === "copy"
            ? "Could not copy diagnostics. Check database access and clipboard permission, then retry."
            : "DevTools could not be opened. Check database access and retry while the native browser is available.",
        );
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(null);
      }
    }
  };

  if (!ownerAvailable)
    return (
      <div className="space-y-3 text-[var(--color-textSecondary)]">
        <p>Unlock the owning database to view browser diagnostics.</p>
        {onRecover && (
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!active || !recoveryAllowed}
            data-tooltip={recoveryLabels.database}
            onClick={() => recover("database")}
          >
            {recoveryLabels.database}
          </button>
        )}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    );

  return (
    <div
      data-testid="origin-browser-failure-diagnostics"
      className="min-w-0 space-y-5 border-t border-[var(--color-border)] pt-5"
    >
      <section
        aria-label="What failed"
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <h3 className="font-semibold">What failed</h3>
        <ul className="mt-3 space-y-4">
          {failureDetails.map((detail, index) => (
            <li key={`${detail.code}:${index}`} className="min-w-0 space-y-2">
              <h4 className="break-words text-sm font-semibold">
                {detail.field}
              </h4>
              <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
                {detail.problem}
              </p>
              <p className="break-words text-xs text-[var(--color-textMuted)]">
                Failure code: <code>{detail.code}</code>
              </p>
              <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
                <span className="font-medium">Next step: </span>
                {detail.nextStep}
              </p>
              {onRecover && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={!active || !recoveryAllowed || busy !== null}
                  data-tooltip={recoveryLabels[detail.action]}
                  onClick={() => recover(detail.action)}
                >
                  {recoveryLabels[detail.action]}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Browser diagnostics"
        className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <div className="border-b border-[var(--color-border)] p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldAlert
              size={18}
              aria-hidden="true"
              className="shrink-0 text-warning"
            />
            {presentation.title}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-textSecondary)]">
            These facts describe the browser attempt. Network timings, response
            headers and an HTTP status are not available from this snapshot. A
            CEF error code is not an HTTP status.
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-[var(--color-textMuted)]">{label}</dt>
              <dd className="mt-0.5 break-words text-sm text-[var(--color-text)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-label="Suggested recovery"
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <h3 className="font-semibold">What to check next</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--color-textSecondary)]">
          {presentation.guidance.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!active || busy !== null}
            aria-busy={busy === "copy"}
            onClick={() => void run("copy")}
          >
            <Copy size={15} aria-hidden="true" />
            Copy diagnostics
          </button>
          {onOpenDevTools && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={!active || !nativeAvailable || busy !== null}
              aria-busy={busy === "devtools"}
              onClick={() => void run("devtools")}
            >
              <Bug size={15} aria-hidden="true" />
              Inspect failed page
            </button>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-textSecondary)]">
          Copied diagnostics include the website origin, fixed failure details,
          suggested recovery and browser facts. Paths, query values,
          credentials, cookies and raw errors are omitted.
        </p>
        {onOpenDevTools && (
          <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
            {nativeAvailable
              ? "DevTools inspects the existing browser session and may show private page data. It is not included in the diagnostic copy."
              : "DevTools requires a live native browser attempt; it is unavailable for this startup or session failure."}
          </p>
        )}
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-2 text-xs text-[var(--color-textSecondary)]"
        >
          {feedback}
        </p>
      </section>

      <section
        aria-label="Deep network diagnostics"
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <Microscope size={18} aria-hidden="true" />
          Deep network diagnostics
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Runs a separate anonymous GET of the website origin root through this
          attempt's private proxy, saved route, destination permissions and
          database-lock protections. Saved website credentials, browser cookies,
          URL paths, query values and fragments are omitted. Redirects are
          reported but never followed; response bodies are not read. Proxy
          authentication is part of the configured route.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-textSecondary)]">
          {probeTrust} An HTTP response does not test the failed page path or
          saved login. The status may come from the relay or destination.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["DNS", "TCP", "TLS", "HTTP"] as const).map((stage) => (
            <div
              key={stage}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3"
            >
              <dt className="text-xs font-semibold">{stage}</dt>
              <dd className="mt-1 text-xs text-[var(--color-textSecondary)]">
                {presentation.stage === stage
                  ? "Browser error reported"
                  : "No stage result"}
                <span className="mt-1 block text-[var(--color-textMuted)]">
                  {probe.running
                    ? "Probe running…"
                    : !probe.report
                      ? "Probe not run"
                      : stage === "DNS" || stage === "TCP"
                        ? "Delegated to the private proxy; no separate timing"
                        : stage === "TLS"
                          ? target.startsWith("https:")
                            ? "Strict PKI within HTTPS request; no separate timing"
                            : "Not applicable to HTTP"
                          : probe.report.httpStatus === null
                            ? "No response status"
                            : `Anonymous HTTP ${probe.report.httpStatus}`}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-[var(--color-textSecondary)]">
          <Info
            size={16}
            aria-hidden="true"
            className="mt-1 shrink-0 text-info"
          />
          {probe.available
            ? "The probe sends only the canonical origin to native code. Native code must approve this destination and use the existing private proxy; it cannot fall back to a direct connection."
            : probeUnavailable}
        </p>
        <div aria-live="polite" aria-atomic="true">
          {probe.running && (
            <p className="mt-3 text-sm text-[var(--color-textSecondary)]">
              Running anonymous diagnostics through the native private proxy…
            </p>
          )}
          {probe.error && (
            <p className="mt-3 text-sm text-warning">{probe.error}</p>
          )}
          {probe.report && (
            <dl
              className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
              aria-label="Anonymous probe results"
            >
              {probeFacts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <button
          type="button"
          disabled={!probe.available || probe.running || busy !== null}
          aria-busy={probe.running}
          className="sor-btn sor-btn-secondary mt-3"
          data-tooltip={
            probe.available
              ? "Send one anonymous request through the native browser route"
              : probeUnavailable
          }
          onClick={() => void probe.run()}
        >
          <Microscope size={15} aria-hidden="true" />
          Run deep diagnostics
        </button>
      </section>
    </div>
  );
}
