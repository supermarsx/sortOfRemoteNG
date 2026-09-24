/** Blank bootstrap/recovery must not inherit an executable app-origin frame. */
export const EMPTY_WEB_FRAME_SANDBOX = "";
export const PROXY_WEB_FRAME_SANDBOX =
  "allow-same-origin allow-scripts allow-forms";

export function clearWebBrowserFrame(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;
  const alreadyRestricted =
    iframe.getAttribute("sandbox") === EMPTY_WEB_FRAME_SANDBOX;
  // Changing sandbox alone does not revoke the active document's flags. Set
  // the restrictive flags BEFORE navigating to the new blank document.
  iframe.setAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
  // Already-idle frames need no second document navigation (which also asks
  // WebView2 to run its document-start scripts again in the blocked sandbox).
  if (!alreadyRestricted || iframe.getAttribute("src") !== "about:blank")
    iframe.src = "about:blank";
}

export function assertWebBrowserFrameNavigation(
  url: string,
  protectedProxyUrls: string | readonly string[],
  parentOrigin: string,
) {
  const target = new URL(url);
  const proxyUrls =
    typeof protectedProxyUrls === "string"
      ? [protectedProxyUrls]
      : protectedProxyUrls;
  const proxies = proxyUrls.map((value) => new URL(value));
  const listenerPort = proxies[0]?.port;
  if (
    proxies.length === 0 ||
    proxies.some(
      (proxy) =>
        proxy.protocol !== "http:" ||
        !/^p[0-9a-f]{32}\.localhost$/u.test(proxy.hostname) ||
        !proxy.port ||
        proxy.port !== listenerPort ||
        proxy.username ||
        proxy.password ||
        proxy.pathname !== "/" ||
        proxy.search ||
        proxy.hash ||
        proxy.origin === parentOrigin,
    ) ||
    target.username ||
    target.password ||
    !proxies.some((proxy) => target.origin === proxy.origin) ||
    target.origin === parentOrigin
  )
    throw new Error(
      "The website frame requires its isolated protected proxy origin.",
    );
}

export function navigateWebBrowserFrame(
  iframe: HTMLIFrameElement,
  url: string,
  protectedProxyUrls: string | readonly string[],
) {
  assertWebBrowserFrameNavigation(
    url,
    protectedProxyUrls,
    iframe.ownerDocument.location.origin,
  );
  // The already-active opaque blank stays opaque. These flags take effect on
  // the next cross-origin proxy document, preserving cookies and form scripts.
  iframe.setAttribute("sandbox", PROXY_WEB_FRAME_SANDBOX);
  if (iframe.getAttribute("src") !== url) iframe.src = url;
}
