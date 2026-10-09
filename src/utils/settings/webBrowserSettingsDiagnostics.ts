import { normalizeWebBrowserSettings } from "./webBrowserSettings";

// Fixed labels only: never put a saved value or an unknown key in diagnostics.
const fixes: Record<string, string> = {
  version: "Use settings schema version 1.",
  engine: "Choose Native CEF (real-origin) or Legacy (legacy).",
  popupPolicy: "Choose Tabs (tabs) or Block (block).",
  defaultZoomPercent: "Enter an integer from 50 to 200 percent.",
  initialLoadTimeoutSeconds: "Enter an integer from 10 to 120 seconds.",
  documentReadyTimeoutSeconds: "Enter an integer from 30 to 240 seconds.",
  minimumFormFillDelayMs: "Enter an integer from 0 to 30,000 milliseconds.",
  minimumFormSubmitDelayMs: "Enter an integer from 0 to 30,000 milliseconds.",
  defaultPolicy:
    "Repair the internal proxy defaults: use version 1 and supported field values. Global defaults cannot grant all requests, all scripts, redirects, HTTP downgrades or query-parameter rewrites; those grants require per-connection review.",
  domainPermissions:
    "Repair the shared website rules: use version 1, a websites array, unique exact HTTPS origins and inherit/allow/deny decisions. Maximums are 64 websites, 32 destinations per website and 256 destinations overall.",
  sessionRetention:
    "Repair cookie retention: version 1; mode ephemeral, memory or encrypted-database; idleTimeoutMinutes 0–10080; maxAgeHours 1–8760; clearOnDatabaseLock true or false. All five fields are required.",
};
for (const field of [
  "idlePrewarmEnabled",
  "showBookmarksBar",
  "showSecurityInfo",
  "showLoadingProgress",
  "allowDownloads",
  "allowPageDialogs",
  "xsltEnabled",
  "preferNativeUserAgent",
  "preferNativeLanguage",
  "hideAutomationIndicator",
  "localStorageEnabled",
  "databasesEnabled",
  "webglEnabled",
  "cookiesEnabled",
  "mediaStreamEnabled",
  "crossOriginRequestsEnabled",
  "websiteExtensionsEnabled",
  "manualFormSubmit",
])
  fixes[field] =
    "Use the checkbox to save true or false, not text or a number.";

export interface WebBrowserSettingsIssue {
  field: string;
  fix: string;
}

/** Uses the real normalizer to diagnose each known field, never a permissive
 * replacement schema. Returned text contains no saved values or parser errors. */
export function diagnoseWebBrowserSettings(
  value: unknown,
): WebBrowserSettingsIssue[] {
  try {
    normalizeWebBrowserSettings(value);
    return [];
  } catch {
    /* inspect below */
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return [
      {
        field: "webBrowser",
        fix: "Restore a Web Browser settings object; do not use null, an array or a primitive value.",
      },
    ];
  const row = value as Record<string, unknown>;
  const issues: WebBrowserSettingsIssue[] = [];
  if (
    Object.keys(row).some(
      (field) => !Object.prototype.hasOwnProperty.call(fixes, field),
    )
  )
    issues.push({
      field: "webBrowser (unsupported field)",
      fix: "Remove unsupported fields from the settings object after reviewing the stored configuration. Unknown field names are omitted from diagnostics.",
    });
  for (const field of Object.keys(fixes)) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    try {
      normalizeWebBrowserSettings({ [field]: row[field] });
    } catch {
      issues.push({ field: `webBrowser.${field}`, fix: fixes[field] });
    }
  }
  if (
    typeof row.minimumFormFillDelayMs === "number" &&
    typeof row.minimumFormSubmitDelayMs === "number" &&
    row.minimumFormFillDelayMs + row.minimumFormSubmitDelayMs > 52000
  )
    issues.push({
      field: "webBrowser.minimumFormFillDelayMs + minimumFormSubmitDelayMs",
      fix: "Reduce the combined autofill and submit delays to at most 52,000 milliseconds.",
    });
  return issues.length
    ? issues
    : [
        {
          field: "webBrowser",
          fix: "The complete settings object failed validation. Review its schema and combined values; no individual field was identified.",
        },
      ];
}
