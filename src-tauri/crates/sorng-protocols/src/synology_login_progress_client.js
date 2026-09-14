/* Advisory page-helper diagnostics only. This bridge cannot request credentials. */
(function (identity) {
  "use strict";
  var phases = [
    "waiting_document",
    "waiting_root",
    "waiting_account_form",
    "waiting_account_editable",
    "requesting_username",
    "waiting_next_button",
    "waiting_password_form",
    "requesting_password",
    "waiting_signin_button",
    "submitted",
    "timeout",
    "stopped",
    "cancelled",
  ];
  var reasons = [
    "not-started",
    "document-loading",
    "root-missing",
    "root-ambiguous",
    "form-missing",
    "form-ambiguous",
    "field-missing",
    "field-ambiguous",
    "button-missing",
    "button-ambiguous",
    "field-hidden",
    "field-disabled",
    "field-readonly",
    "button-hidden",
    "button-disabled",
    "panel-transition",
    "password-route",
    "requesting-username",
    "requesting-password",
    "submitted",
    "timeout",
    "stopped",
    "cancelled",
    "form-changed",
    "route-changed",
    "captcha",
    "credentials-unavailable",
    "invalid-credential-response",
  ];
  // Copy the native identity; the readiness reporter mutates its own payload.
  var bound = {
    version: 1,
    sessionId: identity.sessionId,
    documentToken: identity.documentToken,
    documentSequence: identity.documentSequence,
    navigationToken: identity.navigationToken,
  };
  var active = true,
    last = null,
    reports = 0,
    terminal = false,
    limited = false;
  function report(value) {
    if (!active || terminal || !value || typeof value !== "object") return;
    var phase = value.phase,
      reason = value.reason;
    if (
      typeof phase !== "string" ||
      typeof reason !== "string" ||
      !phases.includes(phase) ||
      !reasons.includes(reason)
    )
      return;
    var key = phase + ":" + reason;
    var finishing = ["submitted", "timeout", "stopped", "cancelled"].includes(
      phase,
    );
    if (last === key) return;
    if (!finishing && reports >= 64) {
      if (limited) return;
      limited = true;
      reason = "observation-limited";
    }
    last = key;
    reports++;
    terminal = finishing;
    try {
      window.parent.postMessage(
        {
          type: "proxy_synology_login_progress",
          version: bound.version,
          sessionId: bound.sessionId,
          documentToken: bound.documentToken,
          documentSequence: bound.documentSequence,
          navigationToken: bound.navigationToken,
          phase: phase,
          reason: reason,
        },
        "*",
      );
    } catch (_) {
      /* No diagnostic failure grants access or retries an action. */
    }
  }
  function progress(event) {
    report(event.detail);
  }
  function close() {
    active = false;
    document.removeEventListener("sorng_synology_login_progress", progress);
    window.removeEventListener("pagehide", close);
    window.removeEventListener("unload", close);
  }
  document.addEventListener("sorng_synology_login_progress", progress);
  window.addEventListener("pagehide", close);
  window.addEventListener("unload", close);
  // Usually installed before the helper. A later installation can safely pick
  // up its fixed, read-only snapshot without invoking or restarting the helper.
  try {
    var helper = window.__sorng_synology_login;
    if (helper && typeof helper.getStatus === "function")
      report(helper.getStatus());
  } catch (_) {
    /* Advisory only. */
  }
})(p);
