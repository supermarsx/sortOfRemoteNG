export type OriginBrowserStartupStage =
  "listen" | "status" | "owner-check" | "create" | "resync";
export type OriginBrowserKnownStartupFailureCode =
  | "working-data"
  | "runtime-package"
  | "runtime-timeout"
  | "runtime-readiness"
  | "runtime-unavailable"
  | "private-proxy"
  | "private-context"
  | "cookie-restore"
  | "embedded-view"
  | "renderer-setup"
  | "initial-zoom"
  | "initial-navigation"
  | "tab-timeout"
  | "session-retention"
  | "cookie-retention"
  | "cookie-read"
  | "cookie-read-owner"
  | "cookie-restore-unsafe"
  | "attempt-limit"
  | "login-unsupported"
  | "login-not-authorized"
  | "login-consent-pending"
  | "credentials-unavailable"
  | "credentials-incomplete"
  | "login-destinations"
  | "request-invalid"
  | "owner-unavailable"
  | "source-mismatch"
  | "permissions-invalid"
  | "certificate-policy"
  | "certificate-bridge"
  | "mfa-origin-mismatch"
  | "application-unsupported"
  | "network-route"
  | "credential-reference"
  | "owner-proof"
  | "session-stale"
  | "settings-unavailable"
  | "preferences-invalid"
  | "capabilities-invalid";
export type OriginBrowserStartupFailureCode =
  OriginBrowserKnownStartupFailureCode | OriginBrowserPolicyFailureCode;
