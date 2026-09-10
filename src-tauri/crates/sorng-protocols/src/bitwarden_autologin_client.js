/* Reviewed Bitwarden web-v2026.7 email -> master-password flow. No generic
 * selectors, password-only shortcut, SSO clicks, recovery or submit retries. */
(function () {
  "use strict";
  if (window.__sorng_bitwarden_login) return;
  var ran = false;
  var stopped = false;
  var cancelActive = null;
  function cancel() {
    stopped = true;
    if (cancelActive) cancelActive();
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("unload", cancel);
  window.addEventListener("hashchange", cancel);
  window.addEventListener("popstate", cancel);

  function run(data, helpers) {
    if (ran || stopped)
      return Promise.resolve({ ok: false, reason: "cancelled" });
    ran = true;
    var username = data.username;
    var continuation = data.continuation;
    data.username = null;
    data.continuation = null;
    return new Promise(function (resolve) {
      var finished = false;
      var captured = null;
      var phase = "email";
      var observer = null;
      var controller = null;
      var password = null;
      var startUrl = window.location.href;
      var timeout = setTimeout(function () {
        finish(false, "reviewed-login-timeout");
      }, 15000);

      function finish(ok, reason) {
        if (finished) return;
        finished = true;
        if (observer) observer.disconnect();
        if (controller) controller.abort();
        clearTimeout(timeout);
        username = continuation = password = null;
        cancelActive = null;
        var result = { ok: ok, reason: reason };
        helpers.report(result);
        resolve(result);
      }
      cancelActive = function () {
        finish(false, "cancelled");
      };
      function unique(selector) {
        var matches = document.querySelectorAll(selector);
        if (matches.length !== 1) return null;
        return matches[0];
      }
      function locate() {
        var user = unique(
          'form input#email[type="email"][data-testid="login-email-input"]',
        );
        var pass = unique(
          'form input#masterPassword[type="password"][data-testid="login-master-password-input"]',
        );
        var next = unique(
          'form button[type="button"][data-testid="login-continue-button"]',
        );
        var submit = unique(
          'form button[type="submit"][data-testid="login-submit-button"]',
        );
        if (
          !user ||
          !pass ||
          !next ||
          !submit ||
          !user.form ||
          pass.form !== user.form ||
          next.form !== user.form ||
          submit.form !== user.form
        )
          return null;
        return {
          user: user,
          pass: pass,
          next: next,
          submit: submit,
          form: user.form,
        };
      }
      function fingerprint(target) {
        var action = new URL(
          target.submit.getAttribute("formaction") ||
            target.form.getAttribute("action") ||
            document.URL,
          document.baseURI,
        );
        var method = (
          target.submit.getAttribute("formmethod") ||
          target.form.getAttribute("method") ||
          ""
        ).toLowerCase();
        if (
          action.origin !== window.location.origin ||
          action.username ||
          action.password ||
          (method && method !== "post")
        )
          throw new Error("unsafe-form-action");
        return JSON.stringify([
          action.href,
          method,
          document.baseURI,
          target.form.getAttribute("action"),
          target.submit.getAttribute("formaction"),
          target.user.name,
          target.pass.name,
          target.next.getAttribute("formaction"),
          target.next.getAttribute("formmethod"),
        ]);
      }
      function check() {
        if (finished || stopped || window.location.href !== startUrl)
          throw new Error("cancelled");
        var found = locate();
        if (
          !found ||
          !captured ||
          Object.keys(found).some(function (key) {
            return found[key] !== captured[key];
          }) ||
          fingerprint(found) !== captured.fingerprint ||
          found.user.disabled ||
          found.user.readOnly ||
          found.pass.disabled ||
          found.pass.readOnly ||
          !found.form.isConnected
        )
          throw new Error("reviewed-login-form-changed");
        return found;
      }
      function passwordStage() {
        var target = check();
        if (
          target.user.value !== username ||
          helpers.isVisible(target.user) ||
          helpers.isVisible(target.next) ||
          !helpers.isVisible(target.pass) ||
          !helpers.isVisible(target.submit) ||
          target.submit.disabled
        )
          return null;
        return target;
      }
      function progress() {
        if (finished || phase === "fetching" || phase === "submitted") return;
        try {
          if (stopped || window.location.href !== startUrl)
            throw new Error("cancelled");
          if (phase === "email") {
            var found = locate();
            if (!found) return;
            // Both reviewed controls already exist in the Angular template;
            // only visibility changes. Never reacquire a replacement password.
            if (
              !helpers.isVisible(found.user) ||
              !helpers.isVisible(found.next) ||
              found.next.disabled ||
              helpers.isVisible(found.pass) ||
              helpers.isVisible(found.submit)
            )
              throw new Error("reviewed-login-initial-stage-required");
            captured = found;
            captured.fingerprint = fingerprint(found);
            check();
            helpers.fillField(found.user, username, check);
            check();
            if (
              found.user.value !== username ||
              !helpers.isVisible(found.user) ||
              !helpers.isVisible(found.next) ||
              found.next.disabled
            )
              throw new Error("reviewed-login-form-changed");
            phase = "password";
            found.next.click();
          }
          var target = passwordStage();
          if (!target) return;
          phase = "fetching";
          controller = new AbortController();
          // Password is requested only after the exact reviewed password stage
          // is visible. Native continuation is one-use, expiring and bound to
          // this document/session. The first response contained no password.
          fetch(
            "/__sortofremoteng_autologin?phase=password&nonce=" +
              encodeURIComponent(continuation),
            {
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
            },
          )
            .then(function (response) {
              return response.ok
                ? response.json()
                : Promise.reject(new Error("reviewed-login-expired"));
            })
            .then(function (reply) {
              try {
                if (
                  !passwordStage() ||
                  !reply ||
                  reply.loginFlow !== "bitwarden" ||
                  typeof reply.password !== "string"
                )
                  throw new Error("reviewed-login-form-changed");
                password = reply.password;
                helpers.fillField(target.pass, password, function () {
                  if (!passwordStage())
                    throw new Error("reviewed-login-form-changed");
                  return true;
                });
                if (!passwordStage() || target.pass.value !== password)
                  throw new Error("reviewed-login-form-changed");
                // Preserve Angular submit handlers while refusing a native GET
                // fallback that would put password controls into the URL.
                var preventGet = function (event) {
                  event.preventDefault();
                };
                var method = (
                  target.submit.getAttribute("formmethod") ||
                  target.form.getAttribute("method") ||
                  ""
                ).toLowerCase();
                if (!method)
                  target.form.addEventListener("submit", preventGet, true);
                phase = "submitted";
                try {
                  target.submit.click();
                } finally {
                  if (!method)
                    target.form.removeEventListener("submit", preventGet, true);
                }
                finish(true, "submitted");
              } finally {
                if (reply && typeof reply === "object") reply.password = null;
                password = null;
              }
            })
            .catch(function () {
              finish(
                false,
                stopped || finished ? "cancelled" : "reviewed-login-stopped",
              );
            });
        } catch (_) {
          finish(false, stopped ? "cancelled" : "reviewed-login-stopped");
        }
      }
      if (
        typeof username !== "string" ||
        !username ||
        typeof continuation !== "string" ||
        !/^[0-9a-f]{32}$/.test(continuation)
      ) {
        finish(false, "invalid-credential-response");
        return;
      }
      observer = new MutationObserver(progress);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      progress();
    });
  }
  window.__sorng_bitwarden_login = { run: run, cancel: cancel };
})();
