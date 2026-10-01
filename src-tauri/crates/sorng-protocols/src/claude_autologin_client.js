/* Claude: one email submission, then interactive email verification. No password. */
(function () {
  "use strict";
  if (window.__sorng_claude_login) return;
  var ran = false,
    stopped = false,
    active = null;
  function cancel() {
    stopped = true;
    if (active) active();
  }
  function runWhenReady(nonce, helpers) {
    if (ran || stopped) return;
    ran = true;
    var dom = window.__sorng_ai_chat_form;
    if (!dom) {
      helpers.report({ ok: false, reason: "autologin-client-unavailable" });
      return;
    }
    return new Promise(function (resolve) {
      var done = false,
        phase = "waiting",
        timer,
        target,
        stable,
        stableSince = 0,
        username = null;
      var deadline = Date.now() + 30000,
        controller = new AbortController(),
        writing = false;
      function finish(ok, reason) {
        if (done) return;
        done = true;
        clearInterval(timer);
        controller.abort();
        document.removeEventListener("input", edited, true);
        window.removeEventListener("pagehide", cancel);
        window.removeEventListener("popstate", cancel);
        window.removeEventListener("hashchange", cancel);
        nonce = username = target = stable = null;
        active = null;
        var result = { ok: ok, reason: reason };
        helpers.report(result);
        resolve(result);
      }
      function fail() {
        finish(false, "reviewed-login-stopped");
      }
      function edited(event) {
        if (!writing && target && event.target === target.field)
          finish(false, "cancelled");
      }
      function valid(value) {
        return (
          !done &&
          !stopped &&
          Date.now() < deadline &&
          dom.at("https://claude.ai", ["/login", "/login/"]) &&
          dom.same(dom.locate("email"), target) &&
          target.field.value === value
        );
      }
      function progress() {
        if (done || stopped) return;
        if (Date.now() >= deadline)
          return finish(false, "reviewed-login-timeout");
        try {
          if (
            !dom.at("https://claude.ai", ["/login", "/login/"]) ||
            dom.blocked()
          )
            return fail();
          if (phase === "waiting") {
            var found = dom.locate("email");
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
            target = found;
            phase = "fetching";
            dom
              .read(nonce, false, controller.signal)
              .then(function (reply) {
                try {
                  if (done || stopped) return;
                  if (
                    !valid("") ||
                    !reply ||
                    reply.loginFlow !== "claude" ||
                    typeof reply.username !== "string" ||
                    !reply.username ||
                    Object.prototype.hasOwnProperty.call(reply, "password") ||
                    Object.prototype.hasOwnProperty.call(reply, "continuation")
                  )
                    throw new Error("grant");
                  username = reply.username;
                  nonce = null;
                  writing = true;
                  try {
                    helpers.fillField(
                      target.field,
                      username,
                      function () {
                        return valid("");
                      },
                      function () {
                        return valid(username);
                      },
                    );
                  } finally {
                    writing = false;
                  }
                  if (!valid(username)) throw new Error("changed");
                  phase = "filled";
                  stableSince = Date.now();
                } finally {
                  if (reply && typeof reply === "object")
                    reply.username = reply.password = reply.continuation = null;
                }
              })
              .catch(fail);
          } else if (phase === "filled") {
            if (!valid(username)) return fail();
            if (Date.now() - stableSince < 400 || !dom.ready(target)) return;
            phase = "submitted";
            dom.click(target);
            finish(false, "manual-email-verification-required");
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
      window.addEventListener("popstate", cancel);
      window.addEventListener("hashchange", cancel);
      timer = setInterval(progress, 100);
      progress();
    });
  }
  window.__sorng_claude_login = { runWhenReady: runWhenReady, cancel: cancel };
})();
