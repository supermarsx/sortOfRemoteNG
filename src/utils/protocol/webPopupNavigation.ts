import type { WebPopupSnapshot } from "./webPopupTabs";
import { assertWebBrowserFrameNavigation } from "./webBrowserFrame";

const PARENT = "__sorng_popup_parent_v1";
const PRIMARY = "__sorng_navigation_v1";

/** Strip only our marker, without reserializing signed application query bytes. */
function applicationQuery(url: URL): string {
  return url.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      const name = new URLSearchParams(pair).keys().next().value;
      return name !== PARENT;
    })
    .join("&");
}

export function popupUpstreamUrl(
  popup: WebPopupSnapshot,
  source: string,
  value = popup.url,
): string {
  assertWebBrowserFrameNavigation(
    value,
    popup.proxyUrl,
    window.location.origin,
  );
  const from = new URL(value);
  const target = new URL(source);
  target.pathname = from.pathname;
  target.search = applicationQuery(from);
  target.hash = from.hash;
  return target.href;
}

export function popupProxyUrl(
  popup: WebPopupSnapshot,
  source: string,
  value: string,
): string {
  const target = new URL(value);
  if (
    target.origin !== new URL(source).origin ||
    target.username ||
    target.password ||
    target.searchParams.has(PRIMARY) ||
    target.searchParams.has(PARENT) ||
    target.pathname.startsWith("/__sortofremoteng")
  )
    throw new Error(
      "This shared browser tab must stay on its source connection's web address.",
    );
  const proxy = new URL(popup.proxyUrl);
  proxy.pathname = target.pathname;
  proxy.search = `${target.search}${target.search ? "&" : "?"}${PARENT}=${popup.document.sequence}`;
  proxy.hash = target.hash;
  assertWebBrowserFrameNavigation(
    proxy.href,
    popup.proxyUrl,
    window.location.origin,
  );
  return proxy.href;
}
