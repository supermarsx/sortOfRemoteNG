import { getGlobalHttpProxyUrl } from "../integration/httpProxy";
import type { SynologyApiRoute } from "../../types/hardware/synologyFileStation";

export const SYNOLOGY_ROUTE_CHANGED =
  "The selected global HTTP proxy changed. Reconnect to start a new NAS API session on the selected route. No sign-in or file operation was retried.";
const invalid = () =>
  new Error(
    "The selected global proxy is not a supported HTTP(S) route. Correct its settings before connecting; the NAS route will not be bypassed.",
  );
export interface SynologyApiRouteSnapshot {
  route: SynologyApiRoute;
  assertCurrent: () => void;
}
/** Same explicit global route as the embedded HTTP browser; no environment lookup. */
export function captureSynologyApiRoute(): SynologyApiRouteSnapshot {
  const selected = getGlobalHttpProxyUrl({ failClosed: true });
  let route: SynologyApiRoute = { kind: "direct" };
  if (selected !== undefined) {
    try {
      if (selected.length > 32768) throw invalid();
      const url = new URL(selected);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.hostname.endsWith(".") ||
        url.port === "0" ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw invalid();
      const username = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      if (
        [username, password].some(
          (value) =>
            new TextEncoder().encode(value).length > 4096 ||
            /\p{Cc}/u.test(value),
        ) ||
        (password && !username)
      )
        throw invalid();
      route = {
        kind: "http_proxy",
        url: url.origin,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      };
    } catch {
      throw invalid();
    }
  }
  return {
    route: Object.freeze(route),
    assertCurrent: () => {
      try {
        if (getGlobalHttpProxyUrl({ failClosed: true }) === selected) return;
      } catch {
        /* A newly invalid enabled proxy also revokes the captured route. */
      }
      throw new Error(SYNOLOGY_ROUTE_CHANGED);
    },
  };
}
