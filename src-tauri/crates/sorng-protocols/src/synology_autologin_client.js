/* Reviewed DSM 7 desktop Vue account/password panels. The hidden password in
 * the account form is intentionally never filled. No API login, remembered
 * device, alternate-factor selection, CAPTCHA handling or submit retries. */
(function () {
  "use strict";
  if (window.__sorng_synology_login) return;
  var ran = false,
    stopped = false,
    cancelActive = null;
  function cancel() {
    stopped = true;
    if (cancelActive) cancelActive();
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("unload", cancel);

  function run(data, helpers) {
    if (ran || stopped)
      return Promise.resolve({ ok: false, reason: "cancelled" });
    ran = true;
    var username = data.username,
      continuation = data.continuation;
    data.username = data.continuation = null;
    return new Promise(function (resolve) {
      var finished = false,
        phase = "account",
        root = null,
        account = null,
        passwordTarget = null,
        observer = null,
        controller = null,
        password = null;
      var enteredPassword = false;
      var start = new URL(location.href);
      var timeout = setTimeout(function () {
        finish(false, "reviewed-login-timeout");
      }, 15000);
      function finish(ok, reason) {
        if (finished) return;
        finished = true;
        if (observer) observer.disconnect();
        if (controller) controller.abort();
        clearTimeout(timeout);
        window.removeEventListener("hashchange", navigation);
        window.removeEventListener("popstate", navigation);
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
        var elements = document.querySelectorAll(selector);
        return elements.length === 1 ? elements[0] : null;
      }
      function allowedRoute() {
        var current = new URL(location.href);
        if (
          current.origin !== start.origin ||
          current.pathname !== start.pathname ||
          current.search !== start.search ||
          document.querySelector("base")
        )
          return false;
        if (phase === "account")
          return ["", "#/signin", "#/signin/"].includes(current.hash);
        if (current.hash === "#/signin/password") enteredPassword = true;
        if (enteredPassword) return current.hash === "#/signin/password";
        return ["", "#/signin", "#/signin/", "#/signin/password"].includes(
          current.hash,
        );
      }
      function safe() {
        if (finished || stopped || !allowedRoute()) return false;
        if (root && unique("#sds-login-vue") !== root) return false;
        return !Array.prototype.some.call(
          document.querySelectorAll(
            'input[name*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i]',
          ),
          helpers.isVisible,
        );
      }
      function locate(passwordStage) {
        if (!safe()) throw new Error("reviewed-login-stopped");
        var nextRoot = unique("#sds-login-vue");
        if (!nextRoot) return null;
        if (!root) root = nextRoot;
        var form = unique(
          passwordStage ? "form#dsm-pass-fieldset" : "form#dsm-user-fieldset",
        );
        var field = unique(
          passwordStage
            ? '#dsm-pass-fieldset input[syno-id="password"][type="password"][name="current-password"][autocomplete="current-password"]'
            : '#dsm-user-fieldset input[syno-id="username"][type="text"][name="username"][autocomplete="username"]',
        );
        var button = unique(
          passwordStage
            ? 'div[role="button"][syno-id="password-panel-next-btn"]'
            : 'div[role="button"][syno-id="account-panel-next-btn"]',
        );
        if (!form || !field || !button) return null;
        // Vue may render the next panel before its transition finishes. Wait
        // within the original deadline; never fill or click disabled controls.
        if (
          !helpers.isVisible(field) ||
          !helpers.isVisible(button) ||
          field.disabled ||
          field.matches(":disabled") ||
          field.readOnly ||
          button.matches(".disable,.spin,[aria-disabled=true]")
        )
          return null;
        var panel = form.closest(".login-tabs-content-wrapper");
        if (
          !root.contains(form) ||
          !panel ||
          !root.contains(panel) ||
          button.closest(".login-tabs-content-wrapper") !== panel ||
          field.form !== form ||
          ["action", "method", "target"].some(function (key) {
            return form.hasAttribute(key);
          }) ||
          ["formaction", "formmethod", "formtarget", "onclick"].some(
            function (key) {
              return button.hasAttribute(key);
            },
          )
        )
          throw new Error("reviewed-login-form-changed");
        if (passwordStage) {
          var hidden = form.querySelectorAll(
            'input[name="username"][autocomplete="username"][hidden]',
          );
          if (
            location.hash !== "#/signin/password" ||
            !account ||
            account.form.isConnected ||
            hidden.length !== 1 ||
            hidden[0].value !== username ||
            (field.value &&
              (!passwordTarget ||
                field !== passwordTarget.field ||
                field.value !== password))
          )
            throw new Error("reviewed-login-form-changed");
        }
        return { form: form, field: field, button: button, panel: panel };
      }
      function same(target, current) {
        return (
          current &&
          target.form === current.form &&
          target.field === current.field &&
          target.button === current.button &&
          target.panel === current.panel
        );
      }
      function navigation() {
        if (!safe()) finish(false, "cancelled");
        else progress();
      }
      function progress() {
        if (finished || phase === "fetching" || phase === "submitted") return;
        try {
          if (!safe()) throw new Error("reviewed-login-stopped");
          if (phase === "account") {
            account = locate(false);
            if (!account) return;
            if (account.field.value && account.field.value !== username)
              throw new Error("reviewed-login-form-changed");
            helpers.fillField(account.field, username, function () {
              return !!same(account, locate(false));
            });
            if (
              !same(account, locate(false)) ||
              account.field.value !== username
            )
              throw new Error("reviewed-login-form-changed");
            // Refuse native GET fallback even if a page handler requests submit.
            account.form.addEventListener(
              "submit",
              function (event) {
                event.preventDefault();
              },
              true,
            );
            phase = "password";
            account.button.click();
          }
          var found = locate(true);
          if (!found) return;
          passwordTarget = found;
          phase = "fetching";
          controller = new AbortController();
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
                : Promise.reject(new Error("expired"));
            })
            .then(function (reply) {
              var writtenPassword = null;
              try {
                if (
                  !same(found, locate(true)) ||
                  !reply ||
                  reply.loginFlow !== "synology" ||
                  typeof reply.password !== "string"
                )
                  throw new Error("reviewed-login-form-changed");
                password = reply.password;
                writtenPassword = password;
                helpers.fillField(found.field, password, function () {
                  return !!same(found, locate(true));
                });
                if (
                  !same(found, locate(true)) ||
                  found.field.value !== password
                )
                  throw new Error("reviewed-login-form-changed");
                found.form.addEventListener(
                  "submit",
                  function (event) {
                    event.preventDefault();
                  },
                  true,
                );
                phase = "submitted";
                found.button.click();
                finish(true, "submitted");
              } catch (error) {
                if (
                  writtenPassword !== null &&
                  found.field.value === writtenPassword
                ) {
                  Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value",
                  ).set.call(found.field, "");
                }
                throw error;
              } finally {
                if (reply && typeof reply === "object") reply.password = null;
                writtenPassword = null;
                password = null;
              }
            })
            .catch(function () {
              finish(false, "reviewed-login-stopped");
            });
        } catch (_) {
          finish(false, "reviewed-login-stopped");
        }
      }
      if (
        typeof username !== "string" ||
        !username ||
        username.trim() !== username ||
        typeof continuation !== "string" ||
        !/^[0-9a-f]{32}$/.test(continuation) ||
        !["/", "/webman/index.cgi"].includes(start.pathname)
      ) {
        finish(false, "invalid-credential-response");
        return;
      }
      window.addEventListener("hashchange", navigation);
      window.addEventListener("popstate", navigation);
      observer = new MutationObserver(progress);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      progress();
    });
  }
  window.__sorng_synology_login = { run: run, cancel: cancel };
})();
