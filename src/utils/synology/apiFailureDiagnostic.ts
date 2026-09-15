import { formatBytes } from "../core/formatters";
/** Closed, non-secret metadata appended by the native NAS API client. */
export const SYNOLOGY_DIAGNOSTIC_MARKER = "\nsynology-diagnostic:v1:";
export const hasSynologyDiagnostic = (error: string) =>
  error.includes("synology-diagnostic:");
const STAGES = {
  api_discovery: "Discovering DSM APIs",
  api_login: "Signing in to DSM API",
  authenticated_file_station: "Checking authenticated File Station access",
  api_response: "Reading a NAS API response",
} as const;
const CATEGORIES = {
  empty: "The NAS returned an empty response instead of API JSON.",
  html: "The endpoint returned a web page instead of API JSON. Check that this address serves the DSM API, not a website login or portal.",
  json_syntax: "The response could not be decoded as valid JSON.",
  json_schema: "The JSON response did not match the expected DSM API format.",
  http_status: "The endpoint returned an unsuccessful HTTP status.",
  response_too_large: "The response exceeded the bounded API response limit.",
  dsm_api:
    "DSM returned an API error. Check the account's API access and the failed step before retrying.",
} as const;
const CONTENT_TYPES = {
  json: "JSON",
  html: "HTML",
  text: "Text",
  other: "Other",
  missing: "Not provided",
} as const;
/** DSM privilege class of the refused API; only sent with a DSM 105 denial. */
const ACCESS = {
  administrator: "Administrator",
  application_privilege: "Application privilege",
} as const;
/**
 * DSM codes that mean the account or session lacks permission. 120 is not one:
 * DSM returns it for an invalid or missing request parameter.
 */
export const SYNOLOGY_PERMISSION_CODES: readonly number[] = [105];
export interface SynologyApiFailureDiagnostic {
  stage: keyof typeof STAGES;
  category: keyof typeof CATEGORIES;
  httpStatus: number;
  contentType: keyof typeof CONTENT_TYPES;
  bytesRead: number;
  dsmCode?: number;
  access?: keyof typeof ACCESS;
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
const member = <T extends object>(object: T, key: unknown): key is keyof T =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);

export function parseSynologyApiFailure(
  error: string,
): SynologyApiFailureDiagnostic | null {
  const index = error.lastIndexOf(SYNOLOGY_DIAGNOSTIC_MARKER);
  if (
    index < 0 ||
    error.indexOf("synology-diagnostic:") !== index + 1 ||
    error.indexOf("synology-diagnostic:", index + 2) !== -1
  )
    return null;
  const encoded = error.slice(index + SYNOLOGY_DIAGNOSTIC_MARKER.length);
  if (encoded.length > 512 || /[\r\n]/.test(encoded)) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const data = value as Record<string, unknown>;
    if (
      Object.keys(data).some(
        (key) =>
          ![
            "stage",
            "category",
            "httpStatus",
            "contentType",
            "bytesRead",
            "dsmCode",
            "access",
          ].includes(key),
      ) ||
      !member(STAGES, data.stage) ||
      !member(CATEGORIES, data.category) ||
      !member(CONTENT_TYPES, data.contentType) ||
      !integer(data.httpStatus, 100, 599) ||
      !integer(data.bytesRead, 0, 8388608) ||
      (data.dsmCode !== undefined &&
        (!integer(data.dsmCode, 0, 65535) || data.category !== "dsm_api")) ||
      (data.access !== undefined &&
        (!member(ACCESS, data.access) ||
          !SYNOLOGY_PERMISSION_CODES.includes(data.dsmCode as number)))
    )
      return null;
    return {
      stage: data.stage,
      category: data.category,
      httpStatus: data.httpStatus,
      contentType: data.contentType,
      bytesRead: data.bytesRead,
      ...(data.dsmCode === undefined
        ? {}
        : { dsmCode: data.dsmCode as number }),
      ...(data.access === undefined
        ? {}
        : { access: data.access as keyof typeof ACCESS }),
    };
  } catch {
    return null;
  }
}

