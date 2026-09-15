import { CircleSlash, Lock, PackageX } from "lucide-react";
import type {
  SynologyReadRestriction,
  SynologyTab,
} from "../../../hooks/synology/synologyAdminData";
import {
  effectiveAccountRole,
  isReadLoadable,
  SYNOLOGY_READ_STATE_REQUIREMENT,
  SYNOLOGY_READ_STATE_TITLES,
  SYNOLOGY_REQUIREMENT_TITLES,
  SYNOLOGY_SECTION_READS,
  synologyAccountSummary,
  type SynologyAccessRequirement,
  type SynologyAccountAccess,
  type SynologyReadField,
  type SynologyReadState,
  type SynologyReconnectOptions,
} from "../../../utils/synology/synologyAccess";
import {
  SYNOLOGY_READ_LABELS,
  SYNOLOGY_SECTION_LABELS,
} from "../../../utils/synology/synologySectionLabels";
import type { Mgr } from "./types";

/**
 * Restricted-data views (plan t84 §4.3 "Views"). Every sentence shown is fixed
 * frontend copy selected by a closed state; the only interpolated values are the
 * DSM API identifier and the package/application name from the access contract.
 * Native reasons, NAS data and DSM error text are never rendered here.
 */
export const SYNOLOGY_ADMINISTRATOR_ACTION_TOOLTIP =
  "Requires a DSM administrator account";

type RefusedState = Exclude<SynologyReadState, "available" | "unknown">;
export interface SynologyRefusedRead {
  field: SynologyReadField;
  state: RefusedState;
  api: string | null;
  package?: string;
  application?: string;
}
export interface SynologyRestrictionActions {
  onRecheck: () => void;
  /** Present only for session restrictions that a new sign-in can lift. */
  reconnect: {
    run: (() => void) | null;
    /** Offered when the secure handshake worked and the session is not already a DSM desktop one. */
    offerDsmSession: boolean;
    runAsDsmSession: (() => void) | null;
  } | null;
}
export interface SynologyReadRestrictionView extends SynologyRestrictionActions {
  field: SynologyReadField;
  state: RefusedState;
  title: string;
  reason: string;
  api: string | null;
}
export interface SynologySectionRestrictionView extends SynologyRestrictionActions {
  tab: SynologyTab;
  requirement: SynologyAccessRequirement | null;
  title: string;
  reason: string;
  reads: SynologyRefusedRead[];
  accountSummary: string | null;
}
export interface SynologyTabAccess {
  tab: SynologyTab;
  restriction: (
    field: SynologyReadField,
  ) => SynologyReadRestrictionView | undefined;
  /** Set when every read of the section is refused, or its snapshot is denied/unavailable. */
  section: SynologySectionRestrictionView | null;
  /** Every read of the tab is `requires_administrator`; partial or delegated access never counts. */
  administratorOnly: boolean;
}

const API_PATTERN = /^SYNO\.[A-Za-z0-9.]{1,120}$/;
const REQUIREMENT_ORDER: readonly SynologyAccessRequirement[] = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
  "package",
  "dsm_version",
];
const contractName = (value: unknown, fallback: string) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= 64 &&
  !/\p{C}/u.test(value)
    ? value
    : fallback;
const readLabel = (field: SynologyReadField) =>
  field === "fileStationInfo"
    ? "File Station information"
    : SYNOLOGY_READ_LABELS[field];

/**
 * Refused reads of one tab, from the manager's `readRestrictions` only (t84-e4).
 * It covers the active tab, keeps the last settled snapshot during a recheck and
 * adds DSM refusals that raced the probe, so notices match what the loader skipped.
 */
function refusedReads(mgr: Mgr, tab: SynologyTab) {
  const restrictions: Partial<
    Record<SynologyReadField, SynologyReadRestriction>
  > = tab === mgr.activeTab ? mgr.readRestrictions : {};
  const refused: SynologyRefusedRead[] = [];
  for (const field of SYNOLOGY_SECTION_READS[tab]) {
    const read = restrictions[field];
    if (!read || read.field !== field || isReadLoadable(read.state)) continue;
    refused.push({
      field,
      state: read.state,
      api: read.api && API_PATTERN.test(read.api) ? read.api : null,
      ...(read.package ? { package: read.package } : {}),
      ...(read.application ? { application: read.application } : {}),
    });
  }
  return refused;
}

