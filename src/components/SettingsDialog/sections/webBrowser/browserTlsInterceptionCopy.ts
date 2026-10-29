import type { BrowserTlsInterception } from "../../../../types/settings/browserSession";

/** Fixed copy for the HTTPS handling choice (`tlsInterception`), shared by the
 * global default and the per-connection override. */
export const TLS_INTERCEPTION_LABEL = "HTTPS handling";

export const TLS_INTERCEPTION_OPTION_LABELS: Record<
  BrowserTlsInterception,
  string
> = {
  auto: "Inspect HTTPS in the app (recommended)",
  off: "Direct TLS",
};

export const TLS_INTERCEPTION_HELP =
  "Inspect HTTPS in the app: the app checks each site's certificate against your Trust Center records and keeps the page cache on this device. Direct TLS: the browser engine verifies certificates itself and keeps its own fingerprint, for sites with strict bot checks; it uses no disk page cache. Applies to new attempts.";

export const HTTP_CACHE_NEEDS_INSPECTION =
  "The disk page cache is available only when HTTPS inspection is active for the connection.";

export const HTTP_CACHE_DIRECT_TLS_CONNECTION =
  "This connection uses Direct TLS, so it has no disk page cache. Choose Inspect HTTPS in the app to use it.";

export const HTTP_CACHE_DIRECT_TLS_DEFAULT =
  "Direct TLS is the app default, so connections that inherit it use no disk page cache.";
