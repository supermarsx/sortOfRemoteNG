import type {
  SynologyAdminData,
  SynologyTab,
} from "../../hooks/synology/synologyAdminData";
import { SYNOLOGY_SECTION_LABELS } from "./synologySectionLabels";

/**
 * Frontend half of the `syn_get_section_access` contract (plan t84 §4.2/§4.3).
 * Every value is validated before it can influence what the panel loads or shows;
 * an invalid shape never grants access and never carries NAS data.
 */
export type SynologyReadField =
  | Exclude<keyof SynologyAdminData, "dashboard" | "selectedDiskSmart">
  | "fileStationInfo";

export type SynologyReadState =
  | "available"
  | "requires_administrator"
  | "session_restricted"
  | "requires_application_privilege"
  | "permission_denied"
  | "package_not_installed"
  | "not_supported"
  | "unknown";

export type SynologySectionStatus =
  "available" | "partial" | "denied" | "unavailable" | "unknown";

export type SynologyAccessRequirement =
  | "administrator"
  | "session"
  | "application_privilege"
  | "permission"
  | "package"
  | "dsm_version";

export interface SynologyReadAccess {
  field: SynologyReadField;
  api: string;
  state: SynologyReadState;
  reason: string;
  package?: string;
  application?: string;
}

export type SynologyAccountRole = "administrator" | "standard" | "unknown";
export type SynologySessionName = "FileStation" | "webui";
export type SynologyLoginHandshake =
  "ik" | "ik_incomplete" | "legacy" | "legacy_unavailable";
export type SynologySessionRoute =
  "direct" | "http_proxy" | "quickconnect_relay" | "quickconnect_direct";
export type SynologySecondFactor = "none" | "otp" | "trusted_device";

/** Identity of the native API session. Never contains hosts, URLs, SIDs, tokens or device ids. */
export interface SynologyAccountAccess {
  /** ≤256 chars, no control characters; the username sent at sign-in. */
  signedInAs: string;
  role: SynologyAccountRole;
  portalSession: boolean;
  sessionName: SynologySessionName;
  loginHandshake: SynologyLoginHandshake;
  authVersion: number;
  route: SynologySessionRoute;
  secondFactor: SynologySecondFactor;
}

export interface SynologySectionAccessSnapshot {
  section: SynologyTab;
  status: SynologySectionStatus;
  requirement: SynologyAccessRequirement | null;
  reason: string;
  /** `null` for a legacy backend snapshot (no per-read results). */
  account: SynologyAccountAccess | null;
  reads: SynologyReadAccess[];
}

/** Profile requested by the explicit reconnect actions (`mgr.reconnect`). */
export type SynologySessionProfile = "file_station" | "dsm_desktop";
export interface SynologyReconnectOptions {
  sessionProfile?: SynologySessionProfile;
}

/** Must equal Rust `api_access::SECTION_READS`. */
export const SYNOLOGY_SECTION_READS: Record<
  SynologyTab,
  readonly SynologyReadField[]
> = {
  dashboard: [
    "systemInfo",
    "utilization",
    "storageOverview",
    "networkOverview",
  ],
  system: ["systemInfo", "utilization"],
  storage: ["storageOverview", "disks", "volumes"],
  fileStation: ["fileStationInfo"],
  shares: ["sharedFolders"],
  network: ["networkOverview", "networkInterfaces", "firewallRules"],
  users: ["users", "groups"],
  packages: ["packages"],
  services: ["services", "smbConfig", "nfsConfig", "sshConfig"],
  docker: [
    "dockerContainers",
    "dockerImages",
    "dockerNetworks",
    "dockerProjects",
  ],
  vms: ["vms"],
  downloads: ["downloadTasks", "downloadStats"],
  surveillance: ["cameras"],
  backup: ["backupTasks", "activeBackupDevices"],
  security: [
    "securityOverview",
    "blockedIps",
    "certificates",
    "autoBlockConfig",
  ],
  hardware: ["hardwareInfo", "upsInfo", "powerSchedule"],
  logs: ["systemLogs", "connectionLogs"],
  notifications: ["notificationConfig"],
};

/**
 * Reads whose DSM API definition allows administrators only (plan §3 "A").
 * Package APIs are excluded: their administrator requirement is inferred, not defined.
 */
