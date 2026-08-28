import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `proxy` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * `PROXY_TYPE_OPTIONS` in `ProxySettings.tsx` is an inline array literal, so the
 * guard reads it from the AST and fails if the `values` below drift from it.
 * No label here comes from `t()`, so no entry carries a `labelKey`.
 */
export const PROXY_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "proxyEnabled",
    label: "Enable global proxy",
    description: "Route all connections through a proxy server",
    tags: ["proxy", "enable", "global", "route", "tunnel"],
    synonyms: ["turn on proxy", "use a proxy", "corporate proxy"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
  {
    key: "proxyType",
    label: "Proxy type",
    description:
      "Select the proxy protocol. SOCKS5 supports authentication and UDP; HTTP/HTTPS proxies are more common in corporate environments.",
    tags: ["proxy", "type", "protocol", "socks", "http", "https"],
    synonyms: ["socks5", "socks4", "proxy protocol", "http proxy"],
    section: "proxy",
    sectionLabel: "Proxy",
    values: [
      "http",
      "HTTP — standard HTTP proxy",
      "https",
      "HTTPS — secure HTTP proxy",
      "socks4",
      "SOCKS4 — SOCKS4 protocol",
      "socks5",
      "SOCKS5 — SOCKS5 with auth",
    ],
  },
  {
    key: "proxyHost",
    label: "Proxy host",
    description:
      "Hostname or IP address of the proxy server to route connections through.",
    tags: ["proxy", "host", "hostname", "server", "address", "ip"],
    synonyms: ["proxy server", "proxy address", "proxy hostname"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
  {
    key: "proxyPort",
    label: "Proxy port",
    description:
      "TCP port number on the proxy server. Common defaults: HTTP 8080, SOCKS5 1080.",
    tags: ["proxy", "port", "tcp", "8080", "1080"],
    synonyms: ["proxy port number"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
  {
    key: "proxyUsername",
    label: "Username",
    description:
      "Username for proxy authentication. Leave blank if the proxy does not require credentials.",
    tags: ["proxy", "username", "user", "authentication", "credentials"],
    synonyms: ["proxy user", "proxy login", "proxy auth"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
  {
    key: "proxyPassword",
    label: "Password",
    description:
      "Password for proxy authentication. Stored encrypted in the application settings.",
    tags: ["proxy", "password", "secret", "authentication", "credentials"],
    synonyms: ["proxy password", "proxy auth"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
  {
    key: "globalProxyPresets",
    label: "Proxy Presets",
    description:
      "Save the current proxy configuration under a name, then apply it later in one click. Useful when switching between work, home, and mobile-tether proxies.",
    tags: ["preset", "presets", "saved", "profile", "switch", "apply"],
    synonyms: ["proxy profiles", "saved proxies", "proxy bookmarks"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
];
