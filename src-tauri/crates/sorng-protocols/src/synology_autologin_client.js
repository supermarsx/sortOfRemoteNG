/* Reviewed DSM 7 desktop Vue account/password panels. Readiness is read-only
 * until the complete account panel exists. Each credential and each action is
 * used once; no API login, alternate-factor selection or submission retries. */
(function () {
  "use strict";
  if (window.__sorng_synology_login) return;
  var ran = false,
    stopped = false,
    cancelActive = null,
    status = null,
    terminalStatus = false;
  // Read-only page diagnostics. The private document reporter adds its native
  // identity before forwarding these fixed strings to the parent application.
  function publish(phase, reason, terminal) {
    if (terminalStatus) return;
    terminalStatus = !!terminal;
    if (status && status.phase === phase && status.reason === reason) return;
    status = { phase: phase, reason: reason };
    try {
      document.dispatchEvent(
        new CustomEvent("sorng_synology_login_progress", {
          detail: { phase: phase, reason: reason },
        }),
      );
    } catch (_) {}
  }
  function cancel() {
    stopped = true;
    if (cancelActive) cancelActive();
    else publish("cancelled", "cancelled", true);
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("unload", cancel);

  function run(data, helpers, readinessNonce) {
    if (ran || stopped)
      return Promise.resolve({ ok: false, reason: "cancelled" });
    ran = true;
    var username = data.username,
      continuation = data.continuation,
      preflight = readinessNonce !== undefined;
    data.username = data.continuation = null;
    return new Promise(function (resolve) {
      var finished = false,
        processing = false,
        phase = "account",
        root = null,
        account = null,
        passwordTarget = null,
        observer = null,
        controller = null,
        password = null,
        timeout = null,
        deadline = 0;
      var enteredPassword = false,
        failureReason = "stopped";
      var start = new URL(location.href);
      var readinessEvents = [
        "DOMContentLoaded",
        "load",
        "transitionend",
        "animationend",
        "visibilitychange",
        "input",
        "change",
      ];
      function armDeadline(ms) {
        clearTimeout(timeout);
        deadline = performance.now() + ms;
        timeout = setTimeout(function () {
          finish(false, "reviewed-login-timeout");
        }, ms);
      }
      function finish(ok, reason) {
        if (finished) return;
        finished = true;
        if (observer) observer.disconnect();
        if (controller) controller.abort();
        clearTimeout(timeout);
        window.removeEventListener("hashchange", navigation);
        window.removeEventListener("popstate", navigation);
        window.removeEventListener("resize", progress);
        readinessEvents.forEach(function (event) {
          document.removeEventListener(event, progress, true);
        });
        if (account)
          account.form.removeEventListener("submit", preventNativeSubmit, true);
        if (passwordTarget)
          passwordTarget.form.removeEventListener(
            "submit",
            preventNativeSubmit,
            true,
          );
        // Clear only our own unsent value, never overwrite a user's edit.
        if (
          !ok &&
          password !== null &&
          passwordTarget &&
          passwordTarget.field.value === password
        ) {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(passwordTarget.field, "");
        }
        username = continuation = password = readinessNonce = null;
        cancelActive = null;
        publish(
          ok
            ? "submitted"
            : reason === "reviewed-login-timeout"
              ? "timeout"
              : reason === "cancelled"
                ? "cancelled"
                : "stopped",
          ok
            ? "submitted"
            : reason === "reviewed-login-timeout"
              ? "timeout"
              : reason === "cancelled"
                ? "cancelled"
                : reason === "invalid-credential-response"
                  ? "invalid-credential-response"
                  : failureReason,
          true,
        );
        var result = { ok: ok, reason: reason };
        helpers.report(result);
        resolve(result);
      }
      cancelActive = function () {
        finish(false, "cancelled");
      };
      function reject(reason) {
        failureReason = reason;
        throw new Error("reviewed-login-stopped");
      }
      function unique(selector, phase, part) {
        var elements = document.querySelectorAll(selector);
        if (elements.length !== 1 && phase)
          publish(phase, part + (elements.length ? "-ambiguous" : "-missing"));
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
        if (["account", "fetching-account", "account-button"].includes(phase))
          return ["", "#/signin", "#/signin/"].includes(current.hash);
        if (current.hash === "#/signin/password") enteredPassword = true;
        if (enteredPassword) return current.hash === "#/signin/password";
        return ["", "#/signin", "#/signin/", "#/signin/password"].includes(
          current.hash,
        );
      }
      function safe() {
        if (finished || stopped || performance.now() >= deadline) return false;
        if (!allowedRoute()) {
          failureReason = "route-changed";
          return false;
        }
        if (root && unique("#sds-login-vue") !== root) {
          failureReason = "form-changed";
          return false;
        }
        var captcha = Array.prototype.some.call(
          document.querySelectorAll(
            'input[name*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i]',
          ),
          helpers.isVisible,
        );
        if (captcha) failureReason = "captcha";
        return !captcha;
      }
      // Structural identity is independent of enabled/visible controls: Vue
      // can enable Next only after input, or overlap panels during transition.
      function locate(passwordStage) {
        if (!safe()) throw new Error("reviewed-login-stopped");
        var nextRoot = unique("#sds-login-vue", "waiting_root", "root");
        if (!nextRoot) return null;
        var waiting = passwordStage
          ? "waiting_password_form"
          : "waiting_account_form";
        var form = unique(
          passwordStage ? "form#dsm-pass-fieldset" : "form#dsm-user-fieldset",
          waiting,
          "form",
        );
        if (!form) return null;
        var field = unique(
          passwordStage
            ? '#dsm-pass-fieldset input[syno-id="password"][type="password"][name="current-password"][autocomplete="current-password"]'
            : '#dsm-user-fieldset input[syno-id="username"][type="text"][name="username"][autocomplete="username"]',
          waiting,
          "field",
        );
        if (!field) return null;
        var button = unique(
          passwordStage
            ? 'div[role="button"][syno-id="password-panel-next-btn"]'
            : 'div[role="button"][syno-id="account-panel-next-btn"]',
          waiting,
          "button",
        );
        if (!button) return null;
        var panel = form.closest(".login-tabs-content-wrapper");
        if (
          !nextRoot.contains(form) ||
          !panel ||
          !nextRoot.contains(panel) ||
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
          reject("form-changed");
        if (passwordStage) {
          var hidden = form.querySelectorAll(
            'input[name="username"][autocomplete="username"][hidden]',
          );
          if (
            !account ||
            hidden.length !== 1 ||
            hidden[0].value !== username ||
            (field.value &&
              (!passwordTarget ||
                field !== passwordTarget.field ||
                field.value !== password))
          )
            reject("form-changed");
          if (account.form.isConnected) {
            if (!same(account, locate(false))) reject("form-changed");
            publish("waiting_password_form", "panel-transition");
            return null;
          }
          if (location.hash !== "#/signin/password") {
            publish("waiting_password_form", "password-route");
            return null;
          }
        }
        return {
          root: nextRoot,
          form: form,
          field: field,
          button: button,
          panel: panel,
        };
      }
      function same(target, current) {
        return !!(
          target &&
          current &&
          target.root === current.root &&
          target.form === current.form &&
          target.field === current.field &&
          target.button === current.button &&
          target.panel === current.panel
        );
      }
      function editable(target) {
        var reason =
          target.field.disabled || target.field.matches(":disabled")
            ? "field-disabled"
            : target.field.readOnly
              ? "field-readonly"
              : !helpers.isVisible(target.field)
                ? "field-hidden"
                : null;
        if (reason)
          publish(
            phase === "account-button"
              ? "waiting_next_button"
              : phase === "password-button"
                ? "waiting_signin_button"
                : phase === "account" || phase === "fetching-account"
                  ? "waiting_account_editable"
                  : "waiting_password_form",
            reason,
          );
        return reason === null;
      }
      function clickable(target) {
        if (!editable(target)) return false;
        var reason = !helpers.isVisible(target.button)
          ? "button-hidden"
          : target.button.matches(
                ".disable,.spin,[aria-disabled=true],[disabled]",
              )
            ? "button-disabled"
            : null;
        if (reason)
          publish(
            phase === "password-button"
              ? "waiting_signin_button"
              : "waiting_next_button",
            reason,
          );
        return reason === null;
      }
      function validAccount() {
        return (
          typeof username === "string" &&
          username &&
          username.trim() === username &&
          typeof continuation === "string" &&
          /^[0-9a-f]{32}$/.test(continuation)
        );
      }
      function clearReply(reply) {
        if (reply && typeof reply === "object")
          reply.username = reply.password = reply.continuation = null;
      }
      function request(nonce, passwordStage) {
        controller = new AbortController();
        return fetch(
          "/__sortofremoteng_autologin?" +
            (passwordStage ? "phase=password&" : "") +
            "nonce=" +
            encodeURIComponent(nonce),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          },
        ).then(function (response) {
          return response.ok
            ? response.json()
            : Promise.reject(new Error("expired"));
        });
      }
      function captureAccount() {
        var nonce = readinessNonce;
        readinessNonce = null;
        phase = "fetching-account";
        publish("requesting_username", "requesting-username");
        if (!same(account, locate(false)) || !editable(account))
          reject("form-changed");
        request(nonce, false)
          .then(function (reply) {
            try {
              if (
                !same(account, locate(false)) ||
                !editable(account) ||
                !reply ||
                reply.loginFlow !== "synology"
              )
                reject("form-changed");
              username = reply.username;
              continuation = reply.continuation;
              if (!validAccount()) reject("invalid-credential-response");
              controller = null;
              phase = "account";
              // Native password capability now has 30s; do not renew on events.
              armDeadline(25000);
              progress();
            } finally {
              clearReply(reply);
            }
          })
          .catch(function () {
            if (failureReason === "stopped")
              failureReason = "credentials-unavailable";
            finish(false, "reviewed-login-stopped");
          });
      }
      function capturePassword() {
        var nonce = continuation;
        continuation = null;
        phase = "fetching-password";
        publish("requesting_password", "requesting-password");
        if (!same(passwordTarget, locate(true)) || !editable(passwordTarget))
          reject("form-changed");
        request(nonce, true)
          .then(function (reply) {
            try {
              if (
                !same(passwordTarget, locate(true)) ||
                !editable(passwordTarget) ||
                !reply ||
                reply.loginFlow !== "synology" ||
                typeof reply.password !== "string"
              )
                reject("form-changed");
              controller = null;
              password = reply.password;
              // Set phase before input events; nested progress must never refill.
              phase = "password-button";
              processing = true;
              passwordTarget.form.addEventListener(
                "submit",
                preventNativeSubmit,
                true,
              );
              helpers.fillField(
                passwordTarget.field,
                password,
                function () {
                  return (
                    same(passwordTarget, locate(true)) &&
                    editable(passwordTarget)
                  );
                },
                function () {
                  return (
                    same(passwordTarget, locate(true)) &&
                    passwordTarget.field.value === password
                  );
                },
              );
              if (
                !same(passwordTarget, locate(true)) ||
                passwordTarget.field.value !== password
              )
                reject("form-changed");
            } finally {
              processing = false;
              clearReply(reply);
            }
            progress();
          })
          .catch(function () {
            if (failureReason === "stopped")
              failureReason = "credentials-unavailable";
            finish(false, "reviewed-login-stopped");
          });
      }
      function preventNativeSubmit(event) {
        event.preventDefault();
      }
      function navigation() {
        if (!safe()) finish(false, "cancelled");
        else progress();
      }
      function progress() {
        if (finished || processing || phase === "submitted") return;
        processing = true;
        try {
          if (!safe()) throw new Error("reviewed-login-stopped");
          if (document.readyState === "loading") {
            publish("waiting_document", "document-loading");
            return;
          }
          if (phase === "fetching-account") {
            if (!same(account, locate(false))) reject("form-changed");
            return;
          }
          if (phase === "fetching-password") {
            if (!same(passwordTarget, locate(true))) reject("form-changed");
            return;
          }
          if (phase === "account") {
            var found = locate(false);
            if (!found || !editable(found)) return;
            if (account && !same(account, found)) reject("form-changed");
            account = found;
            root = found.root; // Never latch an empty/loading Vue mount.
            if (readinessNonce) {
              captureAccount();
              return;
            }
            if (account.field.value && account.field.value !== username)
              reject("form-changed");
            phase = "account-button";
            account.form.addEventListener("submit", preventNativeSubmit, true);
            helpers.fillField(
              account.field,
              username,
              function () {
                return same(account, locate(false)) && editable(account);
              },
              function () {
                return (
                  same(account, locate(false)) &&
                  account.field.value === username
                );
              },
            );
          }
          if (phase === "account-button") {
            if (
              !same(account, locate(false)) ||
              account.field.value !== username
            )
              reject("form-changed");
            if (!clickable(account)) return;
            account.form.addEventListener("submit", preventNativeSubmit, true);
            phase = "password";
            account.button.click();
          }
          if (phase === "password") {
            var next = locate(true);
            if (!next || !editable(next)) return;
            passwordTarget = next;
            capturePassword();
            return;
          }
          if (phase === "password-button") {
            if (
              !same(passwordTarget, locate(true)) ||
              passwordTarget.field.value !== password
            )
              reject("form-changed");
            if (!clickable(passwordTarget)) return;
            passwordTarget.form.addEventListener(
              "submit",
              preventNativeSubmit,
              true,
            );
            phase = "submitted";
            passwordTarget.button.click();
            finish(true, "submitted");
          }
        } catch (_) {
          finish(false, "reviewed-login-stopped");
        } finally {
          processing = false;
        }
      }
      if (
        (preflight
          ? typeof readinessNonce !== "string" ||
            !/^[0-9a-f]{32}$/.test(readinessNonce)
          : !validAccount()) ||
        !["/", "/webman/index.cgi"].includes(start.pathname)
      ) {
        finish(false, "invalid-credential-response");
        return;
      }
      // Includes the first fetch/body decode. No indefinite wait on transport.
      armDeadline(preflight ? 90000 : 25000);
      window.addEventListener("hashchange", navigation);
      window.addEventListener("popstate", navigation);
      window.addEventListener("resize", progress);
      readinessEvents.forEach(function (event) {
        document.addEventListener(event, progress, true);
      });
      observer = new MutationObserver(progress);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      progress();
    });
  }
  window.__sorng_synology_login = {
    run: run,
    runWhenReady: function (nonce, helpers) {
      return run({}, helpers, nonce);
    },
    cancel: cancel,
    getStatus: function () {
      return status ? { phase: status.phase, reason: status.reason } : null;
    },
  };
  publish("waiting_document", "not-started");
})();
