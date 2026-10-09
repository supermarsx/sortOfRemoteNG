import type { OriginBrowserState } from "./useOriginBrowser";
import {
  originBrowserPolicyFailures,
  type OriginBrowserKnownStartupFailureCode,
} from "./originBrowserStartupError";
import { originBrowserConfigurationDetails } from "./originBrowserConfiguration";
import { nativeProxyConnectionFailure } from "./originBrowserSessionError";
import type {
  OriginBrowserFailureReason,
  OriginBrowserLoadFailureCategory,
  OriginBrowserUnavailableReason,
  OriginBrowserRuntimeFailure,
} from "../../types/protocols/originBrowser";
import { originBrowserRuntimeFailure } from "../../types/protocols/originBrowser";

export type BrowserRecoveryAction =
  | "connection"
  | "application"
  | "credentials"
  | "permissions"
  | "network"
  | "browser-session"
  | "trust"
  | "database"
  | "browser-settings"
  | "legacy-proxy";

export interface BrowserFailureDetail {
  code: string;
  field: string;
  problem: string;
  nextStep: string;
  action: BrowserRecoveryAction;
}

type Explanation = readonly [
  field: string,
  problem: string,
  nextStep: string,
  action: BrowserRecoveryAction,
];

const policyDetails = new Map(
  originBrowserPolicyFailures.map(
    ({ code, field, problem, nextStep, action }) => [
      code,
      { code, field, problem, nextStep, action },
    ],
  ),
);

const startupDetails: Record<
  OriginBrowserKnownStartupFailureCode,
  Explanation
