/* Auto-login coordinator: one-shot nonce redemption, reviewed-client dispatch,
 * cancellation and transport-secret cleanup. Private modules are assembled here
 * by autologin_asset.rs; this template is not a standalone executable asset.
 * See autologin/README.md for the include-scope and credential lifecycle seam.
 */

(function () {
  "use strict";

  // Idempotent install: if a previous injection already defined the full asset,
  // don't clobber its single-run state.
  if (
    window.__sorng_autologin &&
    typeof window.__sorng_autologin.fetchCredsAndRun === "function" &&
    window.__sorng_autologin.__full
  ) {
    return;
  }

  // Client-side single-shot guard. The proxy also disarms after the first
  // credential hand-out (structural single-shot), but we guard here too so a
  // double bootstrap invocation never fills/submits twice.
  var hasRun = false;
  var stopped = false;
  var cancelActive = null;
  var fetchController = null;
  function cancelRun() {
    stopped = true;
    if (window.__sorng_bitwarden_login) window.__sorng_bitwarden_login.cancel();
    if (window.__sorng_synology_login) window.__sorng_synology_login.cancel();
    if (window.__sorng_yealink_login) window.__sorng_yealink_login.cancel();
    if (window.__sorng_cloudflare_login)
      window.__sorng_cloudflare_login.cancel();
    if (window.__sorng_adobe_login) window.__sorng_adobe_login.cancel();
    if (window.__sorng_chatgpt_login) window.__sorng_chatgpt_login.cancel();
    if (window.__sorng_claude_login) window.__sorng_claude_login.cancel();
    if (fetchController) fetchController.abort();
    fetchController = null;
    if (cancelActive) cancelActive();
    cancelActive = null;
  }
  window.addEventListener("pagehide", cancelRun);
  window.addEventListener("unload", cancelRun);

  /*__SORNG_AUTOLOGIN_MODULES__*/

  function report(result) {
    // Fixed diagnostic result only; no credentials are included in the event.
    // It never carries the credential, only the outcome.
    try {
      window.parent.postMessage(
        { type: "proxy_autologin_result", result: result },
        "*",
      );
    } catch (_) {}
    try {
      window.__autologin_last = result;
    } catch (_) {}
  }

  // ------------------------------------------------------------------------
  // 5. CREDENTIAL HANDSHAKE — fetch once, fill, drop the secret
  //
  // The injected HTML carries ONLY the per-page nonce + non-secret selectors.
  // The credential is fetched exactly once from the nonce-guarded same-origin
  // endpoint; non-200 => no-op, no retry (403 = not armed / nonce spent).
  // ------------------------------------------------------------------------
  var AUTOLOGIN_PATH = "/__sortofremoteng_autologin";

  function fetchCredsAndRun(nonce, selectors, loginFlow, readiness) {
    // Client single-shot: never fetch/fill/submit more than once per page.
    if (hasRun || stopped) return;
    hasRun = true;

    if (loginFlow === "yealink-t20p") {
      var yealink = window.__sorng_yealink_login;
      if (!yealink || typeof yealink.runWhenReady !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return yealink.runWhenReady(nonce, {
        fillField: fillField,
        isVisible: isVisible,
        report: report,
      });
    }

    // Native closed purpose hint: DSM must see a complete account panel before
    // dispensing its username and starting the short password continuation.
    if (loginFlow === "synology") {
      var synology = window.__sorng_synology_login;
      if (!synology || typeof synology.runWhenReady !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return synology.runWhenReady(nonce, {
        fillField: fillField,
        isVisible: isVisible,
        report: report,
      });
    }
    if (loginFlow === "google" || loginFlow === "google-password") {
      var google = window.__sorng_google_login;
      if (
        !google ||
        typeof google[
          loginFlow === "google" ? "runWhenReady" : "runPasswordWhenReady"
        ] !== "function"
      ) {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      var googleHelpers = {
        fillField: fillField,
        isVisible: isVisible,
        report: report,
      };
      return loginFlow === "google"
        ? google.runWhenReady(nonce, googleHelpers)
        : google.runPasswordWhenReady(nonce, googleHelpers);
    }
    if (loginFlow === "cloudflare") {
      var cloudflare = window.__sorng_cloudflare_login;
      if (!cloudflare || typeof cloudflare.runWhenReady !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return cloudflare.runWhenReady(nonce, {
        fillField: fillField,
        isVisible: isVisible,
        report: report,
      });
    }
    if (loginFlow === "adobe") {
      var adobe = window.__sorng_adobe_login;
      if (!adobe || typeof adobe.runWhenReady !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return adobe.runWhenReady(nonce, {
        fillField: fillField,
        report: report,
      });
    }
    if (
      loginFlow === "chatgpt" ||
      loginFlow === "chatgpt-password" ||
      loginFlow === "claude"
    ) {
      var aiClient =
        loginFlow === "claude"
          ? window.__sorng_claude_login
          : window.__sorng_chatgpt_login;
      var aiMethod =
        loginFlow === "chatgpt-password"
          ? "runPasswordWhenReady"
          : "runWhenReady";
      if (!aiClient || typeof aiClient[aiMethod] !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return aiClient[aiMethod](nonce, {
        fillField: fillField,
        report: report,
      });
    }
    var readinessProfile = loginFlow === "cpanel" ? "cpanel" : null;
    if (loginFlow != null && readinessProfile == null) {
      report({ ok: false, reason: "invalid-login-flow" });
      return;
    }

    var injectedOv = normSel(selectors);

    // Staged login clients and cPanel retain their reviewed lifecycle. This
    // gate requires explicit selectors, so it never mistakes a password-less
    // Bitwarden first step for a missing generic login form.
    if (
      !readinessProfile &&
      injectedOv &&
      (injectedOv.username || injectedOv.password || injectedOv.submit)
    )
      return waitForSelectedLoginForm(injectedOv, readiness).then(
        function (result) {
          if (!result.ok) return result;
          if (stopped) return { ok: false, reason: "cancelled" };
          return redeemCredentials(
            nonce,
            injectedOv,
            readinessProfile,
            result.deadline,
          );
        },
      );

    return redeemCredentials(nonce, injectedOv, readinessProfile);
  }

  function redeemCredentials(
    nonce,
    injectedOv,
    readinessProfile,
    readinessDeadline,
  ) {
    if (readinessDeadline !== undefined && Date.now() >= readinessDeadline) {
      var expired = { ok: false, reason: "form-not-found-timeout" };
      report(expired);
      return expired;
    }
    fetchController =
      typeof AbortController === "function" ? new AbortController() : null;
    return fetch(AUTOLOGIN_PATH + "?nonce=" + encodeURIComponent(nonce), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: fetchController ? fetchController.signal : undefined,
    })
      .then(function (r) {
        // Non-200 => do nothing, do NOT retry.
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (data) {
        // Endpoint selectors (from the connection config) are AUTHORITATIVE
        // and override anything templated into the bootstrap.
        fetchController = null;
        var creds = null;
        try {
          if (stopped) return;
          // A response may select only a reviewed legacy staged adapter when
          // there was no injected flow hint. cPanel always receives the generic
          // credential shape (no response flow); never dispatch another client.
          if (
            data &&
            data.loginFlow != null &&
            (readinessProfile !== null ||
              (data.loginFlow !== "bitwarden" && data.loginFlow !== "synology"))
          ) {
            report({ ok: false, reason: "invalid-login-flow" });
            return;
          }
          if (
            data &&
            (data.loginFlow === "bitwarden" || data.loginFlow === "synology")
          ) {
            var reviewedClient =
              data.loginFlow === "synology"
                ? window.__sorng_synology_login
                : window.__sorng_bitwarden_login;
            if (!reviewedClient || typeof reviewedClient.run !== "function") {
              report({ ok: false, reason: "autologin-client-unavailable" });
              return;
            }
            return reviewedClient.run(data, {
              fillField: fillField,
              isVisible: isVisible,
              report: report,
            });
          }
          if (
            !data ||
            typeof data.username !== "string" ||
            typeof data.password !== "string"
          ) {
            report({ ok: false, reason: "invalid-credential-response" });
            return;
          }
          var ov = normSel(data.selectors) || injectedOv;
          creds = { username: data.username, password: data.password };
          return bootstrapFill(
            creds,
            ov,
            data.formAutomation,
            readinessProfile,
            readinessDeadline,
          );
        } finally {
          // Drop the transport object now; bootstrap owns its private copy.
          if (data && typeof data === "object") {
            data.username = null;
            data.password = null;
            data.continuation = null;
            if (
              data.formAutomation &&
              Array.isArray(data.formAutomation.fields)
            )
              data.formAutomation.fields.forEach(function (field) {
                if (field && typeof field === "object") field.value = "";
              });
          }
        }
      })
      .catch(function () {
        fetchController = null;
        report({
          ok: false,
          reason: stopped ? "cancelled" : "cred-fetch-failed",
        });
      });
  }

  // Export. `__full` lets the nonce-only bootstrap (and
  // any re-injection) defers to it and does not clobber the single-run state.
  window.__sorng_autologin = {
    __full: true,
    setNativeValue: setNativeValue,
    fillField: fillField,
    typeField: typeField,
    findLoginForm: findLoginForm,
    submitForm: submitForm,
    attempt: attempt,
    bootstrap: bootstrapFill,
    fetchCredsAndRun: fetchCredsAndRun,
    cancel: cancelRun,
  };
})();
