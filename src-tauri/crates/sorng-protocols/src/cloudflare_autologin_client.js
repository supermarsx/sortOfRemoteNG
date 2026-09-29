/* Cloudflare dashboard email/password adapter. Semantic login controls only;
 * no SSO, challenge solving, recovery, registration or submit retries. The
 * native grant independently restricts credentials to dash.cloudflare.com. */
(function () {
  "use strict";
  if (window.__sorng_cloudflare_login) return;
  var ran = false;
  var stopped = false;
  var active = null;
  function cancel() {
    stopped = true;
    if (active) active();
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("popstate", cancel);
  window.addEventListener("hashchange", cancel);

  function runWhenReady(nonce, helpers) {
    if (ran || stopped) return;
    ran = true;
    var done = false;
    var phase = "email";
    var deadline = Date.now() + 90000;
    var controller = new AbortController();
    var username = null;
    var password = null;
    var continuation = null;
    var captured = null;
    var stable = null;
    var stableSince = 0;
    var filledAt = 0;
    // An enabled button does not prove that a debounced application model has
    // committed the native input events. Allow a settling window per stage.
    var inputSettleMs = 750;
    var timer = null;

    function finish(ok, reason) {
      if (done) return;
      done = true;
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("input", userActivity, true);
      document.removeEventListener("click", userActivity, true);
      // Do not erase anything the user replaced while the task was settling.
      if (
        !ok &&
        captured &&
        captured.pass &&
        password &&
        captured.pass.value === password
      ) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(captured.pass, "");
        captured.pass.dispatchEvent(new Event("input", { bubbles: true }));
        captured.pass.dispatchEvent(new Event("change", { bubbles: true }));
      }
      username = password = continuation = captured = stable = null;
      active = null;
      helpers.report({ ok: ok, reason: reason });
    }
    active = function () {
      finish(false, "cancelled");
    };
    function userActivity(event) {
      if (
        event.isTrusted &&
        event.target instanceof Element &&
        event.target.closest("form") &&
        (event.type === "input" ||
          event.target.closest("button, input[type=submit]"))
      )
        finish(false, "cancelled");
    }
    document.addEventListener("input", userActivity, true);
    document.addEventListener("click", userActivity, true);

    function painted(node) {
      if (
        !(node instanceof HTMLElement) ||
        !node.isConnected ||
        !node.getClientRects().length
      )
        return false;
      for (var ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        var style = getComputedStyle(ancestor);
        if (
          ancestor.hidden ||
          ancestor.inert ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
      }
      return true;
    }
    function visibleNodes(root, selector) {
      // A disabled submit button is still part of the login form: React may
      // enable it only after the controlled fields commit their values.
      return Array.prototype.filter.call(
        root.querySelectorAll(selector),
        painted,
      );
    }
    function readyField(field) {
      return (
        field instanceof HTMLInputElement &&
        field.isConnected &&
        !field.disabled &&
        !field.matches(":disabled") &&
        !field.readOnly &&
        painted(field)
      );
    }
    function challengePending() {
      // A managed interstitial is not a Turnstile form. Its options can exist
      // before a widget is painted, and a token from an unrelated widget does
      // not clear it. Let the page complete/navigate under its own control.
      if (
        window._cf_chl_opt ||
        document.querySelector(
          "#challenge-form, #challenge-running, #challenge-stage",
        )
      )
        return true;
      var turnstile = visibleNodes(
        document,
        ".cf-turnstile, iframe[src]",
      ).filter(function (node) {
        if (node.matches(".cf-turnstile")) return true;
        try {
          var frame = new URL(node.getAttribute("src"), document.baseURI);
          // Native routing replaces the host with a document-local alias.
          // Retain the challenge path signal after that rewrite. This only
          // postpones credential release; it grants no network permission.
          return (
            frame.origin === "https://challenges.cloudflare.com" ||
            frame.pathname.startsWith("/cdn-cgi/challenge-platform/") ||
            frame.pathname.startsWith("/turnstile/")
          );
        } catch (_) {
          return false;
        }
      });
      var response = document.querySelectorAll(
        'input[name="cf-turnstile-response"]',
      );
      if (
        (turnstile.length || response.length) &&
        !(response.length === 1 && response[0].value.trim())
      )
        return true;
      return (
        visibleNodes(
          document,
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[name*="captcha" i]:not([type="hidden"]), input[autocomplete="one-time-code"], input[autocomplete="new-password"], input[type="file"]',
        ).length > 0
      );
    }
    function locate(needUser) {
      if (
        done ||
        stopped ||
        !["/login", "/login/"].includes(location.pathname) ||
        document.readyState !== "complete" ||
        challengePending()
      )
        return null;
      var users = visibleNodes(
        document,
        'form input[type="email"], form input[autocomplete="username"], form input[name="email"][type="text"]',
      );
      var passes = visibleNodes(document, 'form input[type="password"]');
      if (
        users.length > 1 ||
        passes.length > 1 ||
        (needUser && users.length !== 1)
      )
        return null;
      var user = users[0] || null,
        pass = passes[0] || null;
      if (
        (!user && !pass) ||
        (user && !readyField(user)) ||
        (pass && (!readyField(pass) || pass.autocomplete === "new-password"))
      )
        return null;
      var form = (user || pass).form;
      if (
        !form ||
        !form.isConnected ||
        (user && user.form !== form) ||
        (pass && pass.form !== form)
      )
        return null;
      var buttons = visibleNodes(form, 'button, input[type="submit"]').filter(
        function (button) {
          return button.type === "submit" && button.form === form;
        },
      );
      if (buttons.length !== 1) return null;
      var button = buttons[0];
      // An empty formmethod still overrides POST with the browser's GET default.
      if (
        ["formaction", "formmethod", "formtarget"].some(function (key) {
          return button.hasAttribute(key);
        })
      )
        return null;
      var purpose =
        Array.prototype.map
          .call(
            form.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]'),
            function (heading) {
              return painted(heading) ? heading.textContent : "";
            },
          )
          .join(" ") +
        " " +
        (button.textContent || button.value || "");
      if (
        /\b(?:sso|single[ -]sign[ -]on|sign[ -]?up|create (?:an? )?account|reset password|forgot password|recovery|register)\b/i.test(
          purpose,
        )
      )
        return null;
      // Never let an unhydrated SPA fall back to sending secrets in a GET URL.
      // Explicit POST remains the page's own browser submission.
      var rawAction =
        button.getAttribute("formaction") || form.getAttribute("action") || "";
      var rawMethod = form.getAttribute("method") || "";
      var action = new URL(rawAction || location.href, document.baseURI);
      if (
        action.origin !== location.origin ||
        action.username ||
        action.password ||
        !["/login", "/login/"].includes(action.pathname) ||
        (form.hasAttribute("method") && rawMethod.toLowerCase() !== "post") ||
        (rawAction && rawMethod.toLowerCase() !== "post") ||
        (form.target && form.target !== "_self") ||
        (button.formTarget && button.formTarget !== "_self")
      )
        return null;
      return {
        user: user,
        pass: pass,
        form: form,
        button: button,
        spa: !rawMethod,
        fingerprint: JSON.stringify([
          location.href,
          document.baseURI,
          rawAction,
          rawMethod,
          form.target,
          button.formTarget,
          user && user.name,
          pass && pass.name,
          user && user.autocomplete,
          pass && pass.autocomplete,
        ]),
      };
    }
    function same(a, b) {
      return (
        !!a &&
        !!b &&
        a.user === b.user &&
        a.pass === b.pass &&
        a.button === b.button &&
        a.form === b.form &&
        a.fingerprint === b.fingerprint
      );
    }
    function settled(target) {
      if (!same(stable, target)) {
        stable = target;
        stableSince = Date.now();
        return false;
      }
      return Date.now() - stableSince >= 500;
    }
    function checked(target, userValue, passValue) {
      var current = locate(!!target.user);
      if (
        Date.now() >= deadline ||
        !same(current, target) ||
        (target.user && target.user.value !== userValue) ||
        (target.pass && target.pass.value !== passValue)
      )
        throw new Error("changed");
      return current;
    }
    function buttonReady(target) {
      return (
        !target.button.disabled &&
        !target.button.matches(":disabled") &&
        target.button.getAttribute("aria-disabled") !== "true" &&
        target.button.getAttribute("aria-busy") !== "true" &&
        target.form.getAttribute("aria-busy") !== "true"
      );
    }
    function read(token, passwordStage) {
      return fetch(
        "/__sortofremoteng_autologin?" +
          (passwordStage ? "phase=password&" : "") +
          "nonce=" +
          encodeURIComponent(token),
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      ).then(function (response) {
        if (!response.ok) throw new Error("grant");
        return response.json();
      });
    }
    function click(target) {
      function blockGet(event) {
        event.preventDefault();
      }
      if (target.spa) target.form.addEventListener("submit", blockGet, true);
      try {
        target.button.click();
      } finally {
        target.form.removeEventListener("submit", blockGet, true);
      }
    }
    function fail() {
      finish(false, stopped ? "cancelled" : "reviewed-login-stopped");
    }
    function fetchUsername(target) {
      phase = "email-fetch";
      var existing = target.user.value;
      read(nonce, false)
        .then(function (reply) {
          try {
            if (done || stopped) return;
            checked(target, existing, "");
            if (
              !reply ||
              reply.loginFlow !== "cloudflare" ||
              typeof reply.username !== "string" ||
              !reply.username ||
              typeof reply.continuation !== "string" ||
              !/^[0-9a-f]{32}$/.test(reply.continuation) ||
              (existing && existing !== reply.username)
            )
              throw new Error("grant");
            username = reply.username;
            continuation = reply.continuation;
            deadline = Math.min(deadline, Date.now() + 28000);
            captured = target;
            if (!existing)
              helpers.fillField(
                target.user,
                username,
                function () {
                  checked(target, "", "");
                  return true;
                },
                function () {
                  checked(target, username, "");
                  return true;
                },
              );
            checked(target, username, "");
            phase = "email-filled";
            filledAt = Date.now();
          } finally {
            if (reply && typeof reply === "object")
              reply.username = reply.continuation = null;
          }
        })
        .catch(fail);
    }
    function fetchPassword(target) {
      phase = "password-fetch";
      captured = target;
      read(continuation, true)
        .then(function (reply) {
          try {
            if (done || stopped) return;
            checked(target, username, "");
            if (
              !reply ||
              reply.loginFlow !== "cloudflare" ||
              typeof reply.password !== "string" ||
              !reply.password
            )
              throw new Error("grant");
            password = reply.password;
            helpers.fillField(
              target.pass,
              password,
              function () {
                checked(target, username, "");
                return true;
              },
              function () {
                checked(target, username, password);
                return true;
              },
            );
            checked(target, username, password);
            phase = "password-filled";
            filledAt = Date.now();
          } finally {
            if (reply && typeof reply === "object") reply.password = null;
          }
        })
        .catch(fail);
    }
    function progress() {
      if (done || stopped) return;
      if (Date.now() >= deadline)
        return finish(false, "reviewed-login-timeout");
      if (!["/login", "/login/"].includes(location.pathname)) return fail();
      try {
        if (phase === "email") {
          var first = locate(true);
          if (!first || (first.pass && first.pass.value)) {
            stable = null;
            return;
          }
          if (settled(first)) fetchUsername(first);
        } else if (phase === "email-filled") {
          var email = checked(captured, username, "");
          if (Date.now() - filledAt < inputSettleMs) return;
          if (email.pass) fetchPassword(email);
          else if (buttonReady(email) && email.user.checkValidity()) {
            phase = "password";
            stable = null;
            click(email);
          }
        } else if (phase === "password") {
          var next = locate(false);
          if (
            !next ||
            !next.pass ||
            next.pass.value ||
            (next.user && next.user.value !== username)
          ) {
            stable = null;
            return;
          }
          if (settled(next)) fetchPassword(next);
        } else if (phase === "password-filled") {
          var complete = checked(captured, username, password);
          if (
            Date.now() - filledAt < inputSettleMs ||
            !buttonReady(complete) ||
            !complete.pass.checkValidity() ||
            (complete.user && !complete.user.checkValidity())
          )
            return;
          phase = "submitted";
          click(complete);
          finish(true, "submitted");
        }
      } catch (_) {
        fail();
      }
    }
    timer = setInterval(progress, 100);
    progress();
  }
  window.__sorng_cloudflare_login = {
    runWhenReady: runWhenReady,
    cancel: cancel,
  };
})();
