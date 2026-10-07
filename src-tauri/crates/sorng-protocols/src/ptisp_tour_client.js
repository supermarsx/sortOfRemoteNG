// Native readiness injection is restricted to the reviewed PTisp origin.
// Independent of credentials: manual and SPA logins can reveal the tour later.
(function () {
  "use strict";
  if (window.__sorng_ptisp_tour_v1) return;
  window.__sorng_ptisp_tour_v1 = true;

  var phase = "close";
  var queued = null;
  var deadlineTimer = null;
  var deadline = 0;
  var baseline = new Set();
  var observer = new MutationObserver(schedule);

  function visible(element) {
    if (!element.isConnected) return false;
    for (var node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true")
        return false;
      var style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0" ||
        style.contentVisibility === "hidden"
      )
        return false;
    }
    return Array.from(element.getClientRects()).some(function (rect) {
      return rect.width > 0 && rect.height > 0;
    });
  }

  function enabled(element) {
    return (
      !element.matches(":disabled") &&
      !element.closest('[inert], [aria-disabled="true"]')
    );
  }

  function confirmations() {
    return Array.from(
      document.querySelectorAll('button[type="submit"].btn.btn-primary.btn-md'),
    ).filter(function (button) {
      return (
        (button.textContent || "").replace(/\s+/g, " ").trim() ===
        "Não mostrar todas"
      );
    });
  }

  function stop() {
    phase = "stopped";
    observer.disconnect();
    window.clearTimeout(queued);
    window.clearTimeout(deadlineTimer);
    queued = null;
    deadlineTimer = null;
    baseline.clear();
    document.removeEventListener("DOMContentLoaded", schedule);
    document.removeEventListener("transitionend", schedule, true);
    document.removeEventListener("animationend", schedule, true);
    document.removeEventListener("load", schedule, true);
    document.removeEventListener("click", stop, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pagehide", stop);
    window.removeEventListener("unload", stop);
  }

  function onKey(event) {
    if (event.key === "Escape") stop();
  }

  function inspect() {
    queued = null;
    if (phase === "stopped" || document.readyState === "loading") return;
    if (phase === "close") {
      var close = Array.from(
        document.querySelectorAll("button.my-tour-close"),
      ).find(function (button) {
        return visible(button) && enabled(button);
      });
      if (!close) return;
      // Visible-but-disabled matches also belong to the baseline: enabling
      // an unrelated old button must never make it our confirmation.
      baseline = new Set(confirmations().filter(visible));
      phase = "confirm";
      deadline = Date.now() + 15000;
      deadlineTimer = window.setTimeout(stop, 15000);
      try {
        close.click();
      } catch {
        stop();
      }
      if (phase === "stopped") return;
      // Any subsequent click yields to the site's/user's choice (including
      // Cancel or a backdrop). Our own close has already finished dispatching.
      document.addEventListener("click", stop, true);
      document.addEventListener("keydown", onKey, true);
      schedule();
      return;
    }
    if (Date.now() >= deadline) {
      stop();
      return;
    }
    var matches = confirmations().filter(function (button) {
      return !baseline.has(button) && visible(button);
    });
    // Ambiguous dialogs and disabled controls are left to the site/user.
    if (matches.length !== 1 || !enabled(matches[0])) return;
    var confirm = matches[0];
    stop();
    confirm.click();
  }

  function schedule() {
    if (phase !== "stopped" && queued === null)
      queued = window.setTimeout(inspect, 50);
  }

  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "disabled",
      "aria-hidden",
      "aria-disabled",
      "inert",
      "open",
      "type",
    ],
  });
  document.addEventListener("DOMContentLoaded", schedule);
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  document.addEventListener("load", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("pagehide", stop);
  window.addEventListener("unload", stop);
  schedule();
})();