> = {
  "settings-unavailable": [
    "Saved application settings",
    "The native browser could not read saved application settings.",
    "Review the active settings profile and its storage availability in Web Browser settings, then reopen the connection.",
    "browser-settings",
  ],
  "preferences-invalid": [
    "Saved native browser preferences",
    "Saved browser preferences failed validation. Native did not identify the field or value.",
    "Review shared Web Browser settings and connection Browser Session overrides, then consult native startup diagnostics for a specific invalid setting before changing values.",
    "browser-settings",
  ],
  "capabilities-invalid": [
    "Native browser capability preferences",
    "Saved browser capabilities are invalid or unsupported. Native did not identify a specific capability.",
    "Review shared Web Browser settings and connection Browser Session capability overrides and native startup diagnostics before changing values.",
    "browser-settings",
  ],
  "working-data": [
    "Native browser working folder",
    "The native browser could not prepare its working data.",
    "Review the working folder in Web Browser settings and its filesystem access. Restart the app if you change that folder.",
    "browser-settings",
  ],
  "runtime-package": [
    "Native browser runtime package",
    "The native package or runtime settings could not be prepared; the failing prerequisite was not reported.",
    "Review the runtime configuration in Web Browser settings and native startup diagnostics before retrying.",
    "browser-settings",
  ],
  "runtime-timeout": [
    "Native browser initialization",
    "Native initialization or required policy readiness timed out.",
    "Review native startup diagnostics and the installed runtime in Web Browser settings, then restart the app.",
    "browser-settings",
  ],
  "runtime-readiness": [
    "Native browser initialization",
    "Native initialization or required policy readiness failed; the underlying prerequisite was not reported.",
    "Review native startup diagnostics and the installed runtime in Web Browser settings, then restart the app.",
    "browser-settings",
  ],
  "runtime-unavailable": [
    "Native browser runtime",
    "The packaged native browser is unavailable. Native did not report which prerequisite is missing.",
    "Review the installed runtime and native startup diagnostics in Web Browser settings.",
    "browser-settings",
  ],
  "private-proxy": [
    "Native browser private proxy",
    "The private browser proxy could not start. No direct route was used.",
    "Review the connection's proxy or tunnel route and native startup diagnostics, then reopen the tab.",
    "network",
  ],
  "private-context": [
    "Native browser private context",
    "Private context preparation failed. The report does not distinguish proxy, certificate, or storage setup.",
    "Review native startup diagnostics in Web Browser settings for the failing prerequisite, then reopen the tab.",
    "browser-settings",
  ],
  "cookie-restore": [
    "Browser sign-in cookie restoration",
    "The native browser could not restore this session's sign-in cookies.",
    "Review this connection's browser session retention settings and native startup diagnostics, then reopen the tab.",
    "browser-session",
  ],
  "embedded-view": [
    "Native embedded browser view",
    "The native embedded view could not be created.",
    "Review native startup diagnostics and runtime settings in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
  "renderer-setup": [
    "Native page renderer setup",
    "The native renderer setup failed before the first navigation.",
    "Review the installed runtime and native startup diagnostics in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
  "initial-zoom": [
    "Native browser initial zoom",
    "The native browser rejected initial zoom setup before the first navigation.",
    "Review browser zoom preferences and native startup diagnostics in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
  "initial-navigation": [
    "Initial website navigation",
    "The first native navigation failed. The report does not distinguish destination policy from network routing.",
    "Review the connection destination, its website permissions and configured route, then consult native startup diagnostics.",
    "connection",
  ],
  "tab-timeout": [
    "Native browser tab preparation",
    "Native tab preparation timed out. This does not establish a database lock or a rejected website password.",
    "Review native startup diagnostics in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
  "session-retention": [
    "Browser session retention settings",
    "The saved browser session retention settings are invalid.",
    "Review this connection's browser session retention options, explicitly save supported values, then reopen the tab.",
    "browser-session",
  ],
  "cookie-retention": [
    "Database sign-in cookie retention",
    "Sign-in cookie retention could not be prepared for the owning database.",
    "Review browser session retention settings and native startup diagnostics for this database before reopening the tab.",
    "browser-session",
  ],
  "cookie-read": [
    "Retained sign-in cookies",
    "The native browser could not read retained sign-in cookies; the underlying storage failure was not reported.",
    "Review browser session retention settings and native startup diagnostics before reopening the tab.",
    "browser-session",
  ],
  "cookie-read-owner": [
    "Owning database sign-in cookies",
    "Retained cookies could not be read for this unlocked database.",
    "Review the owning database's availability and native startup diagnostics, then reopen its connection.",
    "database",
  ],
  "cookie-restore-unsafe": [
    "Retained sign-in cookies",
    "Retained sign-in cookies could not be restored safely.",
    "Review browser session retention settings and native startup diagnostics. Reopen the tab after resolving the reported storage issue.",
    "browser-session",
  ],
  "attempt-limit": [
    "Native browser attempts",
    "An attempt already exists for this tab, or the native browser limit was reached. Native did not distinguish the two cases.",
    "Close unused browser tabs and allow their cleanup to finish, then reopen this connection. Review Web Browser diagnostics if it persists.",
    "browser-settings",
  ],
  "login-unsupported": [
    "Application automatic-login configuration",
    "The saved automatic-login configuration is not supported by the native browser.",
    "Review Application login settings. Choose a supported configuration, or explicitly choose manual login and save the connection.",
    "application",
  ],
  "login-not-authorized": [
    "Website login consent",
    "Website login was not authorized. No saved credentials were sent.",
    "Reopen the website to review consent, or explicitly choose manual login in Application settings and save the connection.",
    "application",
  ],
  "login-consent-pending": [
    "Website login consent",
    "An existing website login consent dialog must finish first.",
    "Finish the pending consent dialog before retrying. Review Application login settings if you intend to change the login mode.",
    "application",
  ],
  "credentials-unavailable": [
    "Website credential source",
    "Saved website credentials are unavailable; native did not identify whether the database or credential source was unavailable.",
    "Unlock the owning database and review this connection's saved credentials or linked vault entry, then reopen the tab.",
    "credentials",
  ],
  "credentials-incomplete": [
    "Website login credentials",
    "Automatic login requires complete saved credentials, but the saved credential source is incomplete.",
    "Complete this connection's username and password or linked vault entry, or explicitly choose manual login in Application settings. Save and reopen the tab.",
    "credentials",
  ],
  "login-destinations": [
    "Application login destinations",
    "Website login consent could not be prepared for the saved login destinations.",
    "Review the Application entry and login destination settings, explicitly save the intended destinations, then reopen the tab.",
    "application",
  ],
  "request-invalid": [
    "Native browser creation request",
    "The native browser rejected the creation request without identifying the invalid field.",
    "Review the connection settings and reopen its tab. Consult native startup diagnostics if it repeats.",
    "connection",
  ],
  "owner-unavailable": [
    "Owning database",
    "The saved database owner is unavailable or changed.",
    "Open or unlock the owning database, then reopen this connection from it to obtain fresh ownership proof.",
    "database",
  ],
  "source-mismatch": [
    "Starting website address",
    "The requested start address does not match the saved connection source.",
    "Review the connection address and Application entry URL, save the intended address, then reopen the tab.",
    "connection",
  ],
  "permissions-invalid": [
    "Saved website policy (field not reported)",
    "The native validator rejected a saved website policy as invalid or unsupported. This legacy report does not identify the setting, scope, or rejected value.",
    "Review global Web Browser settings and this connection's website permissions and legacy proxy policy. A specific field must be identified before changing it; check native startup diagnostics. No permission was changed.",
    "permissions",
  ],
  "certificate-policy": [
    "Saved HTTPS trust policy",
    "The saved HTTPS trust policy requires a native certificate adapter that this configuration cannot provide.",
    "Review the saved trust settings and install a runtime that supports the required certificate adapter. Keep the intended verification policy.",
    "trust",
  ],
  "certificate-bridge": [
    "Native certificate-verifier bridge",
    "The loaded CEF runtime does not provide the required app certificate-verifier bridge.",
    "Review Web Browser runtime settings and install or rebuild the patched runtime with the certificate-verifier bridge, then restart the app.",
    "browser-settings",
  ],
  "mfa-origin-mismatch": [
    "Application automatic two-factor consent",
    "Saved automatic two-factor consent does not match the reviewed login origin.",
    "In Application settings, review the authenticator and HTTPS login origin, re-enable automatic codes, and save the connection. The password and authenticator remain unchanged.",
    "application",
  ],
  "application-unsupported": [
    "Application entry or login route",
    "The saved application entry or login route has no native translation.",
    "Review Application entry and login-route settings and choose a supported configuration, then save and reopen the connection.",
    "application",
  ],
  "network-route": [
    "Saved browser network route",
    "The saved proxy or tunnel route is invalid or unsupported. No direct fallback was used.",
    "Review and correct the connection's proxy or tunnel configuration, save the intended route, then reopen the tab.",
    "network",
  ],
  "credential-reference": [
    "Website credential reference",
    "The credential reference is unavailable or invalid in the owning database.",
    "Unlock the owning database and review the connection's credential reference or linked vault entry. Save any correction before reopening the tab.",
    "credentials",
  ],
  "owner-proof": [
    "Database revision and unlock proof",
    "The managed database security revision or unlock proof is missing.",
    "Open or unlock the owning database, then reopen the connection from it to refresh its security proof.",
    "database",
  ],
  "session-stale": [
    "Database or browser session",
    "The database or browser session became unavailable during startup.",
    "Open or unlock the owning database and reopen this connection from it.",
    "database",
  ],
};

const loadDetails: Record<OriginBrowserLoadFailureCategory, Explanation> = {
  dns: [
    "DNS resolution",
    "DNS resolution failed or resolver policy blocked it.",
    "Review DNS and the configured network route, then navigate again when ready.",
    "network",
  ],
  connection: [
    "Website network connection",
    "The connection was refused, closed, or interrupted. The category does not distinguish these causes.",
    "Check site availability and the configured network route, then navigate again when ready.",
    "network",
  ],
  timeout: [
    "Website request timeout",
    "The request timed out; the report does not identify which network hop failed.",
    "Check site availability and the configured network route, then navigate again when ready.",
    "network",
  ],
  "network-changed": [
    "Configured network route",
    "The network changed while the request was loading.",
    "Ensure the configured proxy or tunnel route is connected before navigating again.",
    "network",
  ],
  offline: [
    "Network connectivity",
    "The browser reported that the network is offline.",
    "Restore connectivity through the configured network route before navigating again.",
    "network",
  ],
  proxy: [
    "Proxy or tunnel route",
    "The configured proxy or tunnel could not complete the request.",
    "Review the route's availability and proxy authentication settings before navigating again.",
    "network",
  ],
  certificate: [
    "HTTPS certificate verification",
    "Certificate verification failed; this category alone does not identify the certificate defect.",
    "Review the certificate and saved trust policy before retrying the request.",
    "trust",
  ],
  tls: [
    "TLS connection",
    "The secure connection could not be established.",
    "Review the server's TLS configuration, saved trust settings, and any required client certificate.",
    "trust",
  ],
  blocked: [
    "Website request policy",
    "A browser or security policy blocked the request. This does not identify a particular permission rule.",
    "Review destination permissions and the site's security requirements before retrying the request.",
    "permissions",
  ],
  http: [
    "Website response",
    "The server response could not be loaded; this category does not identify an HTTP status or a login rejection.",
    "Review this connection's destination and the response in browser diagnostics before retrying.",
    "connection",
  ],
  redirect: [
    "Website redirect or login route",
    "The request exceeded the redirect limit.",
    "Review Application entry and login-route settings and the site's redirect configuration before navigating again.",
    "application",
  ],
  cache: [
    "Browser response cache",
    "The saved response could not be read.",
    "Review browser session settings, then navigate again when ready. Resubmitting a form may repeat its action.",
    "browser-session",
  ],
  other: [
    "Website page request",
    "The native browser reported a page-load failure without a more specific supported category.",
    "Review the numeric native error code in browser diagnostics and this connection's destination before retrying.",
    "connection",
  ],
};

const terminalDetails: Record<OriginBrowserFailureReason, Explanation> = {
  renderer: [
    "Native page renderer",
    "The page renderer stopped or its communication bridge failed. The underlying cause was not reported.",
    "Review native browser diagnostics in Web Browser settings, then reopen the tab. Restart the app if it repeats.",
    "browser-settings",
  ],
  session: [
    "Native private browser session",
    "The private browser session was no longer available or valid. No specific cause was reported.",
    "Use Retry browser or reopen the tab. If it repeats, review native browser diagnostics in Web Browser settings and restart the app.",
    "browser-settings",
  ],
  "database-owner": [
    "Database-session authorization",
    "The database-session authorization is no longer current. This report does not establish that the database is locked.",
    "Reopen the connection from its owning database to obtain current authorization. If it repeats, review native browser diagnostics in Web Browser settings.",
    "database",
  ],
  watchdog: [
    "Native browser response deadline",
    "A UI callback did not complete before the watchdog deadline, so the session was stopped. The underlying cause was not reported.",
    "Wait for the app to respond, then use Retry browser. If it repeats, review native browser diagnostics in Web Browser settings and restart the app.",
    "browser-settings",
  ],
  "private-context": [
    "Private browser context",
    "The private browser context could not be verified or kept available. The underlying cause was not reported.",
    "Use Retry browser to create a fresh private session. If it repeats, review native browser diagnostics in Web Browser settings.",
    "browser-settings",
  ],
  "private-proxy": [
    "Private browser proxy",
    "The private browser proxy was unavailable or its required binding could not be verified.",
    "Use Retry browser to create a fresh private session. If it repeats, review native browser diagnostics in Web Browser settings and the configured network route.",
    "browser-settings",
  ],
  "redirect-denied": [
    "Website redirect destination policy",
    "A redirect could not be admitted by the session's destination policy. This report does not establish rejected website credentials.",
    "Review the connection's permitted destinations and native browser diagnostics before retrying. Keep destination checks, HTTPS trust settings, and proxy protections enabled.",
    "permissions",
  ],
  "native-state": [
    "Native browser session state",
    "The app could not safely access native browser session state, so the session was stopped.",
    "Use Retry browser. If it repeats, restart the app and review native browser diagnostics in Web Browser settings.",
    "browser-settings",
  ],
  "certificate-bridge": [
    "Private-session TLS admission bridge",
    "The TLS admission bridge for this private session failed. This report does not establish a server-certificate rejection.",
    "Use Retry browser to create a fresh private context. If it repeats, check the TLS journal in native browser diagnostics. Keep HTTPS trust settings and website credentials unchanged.",
    "browser-settings",
  ],
  "runtime-unavailable": [
    "Native browser runtime",
    "The native browser runtime was no longer available for this session. No specific runtime cause was reported.",
    "Review native browser diagnostics in Web Browser settings and restart the app before retrying.",
    "browser-settings",
  ],
  "owner-window": [
    "Owning app window or document",
    "The app window or document that owned this browser session is no longer current.",
    "Reopen the connection in its current app window. If it repeats, review native browser diagnostics in Web Browser settings.",
    "browser-settings",
  ],
  callback: [
    "Native browser callback",
    "An internal native callback failed and the session was stopped.",
    "Review native browser diagnostics in Web Browser settings, then reopen the tab. Restart the app if it repeats.",
    "browser-settings",
  ],
  "native-surface": [
    "Native embedded browser view",
    "The app could not maintain the embedded browser view.",
    "Review native browser diagnostics in Web Browser settings, then reopen the tab. Restart the app if it repeats.",
    "browser-settings",
  ],
  load: [
    "Native page loading",
    "The session stopped because its page could not load. Native did not report a more specific cause.",
    "Review the connection destination, website permissions, configured route, and native browser diagnostics before reopening the tab.",
    "connection",
  ],
};

const unavailableDetails: Record<OriginBrowserUnavailableReason, Explanation> =
  {
    "runtime-missing": [
      "Packaged native browser runtime",
      "The packaged native browser runtime is missing.",
      "Review Web Browser runtime settings and install the required packaged runtime, then restart the app.",
      "browser-settings",
    ],
    "platform-unsupported": [
      "Native browser platform support",
      "The native browser does not support this platform.",
      "Review Web Browser runtime availability and use a supported platform and runtime for this connection.",
      "browser-settings",
    ],
    "containment-unverified": [
      "Native browser network containment",
      "Native network containment could not be verified.",
      "Review the native runtime and containment diagnostics in Web Browser settings before reopening the connection.",
      "browser-settings",
    ],
    "policy-unavailable": [
      "Required native browser policies",
      "A required native browser policy is unavailable. This capability report does not identify an invalid saved permission setting.",
      "Review native policy readiness diagnostics and the installed runtime in Web Browser settings.",
      "browser-settings",
    ],
    "owner-unavailable": [
      "Owning database",
      "The owning database is unavailable to this browser tab.",
      "Open or unlock the owning database, then reopen the connection from it.",
      "database",
    ],
    "host-unavailable": [
      "Native browser host",
      "The native browser host is unavailable; no specific prerequisite was reported.",
      "Review native startup diagnostics and runtime settings in Web Browser settings, then reopen the tab.",
      "browser-settings",
    ],
  };

const runtimeDetails: Record<OriginBrowserRuntimeFailure["code"], Explanation> =
  {
    "data-directory": [
      "Native browser working data",
      "The browser could not prepare or activate a usable working-data directory.",
      "Review the browser data folder in Web Browser settings. Check that the drive is available, writable and has free space, and that another app instance is not using it. Keep saved database sessions intact, then retry.",
      "browser-settings",
    ],
    "runtime-package": [
      "Native browser runtime package",
      "The app could not prepare the installed CEF runtime package for startup.",
      "Repair or rebuild the app with its matching packaged CEF runtime and resources, then restart. Changing website permissions will not repair the runtime package.",
      "browser-settings",
    ],
    "startup-provider": [
      "Native browser startup provider",
      "The native browser startup provider is unavailable.",
      "Restart the app. If this repeats, repair or rebuild the app's native browser installation and inspect the startup journal.",
      "browser-settings",
    ],
    "certificate-bridge": [
      "Native certificate-verifier bridge",
      "The runtime could not make the required app certificate-verifier bridge available.",
      "Install or rebuild the matching patched CEF runtime, then restart. Keep the saved certificate trust policy unchanged; website permission changes do not fix this engine prerequisite.",
      "browser-settings",
    ],
    "runtime-policy": [
      "Native runtime policy verification",
      "The engine could not maintain the required runtime policy checks. This is not evidence of an invalid saved website permission.",
      "Inspect the native startup journal for the failed policy check, then restart after resolving the runtime problem. Network containment remains enforced; no direct fallback is used.",
      "browser-settings",
    ],
    "startup-timeout": [
      "Native engine startup timeout",
      "Native browser startup did not reach readiness before its deadline.",
      "Restart the app before trying again. Inspect the startup journal if it repeats; do not disable certificate or proxy protections to bypass the timeout.",
      "browser-settings",
    ],
    "ui-dispatch": [
      "Native engine UI dispatch",
      "The app could not schedule or complete native browser work on its UI thread.",
      "Restart the app and inspect the native startup journal if it repeats. This engine failure does not establish a website or saved-password problem.",
      "browser-settings",
    ],
    "runtime-initialization": [
      "Native engine initialization",
      "The native browser engine could not finish initialization.",
      "Restart the app and review the native startup journal and runtime installation. This failure does not establish a website or saved-password problem.",
      "browser-settings",
    ],
  };

const operationDetails: Record<
  NonNullable<OriginBrowserState["operationFailure"]>,
  Explanation
> = {
  presentation: [
    "Native browser presentation",
    "The native presentation update failed. The report does not identify its underlying cause.",
    "Review native browser diagnostics in Web Browser settings and reopen the tab.",
    "browser-settings",
  ],
  navigation: [
    "Native navigation operation",
    "The native navigation operation failed. It did not report whether a permission, route, or session check rejected it.",
    "Review this connection's destination, website permissions, and configured route, then consult native browser diagnostics.",
    "connection",
  ],
  control: [
    "Native browser control",
    "A native browser control operation failed. The failing prerequisite was not reported.",
    "Review native browser diagnostics in Web Browser settings, then reopen the tab if necessary.",
    "browser-settings",
  ],
  state: [
    "Native browser state",
    "The browser state could not be read or verified. The underlying cause was not reported.",
    "Review native browser diagnostics in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
  cleanup: [
    "Native browser cleanup",
    "The native browser did not confirm that the attempt finished closing.",
    "Allow cleanup to finish before reopening the tab. Review Web Browser diagnostics and restart the app if cleanup remains pending.",
    "browser-settings",
  ],
};

const startupStageDetails = {
  listen: [
    "Native browser event subscription",
    "The app could not subscribe to native browser events.",
    "Reopen the tab. Review native IPC diagnostics in Web Browser settings if it repeats.",
    "browser-settings",
  ],
  status: [
    "Native capability status",
    "The app could not read native capability status. This does not establish that the browser runtime is missing.",
    "Reopen the tab. Review native IPC diagnostics in Web Browser settings if it repeats.",
    "browser-settings",
  ],
  "owner-check": [
    "Database owner check",
    "The database owner check failed before browser creation.",
    "Open or unlock the owning database and reopen the connection from it.",
    "database",
  ],
  create: [
    "Native browser creation",
    "The native create request failed without a recognized specific cause.",
    "Review native startup diagnostics in Web Browser settings, then reopen the tab after resolving the reported prerequisite.",
    "browser-settings",
  ],
  resync: [
    "Created browser state",
    "The app could not read the created browser's state; the attempt is being closed.",
    "Review native IPC diagnostics in Web Browser settings, then reopen the tab.",
    "browser-settings",
  ],
} as const satisfies Record<string, Explanation>;

const unknown: Explanation = [
  "Native browser failure",
  "No supported structured cause was reported. The displayed error text does not establish which setting or subsystem failed.",
  "Review native browser diagnostics in Web Browser settings for the failing step before retrying.",
  "browser-settings",
];

function lookup<T extends string>(
  table: Record<T, Explanation>,
  code: unknown,
): Explanation | undefined {
  return typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(table, code)
    ? table[code as T]
    : undefined;
}

function detail(code: string, explanation: Explanation): BrowserFailureDetail {
  const [field, problem, nextStep, action] = explanation;
  return { code, field, problem, nextStep, action };
}

export function getOriginBrowserRuntimeFailureDetail(
  value: unknown,
): BrowserFailureDetail | undefined {
  const failure = originBrowserRuntimeFailure(value);
  return failure
    ? detail(`engine-${failure.code}`, runtimeDetails[failure.code])
    : undefined;
}

/** Fixed allowlisted explanations only. Never inspect error prose, page URLs,
 * titles, credentials, or native exception payloads to guess a recovery target. */
export function getOriginBrowserFailureDetails(
  state: OriginBrowserState,
): BrowserFailureDetail[] {
  if (state.configurationFailure) {
    const details = originBrowserConfigurationDetails(
      state.configurationFailure.issues,
    );
    return details.length
      ? details
      : [detail("configuration-unknown", unknown)];
  }
  const startup = state.startupFailure;
  if (
    state.phase === "error" &&
    startup?.stage === "create" &&
    startup.category === "runtime"
  ) {
    const engine = getOriginBrowserRuntimeFailureDetail(state.runtimeFailure);
    if (engine) return [engine];
  }
  if (startup) {
    if (startup.stage === "create") {
      // Preserve the existing MFA-only reason contract for older callers.
      const code =
        startup.code ??
        (startup.reason === "mfa-origin-mismatch" ? startup.reason : undefined);
      const policy =
        typeof code === "string"
          ? policyDetails.get(code as Parameters<typeof policyDetails.get>[0])
          : undefined;
      if (policy) return [{ ...policy }];
      const explanation = lookup(startupDetails, code);
      if (explanation) return [detail(code!, explanation)];
      if (
        startup.category === "certificate-policy" ||
        startup.category === "certificate-bridge"
      ) {
        return [detail(startup.category, startupDetails[startup.category])];
      }
    }
    // A broad connection category cannot establish credentials or permissions.
    const explanation = lookup(startupStageDetails, startup.stage);
    return [
      explanation
        ? detail(`startup-${startup.stage}`, explanation)
        : detail("startup-unknown", unknown),
    ];
  }
  if (state.operationFailure) {
    const explanation = lookup(operationDetails, state.operationFailure);
    return [
      explanation
        ? detail(`operation-${state.operationFailure}`, explanation)
        : detail("operation-unknown", unknown),
    ];
  }
  const snapshot = state.snapshot;
  if (snapshot?.phase === "failed") {
    const explanation = lookup(terminalDetails, snapshot.failureReason);
    return [
      explanation
        ? detail(`native-${snapshot.failureReason}`, explanation)
        : detail("native-unknown", unknown),
    ];
  }
  if (snapshot?.phase === "attached" && snapshot.loadFailure) {
    if (
      snapshot.loadFailure.category === "proxy" &&
      snapshot.loadFailure.code === -130
    ) {
      return [
        detail("load-proxy-connection", [
          "Native browser private proxy connection",
          nativeProxyConnectionFailure.problem,
          nativeProxyConnectionFailure.nextStep,
          "browser-settings",
        ]),
      ];
    }
    const explanation = lookup(loadDetails, snapshot.loadFailure.category);
    return [
      explanation
        ? detail(`load-${snapshot.loadFailure.category}`, explanation)
        : detail("load-unknown", unknown),
    ];
  }
  if (state.phase === "unavailable") {
    const runtimeFailure = originBrowserRuntimeFailure(state.runtimeFailure);
    if (runtimeFailure && state.unavailableReason !== "owner-unavailable") {
      return [
        detail(
          `engine-${runtimeFailure.code}`,
          runtimeDetails[runtimeFailure.code],
        ),
      ];
    }
    const explanation = lookup(unavailableDetails, state.unavailableReason);
    return [
      explanation
        ? detail(`unavailable-${state.unavailableReason}`, explanation)
        : detail("unavailable-unknown", unknown),
    ];
  }
  return state.phase === "error" || state.error
    ? [detail("unknown-failure", unknown)]
    : [];
}
