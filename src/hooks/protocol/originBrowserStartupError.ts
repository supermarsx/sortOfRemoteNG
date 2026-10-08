export type OriginBrowserStartupStage =
  "listen" | "status" | "owner-check" | "create" | "resync";
export interface OriginBrowserStartupFailure {
  stage: OriginBrowserStartupStage;
  category:
    | "certificate-policy"
    | "certificate-bridge"
    | "connection"
    | "runtime"
    | "ipc";
}
const certificatePolicyFailure =
  "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported";
const certificateBridgeFailure =
  "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.";
const mfaOriginFailure =
  "Saved automatic two-factor authentication consent does not match the reviewed login origin. In Application settings, review the authenticator and HTTPS login origin, re-enable automatic codes, and save the connection. Your password and authenticator are unchanged.";

// Exact fixed native stage failures only. Never append arbitrary native error
// text (including page addresses) or infer a runtime failure from a substring.
const runtimeFailures = new Set([
  "Native browser working-data preparation failed. Review Settings > Web Browser and restart if the working folder changed; the owning database and retained cookies were not changed.",
  "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
  "Native browser initialization or policy readiness timed out. Check the native startup diagnostics and restart the app.",
  "Native browser initialization or policy readiness failed. Check the native startup diagnostics and restart the app.",
  "The packaged real-origin browser is unavailable; no direct-network fallback was used.",
  "Native browser private proxy could not start. Reopen the tab and check the native startup diagnostics; no direct-network fallback was used.",
  "Native browser private context preparation failed. Check the native startup diagnostics for proxy, certificate or storage setup; this is not a saved-password rejection.",
  "Native browser cookie restoration failed. Reopen the tab and check the native startup diagnostics; no other connection's cookies were used.",
  "Native browser embedded view creation failed. Reopen the tab and check the native startup diagnostics; this is not a website login failure.",
  "Native browser renderer setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.",
  "Native browser initial zoom setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.",
  "Native browser first navigation failed. Review this connection's destination permissions and network route, and check the native startup diagnostics.",
  "Native browser tab preparation timed out. Reopen the tab and check the native startup diagnostics; the database was not locked by this timeout.",
]);