export const SYNOLOGY_ADMINISTRATOR_READS: ReadonlySet<SynologyReadField> =
  new Set<SynologyReadField>([
    "utilization",
    "storageOverview",
    "disks",
    "volumes",
    "sharedFolders",
    "networkOverview",
    "networkInterfaces",
    "firewallRules",
    "users",
    "groups",
    "packages",
    "services",
    "smbConfig",
    "nfsConfig",
    "sshConfig",
    "securityOverview",
    "blockedIps",
    "certificates",
    "autoBlockConfig",
    "upsInfo",
    "powerSchedule",
    "systemLogs",
  ]);

const READ_STATES = [
  "available",
  "requires_administrator",
  "session_restricted",
  "requires_application_privilege",
  "permission_denied",
  "package_not_installed",
  "not_supported",
  "unknown",
] as const satisfies readonly SynologyReadState[];
const SECTION_STATUSES = [
  "available",
  "partial",
  "denied",
  "unavailable",
  "unknown",
] as const satisfies readonly SynologySectionStatus[];
const REQUIREMENTS = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
  "package",
  "dsm_version",
] as const satisfies readonly SynologyAccessRequirement[];
const ROLES = [
  "administrator",
  "standard",
  "unknown",
] as const satisfies readonly SynologyAccountRole[];
const SESSION_NAMES = [
  "FileStation",
  "webui",
] as const satisfies readonly SynologySessionName[];
const HANDSHAKES = [
  "ik",
  "ik_incomplete",
  "legacy",
  "legacy_unavailable",
] as const satisfies readonly SynologyLoginHandshake[];
const ROUTES = [
  "direct",
  "http_proxy",
  "quickconnect_relay",
  "quickconnect_direct",
] as const satisfies readonly SynologySessionRoute[];
const SECOND_FACTORS = [
  "none",
  "otp",
  "trusted_device",
] as const satisfies readonly SynologySecondFactor[];

/** Read state → the section requirement it implies (`available`/`unknown` imply none). */
export const SYNOLOGY_READ_STATE_REQUIREMENT: Record<
  SynologyReadState,
  SynologyAccessRequirement | null
> = {
  available: null,
  requires_administrator: "administrator",
  session_restricted: "session",
  requires_application_privilege: "application_privilege",
  permission_denied: "permission",
  package_not_installed: "package",
  not_supported: "dsm_version",
  unknown: null,
};

export const SYNOLOGY_READ_STATE_TITLES: Record<SynologyReadState, string> = {
  available: "Available",
  requires_administrator: "Requires administrator",
  session_restricted: "Session restricted",
  requires_application_privilege: "Requires application privilege",
  permission_denied: "Permission denied",
  package_not_installed: "Package not installed",
  not_supported: "Not provided by this DSM",
  unknown: "Could not verify",
};

export const SYNOLOGY_REQUIREMENT_TITLES: Record<
  SynologyAccessRequirement,
  string
> = {
  administrator: "Requires administrator",
  session: "Session restricted",
  application_privilege: "Requires application privilege",
  permission: "Permission denied",
  package: "Package not installed",
  dsm_version: "Not provided by this DSM",
};

export const SYNOLOGY_SESSION_NAME_LABELS: Record<SynologySessionName, string> =
  { FileStation: "FileStation", webui: "DSM desktop (webui)" };
export const SYNOLOGY_LOGIN_HANDSHAKE_LABELS: Record<
  SynologyLoginHandshake,
  string
> = {
  ik: "DSM 7 secure (IK)",
  ik_incomplete: "DSM 7 secure, incomplete",
  legacy: "legacy",
  legacy_unavailable: "legacy (secure handshake unavailable)",
};
export const SYNOLOGY_ROUTE_LABELS: Record<SynologySessionRoute, string> = {
  direct: "Direct",
  http_proxy: "HTTP proxy",
  quickconnect_relay: "QuickConnect relay",
  quickconnect_direct: "QuickConnect direct",
};
export const SYNOLOGY_SECOND_FACTOR_LABELS: Record<
  SynologySecondFactor,
  string
> = { none: "none", otp: "one-time code", trusted_device: "trusted device" };

export const isReadLoadable = (state?: SynologyReadState) =>
  state === undefined || state === "available" || state === "unknown";

const API_PATTERN = /^SYNO\.[A-Za-z0-9.]{1,120}$/;
// C0/C1 controls, DEL, zero-width and bidirectional overrides: none belong in DSM metadata.
/* eslint-disable no-control-regex -- deliberately matches control characters. */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
/* eslint-enable no-control-regex */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : null;
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !UNSAFE_TEXT.test(value);

