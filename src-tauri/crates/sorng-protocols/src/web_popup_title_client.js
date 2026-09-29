/* This is installed only in a native-approved Tactical secondary document.
 * Its title is display metadata, never an authorization or navigation target.
 * Observe only the head: remote-screen/body mutations must not trigger work.
 */
(function () {
  "use strict";
  var initial = new URL(location.href);
  if (
    !/^\/(?:takecontrol|remotebackground)\/[^/]+\/?$/.test(initial.pathname) &&
    !/^\/webvnc\/[^/]+\/[0-9]+\/?$/.test(initial.pathname) &&
    !/^\/webterm\/?$/.test(initial.pathname)
  )
    return;
  var active = true,
    queued = false,
    lastTitle = null,
    observer = null;
  var identity = {
    type: "proxy_web_popup_title",
    version: 1,
    sessionId: p.sessionId,
    documentSequence: p.documentSequence,
    documentToken: p.documentToken,
    navigationToken: p.navigationToken,
    popupParentSequence: popupTitleParentSequence,
  };
  function emit() {
    queued = false;
    if (!active) return;
    var current = new URL(location.href);
    if (
      current.origin !== initial.origin ||
      current.pathname !== initial.pathname
    )
      return;
    var title = document.title.trim();
    if (!title || title.length > 512 || title === lastTitle) return;
    lastTitle = title;
    try {
      window.parent.postMessage(
        Object.assign({}, identity, {
          title: title,
          // Never copy authentication query parameters or fragments into the
          // title channel. The receiver validates the protected origin/path.
          url: current.origin + current.pathname,
        }),
        "*",
      );
    } catch (_) {
      /* Metadata failure cannot interrupt the remote-control page. */
    }
  }
  function schedule() {
    if (!active || queued) return;
    queued = true;
    queueMicrotask(emit);
  }
  function ready() {
    if (!active) return;
    if (!observer && document.head) {
      observer = new MutationObserver(schedule);
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    schedule();
  }
  function stop() {
    active = false;
    observer?.disconnect();
    document.removeEventListener("DOMContentLoaded", ready);
    window.removeEventListener("pagehide", stop);
  }
  window.addEventListener("pagehide", stop, { once: true });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  ready();
})();
