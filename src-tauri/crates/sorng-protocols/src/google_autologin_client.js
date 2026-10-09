/* Reviewed Google Account identifier -> password flow. Unknown challenges,
 * alternate account pickers, CAPTCHA, recovery, SSO and passkeys fail closed. */
(function (factory) {
  // Native CEF evaluates this module inside a private lexical module scope.
  // Legacy script delivery retains its existing page-global API and transport.
  if (typeof module === "object" && module && module.__sorngNativeGoogle === true && module.exports) module.exports = factory;
  else factory(null);
})(function (nativeTransport) {
  "use strict";
  if (!nativeTransport && window.__sorng_google_login) return;
  if (nativeTransport && (typeof nativeTransport.read !== "function" || typeof nativeTransport.click !== "function")) throw new Error("invalid-native-transport");
  var ran = false;
  var stopped = false;
  var active = null;

  function cancel() {
    stopped = true;
    if (active) active();
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("hashchange", cancel);
  window.addEventListener("popstate", cancel);

  function unique(selector) {
    var values = document.querySelectorAll(selector);
    return values.length === 1 ? values[0] : null;
  }

  function unsafeChallengeVisible() {
    return Array.prototype.some.call(
      document.querySelectorAll(
        'input[name*="captcha" i], iframe[src*="recaptcha" i], [data-challengetype*="captcha" i], input[type="file"], input[name*="recovery" i]',
      ),
      function (node) {
        return node instanceof HTMLElement && node.getClientRects().length > 0;
      },
    );
  }

  function identifierTarget(helpers, expectedValue) {
    if (
      ![
        "/v3/signin/identifier",
        "/signin/v2/identifier",
        "/signin/identifier",
      ].includes(location.pathname) ||
      unsafeChallengeVisible()
    )
      return null;
    var field = unique(
      'input#identifierId[name="identifier"][type="email"], input#identifierId[name="identifier"][type="text"]',
    );
    var button = unique(
      '#identifierNext button[type="button"], #identifierNext button[type="submit"], #identifierNext button:not([type]), button#identifierNext[type="button"], button#identifierNext[type="submit"], button#identifierNext:not([type])',
    );
    if (
      !(field instanceof HTMLInputElement) ||
      !(button instanceof HTMLButtonElement) ||
      !helpers.isVisible(field) ||
      !helpers.isVisible(button) ||
      field.disabled ||
      field.readOnly ||
      button.disabled ||
      (expectedValue === undefined
        ? field.value
        : field.value !== expectedValue)
    )
      return null;
    return { field: field, button: button };
  }

  function passwordTarget(helpers, expectedValue) {
    if (
      ![
        "/v3/signin/challenge/pwd",
        "/signin/v2/challenge/pwd",
        "/signin/challenge/pwd",
      ].includes(location.pathname) ||
      unsafeChallengeVisible()
    )
      return null;
    var field = unique('input[name="Passwd"][type="password"]');
    var button = unique(
      '#passwordNext button[type="button"], #passwordNext button[type="submit"], #passwordNext button:not([type]), button#passwordNext[type="button"], button#passwordNext[type="submit"], button#passwordNext:not([type])',
    );
    if (
      !(field instanceof HTMLInputElement) ||
      !(button instanceof HTMLButtonElement) ||
      !helpers.isVisible(field) ||
      !helpers.isVisible(button) ||
      field.disabled ||
      field.readOnly ||
      button.disabled ||
      (expectedValue === undefined
        ? field.value
        : field.value !== expectedValue)
    )
      return null;
    return { field: field, button: button };
  }

  function read(nonce, phase, controller) {
    if (nativeTransport) return nativeTransport.read(phase ? "password" : "identifier", controller.signal);
    var query = phase ? "?phase=password&nonce=" : "?nonce=";
    return fetch(
      "/__sortofremoteng_autologin" + query + encodeURIComponent(nonce),
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    ).then(function (response) {
      return response.ok ? response.json() : Promise.reject(new Error("grant"));
    });
  }

  function runWhenReady(nonce, helpers, passwordOnly) {
    if (ran || stopped) return;
    ran = true;
    var finished = false;
    var observer = null;
    var controller = new AbortController();
    var continuation = passwordOnly ? nonce : null;
    var username = null;
    var password = null;
    var passwordAutoSubmit = true;
    var phase = passwordOnly ? "password" : "identifier";
    var deadline = Date.now() + 30000;

    function finish(ok, reason) {
      if (finished) return;
      finished = true;
      if (observer) observer.disconnect();
      controller.abort();
      username = password = continuation = null;
      active = null;
      helpers.report({ ok: ok, reason: reason });
    }
    active = function () {
      finish(false, "cancelled");
    };

    function fetchPassword() {
      phase = "password-fetch";
      read(continuation, true, controller)
        .then(function (reply) {
          try {
            if (finished || stopped) return;
            if (
              !reply ||
              reply.loginFlow !== "google" ||
              typeof reply.password !== "string" ||
              !reply.password
            )
              throw new Error("changed");
            password = reply.password;
            passwordAutoSubmit = !nativeTransport || reply.autoSubmit === true;
            // Rendering can replace the panel while the single-use grant is
            // in flight. Observe the new controls without requesting it again.
            phase = "password-fill";
            progress();
          } finally {
            if (reply && typeof reply === "object") reply.password = null;
          }
        })
        .catch(function () {
          finish(false, stopped ? "cancelled" : "reviewed-login-stopped");
        });
    }

    function submitIdentifier(target, autoSubmit) {
      function checkedTarget(expectedValue) {
        var checked = identifierTarget(helpers, expectedValue);
        if (
          finished ||
          stopped ||
          Date.now() >= deadline ||
          !checked ||
          checked.field !== target.field ||
          checked.button !== target.button
        )
          throw new Error("changed");
        return true;
      }
      helpers.fillField(
        target.field,
        username,
        function () {
          return checkedTarget();
        },
        function () {
          return checkedTarget(username);
        },
      );
      checkedTarget(username);
      if (!autoSubmit) return finish(true, "filled");
      phase = "password";
      if (nativeTransport) nativeTransport.click(target.button);
      else target.button.click();
    }

    function submitPassword(target) {
      function checkedTarget(expectedValue) {
        var checked = passwordTarget(helpers, expectedValue);
        if (
          finished ||
          stopped ||
          Date.now() >= deadline ||
          !checked ||
          checked.field !== target.field ||
          checked.button !== target.button
        )
          throw new Error("changed");
        return true;
      }
      helpers.fillField(
        target.field,
        password,
        function () {
          return checkedTarget();
        },
        function () {
          return checkedTarget(password);
        },
      );
      checkedTarget(password);
      phase = "submitted";
      if (!passwordAutoSubmit) return finish(true, "filled");
      if (nativeTransport) nativeTransport.click(target.button);
      else target.button.click();
      finish(true, "submitted");
    }

    function progress() {
      if (finished || stopped) return;
      if (Date.now() >= deadline)
        return finish(false, "reviewed-login-timeout");
      try {
        if (phase === "identifier") {
          var identifier = identifierTarget(helpers);
          if (!identifier) return;
          phase = "identifier-fetch";
          read(nonce, false, controller)
            .then(function (reply) {
              try {
                if (finished || stopped) return;
                if (Date.now() >= deadline)
                  return finish(false, "reviewed-login-timeout");
                var current = identifierTarget(helpers);
                if (
                  !current ||
                  current.field !== identifier.field ||
                  current.button !== identifier.button ||
                  !reply ||
                  reply.loginFlow !== "google" ||
                  typeof reply.username !== "string" ||
                  !reply.username ||
                  typeof reply.continuation !== "string" ||
                  !/^[0-9a-f]{32}$/.test(reply.continuation)
                )
                  throw new Error("changed");
                username = reply.username;
                continuation = reply.continuation;
                submitIdentifier(identifier, !nativeTransport || reply.autoSubmit === true);
              } finally {
                if (reply && typeof reply === "object") {
                  reply.username = null;
                  reply.continuation = null;
                }
                username = null;
              }
            })
            .catch(function () {
              finish(false, stopped ? "cancelled" : "reviewed-login-stopped");
            });
          return;
        }
        if (phase === "password" || phase === "password-fill") {
          var passwordStage = passwordTarget(helpers);
          if (passwordStage) {
            if (phase === "password") fetchPassword();
            else submitPassword(passwordStage);
          }
        }
      } catch (_) {
        finish(false, stopped ? "cancelled" : "reviewed-login-stopped");
      }
    }

    observer = new MutationObserver(progress);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    var timer = setInterval(function () {
      if (finished) return clearInterval(timer);
      progress();
    }, 250);
    progress();
  }

  var client = {
    runWhenReady: function (nonce, helpers) {
      return runWhenReady(nonce, helpers, false);
    },
    runPasswordWhenReady: function (nonce, helpers) {
      return runWhenReady(nonce, helpers, true);
    },
    cancel: cancel,
  };
  if (!nativeTransport) window.__sorng_google_login = client;
  return client;
});