function validateAccount(value: unknown): SynologyAccountAccess | null {
  if (!isRecord(value) || !safeText(value.signedInAs, 256)) return null;
  const role = oneOf(ROLES, value.role);
  const sessionName = oneOf(SESSION_NAMES, value.sessionName);
  const loginHandshake = oneOf(HANDSHAKES, value.loginHandshake);
  const route = oneOf(ROUTES, value.route);
  const secondFactor = oneOf(SECOND_FACTORS, value.secondFactor);
  const { authVersion, portalSession } = value;
  if (
    !role ||
    !sessionName ||
    !loginHandshake ||
    !route ||
    !secondFactor ||
    typeof portalSession !== "boolean" ||
    typeof authVersion !== "number" ||
    !Number.isInteger(authVersion) ||
    authVersion < 1 ||
    authVersion > 64
  )
    return null;
  return {
    signedInAs: value.signedInAs,
    role,
    portalSession,
    sessionName,
    loginHandshake,
    authVersion,
    route,
    secondFactor,
  };
}

function validateRead(
  expected: readonly SynologyReadField[],
  value: unknown,
): SynologyReadAccess | null {
  if (!isRecord(value)) return null;
  const field = oneOf(expected, value.field);
  const state = oneOf(READ_STATES, value.state);
  if (
    !field ||
    !state ||
    typeof value.api !== "string" ||
    !API_PATTERN.test(value.api) ||
    !safeText(value.reason, 1024)
  )
    return null;
  const read: SynologyReadAccess = {
    field,
    api: value.api,
    state,
    reason: value.reason,
  };
  for (const key of ["package", "application"] as const) {
    if (value[key] === undefined) continue;
    if (!safeText(value[key], 64)) return null;
    read[key] = value[key];
  }
  return read;
}

/** Section status implied by its reads (plan §4.2 "Section aggregation"). */
export function aggregateSectionStatus(
  reads: readonly Pick<SynologyReadAccess, "state">[],
): SynologySectionStatus {
  const states = reads.map((read) => read.state);
  const available = states.filter((state) => state === "available").length;
  if (states.length && available === states.length) return "available";
  if (available) return "partial";
  if (states.includes("unknown")) return "unknown";
  if (
    states.some((state) =>
      [
        "requires_administrator",
        "session_restricted",
        "requires_application_privilege",
        "permission_denied",
      ].includes(state),
    )
  )
    return "denied";
  return "unavailable";
}

const DENIED_REQUIREMENTS: readonly SynologyAccessRequirement[] = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
];

/**
 * Returns a sanitized copy of a native snapshot, or `null` when the shape is not
 * trustworthy (callers treat that as "Could not verify"). Legacy snapshots from an
 * older backend (no `reads`) map to `reads: []` and `account: null`.
 */
export function validateSectionAccessSnapshot(
  section: SynologyTab,
  value: unknown,
): SynologySectionAccessSnapshot | null {
  if (!isRecord(value) || value.section !== section) return null;
  const status = oneOf(SECTION_STATUSES, value.status);
  if (!status || !safeText(value.reason, 1024)) return null;
  const reason = value.reason;
  if (value.reads === undefined) {
    if (
      status === "partial" ||
      value.account !== undefined ||
      value.requirement !== undefined
    )
      return null;
    return {
      section,
      status,
      requirement:
        status === "denied"
          ? "permission"
          : status === "unavailable"
            ? "dsm_version"
            : null,
      reason,
      account: null,
      reads: [],
    };
  }
  const expected = SYNOLOGY_SECTION_READS[section];
  if (!Array.isArray(value.reads) || value.reads.length !== expected.length)
    return null;
  const reads: SynologyReadAccess[] = [];
  for (const entry of value.reads) {
    const read = validateRead(expected, entry);
    if (!read || reads.some((seen) => seen.field === read.field)) return null;
    reads.push(read);
  }
  const account = validateAccount(value.account);
  if (!account || aggregateSectionStatus(reads) !== status) return null;
  let requirement: SynologyAccessRequirement | null = null;
  if (value.requirement !== null) {
    requirement = oneOf(REQUIREMENTS, value.requirement);
    if (
      !requirement ||
      !reads.some(
        (read) => SYNOLOGY_READ_STATE_REQUIREMENT[read.state] === requirement,
      )
    )
      return null;
  }
  if (
    (status === "available" && requirement !== null) ||
    (status === "denied" &&
      (!requirement || !DENIED_REQUIREMENTS.includes(requirement))) ||
    (status === "unavailable" &&
      requirement !== "package" &&
      requirement !== "dsm_version")
  )
    return null;
  return { section, status, requirement, reason, account, reads };
}