function sessionReason(
  account: SynologyAccountAccess | null,
  subject: "this data" | "this section",
) {
  if (account?.portalSession)
    return `This API session was opened through a DSM application portal, which limits it to that application. Connect to the DSM port (for example 5001) to use ${subject}.`;
  if (!account)
    return `DSM restricted ${subject} for the current API session. Reconnect, then recheck access.`;
  const dsm =
    account.role === "administrator"
      ? "DSM identifies this account as an administrator but"
      : "DSM";
  if (account.loginHandshake !== "ik")
    return `${dsm} limited this API session: it was signed in without DSM 7's secure login handshake, which DSM requires for full access over QuickConnect or remote addresses. Reconnect; if this remains, copy the session diagnostics.`;
  if (account.sessionName === "webui")
    return `${dsm} still restricts ${subject} for this DSM desktop session. Copy the session diagnostics and include them in your report.`;
  return `${dsm} restricted ${subject} for this API session. Use Reconnect as DSM session, then recheck access. If it remains, copy the session diagnostics.`;
}

function readReason(
  read: SynologyRefusedRead,
  account: SynologyAccountAccess | null,
) {
  switch (read.state) {
    case "requires_administrator":
      return "DSM allows this data only for administrators or accounts with a matching delegated administration role.";
    case "session_restricted":
      return sessionReason(account, "this data");
    case "requires_application_privilege":
      return `The signed-in account needs the ${contractName(read.application, "matching")} application privilege (Control Panel › Application Privileges) to read this data.`;
    case "permission_denied":
      return "DSM denied this data for the signed-in account. Review the account's DSM permissions, then recheck access.";
    case "package_not_installed":
      return `${contractName(read.package, "The required package")} is not installed or not running on this NAS.`;
    case "not_supported":
      return "This DSM version does not provide this data.";
  }
}

function sectionReason(
  requirement: SynologyAccessRequirement | null,
  reads: readonly SynologyRefusedRead[],
  account: SynologyAccountAccess | null,
) {
  const named = (key: "package" | "application", fallback: string) =>
    contractName(reads.find((read) => read[key])?.[key], fallback);
  switch (requirement) {
    case "administrator":
      return "This section needs a DSM administrator account or a delegated administration role.";
    case "session":
      return sessionReason(account, "this section");
    case "application_privilege":
      return `This section needs the ${named("application", "matching")} application privilege. Grant it in Control Panel › Application Privileges, then recheck access.`;
    case "package":
      return `${named("package", "The required package")} is not installed or not running on this NAS.`;
    case "dsm_version":
      return "This DSM version does not provide this section's API.";
    default:
      return "DSM denied this section's data for the signed-in account. Review the account's DSM permissions, then recheck access.";
  }
}

function reconnectActions(
  mgr: Mgr,
  account: SynologyAccountAccess | null,
): SynologyRestrictionActions["reconnect"] {
  // An application-portal session needs a different port, not another sign-in.
  if (account?.portalSession) return null;
  // Optional only for partial test managers; the connection hook always provides it.
  const reconnect = mgr.reconnect as Mgr["reconnect"] | undefined;
  // One user-initiated sign-in; failures surface through the connection state.
  const run = (options?: SynologyReconnectOptions) =>
    void Promise.resolve(options ? reconnect?.(options) : reconnect?.()).catch(
      () => undefined,
    );
  const offerDsmSession =
    account?.loginHandshake === "ik" && account.sessionName !== "webui";
  return {
    run: reconnect ? () => run() : null,
    offerDsmSession,
    runAsDsmSession:
      reconnect && offerDsmSession
        ? () => run({ sessionProfile: "dsm_desktop" })
        : null,
  };
}

/** Per-table restrictions, the whole-section restriction and action gating for one tab. */
// eslint-disable-next-line react-refresh/only-export-components -- shared by the views that render these notices.
export function synologyTabAccess(
  mgr: Mgr,
  tab: SynologyTab,
): SynologyTabAccess {
  const { sectionAccess } = mgr;
  const entry = sectionAccess.entries[tab];
  const account = entry?.account ?? sectionAccess.account ?? null;
  const fields = SYNOLOGY_SECTION_READS[tab];
  const refused = refusedReads(mgr, tab);
  const onRecheck = () => mgr.recheckSection(tab);
  const actionsFor = (sessionRestricted: boolean) => ({
    onRecheck,
    reconnect: sessionRestricted ? reconnectActions(mgr, account) : null,
  });
  let section: SynologySectionRestrictionView | null = null;
  if (
    entry?.status === "denied" ||
    entry?.status === "unavailable" ||
    (fields.length > 0 && refused.length === fields.length)
  ) {
    const requirement =
      REQUIREMENT_ORDER.find((candidate) =>
        refused.some(
          (read) => SYNOLOGY_READ_STATE_REQUIREMENT[read.state] === candidate,
        ),
      ) ??
      entry?.requirement ??
      null;
    section = {
      tab,
      requirement,
      title: requirement
        ? SYNOLOGY_REQUIREMENT_TITLES[requirement]
        : SYNOLOGY_READ_STATE_TITLES.permission_denied,
      reason: sectionReason(requirement, refused, account),
      reads: refused,
      accountSummary: account
        ? synologyAccountSummary(
            account,
            effectiveAccountRole(sectionAccess.entries),
          )
        : null,
      ...actionsFor(requirement === "session"),
    };
  }
  return {
    tab,
    section,
    administratorOnly:
      fields.length > 0 &&
      refused.length === fields.length &&
      refused.every((read) => read.state === "requires_administrator"),
    restriction: (field) => {
      const read = refused.find((candidate) => candidate.field === field);
      return read
        ? {
            field,
            state: read.state,
            title: SYNOLOGY_READ_STATE_TITLES[read.state],
            reason: readReason(read, account),
            api: read.api,
            ...actionsFor(read.state === "session_restricted"),
          }
        : undefined;
    },
  };
}

