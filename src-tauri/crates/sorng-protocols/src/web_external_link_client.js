/* Page-only OWA link capture. Reports are untrusted review suggestions, never
 * permission to open the OS browser. The parent owns the explicit open button.
 * Installed separately from network routing; no cookies or credentials read. */
function installOwaExternalLinks(identity, sourceOrigin) {
  "use strict";
  var parentWindow = window.parent;
  if (parentWindow === window) return;
  var NativeURL = window.URL;
  var proxyOrigin = location.origin;
  var parentOrigin = null;
  var closed = false;
  var observed = new Map();
  var refreshScheduled = false;
  var refreshEpoch = 0;
  function command(event) {
    var data = event.data;
    if (
      closed ||
      event.source !== parentWindow ||
      !data ||
      data.type !== "sorng_owa_external_links" ||
      data.version !== 1 ||
      data.sessionId !== identity.sessionId ||
      data.documentToken !== identity.documentToken ||
      data.documentSequence !== identity.documentSequence ||
      data.navigationToken !== identity.navigationToken ||
      typeof data.enabled !== "boolean"
    )
      return;
    parentOrigin = data.enabled ? event.origin : null;
    if (parentOrigin) refreshFrames();
    else clearFrames();
  }
  function destination(anchor) {
    var raw = anchor.getAttribute("href");
    if (!raw || raw.length > 16_384 || /[\u0000-\u0020\u007f\\]/.test(raw))
      return null;
    var base = anchor.ownerDocument.baseURI;
    if (base === "about:blank" || base === "about:srcdoc") base = location.href;
    var url = new NativeURL(raw, base);
    if (raw.startsWith("//") && url.origin !== proxyOrigin)
      url = new NativeURL(new NativeURL(sourceOrigin).protocol + raw);
    if (url.username || url.password) return null;
    // The network compatibility layer may have prepared this anchor already.
    // Extract only its destination; document/generation proofs never leave.
    if (
      url.origin === proxyOrigin &&
      url.pathname === "/__sortofremoteng_public_navigation_v1"
    ) {
      if (url.searchParams.getAll("destination").length !== 1) return null;
      url = new NativeURL(url.searchParams.get("destination"));
    }
    // OWA's own link wrapper can carry mailbox/session data. Only URL is used.
    if (
      (url.origin === proxyOrigin || url.origin === sourceOrigin) &&
      /^\/owa\/(?:[^/]+\/)?redir\.aspx$/i.test(url.pathname)
    ) {
      var destinations = [];
      url.searchParams.forEach(function (value, key) {
        if (key.toLowerCase() === "url") destinations.push(value);
      });
      if (destinations.length !== 1) return null;
      url = new NativeURL(destinations[0]);
    }
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === proxyOrigin ||
      url.origin === sourceOrigin ||
      /(^|\.)localhost$/i.test(url.hostname)
    )
      return null;
    return url.href;
  }
  function click(event) {
    if (
      closed ||
      !parentOrigin ||
      event.isTrusted !== true ||
      (event.type === "click" ? event.button !== 0 : event.button !== 1) ||
      event.defaultPrevented
    )
      return;
    var anchor = event.target?.closest?.("a[href],area[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    try {
      var url = destination(anchor);
      if (!url) return;
      // Stop the site's popup/redirect handler as well as default navigation.
      // Internal mailbox links and SPA handlers never reach this branch.
      event.preventDefault();
      event.stopImmediatePropagation();
      parentWindow.postMessage(
        {
          type: "sorng_owa_external_link",
          version: 1,
          sessionId: identity.sessionId,
          documentToken: identity.documentToken,
          documentSequence: identity.documentSequence,
          navigationToken: identity.navigationToken,
          destinationUrl: url,
        },
        parentOrigin,
      );
    } catch (_) {
      // Malformed links remain subject to the existing network policy.
    }
  }
  function clearFrames() {
    ++refreshEpoch;
    refreshScheduled = false;
    observed.forEach(function (remove) {
      remove();
    });
    observed.clear();
  }
  function scheduleFrames() {
    if (closed || !parentOrigin || refreshScheduled) return;
    refreshScheduled = true;
    var epoch = refreshEpoch;
    queueMicrotask(function () {
      if (epoch !== refreshEpoch) return;
      refreshScheduled = false;
      refreshFrames();
    });
  }
  function containsFrame(node) {
    return (
      node.nodeType === 1 &&
      (node.matches("iframe,frame") || node.querySelector("iframe,frame"))
    );
  }
  function framesChanged(records) {
    // OWA mutates message/search DOM frequently. Inspect only changed subtrees;
    // text, attributes, and frame-free content do not rescan the root document.
    if (
      records.some(function (record) {
        return (
          Array.from(record.addedNodes).some(containsFrame) ||
          Array.from(record.removedNodes).some(containsFrame)
        );
      })
    )
      scheduleFrames();
  }
  function frameLoaded(event) {
    if (event.target?.matches?.("iframe,frame")) scheduleFrames();
  }
  function refreshFrames() {
    if (closed || !parentOrigin) return;
    var reachable = new Map();
    function visit(doc, view, depth) {
      if (reachable.has(doc) || reachable.size >= 64 || depth > 8) return;
      reachable.set(doc, view);
      doc.querySelectorAll("iframe,frame").forEach(function (frame) {
        try {
          var child = frame.contentDocument;
          var childWindow = frame.contentWindow;
          if (!child || !childWindow) return;
          var address = new NativeURL(child.URL);
          if (
            address.origin !== proxyOrigin &&
            address.href !== "about:blank" &&
            address.href !== "about:srcdoc"
          )
            return;
          visit(child, childWindow, depth + 1);
        } catch (_) {
          // Cross-origin or sandboxed message frames stay isolated.
        }
      });
    }
    visit(document, window, 0);
    observed.forEach(function (remove, doc) {
      if (!reachable.has(doc)) {
        remove();
        observed.delete(doc);
      }
    });
    // Remove old documents BEFORE adding replacements: a frame's WindowProxy
    // survives navigation and removal through it targets the new document.
    reachable.forEach(function (view, doc) {
      if (observed.has(doc)) return;
      // contentDocument access above obeys normal origin and sandbox checks.
      view.addEventListener("click", click, true);
      view.addEventListener("auxclick", click, true);
      doc.addEventListener("load", frameLoaded, true);
      var observer = new MutationObserver(framesChanged);
      observer.observe(doc, { childList: true, subtree: true });
      observed.set(doc, function () {
        try {
          view.removeEventListener("click", click, true);
          view.removeEventListener("auxclick", click, true);
        } catch (_) {
          // The WindowProxy may now point at a cross-origin document. Its old
          // document is gone; release our accessible document/observer only.
        }
        doc.removeEventListener("load", frameLoaded, true);
        observer.disconnect();
      });
    });
  }
  function dispose() {
    closed = true;
    parentOrigin = null;
    clearFrames();
    window.removeEventListener("message", command);
    window.removeEventListener("pagehide", dispose);
  }
  window.addEventListener("message", command);
  window.addEventListener("pagehide", dispose);
}