/** Input has already passed management error sanitization. Preserve only closed metadata. */
export function redactSynologyFailureSecrets(
  error: string,
  secrets: readonly (string | undefined)[],
): string {
  const diagnostic = parseSynologyApiFailure(error);
  if (hasSynologyDiagnostic(error) && !diagnostic)
    return "The NAS API request failed; diagnostic metadata was unavailable.";
  let text = diagnostic
    ? error.slice(0, error.lastIndexOf(SYNOLOGY_DIAGNOSTIC_MARKER))
    : error;
  for (const secret of secrets)
    if (secret) text = text.split(secret).join("[REDACTED]");
  return diagnostic
    ? text + SYNOLOGY_DIAGNOSTIC_MARKER + JSON.stringify(diagnostic)
    : text;
}

function permissionSummary(data: SynologyApiFailureDiagnostic) {
  if (data.access === "administrator")
    return "DSM allows this API only for administrators or accounts with a matching delegated administration role. Sign in with such an account to use it.";
  if (data.access === "application_privilege")
    return "The account lacks the DSM application privilege for this package. Grant it in Control Panel › Application Privileges, then recheck access.";
  if (data.stage === "authenticated_file_station")
    return "DSM denied File Station access for this API session. Grant the account the File Station application privilege in DSM, then reconnect.";
  return "DSM denied this request for the signed-in account. Review the account's DSM permissions.";
}

export function synologyApiFailurePresentation(
  data: SynologyApiFailureDiagnostic,
) {
  const commonCodes: Record<number, string> = {
    106: "The NAS API session timed out. Reconnect before continuing.",
    107: "The NAS ended this API session after another login. Reconnect before continuing.",
    119: "The NAS rejected the API session ID. Reconnect; if this occurs immediately after sign-in, check that login and API requests reach the same DSM server. This does not by itself mean a wrong password or certificate failure.",
    120: "DSM did not accept this request's parameters (invalid or missing parameter). This is not a permission denial; the NAS may expect a different request for this DSM version. Update the desktop application, and copy the diagnostics if it persists.",
    150: "The request source IP differs from the login IP. Check the network route, then reconnect.",
    160: "The NAS blocked this client's IP address. Review DSM auto-block settings before retrying.",
  };
  const loginCodes: Record<number, string> = {
    400: "DSM did not accept the credentials. Check the saved username and password before retrying.",
    401: "The DSM account is disabled.",
    402: "DSM refused API sign-in for this account. The NAS API view signs in as a File Station session, so check the account's File Station application privilege and DSM login restrictions.",
    403: "DSM requires a two-factor authentication code.",
    404: "DSM did not accept the two-factor authentication code.",
    406: "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.",
    407: "DSM auto-block has blocked this client's IP address. Review the block before retrying.",
    408: "The password has expired and this account cannot change it. Ask a DSM administrator to reset it.",
    409: "DSM reports that the password has expired. Complete the password change in DSM.",
    410: "DSM reports that the password has expired. Complete the password change in DSM.",
    449: "DSM requires a sign-in method the NAS API can't complete. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
  };
  const summary =
    data.category === "dsm_api" && data.dsmCode !== undefined
      ? ((data.stage === "api_login" ? loginCodes[data.dsmCode] : undefined) ??
        (SYNOLOGY_PERMISSION_CODES.includes(data.dsmCode)
          ? permissionSummary(data)
          : commonCodes[data.dsmCode]) ??
        CATEGORIES.dsm_api)
      : CATEGORIES[data.category];
  const rows: [string, string][] = [
    ["Step", STAGES[data.stage]],
    ["HTTP status", String(data.httpStatus)],
    ["Response kind", data.category.replace(/_/g, " ")],
    ["Content type", CONTENT_TYPES[data.contentType]],
    ["Response bytes inspected", formatBytes(data.bytesRead)],
    ...(data.dsmCode === undefined
      ? []
      : [["DSM code", String(data.dsmCode)] as [string, string]]),
    ...(data.access === undefined
      ? []
      : [["Required access", ACCESS[data.access]] as [string, string]]),
  ];
  return {
    summary,
    rows,
    copy: [
      "Synology NAS API failure",
      summary,
      ...rows.map(
        ([label, value]) =>
          `${label}: ${label === "Response bytes inspected" ? data.bytesRead : value}`,
      ),
      "No URLs, credentials, headers, cookies or response bodies are included. Bytes inspected is not necessarily the full response size; the body is not retained in this diagnostic. No automatic sign-in retry was made.",
    ].join("\n"),
  };
}
