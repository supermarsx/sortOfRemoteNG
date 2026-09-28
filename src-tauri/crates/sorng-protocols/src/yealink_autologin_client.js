// Keyless SIP-T20P only. The phone owns submission and password processing.
(function () {
  "use strict";
  if (window.__sorng_yealink_login) return;
  var used = false;
  var cancelActive = null;
  function cancel() {
    if (cancelActive) cancelActive();
  }
  function handler(value) {
    return (value || "").replace(/\s/g, "").replace(/;$/, "");
  }
  function only(root, selector) {
    var matches = root.querySelectorAll(selector);
    return matches.length === 1 ? matches[0] : null;
  }
  function modelText(model) {
    var copy = model.cloneNode(true);
    copy
      .querySelectorAll("script,style,template,noscript,[hidden],[inert]")
      .forEach(function (el) {
        el.remove();
      });
    return copy.textContent.trim();
  }
  function target(helpers) {
    var form = only(document, 'form[name="formInput"]');
    var model = only(document, "#loginPhoneModel");
    if (
      !form ||
      !model ||
      modelText(model) !== "Enterprise IP phone SIP-T20P" ||
      form.method.toLowerCase() !== "post" ||
      (form.getAttribute("autocomplete") || "").toLowerCase() !== "off" ||
      handler(form.getAttribute("onsubmit")) !== "returnfalse" ||
      typeof form.onsubmit !== "function" ||
      !/^(|_self)$/.test(form.getAttribute("target") || "")
    )
      return null;
    var action = new URL(form.action, document.baseURI);
    if (
      action.origin !== window.location.origin ||
      action.username ||
      action.password ||
      action.hash ||
      action.pathname !== "/servlet" ||
      Array.from(action.searchParams).length !== 2 ||
      action.searchParams.get("p") !== "login" ||
      action.searchParams.get("q") !== "login"
    )
      return null;
    var user = only(form, 'input[name="username"]');
    var pw = only(form, 'input[name="pwd"]');
    var jump = only(form, 'input[name="jumpto"]');
    var acc = only(form, 'input[name="acc"]');
    var confirm = only(document, "#idConfirm");
    var clear = only(document, "#idCancel");
    if (
      !user ||
      user.type !== "text" ||
      !pw ||
      pw.type !== "password" ||
      !jump ||
      jump.type !== "hidden" ||
      jump.value !== "status" ||
      !acc ||
      acc.type !== "hidden" ||
      acc.value !== "" ||
      !confirm ||
      confirm.tagName !== "INPUT" ||
      confirm.type !== "button" ||
      !clear ||
      clear.tagName !== "INPUT" ||
      clear.type !== "button" ||
      handler(confirm.getAttribute("onclick")) !== "OnConfirm()" ||
      handler(clear.getAttribute("onclick")) !== "OnClear()" ||
      typeof confirm.onclick !== "function" ||
      typeof window.OnConfirm !== "function" ||
      [user, pw, jump, acc, confirm, clear].some(function (el) {
        return el.form !== form || el.hasAttribute("form") || el.disabled;
      }) ||
      !helpers.isVisible(user) ||
      !helpers.isVisible(pw) ||
      !helpers.isVisible(confirm) ||
      confirm.getAttribute("aria-disabled") === "true" ||
      [user, pw, confirm].some(function (el) {
        return el.matches(":disabled");
      })
    )
      return null;
    return {
      form: form,
      user: user,
      pw: pw,
      jump: jump,
      acc: acc,
      confirm: confirm,
      clear: clear,
      model: model,
      action: action.href,
      onConfirm: window.OnConfirm,
      onclick: confirm.onclick,
      onsubmit: form.onsubmit,
    };
  }
  function runWhenReady(nonce, helpers) {
    if (used) return;
    used = true;
    return new Promise(function (resolve) {
      var stopped = false;
      var timer = null;
      var timeout = null;
      var controller = new AbortController();
      var url = window.location.href;
      function finish(result) {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        clearTimeout(timeout);
        controller.abort();
        cancelActive = null;
        helpers.report(result);
        resolve(result);
      }
      cancelActive = function () {
        finish({ ok: false, reason: "cancelled" });
      };
      function current(captured) {
        if (stopped || window.location.href !== url) return false;
        var next = target(helpers);
        return (
          !!next &&
          Object.keys(captured).every(function (key) {
            return captured[key] === next[key];
          })
        );
      }
      function tick() {
        if (stopped) return;
        var captured;
        try {
          captured = target(helpers);
        } catch (_) {}
        if (!captured) {
          timer = setTimeout(tick, 100);
          return;
        }
        // Exactly one redemption, only after the native page handler is ready.
        fetch(
          "/__sortofremoteng_autologin?nonce=" + encodeURIComponent(nonce),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        )
          .then(function (response) {
            if (!response.ok) throw new Error("credential-unavailable");
            return response.json();
          })
          .then(function (data) {
            try {
              if (
                !current(captured) ||
                !data ||
                typeof data.username !== "string" ||
                typeof data.password !== "string"
              ) {
                finish({ ok: false, reason: "form-changed-or-unsafe" });
                return;
              }
              var guard = function () {
                return current(captured);
              };
              helpers.fillField(captured.user, data.username, guard);
              helpers.fillField(captured.pw, data.password, guard);
              if (
                !guard() ||
                captured.user.value !== data.username ||
                captured.pw.value !== data.password
              )
                throw new Error("form-changed-or-unsafe");
              // No requestSubmit/form.submit/Enter fallback, even if click fails.
              captured.confirm.click();
              finish({
                ok: true,
                reason: "submitted",
                via: "yealink-OnConfirm-click",
              });
            } finally {
              if (data && typeof data === "object") {
                data.username = null;
                data.password = null;
              }
            }
          })
          .catch(function () {
            finish({
              ok: false,
              reason: "form-changed-or-credential-unavailable",
            });
          });
      }
      timeout = setTimeout(function () {
        finish({ ok: false, reason: "yealink-handler-not-ready" });
      }, 8000);
      tick();
    });
  }
  window.__sorng_yealink_login = { runWhenReady: runWhenReady, cancel: cancel };
})();
