import { originBrowserLoadFailure } from "../../types/protocols/originBrowser";

/** -130 is connection to the proxy itself, not a website login rejection or
 * an upstream CONNECT rejection (-111). Do not infer why the endpoint failed. */
export const nativeProxyConnectionFailure = {
  title: "The browser could not connect to its private proxy",
  problem:
    "CEF could not connect to its configured proxy endpoint. This request did not reach the website through that proxy; the error does not establish a rejected website password.",
  nextStep:
    "Use Retry browser to create a fresh private proxy session. If other tabs also fail, inspect the native startup diagnostics and restart the app. Do not change website credentials or bypass proxy protections for this error.",
} as const;

/** Only fixed lifecycle diagnostics reach the shell. Never append native text,
 * URLs, titles, exception details or unrelated GPU/Chromium log messages. */
export function originBrowserSessionError(reason: unknown): string {
  switch (reason) {
    case "renderer":
      return "Native browser session failed: the page renderer stopped or its native communication bridge failed. Reopen the tab. If it happens again, restart the app and check native browser diagnostics; this report does not identify the underlying cause.";
    case "session":
      return "Native browser session failed: the private browser session was no longer available or valid. No specific cause was reported. Reopen the tab or use Retry browser. If it happens again, review native browser diagnostics in Web Browser settings and restart the app.";
    case "database-owner":
      return "Native browser session failed: the database-session authorization is no longer current. This report does not establish that the database is locked. Reopen the connection from its owning database to obtain current authorization. If it happens again, review native browser diagnostics in Web Browser settings.";
    case "watchdog":
      return "Native browser session failed: a UI callback did not complete before the watchdog deadline, so the session was stopped. The underlying cause was not reported. Wait for the app to respond, then use Retry browser. If it repeats, review native browser diagnostics in Web Browser settings and restart the app.";
    case "private-context":
      return "Native browser session failed: the private browser context could not be verified or kept available. The underlying cause was not reported. Use Retry browser to create a fresh private session. If it repeats, review native browser diagnostics in Web Browser settings.";
    case "private-proxy":
      return "Native browser session failed: the private browser proxy was unavailable or its required binding could not be verified. Use Retry browser to create a fresh private session. If it repeats, review native browser diagnostics in Web Browser settings and the configured network route.";
    case "native-state":
      return "Native browser session failed: the app could not safely access native browser session state, so the session was stopped. Use Retry browser. If it repeats, restart the app and review native browser diagnostics in Web Browser settings.";
    case "certificate-bridge":
      return "Native browser session failed: the TLS admission bridge for this private session failed. This report does not establish a server-certificate rejection. Use Retry browser to create a fresh private context. If it repeats, check the TLS journal in native browser diagnostics. Keep HTTPS trust settings and website credentials unchanged.";
    case "redirect-denied":
      return "Native browser session failed: a redirect could not be admitted by the session's destination policy. Review the connection's permitted destinations and native browser diagnostics before retrying. Reopen the tab after that review. Keep destination checks, HTTPS trust settings, and proxy protections enabled; this report does not establish rejected website credentials.";
    case "runtime-unavailable":
      return "Native browser session failed: the native browser runtime was no longer available for this session. No specific runtime cause was reported. Review native browser diagnostics in Web Browser settings and restart the app before retrying.";
    case "owner-window":
      return "Native browser session failed: the app window or document that owned this browser session is no longer current. Reopen the connection in its current app window. If it repeats, review native browser diagnostics in Web Browser settings.";
    case "callback":
      return "Native browser session failed: an internal native browser callback failed, so the session was stopped. Reopen the tab. If it happens again, restart the app and check native browser diagnostics.";
    case "native-surface":
      return "Native browser session failed: the app could not maintain the embedded browser view. Reopen the tab. If it happens again, restart the app and check native browser diagnostics.";
    case "load":
      return "Native browser session failed: the page could not be loaded. Reopen the tab after checking the network route, destination permissions, and site availability. Check native browser diagnostics for a more specific cause.";
    default:
      return "Native browser session failed. No cause was provided by the native browser. Reopen the tab. If it happens again, restart the app and check native browser diagnostics.";
  }
}

/** Actionable request failure without guessing a cause from native prose. */
export function originBrowserLoadError(value: unknown): string {
  const failure = originBrowserLoadFailure("attached", value);
  if (!failure)
    return "The page could not be loaded. Review native browser diagnostics.";
  if (failure.category === "proxy" && failure.code === -130) {
    return `${nativeProxyConnectionFailure.problem} ${nativeProxyConnectionFailure.nextStep} (CEF -130.) The browser session remains open; no request was automatically retried.`;
  }
  const details = {
    dns: "DNS resolution failed or was blocked by resolver policy. Check DNS and the connection's network route.",
    connection:
      "The connection was refused, closed, or interrupted. Check site availability and the network route.",
    timeout:
      "The request timed out. Check site availability and the network route.",
    "network-changed":
      "The network changed while the request was loading. Check that the configured route is connected before navigating again.",
    offline:
      "The network is offline. Restore the configured connection before navigating again.",
    proxy:
      "The configured proxy or tunnel could not complete the request. Check its availability and authentication settings.",
    certificate:
      "Certificate verification failed. Review the certificate and this connection's saved trust policy.",
    tls: "The secure connection could not be established. Check the server's TLS configuration and any required client certificate.",
    blocked:
      "A browser or security policy blocked the request. Review destination permissions and the site's security requirements.",
    http: "The server response could not be loaded. Review the response and request in browser diagnostics.",
    redirect:
      "The request exceeded the redirect limit. Review the site's redirect and login configuration.",
    cache:
      "The saved response could not be read. Navigate to the page again when ready; resubmitting a form may repeat its action.",
    other:
      "The page request failed. Review the numeric error code in native browser diagnostics.",
  };
  return `${details[failure.category]} (CEF ${failure.code}.) The browser session remains open; no request was automatically retried.`;
}
