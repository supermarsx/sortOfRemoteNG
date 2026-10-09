import type {
  BrowserFailureDetail,
  BrowserRecoveryAction,
} from "./originBrowserFailureDetails";

const references = {
  ownerDatabaseId: ["Owning database reference", "database"],
  connectionId: ["Connection reference", "connection"],
  sessionId: ["Browser tab reference", "connection"],
  expectedSecurityRevision: ["Database security revision", "database"],
  sourceSessionId: ["Database unlock-session reference", "database"],
  grantId: ["Website login grant reference", "application"],
} as const satisfies Record<string, readonly [string, BrowserRecoveryAction]>;
type Reference = keyof typeof references;
type ReferenceIssue = `${Reference}:${"missing" | "type" | "too-long"}`;
export type BrowserConfigurationIssue =
  | ReferenceIssue
  | "url-missing"
  | "url-type"
  | "url-too-long"
  | "url-characters"
  | "url-invalid"
  | "url-scheme"
  | "url-credentials"
  | "consent-kind";

const urlProblems = {
  "url-missing":
    "The starting website address is empty or could not be derived from the saved application settings.",
  "url-type": "The starting website address is not stored as text.",
  "url-too-long":
    "The starting website address exceeds the 16,384-byte browser request limit.",
  "url-characters":
    "The starting website address contains whitespace, a control character or a backslash.",
  "url-invalid":
    "The starting website address is not a valid absolute URL, or its hostname or port is invalid.",
  "url-scheme":
    "The starting website address uses a scheme other than HTTP or HTTPS.",
  "url-credentials":
    "The starting website address contains embedded username or password information, which is not allowed.",
} as const;

function checkUrl(value: unknown): {
  url: string | null;
  issue?: BrowserConfigurationIssue;
} {
  if (value === "" || value === undefined || value === null)
    return { url: null, issue: "url-missing" };
  if (typeof value !== "string") return { url: null, issue: "url-type" };
  if (value.length > 16_384 || new TextEncoder().encode(value).length > 16_384)
    return { url: null, issue: "url-too-long" };
  if (
    /[\s\\]/.test(value) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return { url: null, issue: "url-characters" };
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
      return { url: null, issue: "url-scheme" };
    if (url.username || url.password)
      return { url: null, issue: "url-credentials" };
    if (new TextEncoder().encode(url.href).length > 16_384)
      return { url: null, issue: "url-too-long" };
    return { url: url.href };
  } catch {
    return { url: null, issue: "url-invalid" };
  }
}

export function originBrowserNavigationUrl(value: unknown): string | null {
  return checkUrl(value).url;
}

/** Fixed rule codes only: no reference values, addresses, grants or secrets. */
export function validateOriginBrowserConfiguration(input: {
  initialUrl: unknown;
  ownerDatabaseId: unknown;
  connectionId: unknown;
  sessionId: unknown;
  expectedSecurityRevision: unknown;
  sourceSessionId: unknown;
  consentKind: unknown;
  grantId: unknown;
}) {
  const { url, issue } = checkUrl(input.initialUrl);
  const issues: BrowserConfigurationIssue[] = issue ? [issue] : [];
  for (const field of Object.keys(references) as Reference[]) {
    if (field === "grantId" && input.consentKind !== "existing-grant") continue;
    const value = input[field];
    if (value === "" || value === undefined || value === null)
      issues.push(`${field}:missing`);
    else if (typeof value !== "string") issues.push(`${field}:type`);
    else if (value.length > 256) issues.push(`${field}:too-long`);
  }
  if (
    input.consentKind !== "required" &&
    input.consentKind !== "existing-grant"
  )
    issues.push("consent-kind");
  return { url, issues };
}

export function originBrowserConfigurationDetails(
  issues: readonly BrowserConfigurationIssue[],
): BrowserFailureDetail[] {
  const result: BrowserFailureDetail[] = [];
  for (const code of new Set(issues)) {
    if (Object.prototype.hasOwnProperty.call(urlProblems, code)) {
      result.push({
        code,
        field: "Starting website address",
        problem: urlProblems[code as keyof typeof urlProblems],
        nextStep:
          "Review the connection address and application entry URL. Use an absolute HTTP(S) address; keep credentials in the credential fields. Then retry.",
        action: "connection",
      });
    } else if (code === "consent-kind") {
      result.push({
        code,
        field: "Website login consent",
        problem: "The login consent mode is not supported.",
        nextStep:
          "Review the connection's application login settings and reopen its tab to obtain a fresh login grant.",
        action: "application",
      });
    } else {
      // Whitelist both halves even if an untyped caller provides arbitrary data.
      const [field, violation] = String(code).split(":");
      if (
        !Object.prototype.hasOwnProperty.call(references, field) ||
        !["missing", "type", "too-long"].includes(violation) ||
        `${field}:${violation}` !== code
      )
        continue;
      const [label, action] = references[field as Reference];
      result.push({
        code,
        field: label,
        problem: `${label} ${violation === "missing" ? "is missing" : violation === "type" ? "is not stored as text" : "exceeds the 256-character limit"}.`,
        nextStep:
          action === "database"
            ? "Open or unlock this tab's owning database, then reopen the connection from it to refresh its security proof. No other database will be substituted."
            : action === "application"
              ? "Review the connection's application login settings, then reopen its tab to obtain a fresh login grant."
              : "Reopen this connection from its owning database, or create a new Quick Connect tab. This is a session-reference problem, not a rejected website password.",
        action,
      });
    }
  }
  return result;
}
