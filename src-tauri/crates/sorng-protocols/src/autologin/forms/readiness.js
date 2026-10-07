/* Private auto-login forms/readiness.js. Assembled inside the coordinator IIFE. */
function waitForSelectedLoginForm(ov, readiness) {
  // A selector-configured application may first serve a dashboard shell and
  // then navigate to /login (legacy Nginx Proxy Manager does exactly this).
  // Redeeming the nonce on that shell disarms the entire session. Wait with
  // no credentials in JS until its selected, safe form actually exists.
  return new Promise(function (resolve) {
    var timer = null;
    var options;
    try {
      options = normalizeFormOptions();
      if (readiness !== undefined) {
        if (
          !readiness ||
          typeof readiness !== "object" ||
          Array.isArray(readiness) ||
          Object.keys(readiness).some(function (key) {
            return key !== "formSelector" && key !== "detectionTimeoutMs";
          })
        )
          throw new Error("invalid-form-options");
        options.detectionTimeoutMs = readiness.detectionTimeoutMs;
        if (readiness.formSelector !== undefined)
          options.formSelector = readiness.formSelector;
        options = normalizeFormOptions(options);
      }
    } catch (_) {
      var invalid = { ok: false, reason: "invalid-form-options" };
      report(invalid);
      resolve(invalid);
      return;
    }
    // Porkbun's own verification can precede enabling Login. Wait at most
    // one minute with no credential in page JS; keep generic timing intact.
    if (porkbunSelectors(ov)) options.detectionTimeoutMs = 60000;
    var deadline = Date.now() + options.detectionTimeoutMs;
    var origin = window.location.origin;
    var finished = false;
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      document.removeEventListener("DOMContentLoaded", tick);
      if (cancelActive === cancel) cancelActive = null;
      if (!result.ok) report(result);
      resolve(result);
    }
    function cancel() {
      finish({ ok: false, reason: "cancelled" });
    }
    function tick() {
      if (finished) return;
      clearTimeout(timer);
      if (stopped || window.location.origin !== origin) {
        cancel();
        return;
      }
      if (Date.now() >= deadline) {
        finish({ ok: false, reason: "form-not-found-timeout" });
        return;
      }
      try {
        if (document.readyState !== "loading") {
          var target = findLoginForm(ov, options);
          if (!target) openFreepbxAdmin(ov);
          if (target) {
            if (target.instagram && !instagramEmpty(target)) {
              finish({ ok: false, reason: "form-already-filled" });
              return;
            }
            if (target.linkedin) {
              if (!linkedinEmpty(target)) {
                finish({ ok: false, reason: "form-already-filled" });
                return;
              }
              linkedinRememberTarget(target);
            }
            targetFingerprint(target);
            finish({ ok: true, deadline: deadline });
            return;
          }
        }
      } catch (error) {
        finish({
          ok: false,
          reason:
            error &&
            [
              "unsafe-form-action",
              "unsafe-form-method",
              "unsafe-form-target",
            ].indexOf(error.message) >= 0
              ? error.message
              : "form-fill-failed",
        });
        return;
      }
      timer = setTimeout(tick, 200);
    }
    cancelActive = cancel;
    document.addEventListener("DOMContentLoaded", tick, { once: true });
    tick();
  });
}
