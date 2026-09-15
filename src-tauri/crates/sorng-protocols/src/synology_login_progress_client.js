/* Advisory page-helper diagnostics only. This bridge cannot request credentials. */
(function (identity) {
  "use strict";
  var phases = [
    "waiting_document",
    "waiting_page",
    "waiting_root",
    "waiting_account_form",
    "waiting_account_editable",
    "waiting_account_stable",
    "requesting_username",
    "filling_username",
    "waiting_next_button",
    "waiting_password_form",
    "requesting_password",
    "filling_password",
    "waiting_signin_button",
    "verifying_sign_in",
    "submitted",
    "timeout",
    "stopped",
    "cancelled",
    "signed_in",
    "rejected",
  ];
  var finishing = [
    "submitted",
    "timeout",
    "stopped",
    "cancelled",
    "signed_in",
    "rejected",
  ];
  var reasons = [
    "not-started",
    "document-loading",
    "form-settling",
    "input-settling",
    "next-not-advanced",
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
    "route-pending",
    "page-busy",
    "controls-replaced",
    "value-refilled",
    "panel-quiet-wait",
    "next-reclicked",
    "captcha-required",
    "interactive-step-required",
    "user-input-detected",
    "unsafe-form-target",
    "account-mismatch",
    "left-login-page",
    "layout-unrecognized",
    "unsupported-login-path",
    "page-never-ready",
    "login-form-never-appeared",
    "password-panel-never-appeared",
    "signin-button-never-enabled",
    "left-signin-page",
    "error-visible",
    "sign-in-unconfirmed",
    "no-sign-in-page",
  ];
  // Closed trace values; the helper never reports values, ids, URLs or text.
  var hashes = [
    "empty",
    "slash",
    "signin",
    "password",
    "otp",
    "approve",
    "select-auth",
    "passkey",
    "other",
  ];
  var readyStates = ["loading", "interactive", "complete"];
  var stages = ["account", "password", "submitted"];
  var handoffs = ["otp", "approve", "select-auth", "passkey", "other"];
  var counts = ["root", "panel", "form", "field", "button"];
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
    lastPhase = null,
    phaseChanges = 0,
    reasonChanges = 0,
    terminal = false,
    limited = false;
  function integer(value, max) {
    return typeof value === "number" && value >= 0 && value % 1 === 0
      ? Math.min(value, max)
      : null;
  }
  function member(list, value) {
    return typeof value === "string" && list.includes(value);
  }
  // Rebuild the trace from closed values only. Each page-owned property is
  // read once; a malformed or hostile trace is omitted without affecting the
  // closed phase and reason it accompanies.
  function sanitizeTrace(read) {
    try {
      var value = read();
      if (!value || typeof value !== "object") return null;
      var result = {},
        steps = value.steps,
        fingerprint = value.fingerprint,
        handoff = value.handoff;
      if (Array.isArray(steps)) {
        var clean = [],
          length = integer(steps.length, 4294967295) || 0;
        for (var index = Math.max(0, length - 8); index < length; index++) {
          var step = steps[index];
          if (!step || typeof step !== "object") continue;
          var t = integer(step.t, 86400000),
            phase = step.phase,
            reason = step.reason;
          if (t !== null && member(phases, phase) && member(reasons, reason))
            clean.push({ t: t, phase: phase, reason: reason });
        }
        if (clean.length) result.steps = clean;
      }
      if (fingerprint && typeof fingerprint === "object") {
        var print = {},
          any = false;
        counts.forEach(function (name) {
          var count = integer(fingerprint[name], 9);
          if (count !== null) {
            print[name] = count;
            any = true;
          }
        });
        [
          ["hash", hashes],
          ["readyState", readyStates],
          ["stage", stages],
        ].forEach(function (field) {
          var closed = fingerprint[field[0]];
          if (member(field[1], closed)) {
            print[field[0]] = closed;
            any = true;
          }
        });
        if (any) result.fingerprint = print;
      }
      if (member(handoffs, handoff)) result.handoff = handoff;
      return result.steps || result.fingerprint || result.handoff
        ? result
        : null;
    } catch (_) {
      return null;
    }
  }
  function report(value, readTrace) {
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
    var ending = finishing.includes(phase);
    if (last === key) return;
    if (!ending) {
      if (limited) return;
      // Phase changes and reason-only churn within a phase are bounded apart.
      var phaseChange = phase !== lastPhase;
      if (phaseChange ? phaseChanges >= 64 : reasonChanges >= 256) {
        limited = true;
        reason = "observation-limited";
      } else if (phaseChange) phaseChanges++;
      else reasonChanges++;
    }
    last = key;
    lastPhase = phase;
    terminal = ending;
    var message = {
      type: "proxy_synology_login_progress",
      version: bound.version,
      sessionId: bound.sessionId,
      documentToken: bound.documentToken,
      documentSequence: bound.documentSequence,
      navigationToken: bound.navigationToken,
      phase: phase,
      reason: reason,
    };
    var trace = limited && !ending ? null : sanitizeTrace(readTrace);
    if (trace) message.trace = trace;
    try {
      window.parent.postMessage(message, "*");
    } catch (_) {
      /* No diagnostic failure grants access or retries an action. */
    }
  }
  function progress(event) {
    var detail = event.detail;
    report(detail, function () {
      return detail.trace;
    });
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
      report(helper.getStatus(), function () {
        // getStatus() is phase and reason only; the same trace is read apart.
        return typeof helper.getTrace === "function" ? helper.getTrace() : null;
      });
  } catch (_) {
    /* Advisory only. */
  }
})(p);
