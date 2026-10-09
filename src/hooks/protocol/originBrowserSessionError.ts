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