export type SynologyEffectiveRole =
  "administrator" | "delegated" | "standard" | "unknown";

type AccessEvidence = {
  account: SynologyAccountAccess | null;
  reads: readonly SynologyReadAccess[];
};

/**
 * DSM's reported role when known. Otherwise inferred from administrator-class reads:
 * some readable and some refused → delegated administration; all refused → standard.
 */
export function effectiveAccountRole(
  entries:
    | Readonly<Partial<Record<string, AccessEvidence>>>
    | readonly (AccessEvidence | undefined)[],
): SynologyEffectiveRole {
  const list = Object.values(entries).filter(
    (entry): entry is AccessEvidence => !!entry,
  );
  const reported = list.find(
    (entry) => entry.account && entry.account.role !== "unknown",
  )?.account?.role;
  if (reported === "administrator" || reported === "standard") return reported;
  const probed = list
    .flatMap((entry) => entry.reads)
    .filter(
      (read) =>
        (SYNOLOGY_ADMINISTRATOR_READS.has(read.field) ||
          read.state === "requires_administrator") &&
        !["package_not_installed", "not_supported", "unknown"].includes(
          read.state,
        ),
    );
  const refused = probed.filter(
    (read) => read.state === "requires_administrator",
  ).length;
  if (refused && probed.some((read) => read.state === "available"))
    return "delegated";
  if (refused && refused === probed.length) return "standard";
  return "unknown";
}

export const SYNOLOGY_EFFECTIVE_ROLE_LABELS: Record<
  SynologyEffectiveRole,
  string
> = {
  administrator: "yes",
  delegated: "no (delegated administration)",
  standard: "no",
  unknown: "unknown (DSM did not report it)",
};

/** Labelled identity parts, in display order. Values are enum labels or the username only. */
export function synologyAccountIdentityParts(
  account: SynologyAccountAccess,
  role: SynologyEffectiveRole,
): [label: string, value: string][] {
  return [
    ["Signed in as", account.signedInAs],
    ["Administrator", SYNOLOGY_EFFECTIVE_ROLE_LABELS[role]],
    [
      "Session",
      SYNOLOGY_SESSION_NAME_LABELS[account.sessionName] +
        (account.portalSession ? " (application portal)" : ""),
    ],
    [
      "Login handshake",
      SYNOLOGY_LOGIN_HANDSHAKE_LABELS[account.loginHandshake],
    ],
    ["Route", SYNOLOGY_ROUTE_LABELS[account.route]],
    ["2FA", SYNOLOGY_SECOND_FACTOR_LABELS[account.secondFactor]],
  ];
}

/** One line: "Signed in as nas-admin · Administrator: yes · Session: FileStation · …". */
export function synologyAccountSummary(
  account: SynologyAccountAccess,
  role: SynologyEffectiveRole,
) {
  return synologyAccountIdentityParts(account, role)
    .map(([label, value]) =>
      label === "Signed in as" ? `${label} ${value}` : `${label}: ${value}`,
    )
    .join(" · ");
}

/**
 * Copyable session diagnostics built only from validated enums, the username,
 * section statuses and restricted DSM API names. Reasons are not included, and
 * nothing here can carry a hostname, URL, SID, token, hash or device id.
 */
export function formatSynologySessionDiagnostics({
  account,
  role,
  entries,
}: {
  account: SynologyAccountAccess | null;
  role: SynologyEffectiveRole;
  entries: Readonly<
    Partial<
      Record<
        SynologyTab,
        {
          status: SynologySectionStatus | "checking";
          requirement: SynologyAccessRequirement | null;
          reads: readonly SynologyReadAccess[];
        }
      >
    >
  >;
}) {
  const lines = ["Synology NAS API session diagnostics"];
  if (account) {
    for (const [label, value] of synologyAccountIdentityParts(account, role))
      lines.push(`${label}: ${value}`);
    lines.push(`Auth API version: ${account.authVersion}`);
  } else lines.push("Session identity: not reported by the desktop backend");
  lines.push("Sections:");
  for (const section of Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[]) {
    const entry = entries[section];
    if (!entry) continue;
    const restricted = entry.reads
      .filter((read) => read.state !== "available")
      .map((read) => `${read.api} ${read.state}`);
    lines.push(
      `${SYNOLOGY_SECTION_LABELS[section]}: ${entry.status}` +
        (entry.requirement ? ` (${entry.requirement})` : "") +
        (restricted.length ? ` — ${restricted.join(", ")}` : ""),
    );
  }
  return lines.join("\n");
}
