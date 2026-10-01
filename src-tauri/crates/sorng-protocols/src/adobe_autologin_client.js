/* Reviewed Adobe SPA email/password only. Native grants bind the exact auth
 * origin/document; no registration, federation, profile choice or MFA handling. */
(function () {
  "use strict";
  if (window.__sorng_adobe_login) return;
  var ran = false,
    stopped = false,
    active = null;
  function cancel() {
    stopped = true;
    if (active) active();
  }
  window.addEventListener("pagehide", cancel);

  function runWhenReady(nonce, helpers) {
    if (ran || stopped) return;
    ran = true;
    var done = false,
      phase = "email",
      timer = null;
    var deadline = Date.now() + 90000;
    var initialDocument = location.origin + location.pathname + location.search;
    var controller = new AbortController();
    var username = null,
      password = null,
      continuation = null;
    var captured = null,
      stable = null,
      stableSince = 0,
      filledAt = 0;

    function finish(ok, reason) {
      if (done) return;
      done = true;
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("input", userActivity, true);
      document.removeEventListener("click", userActivity, true);
      window.removeEventListener("hashchange", navigation);
      window.removeEventListener("popstate", navigation);
      if (
        !ok &&
        captured &&
        captured.stage === "password" &&
        password &&
        captured.field.value === password
      ) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(captured.field, "");
        captured.field.dispatchEvent(new Event("input", { bubbles: true }));
        captured.field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      nonce = username = password = continuation = captured = stable = null;
      active = null;
      helpers.report({ ok: ok, reason: reason });
    }
    function fail() {
      finish(false, "reviewed-login-stopped");
    }
    active = function () {
      finish(false, "cancelled");
    };
    function userActivity(event) {
      if (event.isTrusted) finish(false, "cancelled");
    }
    document.addEventListener("input", userActivity, true);
    document.addEventListener("click", userActivity, true);

    function route() {
      if (
        location.pathname !== "/en_US/index.html" ||
        location.origin + location.pathname + location.search !==
          initialDocument
      )
        return null;
      var path = (location.hash.slice(1) || "/").split("?")[0];
      return path === "/" ? "email" : path === "/password" ? "password" : null;
    }
    function navigation() {
      var current = route();
      if (
        !current ||
        (phase.indexOf("email") === 0 && current !== "email") ||
        (phase.indexOf("password") === 0 && current !== "password")
      )
        fail();
    }
    window.addEventListener("hashchange", navigation);
    window.addEventListener("popstate", navigation);

    function painted(node) {
      if (
        !(node instanceof HTMLElement) ||
        !node.isConnected ||
        !node.getClientRects().length
      )
        return false;
      for (var parent = node; parent; parent = parent.parentElement) {
        var style = getComputedStyle(parent);
        if (
          parent.hidden ||
          parent.inert ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
      }
      return true;
    }
    function only(root, selector) {
      var nodes = root.querySelectorAll(selector);
      return nodes.length === 1 ? nodes[0] : null;
    }
    function blocked() {
      return Array.prototype.some.call(
        document.querySelectorAll(
          'input[autocomplete="one-time-code"], input[autocomplete="new-password"], ' +
            'iframe[src*="captcha"], iframe[src*="challenge"], .cf-turnstile, ' +
            '[role="alert"], [aria-invalid="true"], #PasswordPage-PasswordField-Error, ' +
            "#GetStarted-EmailField-Error",
        ),
        function (node) {
          return (
            painted(node) &&
            (!node.matches('[role="alert"], [id$="-Error"]') ||
              !!node.textContent.trim())
          );
        },
      );
    }
    function locate(stage) {
      if (done || stopped || route() !== stage || blocked()) return null;
      var email = stage === "email";
      var form = only(document, email ? "form#EmailForm" : "form#PasswordForm");
      if (!form || !painted(form)) return null;
      var field = only(
        form,
        email
          ? 'input#EmailPage-EmailField[name="username"][type="email"]'
          : 'input#PasswordPage-PasswordField[name="password"][type="password"]',
      );
      var button = only(
        form,
        email
          ? 'button[data-id="EmailPage-ContinueButton"][type="submit"]'
          : 'button[data-id="PasswordPage-ContinueButton"][type="submit"]',
      );
      var identity = email
        ? null
        : only(form, 'input[name="username"][autocomplete="username"]');
      if (
        !field ||
        !button ||
        !painted(field) ||
        !painted(button) ||
        field.form !== form ||
        button.form !== form ||
        field.disabled ||
        field.matches(":disabled") ||
        field.readOnly ||
        (!email &&
          (!identity ||
            identity.form !== form ||
            painted(identity) ||
            !identity.readOnly ||
            !identity.value ||
            identity.value !== username)) ||
        Array.prototype.some.call(
          form.querySelectorAll("input"),
          function (input) {
            return (
              input !== field &&
              painted(input) &&
              (input.type === "password" ||
                input.type === "email" ||
                input.autocomplete === "username")
            );
          },
        ) ||
        ["formaction", "formmethod", "formtarget", "formenctype"].some(
          function (name) {
            return button.hasAttribute(name);
          },
        )
      )
        return null;
      var action = new URL(
        form.getAttribute("action") || location.href,
        document.baseURI,
      );
      var method = form.getAttribute("method");
      if (
        action.origin !== location.origin ||
        action.username ||
        action.password ||
        action.pathname !== location.pathname ||
        (method !== null && method.toLowerCase() !== "post") ||
        (form.target && form.target !== "_self")
      )
        return null;
      return {
        stage: stage,
        form: form,
        field: field,
        button: button,
        identity: identity,
        fingerprint: JSON.stringify([
          location.href,
          document.baseURI,
          form.getAttribute("action"),
          method,
          form.target,
          form.enctype,
          field.name,
          field.type,
          field.autocomplete,
          identity && identity.value,
        ]),
      };
    }
    function same(a, b) {
      return (
        !!a &&
        !!b &&
        a.form === b.form &&
        a.field === b.field &&
        a.button === b.button &&
        a.identity === b.identity &&
        a.fingerprint === b.fingerprint
      );
    }
    function checked(target, value) {
      if (
        done ||
        stopped ||
        Date.now() >= deadline ||
        !same(locate(target.stage), target) ||
        target.field.value !== value
      )
        throw new Error("changed");
      return true;
    }
    function settled(target) {
      if (!same(stable, target)) {
        stable = target;
        stableSince = Date.now();
        return false;
      }
      return Date.now() - stableSince >= 400;
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
    function read(token, isPassword) {
      return fetch(
        "/__sortofremoteng_autologin?" +
          (isPassword ? "phase=password&" : "") +
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
      // Verified React submit handlers call preventDefault themselves. Block
      // browser submission even before hydration, but do not stop propagation.
      // Never fall back to form.submit(), requestSubmit(), Enter or a GET URL.
      function prevent(event) {
        event.preventDefault();
      }
      target.form.addEventListener("submit", prevent, true);
      try {
        target.button.click();
      } finally {
        target.form.removeEventListener("submit", prevent, true);
      }
    }
    function fetchStage(target) {
      var isPassword = target.stage === "password";
      var existing = target.field.value;
      captured = target;
      phase = target.stage + "-fetch";
      read(isPassword ? continuation : nonce, isPassword)
        .then(function (reply) {
          try {
            if (done || stopped) return;
            checked(target, existing);
            if (!reply || reply.loginFlow !== "adobe") throw new Error("grant");
            if (isPassword) {
              if (
                typeof reply.password !== "string" ||
                !reply.password ||
                reply.username != null ||
                reply.continuation != null ||
                existing
              )
                throw new Error("grant");
              password = reply.password;
            } else {
              if (
                typeof reply.username !== "string" ||
                !reply.username ||
                reply.password != null ||
                typeof reply.continuation !== "string" ||
                !/^[0-9a-f]{32}$/.test(reply.continuation) ||
                (existing && existing !== reply.username)
              )
                throw new Error("grant");
              username = reply.username;
              continuation = reply.continuation;
              nonce = null;
              deadline = Math.min(deadline, Date.now() + 28000);
            }
            var value = isPassword ? password : username;
            if (!existing)
              helpers.fillField(
                target.field,
                value,
                function () {
                  return checked(target, existing);
                },
                function () {
                  return checked(target, value);
                },
              );
            checked(target, value);
            phase = target.stage + "-filled";
            filledAt = Date.now();
          } finally {
            if (reply && typeof reply === "object")
              reply.username = reply.password = reply.continuation = null;
          }
        })
        .catch(fail);
    }
    function progress() {
      if (done || stopped) return;
      if (Date.now() >= deadline)
        return finish(false, "reviewed-login-timeout");
      if (!route() || blocked()) return fail();
      try {
        if (phase === "email" || phase === "password") {
          if (phase === "password" && route() === "password") {
            var account = document.querySelector(
              '#PasswordForm input[name="username"][autocomplete="username"]',
            );
            if (account && account.value && account.value !== username)
              return fail();
          }
          var target = locate(phase);
          if (!target) {
            stable = null;
            return;
          }
          if (phase === "password" && target.field.value) return fail();
          if (settled(target)) fetchStage(target);
        } else if (phase === "email-filled" || phase === "password-filled") {
          var isPassword = phase === "password-filled";
          checked(captured, isPassword ? password : username);
          if (
            Date.now() - filledAt < 750 ||
            !buttonReady(captured) ||
            !captured.field.checkValidity()
          )
            return;
          var complete = captured;
          phase = isPassword ? "submitted" : "password";
          stable = null;
          click(complete);
          if (isPassword) finish(true, "submitted");
        }
      } catch (_) {
        fail();
      }
    }
    timer = setInterval(progress, 100);
    progress();
  }
  window.__sorng_adobe_login = { runWhenReady: runWhenReady, cancel: cancel };
})();
