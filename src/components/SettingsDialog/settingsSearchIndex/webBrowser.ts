import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `webBrowser` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const WEB_BROWSER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "webBrowser.idlePrewarmEnabled",
    label: "Prewarm browser while idle",
    description:
      "Prepare the native engine after a saved website's database is unlocked. Enabled by default; uses memory earlier to reduce the first website's startup delay without opening a page.",
    tags: ["prewarm", "warmup", "startup", "idle", "CEF", "memory", "speed"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.engine",
    label: "Default browser engine",
    description:
      "Real-origin native browsing is the default for new tabs. Explicit legacy choices are preserved. Native unavailability never triggers fallback.",
    tags: ["engine", "legacy", "native", "real-origin", "CEF"],
    values: [
      "legacy",
      "Legacy rewrite browser",
      "real-origin",
      "Real-origin native browser (experimental)",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.hideAutomationIndicator",
    label: "Hide WebDriver indicator (experimental)",
    description:
      "Optional page-local navigator.webdriver override. Does not conceal the iframe or TLS identity, and cannot guarantee sign-in acceptance.",
    tags: [
      "stealth",
      "webdriver",
      "automation",
      "bot",
      "detection",
      "google",
      "cloudflare",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.preferNativeLanguage",
    label: "Keep browser language consistent",
    description:
      "Ignore saved Accept-Language header overrides; keep the actual runtime language preference.",
    tags: [
      "language",
      "locale",
      "fingerprint",
      "compatibility",
      "identity",
      "accept-language",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.minimumFormFillDelayMs",
    label: "Minimum autofill delay (ms)",
    description:
      "Wait up to 30000 milliseconds before supported DOM form filling without shortening saved connection delays.",
    tags: ["autofill", "delay", "login", "timing", "initialization"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.minimumFormSubmitDelayMs",
    label: "Minimum sign-in submit delay (ms)",
    description:
      "Wait up to 30000 milliseconds after filling before one automatic sign-in submit. Does not retry rejected logins.",
    tags: ["submit", "delay", "login", "timing", "lockout"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.preferNativeUserAgent",
    label: "Keep browser identity consistent",
    description:
      "Ignore saved User-Agent overrides; preserve the real runtime identity and native client hints. Reopen tabs to apply.",
    tags: [
      "user agent",
      "native",
      "identity",
      "compatibility",
      "embedded",
      "detection",
      "countermeasures",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.manualFormSubmit",
    label: "Require manual sign-in submission",
    description:
      "Fill consented DOM login fields without submitting automatically; pause automatic 2FA. Reopen tabs to apply form behavior.",
    tags: ["login", "autofill", "submit", "compatibility", "automation", "2fa"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultZoomPercent",
    label: "Website zoom (%)",
    description:
      "Scale website content from 50 to 200 percent without reloading.",
    tags: ["zoom", "scale", "magnification", "size"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.showLoadingProgress",
    label: "Show loading progress",
    description:
      "Display the slim page-loading bar; retain trust and error prompts.",
    tags: ["loading", "progress", "bar", "visibility"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.allowDownloads",
    label: "Allow website downloads",
    description:
      "Permit downloads from approved proxy pages on the next navigation.",
    tags: ["download", "files", "sandbox", "capabilities"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.allowPageDialogs",
    label: "Allow website dialogs",
    description:
      "Permit alert, confirm and prompt where the embedded runtime supports them.",
    tags: ["dialog", "alert", "confirm", "prompt", "sandbox"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "websiteDarkMode",
    label: "Website appearance and dark-mode extension",
    description:
      "Configure dynamic colors, filters, custom CSS, brightness and reusable appearance presets. Enable the extension separately for each website.",
    tags: [
      "dark",
      "extension",
      "appearance",
      "brightness",
      "contrast",
      "sepia",
      "grayscale",
      "presets",
      "custom CSS",
    ],
    synonyms: ["darkreader", "night mode", "website colors", "dynamic filter"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.showBookmarksBar",
    label: "Show bookmarks bar",
    description: "Keep saved bookmarks visible below the address bar.",
    tags: [
      "bookmarks",
      "favorites",
      "favourites",
      "bar",
      "toolbar",
      "visibility",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.showSecurityInfo",
    label: "Show security information",
    description:
      "Show connection security details; warnings remain visible when hidden.",
    tags: ["security", "certificate", "tls", "https", "warning", "visibility"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.popupPolicy",
    label: "Website popups",
    description:
      "Open allowed native popups as temporary tabs in the same connection or block them. Reopen the website to apply. Legacy support is limited to Tactical RMM.",
    tags: ["popup", "window.open", "tabs", "native", "tactical", "rmm"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
    values: ["tabs", "Open in tabs", "block", "Block popups"],
  },
  {
    key: "webBrowser.initialLoadTimeoutSeconds",
    label: "Initial load timeout",
    description:
      "Wait for the first page response, 10 to 120 seconds (default 30).",
    tags: ["timeout", "load", "deadline", "seconds", "response"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.documentReadyTimeoutSeconds",
    label: "Document ready timeout",
    description:
      "Wait for the document to become ready, 30 to 240 seconds (default 120).",
    tags: ["timeout", "document", "ready", "deadline", "loading"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultPolicy.pageScripts",
    label: "Page scripts",
    description:
      "Default for connections without a saved policy. Close and reopen tabs to apply.",
    tags: ["javascript", "scripts", "policy", "defaults", "inline"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
    values: [
      "allow",
      "Allow scripts",
      "inline-only",
      "Inline scripts only",
      "block",
      "Block scripts",
    ],
  },
  {
    key: "webBrowser.defaultPolicy.httpsOnly",
    label: "Require HTTPS",
    description: "Require HTTPS for mediated website requests.",
    tags: ["https", "tls", "secure", "policy", "defaults"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultPolicy.sameOriginOnly",
    label: "Restrict to the same origin",
    description:
      "Restrict mediated redirects, resources and forms; overrides external fonts, scripts and stylesheets.",
    tags: [
      "same origin",
      "resources",
      "forms",
      "redirects",
      "restriction",
      "policy",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultPolicy.cacheMode",
    label: "Website cache",
    description:
      "Default caching behavior for connections without a saved policy.",
    tags: ["cache", "bypass", "reload", "policy"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
    values: ["normal", "Normal caching", "bypass", "Bypass cache"],
  },
  {
    key: "webBrowser.defaultPolicy.allowExternalFonts",
    label: "Allow external fonts",
    description:
      "Fetch fonts anonymously through the proxy from approved origins.",
    tags: ["fonts", "external", "anonymous", "stylesheet", "policy"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultPolicy.externalFontOrigins",
    label: "External font origin",
    description:
      "Up to 16 unique exact HTTPS origins for font stylesheets and files. Restore common fonts to enable the four common font hosts.",
    tags: [
      "fonts",
      "origins",
      "allowlist",
      "stylesheet",
      "https",
      "validation",
      "restore defaults",
      "google fonts",
      "cdnjs",
      "jsdelivr",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.defaultPolicy.externalResourceOrigins",
    label: "External scripts and stylesheets",
    description:
      "Allow anonymous proxied requests to exact HTTPS origins for scripts or stylesheets. Add or remove origins, or restore common resource defaults. Same-origin and script restrictions still apply.",
    tags: [
      "cdn",
      "javascript",
      "css",
      "scripts",
      "stylesheets",
      "origins",
      "allowlist",
      "https",
      "restore defaults",
      "stripe",
      "paypal",
      "braintree",
      "google",
      "cdnjs",
      "jsdelivr",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "webBrowser.identity",
    label: "Browser identity and compatibility",
    description:
      "Read-only native user agent; identity headers pass through. Embedded proxy is not a full browser and cannot guarantee Google or Cloudflare compatibility.",
    tags: [
      "user agent",
      "identity",
      "headers",
      "google",
      "cloudflare",
      "compatibility",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },

  // ─── Bookmarks ──────────────────────────────────────────────────
  {
    key: "confirmDeleteAllBookmarks",
    label: "Confirm before deleting all bookmarks",
    description:
      "Show a confirmation dialog before clearing all saved bookmarks for a web browser connection.",
    tags: [
      "bookmarks",
      "delete",
      "confirm",
      "clear",
      "browser",
      "favorites",
      "safety",
    ],
    synonyms: ["favourites", "favorites", "clear bookmarks", "are you sure"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
];