// Exact native-only strings from origin_browser_login.rs and
// origin_browser_authority.rs (compiled by sorng-commands-core). Never match a
// prefix/substring or append native exception text, stack, URL or credentials.
const knownFailures = new Map<string, string>([
  ...[
    "Saved browser session retention settings are invalid.",
    "Sign-in cookie retention could not be prepared for this database.",
    "Sign-in cookies could not be read.",
    "Sign-in cookies could not be read for this unlocked database.",
    "Retained sign-in cookies could not be restored safely.",
    "A browser attempt already exists for this tab, or the native browser limit was reached.",
  ].map((message): [string, string] => [message, message]),
  [
    "This saved automatic-login configuration is not supported by the real-origin browser yet. Choose manual login explicitly in this connection's settings to open it without automatic credential entry.",
    "This connection's automatic-login configuration is not supported by the native browser yet. Review its saved login settings; manual login must be an explicit choice.",
  ],
  [
    "Website login was not authorized. No saved credentials were sent. Reopen the website to review consent, or select manual login in its connection settings.",
    "Website login was not authorized. No saved credentials were sent. Reopen the website to review native consent, or explicitly choose manual login in its connection settings.",
  ],
  [
    "Finish the existing website login consent dialog first.",
    "Finish the existing website login consent dialog, then retry this connection.",
  ],
  [
    "Saved website credentials are unavailable. Unlock the owning database and review this connection's credential source before retrying.",
    "Saved website credentials are unavailable. Unlock the owning database and review this connection's credential source before retrying.",
  ],
  [
    "Automatic website login needs complete saved credentials. Edit this connection's website login credentials or linked database-vault entry, or explicitly choose manual login, then reopen the tab.",
    "Automatic website login needs complete saved credentials. Edit this connection's website login credentials or linked database-vault entry, or explicitly choose manual login, then reopen the tab.",
  ],
  [
    "Website login consent could not be prepared. Review this connection's saved login destinations.",
    "Website login consent could not be prepared. Review this connection's saved login destinations.",
  ],
  [
    "Browser creation request is invalid",
    "The saved browser configuration could not be accepted. Review the connection settings and reopen the tab.",
  ],
  [
    "Browser saved database owner is unavailable or changed",
    "The owning database is unavailable or changed. Unlock it and reopen the connection from that database.",
  ],
  [
    "Browser initial URL does not match its saved source",
    "The requested start address no longer matches the saved connection. Review its address and reopen the tab.",
  ],
  [
    "Saved browser permission policy is invalid or unsupported",
    "The saved website permission policy is invalid or unsupported. Review the global and connection website permissions.",
  ],
  [
    certificatePolicyFailure,
    "The saved HTTPS trust policy cannot be enforced by this native browser configuration. Review its trust settings and installed browser runtime. No trust-policy change or fallback was applied.",
  ],
  [certificateBridgeFailure, certificateBridgeFailure],
  [mfaOriginFailure, mfaOriginFailure],
  [
    "Saved application entry or login route has no native translation",
    "This saved application entry or login route has no native translation yet. Review the connection's application settings.",
  ],
  [
    "Saved browser network route is invalid or unsupported; no direct fallback",
    "The saved browser network route is invalid or unsupported. Review its proxy or tunnel configuration; no direct fallback was used.",
  ],
  [
    "Saved website credentials are unavailable or invalid in the owning database; review its credential reference",
    "Saved website credentials are unavailable or invalid. Unlock the owning database and review the connection's credential reference.",
  ],
  [
    "Managed database revision and unlock proof are required",
    "The managed database unlock proof is missing. Unlock the owning database and reopen the connection.",
  ],
  [
    "This website's database or browser session is no longer available. Reopen it from its owning database.",
    "The database or browser session changed during startup. Reopen the connection from its owning database.",
  ],
]);

const stageGuidance: Record<OriginBrowserStartupStage, string> = {
  listen:
    "Could not subscribe to native browser events. Reopen the tab; if it repeats, check the app's native IPC setup.",
  status:
    "Could not read native browser capability status. Reopen the tab; this failure does not establish that CEF is unavailable.",
  "owner-check":
    "The database owner check failed before creation. Unlock the owning database and reopen the connection.",
  create:
    "The native create request failed. Reopen the tab and check the native startup diagnostics for the failing step; this message does not establish a credential or GPU failure.",
  resync:
    "Could not read the created browser's state. This attempt is being closed; reopen the tab to retry.",
};

export function originBrowserStartupError(
  stage: OriginBrowserStartupStage,
  error: unknown,
): OriginBrowserStartupFailure & { message: string } {
  // Do not stringify arbitrary objects or invoke a message getter.
  const candidate: unknown =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? Object.getOwnPropertyDescriptor(error, "message")?.value
        : undefined;
  // Only create invokes saved-authority validation and deferred native startup.
  // The same text from another stage cannot establish that runtime prerequisite.
  const certificateFailure = candidate === certificatePolicyFailure;
  const bridgeFailure = candidate === certificateBridgeFailure;
  const mfaFailure = candidate === mfaOriginFailure;
  if (
    stage === "create" &&
    typeof candidate === "string" &&
    runtimeFailures.has(candidate)
  ) {
    return {
      stage,
      category: "runtime",
      message: `Native browser startup failed (${stage}). ${candidate}`,
    };
  }
  const guidance =
    typeof candidate === "string" &&
    (!(certificateFailure || bridgeFailure || mfaFailure) || stage === "create")
      ? knownFailures.get(candidate)
      : undefined;
  return {
    stage,
    category:
      bridgeFailure && stage === "create"
        ? "certificate-bridge"
        : certificateFailure && stage === "create"
          ? "certificate-policy"
          : guidance || stage === "owner-check"
            ? "connection"
            : "ipc",
    message: `Native browser startup failed (${stage}). ${guidance ?? stageGuidance[stage]}`,
  };
}
