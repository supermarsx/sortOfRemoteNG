/* ChatGPT semantic email -> exact password stage. Challenges stay interactive. */
(function () {
  "use strict";
  if (window.__sorng_chatgpt_login) return;
  var ran = false,
    stopped = false,
    active = null;
  function cancel() {
    stopped = true;
    if (active) active();
  }
  function runWhenReady(nonce, helpers, passwordOnly) {
    if (ran || stopped) return;
    ran = true;
    var dom = window.__sorng_ai_chat_form;
    if (!dom) {
      helpers.report({ ok: false, reason: "autologin-client-unavailable" });
      return;
    }
    return new Promise(function (resolve) {
      var done = false,
        phase = passwordOnly ? "password" : "email",
        timer,
        target,
        stable,
        stableSince = 0;
      var deadline = Date.now() + (passwordOnly ? 28000 : 30000),
        controller = new AbortController();
      var username = null,
        password = null,
        continuation = passwordOnly ? nonce : null;
      var writing = false,
        passwordWritten = false;
      function finish(ok, reason) {
        if (done) return;
        done = true;
        clearInterval(timer);
        controller.abort();
        document.removeEventListener("input", edited, true);
        window.removeEventListener("pagehide", cancel);
        window.removeEventListener("popstate", navigation);
        window.removeEventListener("hashchange", navigation);
        if (!ok && passwordWritten && target) {
          try {
            dom.clearOwned(target.field, password);
          } catch (_) {}
        }
        nonce = username = password = continuation = target = stable = null;
        active = null;
        var result = { ok: ok, reason: reason };
        helpers.report(result);
        resolve(result);
      }
      function fail() {
        finish(false, "reviewed-login-stopped");
      }
      function route() {
        if (dom.at("https://auth.openai.com", ["/log-in/password"]))
          return "password";
        if (
          dom.at("https://auth.openai.com", ["/log-in"]) ||
          dom.at("https://chatgpt.com", ["/auth/login"])
        )
          return "email";
        return null;
      }
      function navigation() {
        if (phase !== "password" || route() !== "password") fail();
      }
      function edited(event) {
        if (
          !writing &&
          target &&
          (event.target === target.field || event.target === target.identity)
        )
          finish(false, "cancelled");
      }
      function valid(value) {
        return (
          !done &&
          !stopped &&
          Date.now() < deadline &&
          route() === target.stage &&
          dom.same(
            dom.locate(target.stage, username, passwordOnly && !username),
            target,
          ) &&
          target.field.value === value
        );
      }
      function fetchStage(found) {
        var isPassword = found.stage === "password";
        target = found;
        phase = found.stage + "-fetch";
        dom
          .read(
            isPassword ? continuation : nonce,
            isPassword,
            controller.signal,
          )
          .then(function (reply) {
            try {
              if (done || stopped) return;
              if (!valid("") || !reply || reply.loginFlow !== "chatgpt")
                throw new Error("grant");
              if (isPassword) {
                if (
                  typeof reply.password !== "string" ||
                  !reply.password ||
                  typeof reply.username !== "string" ||
                  !reply.username ||
                  (username && reply.username !== username) ||
                  (target.identity &&
                    target.identity.value !== reply.username) ||
                  reply.continuation != null
                )
                  throw new Error("grant");
                // A new document cannot infer identity from its own hidden
                // field. Bind it to the native grant before writing a secret.
                username = reply.username;
                password = reply.password;
                continuation = null;
              } else {
                if (
                  typeof reply.username !== "string" ||
                  !reply.username ||
                  Object.prototype.hasOwnProperty.call(reply, "password") ||
                  typeof reply.continuation !== "string" ||
                  !/^[a-f0-9]{32}$/.test(reply.continuation)
                )
                  throw new Error("grant");
                username = reply.username;
                continuation = reply.continuation;
                nonce = null;
                deadline = Math.min(deadline, Date.now() + 28000);
              }
              var value = isPassword ? password : username;
              writing = true;
              try {
                helpers.fillField(
                  target.field,
                  value,
                  function () {
                    return valid("");
                  },
                  function () {
                    if (isPassword)
                      passwordWritten = target.field.value === value;
                    return valid(value);
                  },
                );
              } finally {
                writing = false;
              }
              if (!valid(value)) throw new Error("changed");
              phase = target.stage + "-filled";
              stableSince = Date.now();
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
        try {
          var current = route();
          if (!current || dom.blocked()) return fail();
          if (phase === "email" || phase === "password") {
            // After the one email submission, another email form is not a
            // new grant. Never reacquire or resend on a second provider step.
            if (current !== phase) {
              if (
                phase === "password" &&
                current === "email" &&
                target &&
                target.stage === "email" &&
                valid(username)
              )
                return;
              return fail();
            }
            var found = dom.locate(phase, username, passwordOnly && !username);
            if (!found) {
              stable = null;
              return;
            }
            if (found.field.value) return fail();
            if (!dom.same(stable, found)) {
              stable = found;
              stableSince = Date.now();
              return;
            }
            if (Date.now() - stableSince < 400) return;
            fetchStage(found);
          } else if (phase.endsWith("-filled")) {
            var isPassword = phase === "password-filled";
            if (!valid(isPassword ? password : username)) return fail();
            if (Date.now() - stableSince < 400 || !dom.ready(target)) return;
            var complete = target;
            phase = isPassword ? "submitted" : "password";
            stable = null;
            dom.click(complete);
            if (isPassword) finish(true, "submitted");
          }
        } catch (_) {
          fail();
        }
      }
      active = function () {
        finish(false, "cancelled");
      };
      document.addEventListener("input", edited, true);
      window.addEventListener("pagehide", cancel);
      window.addEventListener("popstate", navigation);
      window.addEventListener("hashchange", navigation);
      timer = setInterval(progress, 100);
      progress();
    });
  }
  window.__sorng_chatgpt_login = {
    runWhenReady: runWhenReady,
    runPasswordWhenReady: function (nonce, helpers) {
      return runWhenReady(nonce, helpers, true);
    },
    cancel: cancel,
  };
})();
