/* Private auto-login apps/joomla.js. Assembled inside the coordinator IIFE. */
function isJoomlaPasswordForm(target) {
  return !!(
    target.form &&
    target.form.id === "form-login" &&
    target.user &&
    target.user.id === "mod-login-username" &&
    target.user.name === "username" &&
    target.pw.id === "mod-login-password" &&
    target.pw.name === "passwd"
  );
}

function hasJoomlaTwoFactorField(target) {
  // Joomla 3 and 4.0/4.1 share this optional same-form field. Its presence
  // does not identify TOTP versus another method (or this account's setup).
  // Even a prefilled/hidden field stays manual; never send an unreviewed OTP.
  return !!(
    isJoomlaPasswordForm(target) &&
    target.form.querySelector('input#mod-login-secretkey[name="secretkey"]')
  );
}

function manualJoomlaMfa(target) {
  var status = target.form.querySelector("[data-sorng-joomla-mfa-status]");
  if (!status) {
    status = target.pw.ownerDocument.createElement("p");
    status.setAttribute("data-sorng-joomla-mfa-status", "");
    status.setAttribute("role", "status");
    target.form.appendChild(status);
  }
  status.textContent =
    "Username and password filled. Complete Joomla's two-factor field if required, then select Log in.";
  return {
    ok: false,
    reason: "manual-mfa-required",
    userFilled: true,
    pwFilled: true,
  };
}

function joomlaSubmissionTarget(target) {
  if (!isJoomlaPasswordForm(target)) return null;
  var value = target.submit && target.submit.getAttribute("formtarget");
  if (value == null) value = target.form.getAttribute("target");
  if (value == null) {
    var base = target.pw.ownerDocument.querySelector("base[target]");
    value = base && base.getAttribute("target");
  }
  // Do not let a reviewed login leave its protected frame via a button,
  // form or document-base browsing-context override. Empty means _self.
  value = (value || "").toLowerCase();
  if (value && value !== "_self") throw new Error("unsafe-form-target");
  return value;
}
