import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const EXCHANGE_OWA_MAILBOX_ERROR =
  "Enter a mailbox email address such as shared@example.com, not a URL or path. Use ASCII letters, digits, dots, hyphens, underscores or + aliases.";

/** Empty preserves the saved entry URL; undefined means invalid input. */
export function normalizeExchangeOwaMailbox(
  value: unknown,
): string | undefined {
  if (value === undefined) return "";
  if (
    typeof value !== "string" ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126,
    )
  )
    return undefined;
  const mailbox = value.trim();
  if (!mailbox) return "";
  if (mailbox.length > 254) return undefined;
  const parts = mailbox.split("@");
  if (parts.length !== 2) return undefined;
  const [local, domain] = parts;
  if (
    local.length > 64 ||
    !/^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$/.test(local) ||
    domain.length > 253
  )
    return undefined;
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
    )
  )
    return undefined;
  return mailbox;
}

/** initialUrl is the caller's canonical saved HTTPS entry, never a live page URL. */
export function resolveExchangeOwaInitialUrl(
  initialUrl: string,
  value: unknown,
): string {
  const mailbox = normalizeExchangeOwaMailbox(value);
  if (mailbox === undefined) throw new Error(EXCHANGE_OWA_MAILBOX_ERROR);
  const target = new URL(initialUrl);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("Exchange OWA requires HTTPS without URL credentials.");
  // All permitted characters are safe within one URL pathname segment, including
  // @ and +. Reject percent escapes and path/query delimiters before URL.pathname
  // serialization; the Exchange destination adapter intentionally rejects escapes.
  if (mailbox) {
    target.pathname = `/owa/${mailbox}/`;
    target.search = "";
    target.hash = "";
  } else if (target.pathname === "/" && !target.search && !target.hash) {
    target.pathname = "/owa/";
  }
  return target.toString();
}

// Distinct selectors select OWA's destination guard in the shared Exchange FBA
// adapter. They do not grant a proxy origin or opt an existing profile in.
export const EXCHANGE_OWA_LOGIN_SELECTORS = {
  usernameSelector:
    'form[name="logonForm"][method="post" i] input#username[name="username"]',
  passwordSelector:
    'form[name="logonForm"][method="post" i] input#password[name="password"][type="password"]',
  submitSelector:
    'form[name="logonForm"][method="post" i] .signinbutton[role="button"]',
} as const;

export const EXCHANGE_OWA_PROFILE: HttpApplicationProfile = {
  id: "exchange-owa",
  label: "Exchange Outlook on the web (on-premises)",
  category: "mailStorage",
  capability: "known-form",
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginPath: "/owa/",
  usernameLabel: "Domain\\username, UPN, or username",
  selectors: EXCHANGE_OWA_LOGIN_SELECTORS,
  description:
    "Optional on-premises Exchange OWA forms-based login at your organization's HTTPS mail host. Opens /owa/ or the secondary mailbox below, waits for the native Exchange sign-in form, and clicks its Sign in handler once, preserving the mailbox return destination and hidden fields. Enter the exact account format required by your server; saved or vault credentials use the configured proxy path. Windows authentication, federation/SSO, MFA, password changes and customized forms remain interactive. This is not Outlook Online or Microsoft 365.",
};
