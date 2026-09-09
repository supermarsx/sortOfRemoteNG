/** Blank bootstrap/recovery must not inherit an executable app-origin frame. */
export const EMPTY_WEB_FRAME_SANDBOX = "";
export const PROXY_WEB_FRAME_SANDBOX =
  "allow-same-origin allow-scripts allow-forms";

export function clearWebBrowserFrame(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;
  // Changing sandbox alone does not revoke the active document's flags. Set
  // the restrictive flags BEFORE navigating to the new blank document.
  iframe.setAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
  iframe.src = "about:blank";
}

export function navigateWebBrowserFrame(
  iframe: HTMLIFrameElement,
  url: string,
  protectedProxyUrl: string,
) {
  const target = new URL(url),
    proxy = new URL(protectedProxyUrl);
  if (
    proxy.protocol !== "http:" ||
    !/^p[0-9a-f]{32}\.localhost$/u.test(proxy.hostname) ||
    !proxy.port ||
    proxy.username ||
    proxy.password ||
    target.username ||
    target.password ||
    target.origin !== proxy.origin ||
    target.origin === iframe.ownerDocument.location.origin
  )
    throw new Error(
      "The website frame requires its isolated protected proxy origin.",
    );
  // The already-active opaque blank stays opaque. These flags take effect on
  // the next cross-origin proxy document, preserving cookies and form scripts.
  iframe.setAttribute("sandbox", PROXY_WEB_FRAME_SANDBOX);
  if (iframe.getAttribute("src") !== url) iframe.src = url;
}