const iconFor = (state: string | null) =>
  state === "package_not_installed" || state === "package"
    ? PackageX
    : state === "not_supported" || state === "dsm_version"
      ? CircleSlash
      : Lock;

function RestrictionButtons({
  actions,
  testIdPrefix,
}: {
  actions: SynologyRestrictionActions;
  testIdPrefix: string;
}) {
  const { reconnect } = actions;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reconnect?.offerDsmSession && (
        <button
          type="button"
          className="sor-btn-secondary-sm"
          data-testid={`${testIdPrefix}-reconnect-dsm-session`}
          disabled={!reconnect.runAsDsmSession}
          onClick={() => reconnect.runAsDsmSession?.()}
        >
          Reconnect as DSM session
        </button>
      )}
      {reconnect && (
        <button
          type="button"
          className="sor-btn-secondary-sm"
          data-testid={`${testIdPrefix}-reconnect`}
          disabled={!reconnect.run}
          onClick={() => reconnect.run?.()}
        >
          Reconnect
        </button>
      )}
      <button
        type="button"
        className="sor-btn-secondary-sm"
        data-testid={`${testIdPrefix}-recheck`}
        onClick={actions.onRecheck}
      >
        Recheck access
      </button>
    </div>
  );
}

/** Neutral notice shown by `AdminTable` in place of rows this session cannot read. */
export function SynologyReadRestrictionNotice({
  restriction,
}: {
  restriction: SynologyReadRestrictionView;
}) {
  const Icon = iconFor(restriction.state);
  return (
    <div
      role="note"
      data-testid="synology-read-restriction"
      data-read-field={restriction.field}
      data-read-state={restriction.state}
      className="flex flex-wrap items-start gap-3 rounded border border-border p-4 text-xs"
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-text-muted"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="font-medium text-text"
          data-testid="synology-read-restriction-title"
        >
          {restriction.title}
        </p>
        <p
          className="text-text-muted"
          data-testid="synology-read-restriction-reason"
        >
          {restriction.reason}
        </p>
        {restriction.api && (
          <p className="text-text-muted">
            DSM API: <code className="break-all">{restriction.api}</code>
          </p>
        )}
      </div>
      <RestrictionButtons
        actions={restriction}
        testIdPrefix="synology-read-restriction"
      />
    </div>
  );
}

/** Full-panel explanation when nothing in a section can be read by this session. */
export default function SynologySectionRestriction({
  access,
}: {
  access: SynologySectionRestrictionView;
}) {
  const Icon = iconFor(access.requirement);
  const headingId = `synology-section-restriction-${access.tab}`;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <section
        aria-labelledby={headingId}
        data-testid="synology-section-restriction"
        data-section={access.tab}
        data-requirement={access.requirement ?? undefined}
        className="mx-auto max-w-2xl space-y-3 rounded-lg border border-border p-5 text-sm"
      >
        <div className="flex items-center gap-2">
          <Icon
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-text-muted"
          />
          <div className="min-w-0">
            <p className="text-xs text-text-muted">
              {SYNOLOGY_SECTION_LABELS[access.tab]}
            </p>
            <h3 id={headingId} className="font-medium">
              {access.title}
            </h3>
          </div>
        </div>
        <p
          className="text-xs text-text-muted"
          data-testid="synology-section-restriction-reason"
        >
          {access.reason}
        </p>
        {access.reads.length > 0 && (
          <ul
            className="space-y-0.5 text-xs"
            data-testid="synology-section-restriction-reads"
          >
            {access.reads.map((read) => (
              <li
                key={read.field}
                data-read-field={read.field}
                data-read-state={read.state}
              >
                {readLabel(read.field)}:{" "}
                {SYNOLOGY_READ_STATE_TITLES[read.state]}
                {read.api && (
                  <span className="text-text-muted">
                    {" "}
                    (<code className="break-all">{read.api}</code>)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {access.accountSummary && (
          <p
            className="break-words text-xs text-text-muted"
            data-testid="synology-section-restriction-account"
          >
            {access.accountSummary}
          </p>
        )}
        <RestrictionButtons
          actions={access}
          testIdPrefix="synology-section-restriction"
        />
      </section>
    </div>
  );
}
