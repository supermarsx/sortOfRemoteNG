/** Only fixed lifecycle diagnostics reach the shell. Never append native text,
 * URLs, titles, exception details or unrelated GPU/Chromium log messages. */
export function originBrowserSessionError(reason: unknown): string {
  switch (reason) {
    case "renderer":
      return "Native browser session failed: the page renderer stopped or its native communication bridge failed. Reopen the tab. If it happens again, restart the app and check native browser diagnostics; this report does not identify the underlying cause.";
    case "session":
      return "Native browser session failed: the private browser session was no longer available or valid. Reopen the connection from its owning database, unlocking it if needed. If it happens again, check native browser diagnostics.";
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
