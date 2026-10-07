export type OriginBrowserStartupStage =
  "listen" | "status" | "owner-check" | "create" | "resync";
export interface OriginBrowserStartupFailure {
  stage: OriginBrowserStartupStage;
  category: "certificate-policy" | "certificate-bridge" | "connection" | "ipc";
}
const certificatePolicyFailure =
  "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported";
const certificateBridgeFailure =
  "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.";

// Exact native-only strings from origin_browser_login.rs and
// origin_browser_authority.rs (compiled by sorng-commands-core). Never match a
// prefix/substring or append native exception text, stack, URL or credentials.
const knownFailures = new Map<string, string>([
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
    "The native create request failed. Review the saved connection's login, credentials, permissions and network route before retrying.",
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
  // Only create invokes saved-authority validation, after available capability.
  // The same text from another stage cannot establish that runtime prerequisite.
  const certificateFailure = candidate === certificatePolicyFailure;
  const bridgeFailure = candidate === certificateBridgeFailure;
  const guidance =
    typeof candidate === "string" && (!(certificateFailure || bridgeFailure) || stage === "create")
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
