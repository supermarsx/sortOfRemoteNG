/* Private auto-login apps/porkbun.js. Assembled inside the coordinator IIFE. */
function porkbunSelectors(ov) {
  return !!(
    ov &&
    ov.username ===
      'form#loginForm input#loginUsername[name="loginUsername"][autocomplete="username"]' &&
    ov.password ===
      'form#loginForm input#loginPassword[name="loginPassword"][type="password"]' &&
    ov.submit === "#accountLoginButtonContainer button#accountLoginButton"
  );
}

// Public /account/login + skaboink.js reviewed 2026-09-30. The button is a
// sibling of the form, not a form-associated submitter. Its website handler
// owns CAPTCHA, AJAX and subsequent challenges; /blank is only a dummy target.
// This exception requires the complete reviewed selectors, never heuristics.
function porkbunTarget(root, ov, user, pw) {
  if (!porkbunSelectors(ov) || root !== document) return null;
  var form = pw.form;
  var container = document.querySelector("#accountLoginContainer");
  var buttons = document.querySelectorAll(ov.submit);
  var button = buttons.length === 1 ? buttons[0] : null;
  var view = document.defaultView;
  if (
    location.pathname !== "/account/login" ||
    !form ||
    form.id !== "loginForm" ||
    !user ||
    user.form !== form ||
    document.querySelectorAll("form#loginForm").length !== 1 ||
    document.querySelectorAll(ov.username).length !== 1 ||
    document.querySelectorAll(ov.password).length !== 1 ||
    document.querySelectorAll("#accountLoginContainer").length !== 1 ||
    !container ||
    form.parentElement !== container ||
    !button ||
    button.parentElement.parentElement !== container ||
    button.parentElement.previousElementSibling !== form ||
    button.form !== null ||
    button.hasAttribute("form") ||
    button.hasAttribute("formaction") ||
    button.hasAttribute("formmethod") ||
    button.hasAttribute("formtarget") ||
    button.hasAttribute("data-login-action") ||
    button.getAttribute("onclick") !== "logInExec();" ||
    button.getAttribute("aria-disabled") === "true" ||
    button.matches(":disabled") ||
    !isVisible(button) ||
    form.getAttribute("action") !== "/blank" ||
    (form.getAttribute("method") || "").toLowerCase() !== "post" ||
    form.getAttribute("target") !== "lame_login_iframe" ||
    !form.hasAttribute("data-pbrf") ||
    new URL("/blank", document.baseURI).origin !== location.origin ||
    typeof button.onclick !== "function" ||
    typeof view.logInExec !== "function" ||
    typeof view.logIn !== "function" ||
    [user, pw, button].some(function (element) {
      return !!element.closest(
        '[inert], [aria-busy="true"], [aria-disabled="true"]',
      );
    })
  )
    return null;
  // A resumed MFA/error page is not a fresh password-login stage. Never
  // activate recovery controls or retry rejected credentials automatically.
  var blockers = document.querySelectorAll(
    "#twoFactorLoginContainer, #twoFactorLoginContainerEmail, " +
      "#twoFactorLoginContainerEmailNoCookie, #modal_forceCcaptcha, " +
      '#accountLoginErrorAlert, [id^="bypassTwoFactor"][id$="Container"]',
  );
  if (
    Array.prototype.some.call(blockers, function (element) {
      if (!isVisible(element)) return false;
      for (var parent = element; parent; parent = parent.parentElement) {
        var style = view.getComputedStyle(parent);
        if (
          parent.hidden ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
      }
      return true;
    })
  )
    return null;
  return {
    user: user,
    pw: pw,
    form: form,
    submit: button,
    porkbun: {
      click: button.onclick,
      exec: view.logInExec,
      login: view.logIn,
    },
  };
}
