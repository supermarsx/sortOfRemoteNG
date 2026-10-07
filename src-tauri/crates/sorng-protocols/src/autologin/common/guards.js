/* Private auto-login common/guards.js. Assembled inside the coordinator IIFE. */
function targetFingerprint(target) {
  var form = target.form;
  var submit = target.submit;
  var destination =
    submit &&
    (submit.getAttribute("formaction") ||
      (submit.tagName === "A" ? submit.getAttribute("href") : null));
  if (!destination && form) destination = form.getAttribute("action");
  var action = new URL(
    destination || target.pw.ownerDocument.URL,
    target.pw.ownerDocument.baseURI,
  );
  if (
    action.origin !== window.location.origin ||
    action.username ||
    action.password
  )
    throw new Error("unsafe-form-action");
  var methodOverride = submit && submit.getAttribute("formmethod");
  var joomla = isJoomlaPasswordForm(target);
  var method = (
    joomla && methodOverride != null
      ? methodOverride
      : methodOverride || (form && form.getAttribute("method")) || ""
  ).toLowerCase();
  // A present empty/invalid button formmethod means GET, not inheritance.
  // Known Joomla forms require POST; retain existing handler-only SPA rules.
  if (joomla ? method !== "post" : method && method !== "post")
    throw new Error("unsafe-form-method");
  return JSON.stringify([
    action.href,
    method,
    target.pw.ownerDocument.baseURI,
    form && form.getAttribute("action"),
    submit && submit.getAttribute("formaction"),
    submit && submit.getAttribute("href"),
    joomlaSubmissionTarget(target),
    exchangeEcpFingerprint(target),
    target.porkbun && [
      form.getAttribute("target"),
      submit.getAttribute("formtarget"),
      submit.getAttribute("type"),
      submit.getAttribute("onclick"),
    ],
    target.user && [
      target.user.id,
      target.user.name,
      target.user.type,
      target.user.autocomplete,
    ],
    [target.pw.id, target.pw.name, target.pw.type, target.pw.autocomplete],
  ]);
}

function allowedExtra(element, target) {
  if (
    !element ||
    !target.form ||
    target.exchangeEcp ||
    element.form !== target.form ||
    element === target.user ||
    element === target.pw ||
    element.disabled ||
    element.readOnly
  )
    return false;
  var hints = [
    element.id,
    element.name,
    element.getAttribute("autocomplete"),
  ].join(" ");
  if (
    /pass(word|wd|phrase)?|secret|csrf|xsrf|token|nonce|authenticity|otp|one.time|verification|captcha|backup|recovery|username|user.name|login/i.test(
      hints,
    )
  )
    return false;
  if (element.tagName === "SELECT")
    return !element.multiple && isVisible(element);
  return (
    element.tagName === "INPUT" &&
    (element.type === "hidden" ||
      (element.type === "text" && isVisible(element)))
  );
}

function captureTarget(target, options) {
  if (!target.submit) target.submit = findSubmitButton(target);
  var used = new Set();
  var extras = options.fields.map(function (field) {
    if (!target.form) throw new Error("invalid-extra-field");
    var matches = target.form.querySelectorAll(field.selector);
    var element = matches[0];
    if (
      matches.length !== 1 ||
      used.has(element) ||
      !allowedExtra(element, target)
    )
      throw new Error("invalid-extra-field");
    if (
      element.tagName === "SELECT" &&
      !Array.from(element.options).some(function (option) {
        return (
          !option.disabled &&
          !(
            option.parentElement.tagName === "OPTGROUP" &&
            option.parentElement.disabled
          ) &&
          option.value === field.value
        );
      })
    )
      throw new Error("invalid-extra-field");
    used.add(element);
    return {
      element: element,
      selector: field.selector,
      value: field.value,
      type: element.type,
      name: element.name,
      id: element.id,
    };
  });
  return {
    target: target,
    document: target.pw.ownerDocument,
    fingerprint: targetFingerprint(target),
    joomlaMfa: hasJoomlaTwoFactorField(target),
    extras: extras,
  };
}

function sameCapturedTarget(captured, ov, options) {
  var target = captured.target;
  if (
    !target.pw.isConnected ||
    !isVisible(target.pw) ||
    target.pw.type !== "password" ||
    target.pw.ownerDocument !== captured.document ||
    target.pw.form !== target.form
  )
    return false;
  if (
    target.user &&
    (!target.user.isConnected ||
      !isVisible(target.user) ||
      target.user.form !== target.form)
  )
    return false;
  if (target.form && !target.form.isConnected) return false;
  if (
    target.submit &&
    (!target.submit.isConnected ||
      !isVisible(target.submit) ||
      (target.submit.form && target.submit.form !== target.form))
  )
    return false;
  var found = findLoginForm(ov, options);
  if (
    !found ||
    found.user !== target.user ||
    found.pw !== target.pw ||
    found.form !== target.form ||
    (ov && ov.submit && found.submit !== target.submit)
  )
    return false;
  if (
    target.porkbun &&
    (!found.porkbun ||
      found.porkbun.click !== target.porkbun.click ||
      found.porkbun.exec !== target.porkbun.exec ||
      found.porkbun.login !== target.porkbun.login)
  )
    return false;
  if (targetFingerprint(target) !== captured.fingerprint) return false;
  if (!sameExchangeEcpHandler(target, found)) return false;
  if (!sameVodafoneRouterHandler(target, found)) return false;
  return captured.extras.every(function (field) {
    var matches = target.form.querySelectorAll(field.selector);
    return (
      matches.length === 1 &&
      matches[0] === field.element &&
      field.element.isConnected &&
      allowedExtra(field.element, target) &&
      field.element.type === field.type &&
      field.element.name === field.name &&
      field.element.id === field.id &&
      (field.element.tagName !== "SELECT" ||
        Array.from(field.element.options).some(function (option) {
          return (
            !option.disabled &&
            !(
              option.parentElement.tagName === "OPTGROUP" &&
              option.parentElement.disabled
            ) &&
            option.value === field.value
          );
        }))
    );
  });
}

function guardedSubmit(target, ov, readinessProfile) {
  // Reviewed SPA forms omit method/action. Keep their JS handlers, but never
  // permit a missing handler to fall through to a native credential-bearing GET.
  var preventGet = function (event) {
    event.preventDefault();
  };
  var form = target.form;
  var method = (
    (target.submit && target.submit.getAttribute("formmethod")) ||
    (form && form.getAttribute("method")) ||
    ""
  ).toLowerCase();
  if (
    form &&
    !method &&
    !target.submit &&
    typeof form.requestSubmit !== "function"
  )
    throw new Error("unsafe-form-method");
  if (form && !method) form.addEventListener("submit", preventGet, true);
  try {
    return submitForm(target, ov, readinessProfile);
  } finally {
    if (form && !method) form.removeEventListener("submit", preventGet, true);
  }
}