export interface OriginBrowserStartupFailure {
  stage: OriginBrowserStartupStage;
  /** Fixed native failure, retained separately from the broad legacy category. */
  code?: OriginBrowserStartupFailureCode;
  /** Exact native saved-authority failure, never inferred from display text. */
  reason?: "mfa-origin-mismatch";
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

// Every native policy message is assembled from these fixed literals. Never
// split a received message into a scope/rule, interpolate saved values, or use
// a prefix match: only an exact member of the generated whitelist is accepted.
const proxyRules = {
  object: [
    "must be an object",
    "",
    "Restore a policy object using the editor's supported internal proxy controls.",
  ],
  version: [
    "version must be 1 when present",
    "version",
    "Use policy version 1 when the version field is present.",
  ],
  "page-scripts": [
    "pageScripts must be allow when present",
    "pageScripts",
    "Set Page Scripts to Allow when present. A restrictive legacy rewrite mode has no native translation; review the intended domain script permissions before saving.",
  ],
  "all-requests": [
    "allowAllRequests must be false when present",
    "allowAllRequests",
    "This native runtime does not support the saved broad grant at this scope. Update and restart the app; configure Allow all requests on the connection, not in global defaults.",
  ],
  "all-scripts": [
    "allowAllScripts must be false when present",
    "allowAllScripts",
    "This native runtime does not support the saved broad grant at this scope. Update and restart the app; configure Allow all scripts on the connection, not in global defaults.",
  ],
  "all-requests-type": [
    "allowAllRequests must be a boolean when present",
    "allowAllRequests",
    "Use the Allow all website requests checkbox so the saved value is true or false. Enabled requests still use this connection's private proxy.",
  ],
  "all-scripts-type": [
    "allowAllScripts must be a boolean when present",
    "allowAllScripts",
    "Use the Allow all website scripts checkbox so the saved value is true or false. This does not disable native website CSP or grant login consent.",
  ],
  "all-requests-scope": [
    "allowAllRequests is connection-only",
    "allowAllRequests",
    "Keep Allow all requests false in global defaults. Enable it only in the intended saved connection's Internal proxy controls.",
  ],
  "all-scripts-scope": [
    "allowAllScripts is connection-only",
    "allowAllScripts",
    "Keep Allow all scripts false in global defaults. Enable it only in the intended saved connection's Internal proxy controls.",
  ],
  "https-only-type": [
    "httpsOnly must be a boolean when present",
    "httpsOnly",
    "Use the HTTPS only checkbox so the saved value is true or false.",
  ],
  "same-origin-type": [
    "sameOriginOnly must be a boolean when present",
    "sameOriginOnly",
    "Use the Same origin only checkbox so the saved value is true or false.",
  ],
  "http-downgrade-type": [
    "allowHttpDowngradeRedirects must be a boolean when present",
    "allowHttpDowngradeRedirects",
    "Use the HTTP downgrade redirects checkbox so the saved value is true or false. HTTPS-only still takes precedence.",
  ],
  "query-parameters": [
    "queryParameters must be an empty array when present",
    "queryParameters",
    "Clear legacy query-parameter rewrite rules (an empty array). These rewrites are not supported by the native browser; review the intended start address before saving.",
  ],
} as const;
const domainRules = {
  "domain-object": [
    "must match the domain permission object schema",
    "",
    "Use a domain permission object with version 1 and a websites array.",
  ],
  "domain-fields": [
    "domain permission object contains an unsupported field",
    "",
    "Use only version and websites in the domain permission object; remove unsupported fields after reviewing the saved policy.",
  ],
  "domain-version": [
    "version must be 1",
    "version",
    "Use domain permission schema version 1.",
  ],
  "websites-array": [
    "websites must be an array",
    "websites",
    "Store website rules as an array, using an empty array when no overrides are intended.",
  ],
  "websites-limit": [
    "websites must contain at most 64 entries",
    "websites",
    "Reduce the list to at most 64 website entries, retaining the intended restrictions.",
  ],
  "website-object": [
    "websites[] must be an object",
    "websites[]",
    "Use an object for each website row with origin and optional requestClasses and destinations.",
  ],
  "website-fields": [
    "websites[] contains an unsupported field",
    "websites[]",
    "Use only origin, requestClasses, and destinations in each website row.",
  ],
  "website-origin": [
    "websites[].origin must be an exact HTTPS origin",
    "websites[].origin",
    "Use an exact HTTPS origin with no credentials, path, query, fragment, or wildcard.",
  ],
  "website-duplicate": [
    "websites[].origin must be unique after canonicalization",
    "websites[].origin",
    "Merge duplicate canonical website origins after reviewing their permissions; retain one row per origin.",
  ],
  "destinations-array": [
    "websites[].destinations must be an array",
    "websites[].destinations",
    "Store each website's destination overrides as an array.",
  ],
  "destinations-limit": [
    "websites[].destinations must contain at most 32 entries",
    "websites[].destinations",
    "Keep at most 32 destination entries per website, retaining the intended restrictions.",
  ],
  "destinations-total": [
    "websites[].destinations must total at most 256 entries",
    "websites[].destinations",
    "Reduce destination entries across all websites to at most 256, retaining the intended restrictions.",
  ],
  "destination-object": [
    "websites[].destinations[] must be an object",
    "websites[].destinations[]",
    "Use an object with origin and optional requestClasses for each destination.",
  ],
  "destination-fields": [
    "websites[].destinations[] contains an unsupported field",
    "websites[].destinations[]",
    "Use only origin and requestClasses in each destination row.",
  ],
  "destination-origin": [
    "websites[].destinations[].origin must be an exact HTTPS origin",
    "websites[].destinations[].origin",
    "Use an exact HTTPS origin with no credentials, path, query, fragment, or wildcard.",
  ],
  "destination-duplicate": [
    "websites[].destinations[].origin must be unique after canonicalization",
    "websites[].destinations[].origin",
    "Merge duplicate canonical destination origins within each website after reviewing their permissions.",
  ],
  "website-classes-object": [
    "websites[].requestClasses must be an object",
    "websites[].requestClasses",
    "Use an object mapping supported request classes to inherit, allow, or deny.",
  ],
  "destination-classes-object": [
    "websites[].destinations[].requestClasses must be an object",
    "websites[].destinations[].requestClasses",
    "Use an object mapping supported request classes to inherit, allow, or deny.",
  ],
  "website-class": [
    "websites[].requestClasses contains an unsupported request class",
    "websites[].requestClasses",
    "Use only script, stylesheet, font, image-media, fetch-xhr, frame, worker, websocket, and navigation request classes.",
  ],
  "destination-class": [
    "websites[].destinations[].requestClasses contains an unsupported request class",
    "websites[].destinations[].requestClasses",
    "Use only script, stylesheet, font, image-media, fetch-xhr, frame, worker, websocket, and navigation request classes.",
  ],
  "website-decision": [
    "websites[].requestClasses decisions must be inherit, allow or deny",
    "websites[].requestClasses",
    "Choose inherit, allow, or deny for every website request-class decision.",
  ],
  "destination-decision": [
    "websites[].destinations[].requestClasses decisions must be inherit, allow or deny",
    "websites[].destinations[].requestClasses",
    "Choose inherit, allow, or deny for every destination request-class decision.",
  ],
  "website-navigation": [
    "websites[].requestClasses.navigation denies initial navigation",
    "websites[].requestClasses.navigation",
    "Review the matching website's Navigation decision. Keep deny if intended; permit navigation explicitly only if you intend to open this website, then save and reopen it.",
  ],
  "destination-navigation": [
    "websites[].destinations[].requestClasses.navigation denies initial navigation",
    "websites[].destinations[].requestClasses.navigation",
    "Review the matching destination's Navigation decision. Keep deny if intended; permit navigation explicitly only if you intend to open this website, then save and reopen it.",
  ],
  "domain-schema": [
    "domain permission schema validation failed",
    "",
    "Review the version 1 domain permission schema. Native rejected it without identifying the exact row or field; do not guess which permission to relax.",
  ],
} as const;
const resourceRules = {
  "resources-array": [
    "externalResourceOrigins must be an array",
    "externalResourceOrigins",
    "Store external resource origins as an array of origin and kinds objects.",
  ],
  "resources-limit": [
    "externalResourceOrigins must contain at most 32 entries",
    "externalResourceOrigins",
    "Keep at most 32 external resource origin entries.",
  ],
  "resource-kinds-array": [
    "externalResourceOrigins[].kinds must be an array",
    "externalResourceOrigins[].kinds",
    "Use an array of supported resource kinds: script and stylesheet.",
  ],
  "resource-kind": [
    "externalResourceOrigins[].kinds[] must be script or stylesheet",
    "externalResourceOrigins[].kinds[]",
    "Use only script or stylesheet as external resource kinds.",
  ],
  "resource-origin": [
    "externalResourceOrigins[].origin must be an exact HTTPS origin",
    "externalResourceOrigins[].origin",
    "Use exact HTTPS resource origins with no credentials, path, query, fragment, or wildcard.",
  ],
} as const;
const fontRules = {
  "fonts-array": [
    "externalFontOrigins must be an array",
    "externalFontOrigins",
    "Store external font origins as an array of exact HTTPS origins.",
  ],
  "fonts-limit": [
    "externalFontOrigins must contain at most 16 entries",
    "externalFontOrigins",
    "Keep at most 16 external font origin entries.",
  ],
  "font-origin": [
    "externalFontOrigins[] must be an exact HTTPS origin",
    "externalFontOrigins[]",
    "Use exact HTTPS font origins with no credentials, path, query, fragment, or wildcard.",
  ],
} as const;
const capabilityRules = {
  databases: [
    "databasesEnabled=false is unsupported by the native browser",
    "databasesEnabled",
    "The native browser requires databasesEnabled=true. Review whether enabling website databases fits this connection's requirements before explicitly saving a change.",
  ],
  webgl: [
    "webglEnabled=false is unsupported by the native browser",
    "webglEnabled",
    "The native browser requires webglEnabled=true. Review whether enabling WebGL fits this connection's requirements before explicitly saving a change.",
  ],
} as const;
const preferenceRules = {
  "bookmarks-bar-type": [
    "showBookmarksBar must be a boolean when present",
    "showBookmarksBar",
    "Use the Show bookmarks bar checkbox so showBookmarksBar is true or false.",
  ],
  "security-info-type": [
    "showSecurityInfo must be a boolean when present",
    "showSecurityInfo",
    "Use the Show security information checkbox so showSecurityInfo is true or false.",
  ],
  "loading-progress-type": [
    "showLoadingProgress must be a boolean when present",
    "showLoadingProgress",
    "Use the Show loading progress checkbox so showLoadingProgress is true or false.",
  ],
  "default-zoom-range": [
    "defaultZoomPercent must be an integer from 50 to 200 when present",
    "defaultZoomPercent",
    "Set Website zoom to a whole percentage from 50% to 200%, then save the reviewed setting.",
  ],
  "initial-load-timeout-range": [
    "initialLoadTimeoutSeconds must be an integer from 10 to 120 when present",
    "initialLoadTimeoutSeconds",
    "Set Initial load timeout to a whole number from 10 to 120 seconds, then save the reviewed setting.",
  ],
  "document-ready-timeout-range": [
    "documentReadyTimeoutSeconds must be an integer from 30 to 240 when present",
    "documentReadyTimeoutSeconds",
    "Set Document ready timeout to a whole number from 30 to 240 seconds, then save the reviewed setting.",
  ],
  "form-fill-delay-range": [
    "minimumFormFillDelayMs must be an integer from 0 to 30000 when present",
    "minimumFormFillDelayMs",
    "Set Minimum autofill delay to a whole number from 0 to 30000 ms. Keep its total with the submit delay at most 52000 ms, including inherited defaults, then save.",
  ],
  "form-submit-delay-range": [
    "minimumFormSubmitDelayMs must be an integer from 0 to 30000 when present",
    "minimumFormSubmitDelayMs",
    "Set Minimum submit delay to a whole number from 0 to 30000 ms. Keep its total with the autofill delay at most 52000 ms, including inherited defaults, then save.",
  ],
  "form-delays-total": [
    "minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
    "minimumFormFillDelayMs + minimumFormSubmitDelayMs",
    "Review Minimum autofill delay and Minimum submit delay in this settings layer. Use whole numbers from 0 to 30000 ms each, with a combined total at most 52000 ms (52 seconds), then save.",
  ],
  "retention-object": [
    "sessionRetention must be an object when present",
    "sessionRetention",
    "Use a complete cookie retention object with version, mode, idleTimeoutMinutes, maxAgeHours, and clearOnDatabaseLock. Review the intended retention policy before saving.",
  ],
  "retention-version": [
    "sessionRetention.version is required and must be 1",
    "sessionRetention.version",
    "Include sessionRetention.version with the numeric value 1, retaining the other reviewed cookie retention settings.",
  ],
  "retention-mode": [
    "sessionRetention.mode is required and must be ephemeral, memory, encrypted-database or encrypted-local",
    "sessionRetention.mode",
    "Choose the intended Requested cookie retention mode: ephemeral, memory, or encrypted-database. The legacy spelling encrypted-local is accepted on read. Review and save the choice; setting a mode does not establish runtime support or migrate cookie data.",
  ],
  "retention-idle-range": [
    "sessionRetention.idleTimeoutMinutes is required and must be an integer from 0 to 10080",
    "sessionRetention.idleTimeoutMinutes",
    "Include Retained session idle expiry as a whole number from 0 to 10080 minutes. A value of 0 clears retained data when the attempt closes; review the intended expiry before saving.",
  ],
  "retention-age-range": [
    "sessionRetention.maxAgeHours is required and must be an integer from 1 to 8760",
    "sessionRetention.maxAgeHours",
    "Include Retained session maximum age as a whole number from 1 to 8760 hours, then save the reviewed expiry.",
  ],
  "retention-clear-on-lock-type": [
    "sessionRetention.clearOnDatabaseLock is required and must be a boolean",
    "sessionRetention.clearOnDatabaseLock",
    "Include clearOnDatabaseLock as true or false. Review whether retained cookies should be cleared on database lock before saving; locking always closes live browser attempts.",
  ],
  "retention-fields": [
    "sessionRetention contains an unsupported field",
    "sessionRetention",
    "Use only version, mode, idleTimeoutMinutes, maxAgeHours, and clearOnDatabaseLock in the cookie retention object. Remove unsupported fields after reviewing the saved policy; native did not report the unsupported field's name.",
  ],
  "local-storage-type": [
    "localStorageEnabled must be a boolean when present",
    "localStorageEnabled",
    "Use the Local storage checkbox so localStorageEnabled is true or false.",
  ],
  "databases-type": [
    "databasesEnabled must be a boolean when present",
    "databasesEnabled",
    "Use the Website databases checkbox so databasesEnabled is a boolean. The native browser currently requires true.",
  ],
  "webgl-type": [
    "webglEnabled must be a boolean when present",
    "webglEnabled",
    "Use the WebGL checkbox so webglEnabled is a boolean. The native browser currently requires true.",
  ],
  "cookies-type": [
    "cookiesEnabled must be a boolean when present",
    "cookiesEnabled",
    "Use the Cookies checkbox so cookiesEnabled is true or false.",
  ],
  "media-stream-type": [
    "mediaStreamEnabled must be a boolean when present",
    "mediaStreamEnabled",
    "Use the Media stream checkbox so mediaStreamEnabled is true or false.",
  ],
  "cross-origin-type": [
    "crossOriginRequestsEnabled must be a boolean when present",
    "crossOriginRequestsEnabled",
    "Use the Cross-origin requests checkbox so crossOriginRequestsEnabled is true or false.",
  ],
  "extensions-type": [
    "websiteExtensionsEnabled must be a boolean when present",
    "websiteExtensionsEnabled",
    "Use the Website extensions checkbox so websiteExtensionsEnabled is true or false.",
  ],
  "automation-indicator-type": [
    "hideAutomationIndicator must be a boolean when present",
    "hideAutomationIndicator",
    "Use the Hide automation indicator checkbox so hideAutomationIndicator is true or false.",
  ],
  "manual-submit-type": [
    "manualFormSubmit must be a boolean when present",
    "manualFormSubmit",
    "Use the Manual form submit checkbox so manualFormSubmit is true or false.",
  ],
} as const;
const specificRules = {
  "inherited-form-delays-total": [
    "inherited minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
    "minimumFormFillDelayMs + minimumFormSubmitDelayMs",
    "Review connection.browserSession delay overrides alongside inherited settings.webBrowser defaults. For minimumFormFillDelayMs and minimumFormSubmitDelayMs, use whole numbers from 0 to 30000 ms each and keep the effective combined total at most 52000 ms (52 seconds), then save the reviewed correction.",
  ],
  "preference-version": [
    "version must be 1",
    "version",
    "Use browser session override schema version 1.",
  ],
  "downloads-type": [
    "allowDownloads must be a boolean when present",
    "allowDownloads",
    "Use the Allow downloads checkbox so allowDownloads is true or false.",
  ],
  "popup-policy": [
    "popupPolicy must be tabs or block when present",
    "popupPolicy",
    "Choose tabs to open popups as tabs, or block to block popups; save only one of these supported values.",
  ],
  "source-https": [
    "saved source must use HTTPS",
    "",
    "Review the saved connection address and Application entry URL. Saved website domain policies require an HTTPS source; use a server address that supports HTTPS.",
  ],
  "source-resolution": [
    "source origin is invalid for domain permission resolution",
    "",
    "Review the saved connection address and Application entry URL; use an exact supported HTTPS origin.",
  ],
  "source-temporary": [
    "temporary HTTP source origin is invalid",
    "",
    "Review the Quick Connect address and use a valid HTTP origin without credentials.",
  ],
  "verify-ssl": [
    "must be true when present",
    "",
    "Enable Verify SSL (httpVerifySsl=true) for the native browser and review the saved HTTPS trust policy before saving.",
  ],
  "temporary-https-only": [
    "httpsOnly must be false when present for temporary HTTP",
    "httpsOnly",
    "Prefer an HTTPS Quick Connect address if supported. For an intentional HTTP session, explicitly review and set the global HTTPS only control to false; this changes the global default.",
  ],
  "redirect-version": [
    "version must be 1",
    "version",
    "Use trusted redirect destination schema version 1.",
  ],
  "redirects-array": [
    "origins must be an array",
    "origins",
    "Store trusted redirect destinations as an array of exact HTTPS origins.",
  ],
  "redirects-limit": [
    "origins must contain at most 32 entries",
    "origins",
    "Keep at most 32 explicitly reviewed trusted redirect destinations.",
  ],
  "redirect-origin": [
    "origins[] must be an exact HTTPS origin",
    "origins[]",
    "Use exact HTTPS redirect origins with no credentials, path, query, fragment, or wildcard.",
  ],
  "bundled-json": [
    "must be valid JSON",
    "",
    "Repair or reinstall the app's bundled resource-origin catalog; this is an installed application data error.",
  ],
  "bundled-google": [
    "route entries must be exact HTTPS origins",
    "",
    "Repair or reinstall the app's bundled Google route catalog; this is an installed application data error.",
  ],
  "combined-destinations": [
    "combined destinations must contain at most 32 entries",
    "",
    "Review the combined website destinations, trusted redirects, external resources, font origins, and application routes. Keep their effective destination set within 32 entries.",
  ],
  "effective-identity": [
    "browser identity or allowed origins failed native policy validation",
    "",
    "Reopen the connection from its owning database and review its allowed origins. Native did not identify the failed identity or origin field.",
  ],
  "effective-engine": [
    "materialized domain permission engine validation failed",
    "",
    "Review shared and connection website permissions and native startup diagnostics. Native did not identify which effective rule failed validation.",
  ],
} as const;
const policyScopes = {
  source: "connection",
  "connection.httpVerifySsl": "trust",
  "settings.webBrowser": "browser-settings",
  "connection.httpProxyPolicy": "legacy-proxy",
  "settings.webBrowser.defaultPolicy": "browser-settings",
  "settings.webBrowser.domainPermissions": "browser-settings",
  "connection.websiteDomainPermissions": "permissions",
  "connection.httpTrustedRedirectDestinations": "legacy-proxy",
  "connection.browserSession": "browser-session",
  "effective.browserSession": "browser-session",
  "bundled.commonResourceOrigins": "browser-settings",
  "bundled.externalFontOrigins": "browser-settings",
  "bundled.googleRoutes": "browser-settings",
  effective: "permissions",
} as const;
type PolicyRuleCode =
  | keyof typeof proxyRules
  | keyof typeof domainRules
  | keyof typeof resourceRules
  | keyof typeof fontRules
  | keyof typeof capabilityRules
  | keyof typeof preferenceRules
  | keyof typeof specificRules;
export type OriginBrowserPolicyFailureCode =
  `${keyof typeof policyScopes}:${PolicyRuleCode}`;

function policyFailures(
  scope: keyof typeof policyScopes,
  rules: Partial<Record<PolicyRuleCode, readonly [string, string, string]>>,
) {
  return Object.entries(rules).map(([key, [rule, field, nextStep]]) => ({
    code: `${scope}:${key}` as OriginBrowserPolicyFailureCode,
    native: `Saved browser policy rejected (${scope}): ${rule}`,
    field: field ? `${scope}.${field}` : scope,
    problem: `Native rejected ${scope}: ${rule}.`,
    nextStep: scope.startsWith("bundled.")
      ? "Repair or reinstall the app's bundled browser policy data so it satisfies the reported rule. Review the installed runtime in Web Browser settings before retrying."
      : nextStep,
    action: policyScopes[scope],
  }));
}

/** Fixed native message catalog shared with the safe recovery-detail mapper. */
export const originBrowserPolicyFailures = [
  ...policyFailures("connection.httpProxyPolicy", {
    ...proxyRules,
    ...resourceRules,
    ...fontRules,
  }),
  ...policyFailures("settings.webBrowser.defaultPolicy", {
    ...proxyRules,
    ...resourceRules,
    ...fontRules,
    "temporary-https-only": specificRules["temporary-https-only"],
  }),
  ...policyFailures("settings.webBrowser.domainPermissions", domainRules),
  ...policyFailures("connection.websiteDomainPermissions", domainRules),
  ...policyFailures("connection.browserSession", {
    ...capabilityRules,
    ...preferenceRules,
    "preference-version": specificRules["preference-version"],
    object: [
      "must be an object",
      "",
      "Restore a browser session override object using the connection's Browser Session settings editor.",
    ],
  }),
  ...policyFailures("effective.browserSession", {
    "inherited-form-delays-total": specificRules["inherited-form-delays-total"],
  }),
  ...policyFailures("settings.webBrowser", {
    ...capabilityRules,
    ...preferenceRules,
    version: [
      "version must be 1 when present",
      "version",
      "Use Web Browser settings schema version 1 when the version field is present.",
    ],
    "downloads-type": specificRules["downloads-type"],
    "popup-policy": specificRules["popup-policy"],
    object: [
      "must be an object",
      "",
      "Restore a Web Browser settings object using the app's supported settings editor.",
    ],
  }),
  ...policyFailures("source", {
    "source-https": specificRules["source-https"],
    "source-resolution": specificRules["source-resolution"],
    "source-temporary": specificRules["source-temporary"],
  }),
  ...policyFailures("connection.httpVerifySsl", {
    "verify-ssl": specificRules["verify-ssl"],
  }),
  ...policyFailures("connection.httpTrustedRedirectDestinations", {
    "redirect-version": specificRules["redirect-version"],
    "redirects-array": specificRules["redirects-array"],
    "redirects-limit": specificRules["redirects-limit"],
    "redirect-origin": specificRules["redirect-origin"],
  }),
  ...policyFailures("bundled.commonResourceOrigins", {
    ...resourceRules,
    "bundled-json": specificRules["bundled-json"],
  }),
  ...policyFailures("bundled.externalFontOrigins", fontRules),
  ...policyFailures("bundled.googleRoutes", {
    "bundled-google": specificRules["bundled-google"],
  }),
  ...policyFailures("effective", {
    "combined-destinations": specificRules["combined-destinations"],
    "effective-identity": specificRules["effective-identity"],
    "effective-engine": specificRules["effective-engine"],
  }),
];
const policyFailureMessages = new Map(
  originBrowserPolicyFailures.map((failure) => [failure.native, failure]),
);

// Exact fixed native stage failures only. Never append arbitrary native error
// text (including page addresses) or infer a runtime failure from a substring.
const runtimeFailures = new Map<string, OriginBrowserStartupFailureCode>([
  [
    "Native browser working-data preparation failed. Review Settings > Web Browser and restart if the working folder changed; the owning database and retained cookies were not changed.",
    "working-data",
  ],
  [
    "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    "runtime-package",
  ],
  [
    "Native browser initialization or policy readiness timed out. Check the native startup diagnostics and restart the app.",
    "runtime-timeout",
  ],
  [
    "Native browser initialization or policy readiness failed. Check the native startup diagnostics and restart the app.",
    "runtime-readiness",
  ],
  [
    "The packaged real-origin browser is unavailable; no direct-network fallback was used.",
    "runtime-unavailable",
  ],
  [
    "The packaged real-origin browser is unavailable. No website was opened and no direct-network fallback was used.",
    "runtime-unavailable",
  ],
  [
    "Native browser private proxy could not start. Reopen the tab and check the native startup diagnostics; no direct-network fallback was used.",
    "private-proxy",
  ],
  [
    "Native browser private context preparation failed. Check the native startup diagnostics for proxy, certificate or storage setup; this is not a saved-password rejection.",
    "private-context",
  ],
  [
    "Native browser cookie restoration failed. Reopen the tab and check the native startup diagnostics; no other connection's cookies were used.",
    "cookie-restore",
  ],
  [
    "Native browser embedded view creation failed. Reopen the tab and check the native startup diagnostics; this is not a website login failure.",
    "embedded-view",
  ],
  [
    "Native browser renderer setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.",
    "renderer-setup",
  ],
  [
    "Native browser initial zoom setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.",
    "initial-zoom",
  ],
  [
    "Native browser first navigation failed. Review this connection's destination permissions and network route, and check the native startup diagnostics.",
    "initial-navigation",
  ],
  [
    "Native browser tab preparation timed out. Reopen the tab and check the native startup diagnostics; the database was not locked by this timeout.",
    "tab-timeout",
  ],
]);

function known(
  native: string,
  code: OriginBrowserStartupFailureCode,
  message = native,
): [string, { code: OriginBrowserStartupFailureCode; message: string }] {
  return [native, { code, message }];
}

// Exact native-only strings from origin_browser_login.rs and
// origin_browser_authority.rs (compiled by sorng-commands-core). Never match a
// prefix/substring or append native exception text, stack, URL or credentials.
const knownFailures = new Map([
  known(
    "Saved browser application settings could not be read",
    "settings-unavailable",
  ),
  known("Saved browser preferences are invalid", "preferences-invalid"),
  known(
    "Saved browser capabilities are invalid or unsupported",
    "capabilities-invalid",
  ),
  known(
    "Saved browser session retention settings are invalid.",
    "session-retention",
  ),
  known(
    "Sign-in cookie retention could not be prepared for this database.",
    "cookie-retention",
  ),
  known("Sign-in cookies could not be read.", "cookie-read"),
  known(
    "Sign-in cookies could not be read for this unlocked database.",
    "cookie-read-owner",
  ),
  known(
    "Retained sign-in cookies could not be restored safely.",
    "cookie-restore-unsafe",
  ),
  known(
    "A browser attempt already exists for this tab, or the native browser limit was reached.",
    "attempt-limit",
  ),
  known(
    "This saved automatic-login configuration is not supported by the real-origin browser yet. Choose manual login explicitly in this connection's settings to open it without automatic credential entry.",
    "login-unsupported",
    "This connection's automatic-login configuration is not supported by the native browser yet. Review its saved login settings; manual login must be an explicit choice.",
  ),
  known(
    "Website login was not authorized. No saved credentials were sent. Reopen the website to review consent, or select manual login in its connection settings.",
    "login-not-authorized",
    "Website login was not authorized. No saved credentials were sent. Reopen the website to review native consent, or explicitly choose manual login in its connection settings.",
  ),
  known(
    "Finish the existing website login consent dialog first.",
    "login-consent-pending",
    "Finish the existing website login consent dialog, then retry this connection.",
  ),
  known(
    "Saved website credentials are unavailable. Unlock the owning database and review this connection's credential source before retrying.",
    "credentials-unavailable",
  ),
  known(
    "Automatic website login needs complete saved credentials. Edit this connection's website login credentials or linked database-vault entry, or explicitly choose manual login, then reopen the tab.",
    "credentials-incomplete",
  ),
  known(
    "Website login consent could not be prepared. Review this connection's saved login destinations.",
    "login-destinations",
  ),
  known(
    "Browser creation request is invalid",
    "request-invalid",
    "The saved browser configuration could not be accepted. Review the connection settings and reopen the tab.",
  ),
  known(
    "Browser saved database owner is unavailable or changed",
    "owner-unavailable",
    "The owning database is unavailable or changed. Unlock it and reopen the connection from that database.",
  ),
  known(
    "Browser initial URL does not match its saved source",
    "source-mismatch",
    "The requested start address no longer matches the saved connection. Review its address and reopen the tab.",
  ),
  known(
    "Saved browser permission policy is invalid or unsupported",
    "permissions-invalid",
    "The saved website permission policy is invalid or unsupported. Review the global and connection website permissions.",
  ),
  known(
    "Saved website permission policy is invalid or unsupported",
    "permissions-invalid",
    "The saved website permission policy is invalid or unsupported. Review the global and connection website permissions.",
  ),
  known(
    certificatePolicyFailure,
    "certificate-policy",
    "The saved HTTPS trust policy cannot be enforced by this native browser configuration. Review its trust settings and installed browser runtime. No trust-policy change or fallback was applied.",
  ),
  known(certificateBridgeFailure, "certificate-bridge"),
  known(mfaOriginFailure, "mfa-origin-mismatch"),
  known(
    "Saved application entry or login route has no native translation",
    "application-unsupported",
    "This saved application entry or login route has no native translation yet. Review the connection's application settings.",
  ),
  known(
    "Saved browser network route is invalid or unsupported; no direct fallback",
    "network-route",
    "The saved browser network route is invalid or unsupported. Review its proxy or tunnel configuration; no direct fallback was used.",
  ),
  known(
    "Saved website credentials are unavailable or invalid in the owning database; review its credential reference",
    "credential-reference",
    "Saved website credentials are unavailable or invalid. Unlock the owning database and review the connection's credential reference.",
  ),
  known(
    "Managed database revision and unlock proof are required",
    "owner-proof",
    "The managed database unlock proof is missing. Unlock the owning database and reopen the connection.",
  ),
  known(
    "This website's database or browser session is no longer available. Reopen it from its owning database.",
    "session-stale",
    "The database or browser session changed during startup. Reopen the connection from its owning database.",
  ),
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
  const policyFailure =
    stage === "create" && typeof candidate === "string"
      ? policyFailureMessages.get(candidate)
      : undefined;
  if (policyFailure) {
    return {
      stage,
      category: "connection",
      code: policyFailure.code,
      message: `Native browser startup failed (${stage}). ${policyFailure.problem} ${policyFailure.nextStep}`,
    };
  }
  if (
    stage === "create" &&
    typeof candidate === "string" &&
    runtimeFailures.has(candidate)
  ) {
    return {
      stage,
      category: "runtime",
      code: runtimeFailures.get(candidate),
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
    ...(stage === "create" && guidance ? { code: guidance.code } : {}),
    ...(mfaFailure && stage === "create"
      ? { reason: "mfa-origin-mismatch" as const }
      : {}),
    category:
      bridgeFailure && stage === "create"
        ? "certificate-bridge"
        : certificateFailure && stage === "create"
          ? "certificate-policy"
          : guidance || stage === "owner-check"
            ? "connection"
            : "ipc",
    message: `Native browser startup failed (${stage}). ${guidance?.message ?? stageGuidance[stage]}`,
  };
}
