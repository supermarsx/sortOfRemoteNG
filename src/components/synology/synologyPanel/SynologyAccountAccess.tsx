import React, { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { SubProps } from "./types";
import { WebsiteDiagnosticsCopyButton } from "../../protocol/webBrowser/WebsiteDiagnosticsCopyButton";
import {
  effectiveAccountRole,
  formatSynologySessionDiagnostics,
  synologyAccountIdentityParts,
  type SynologyReconnectOptions,
} from "../../../utils/synology/synologyAccess";

/** Who is signed in and how, so a restricted-data report is conclusive without NAS secrets. */
const SynologyAccountAccess: React.FC<SubProps> = ({ mgr }) => {
  const access = mgr.sectionAccess;
  const { account, entries } = access;
  // Optional only for partial test managers; the connection hook always provides it.
  const reconnect = mgr.reconnect as typeof mgr.reconnect | undefined;
  // One user-initiated sign-in; failures surface through the connection state.
  const run = (options?: SynologyReconnectOptions) =>
    void Promise.resolve(options ? reconnect?.(options) : reconnect?.()).catch(
      () => undefined,
    );
  const role = effectiveAccountRole(entries);
  const sessionRestricted = Object.values(entries).some((entry) =>
    entry.reads.some((read) => read.state === "session_restricted"),
  );
  const warning =
    account !== null &&
    sessionRestricted &&
    (role === "administrator" || account.portalSession);
  const [expandedChoice, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedChoice ?? warning;
  const diagnostics = formatSynologySessionDiagnostics({
    account,
    role,
    entries,
  });
  const offerDsmSession =
    warning &&
    account.loginHandshake === "ik" &&
    account.sessionName !== "webui" &&
    !account.portalSession;
  const notice = !account
    ? null
    : warning
      ? account.portalSession
        ? "This API session was opened through a DSM application portal, which limits it to that application. Connect to the DSM port (for example 5001) instead."
        : account.loginHandshake !== "ik"
          ? "DSM identifies this account as an administrator but limited this API session: it was signed in without DSM 7's secure login handshake. Reconnect; if this remains, copy the session diagnostics."
          : account.sessionName === "webui"
            ? "DSM identifies this account as an administrator but still restricts some data for this DSM session. Copy the session diagnostics and include them in your report."
            : "DSM identifies this account as an administrator but restricted some data for this API session. Use Reconnect as DSM session, then recheck access. If it remains, copy the session diagnostics."
      : role === "standard" || role === "delegated"
        ? "Administrator-only data is hidden for this account."
        : null;

  return (
    <section
      aria-label="NAS API session"
      data-testid="synology-account-access"
      data-tone={warning ? "warning" : "neutral"}
      className={`border-t px-3 py-2 text-[10px] ${warning ? "border-warning/40 bg-warning/10" : "border-border"}`}
    >
      <div className="flex items-center gap-1">
        {warning && (
          <TriangleAlert
            aria-hidden="true"
            className="h-3 w-3 shrink-0 text-warning"
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium">
          NAS API session
        </h3>
        <button
          type="button"
          className="sor-icon-btn-sm md:hidden"
          aria-expanded={expanded}
          aria-label={
            expanded ? "Hide session details" : "Show session details"
          }
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-3 w-3 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <div className={`mt-1 space-y-1.5 ${expanded ? "" : "hidden md:block"}`}>
        {account ? (
          <p
            data-testid="synology-account-identity"
            className="break-words text-text-muted"
          >
            {synologyAccountIdentityParts(account, role).map(
              ([label, value], index) => (
                <React.Fragment key={label}>
                  {index > 0 && " · "}
                  <span>
                    {label === "Signed in as" ? `${label} ` : `${label}: `}
                    <span className="text-text">{value}</span>
                  </span>
                </React.Fragment>
              ),
            )}
          </p>
        ) : (
          <p className="text-text-muted">
            {access.checking
              ? "Session details appear after the first section check."
              : "This desktop version did not report session details."}
          </p>
        )}
        {notice && (
          <p
            data-testid="synology-account-notice"
            className={warning ? "text-warning" : "text-text-muted"}
          >
            {notice}
          </p>
        )}
        {warning && (
          <div className="flex flex-col gap-1">
            {offerDsmSession && (
              <button
                type="button"
                className="sor-btn-secondary-sm w-full"
                data-testid="synology-reconnect-dsm-session"
                disabled={!reconnect}
                onClick={() => run({ sessionProfile: "dsm_desktop" })}
              >
                Reconnect as DSM session
              </button>
            )}
            <button
              type="button"
              className="sor-btn-secondary-sm w-full"
              data-testid="synology-reconnect"
              disabled={!reconnect}
              onClick={() => run()}
            >
              Reconnect
            </button>
          </div>
        )}
        <div
          className="flex items-center justify-between gap-1"
          data-testid="synology-session-diagnostics"
        >
          <span className="text-text-muted">Copy session diagnostics</span>
          <WebsiteDiagnosticsCopyButton text={diagnostics} />
        </div>
      </div>
    </section>
  );
};

export default SynologyAccountAccess;
