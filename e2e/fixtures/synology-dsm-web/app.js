// Synthetic DSM 7.2 login SPA (t85 e2e fixture; not DSM code).
//
// Boots like the DSM Vue app: on DOMContentLoaded it replays the selected e1
// timeline (splash, "#/", "#/signin", account panel) with `createDsmPage`, then
// answers the reviewed controls through the DSM login API:
//   Next     -> POST SYNO.API.Auth.Type get  -> password panel on #/signin/password
//   Sign in  -> POST SYNO.API.Auth login     -> desktop on #/, or the OTP panel
//                                               on #/signin/otp (error 403)
// The server records those submissions; this page only reports closed
// milestone labels to /webman/fixture-event.cgi, never a field value.
(function () {
  "use strict";

  var started = Date.now();
  function report(event, detail) {
    try {
      fetch("/webman/fixture-event.cgi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event,
          detail: detail === undefined ? null : String(detail),
          t: Date.now() - started,
        }),
        credentials: "same-origin",
        keepalive: true,
      }).catch(function () {});
    } catch (_) {
      // Diagnostics only.
    }
  }

  var config = window.__DSM_FIXTURE__;
  if (
    !config ||
    typeof window.createDsmPage !== "function" ||
    typeof window.createDsmMarkup !== "function"
  ) {
    report("fixture-misconfigured");
    return;
  }
  var markup = window.createDsmMarkup();
  var page = window.createDsmPage(window);
  // Transitions follow the API replies below, not the simulator's own timers.
  page.install({
    next: { delayMs: 0, outcome: "none" },
    signIn: { delayMs: 0, outcome: "none" },
  });

  function apply(step) {
    page.apply(step);
    report("step", step.type + (step.hash ? " " + step.hash : ""));
  }

  function entry(params) {
    return fetch("/webapi/entry.cgi", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams(params).toString(),
      credentials: "same-origin",
    }).then(function (response) {
      return response.json();
    });
  }

  function showError(code) {
    var panel = document.querySelector(".login-tabs-content-wrapper");
    if (panel) panel.insertAdjacentHTML("beforeend", markup.error());
    report("error-shown", code);
  }

  function submitAccount() {
    var field = document.querySelector(
      'form#dsm-user-fieldset [syno-id="username"]',
    );
    var account = field ? field.value : "";
    report("next-click");
    entry({
      api: "SYNO.API.Auth.Type",
      method: "get",
      version: "1",
      account: account,
    }).then(
      function (reply) {
        if (!reply || reply.success !== true) return showError("account");
        // DSM renders the account the user entered on the password panel.
        apply({ type: "route", hash: "#/signin/password", via: "push" });
        apply({ type: "password", hiddenUsername: account });
      },
      function () {
        report("request-failed", "account");
      },
    );
  }

  function submitPassword() {
    var form = document.querySelector("form#dsm-pass-fieldset");
    var field = form && form.querySelector('[syno-id="password"]');
    var hidden = form && form.querySelector('input[name="username"]');
    report("signin-click");
    entry({
      api: "SYNO.API.Auth",
      method: "login",
      version: "7",
      session: "webui",
      account: hidden ? hidden.value : "",
      passwd: field ? field.value : "",
    }).then(
      function (reply) {
        var code = reply && reply.error ? reply.error.code : null;
        if (reply && reply.success === true) {
          apply({ type: "removeRoot" });
          apply({ type: "route", hash: "#/", via: "replace" });
          document.body.insertAdjacentHTML("beforeend", markup.desktop());
          report("desktop-shown");
        } else if (code === 403) {
          apply({ type: "route", hash: "#/signin/otp", via: "push" });
          apply({ type: "otp" });
        } else {
          apply({ type: "clearField" });
          showError(code);
        }
      },
      function () {
        report("request-failed", "login");
      },
    );
  }

  function submitOtp() {
    var code = document.querySelector('input[name="one-time-code"]');
    var hidden = document.querySelector('input[name="username"]');
    report("otp-click");
    entry({
      api: "SYNO.API.Auth",
      method: "login",
      version: "7",
      account: hidden ? hidden.value : "",
      otp_code: code ? code.value : "",
    }).then(
      function (reply) {
        if (!reply || reply.success !== true)
          showError(reply && reply.error ? reply.error.code : null);
      },
      function () {
        report("request-failed", "otp");
      },
    );
  }

  // Registered after createDsmPage's own listener, which counts the clicks.
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest('[syno-id="account-panel-next-btn"]')) submitAccount();
    else if (target.closest('[syno-id="password-panel-next-btn"]'))
      submitPassword();
    else if (target.closest('[syno-id="otp-panel-next-btn"]')) submitOtp();
  });

  function start() {
    var timeline = config.timeline;
    report("boot", timeline.name);
    if (timeline.hash)
      apply({ type: "route", hash: timeline.hash, via: "replace" });
    timeline.initial.forEach(apply);
    timeline.steps.forEach(function (scheduled) {
      setTimeout(function () {
        apply(scheduled.step);
      }, scheduled.at);
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
