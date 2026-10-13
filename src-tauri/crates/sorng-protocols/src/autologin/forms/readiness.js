/* Private auto-login forms/readiness.js. Assembled inside the coordinator IIFE. */
// Full-page Cloudflare verification, excluding a Turnstile widget on a real login.
function loginChallengeStatus(doc) {
  var markers = Array.from(
    doc.querySelectorAll(
      "#challenge-form, #challenge-running, #challenge-stage, #cf-wrapper, .cf-browser-verification",
    ),
  );
  var marker = markers.some(function (element) {
    for (var node = element; node; node = node.parentElement) {
      var style = doc.defaultView.getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
    }
    return true;
  });
  var text = ((doc.body && doc.body.textContent) || "").slice(0, 20000);
  var title = doc.title || "";
  var known =
    marker ||
    (markers.length === 0 &&
      ((/performing security verification|incompatible browser extension or network configuration/i.test(
        text,
      ) &&
        /cloudflare|challenges.cloudflare.com|ray id/i.test(text)) ||
        (/just a moment|attention required/i.test(title) &&
          /cloudflare|security verification|enable javascript and cookies/i.test(
            text,
          ))));
  if (!known) return null;
  return /incompatible browser extension or network configuration/i.test(text)
    ? "incompatible"
    : "waiting";
}
// The native host owns its authenticated, one-per-attempt reload action.
// Legacy pages have no native notification channel and use their local marker.
function requestLoginChallengeReload() {
  if (typeof notify === "function") notify("challenge-reloading");
  else window.location.reload();
}
// Coordinator guard: every provider waits before its own readiness/nonce flow.
function waitForLoginChallenge() {
  return new Promise(function (resolve) {
    var doc = document,
      origin = window.location.origin,
      began = Date.now();
    var timer,
      finished = false,
      reloaded = false;
    var key = "sorng-cloudflare-reload.v1";
    try {
      reloaded = Date.now() - Number(sessionStorage.getItem(key)) < 120000;
    } catch (_) {
      reloaded = true;
    }
    function finish(ok, reason) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cancelActive === cancel) cancelActive = null;
      resolve({ ok: ok, reason: reason });
    }
    function cancel() {
      finish(false, "cancelled");
    }
    function tick() {
      if (finished) return;
      if (stopped || document !== doc || window.location.origin !== origin)
        return cancel();
      var challenge = loginChallengeStatus(doc);
      if (!challenge) {
        try {
          sessionStorage.removeItem(key);
        } catch (_) {}
        finish(true, "challenge-cleared");
        return;
      }
      if (Date.now() - began >= 120000) {
        finish(false, "challenge-timeout");
        return;
      }
      if (
        challenge === "incompatible" &&
        !reloaded &&
        Date.now() - began >= 5000
      ) {
        reloaded = true;
        try {
          sessionStorage.setItem(key, String(Date.now()));
        } catch (_) {}
        requestLoginChallengeReload();
      }
      timer = setTimeout(tick, 200);
    }
    cancelActive = cancel;
    tick();
  });
}
// The legacy coordinator retains its single flight while challenge readiness waits.
function resumeLoginAfterChallenge(retry) {
  return waitForLoginChallenge().then(function (result) {
    if (stopped) return;
    if (!result.ok) {
      report(result);
      return;
    }
    return retry();
  });
}
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
    var challengeBegan = 0;
    var challengeReloaded = false;
    var challengeKey = "sorng-cloudflare-reload.v1";
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
      var challenge = loginChallengeStatus(document);
      if (challenge) {
        if (!challengeBegan) {
          challengeBegan = Date.now();
          if (typeof notify === "function") notify("challenge-waiting");
          try {
            challengeReloaded =
              Date.now() - Number(sessionStorage.getItem(challengeKey)) <
              120000;
          } catch (_) {
            challengeReloaded = true;
          }
        }
        if (Date.now() - challengeBegan >= 120000) {
          finish({ ok: false, reason: "challenge-timeout" });
          return;
        }
        if (
          challenge === "incompatible" &&
          !challengeReloaded &&
          Date.now() - challengeBegan >= 5000
        ) {
          challengeReloaded = true;
          try {
            sessionStorage.setItem(challengeKey, String(Date.now()));
          } catch (_) {}
          requestLoginChallengeReload();
        }
        timer = setTimeout(tick, 200);
        return;
      }
      if (challengeBegan) {
        challengeBegan = 0;
        deadline = Date.now() + options.detectionTimeoutMs;
        try {
          sessionStorage.removeItem(challengeKey);
        } catch (_) {}
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
