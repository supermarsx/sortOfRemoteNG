/* Private auto-login forms/generic.js. Assembled inside the coordinator IIFE. */
function findInRoot(root, ov, options) {
  var selectedForm = null;
  if (options && options.formSelector) {
    var forms = root.querySelectorAll(options.formSelector);
    if (forms.length !== 1 || forms[0].tagName !== "FORM") return null;
    selectedForm = forms[0];
    root = selectedForm;
  }
  var pw = null;
  if (ov && ov.password) {
    // AUTHORITATIVE: a set-but-unmatched override means "no login form in
    // this root" — never fall back to the heuristic (would risk filling a
    // wrong/different field — R4 / spike refinement #2).
    pw = root.querySelector(ov.password);
    if (
      !pw ||
      !isVisible(pw) ||
      pw.tagName !== "INPUT" ||
      pw.type !== "password"
    )
      return null;
  } else {
    var ps = root.querySelectorAll("input[type=password]");
    for (var i = 0; i < ps.length; i++) {
      if (isVisible(ps[i])) {
        pw = ps[i];
        break;
      }
    }
  }
  if (!pw) return null; // no login form here
  if (selectedForm && pw.form !== selectedForm) return null;

  var user = null;
  if (ov && ov.username) {
    // An explicit missing/hidden field fails closed; never fill only the
    // password into a different or partially rendered application form.
    user = root.querySelector(ov.username);
    if (
      !user ||
      !isVisible(user) ||
      user.tagName !== "INPUT" ||
      !/^(text|email|tel)$/.test(user.type) ||
      user.form !== pw.form
    )
      return null;
  }
  if (!user && !(ov && ov.username)) {
    var form = pw.form || root;
    var all = form.querySelectorAll(
      "input[type=text], input[type=email], input:not([type]), input[type=tel]",
    );
    var candidates = [];
    for (var j = 0; j < all.length; j++) {
      if (isVisible(all[j])) candidates.push(all[j]);
    }
    // 1) hint match within the form
    for (var k = 0; k < candidates.length; k++) {
      if (matchesHint(candidates[k])) {
        user = candidates[k];
        break;
      }
    }
    // 2) the visible text input immediately preceding the password in DOM
    //    order, else the first candidate.
    if (!user && candidates.length) {
      var before = [];
      for (var m = 0; m < candidates.length; m++) {
        if (
          candidates[m].compareDocumentPosition(pw) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) {
          before.push(candidates[m]);
        }
      }
      user = before.length ? before[before.length - 1] : candidates[0];
    }
  }
  if (porkbunSelectors(ov)) return porkbunTarget(root, ov, user, pw);
  if (exchangeEcpSelectors(ov)) return exchangeEcpTarget(root, ov, user, pw);
  if (instagramSelectors(ov)) return instagramTarget(root, ov, user, pw);
  var submit = null;
  if (ov && ov.submit) {
    var scope = pw.form || nearestScope(pw, user);
    submit = scope.querySelector(ov.submit);
    if (
      !submit ||
      !scope.contains(submit) ||
      !isVisible(submit) ||
      (submit.form && submit.form !== pw.form) ||
      !(
        /^(BUTTON|INPUT|A)$/.test(submit.tagName) ||
        submit.getAttribute("role") === "button"
      )
    )
      return null;
  }
  return { user: user, pw: pw, form: pw.form || null, submit: submit };
}

// Walk the main document plus SAME-ORIGIN iframes (cross-origin frames are
// inaccessible — documented R1 limitation).
function findLoginForm(ov, options) {
  var hit = findInRoot(document, ov, options);
  if (hit) return hit;
  var frames = document.querySelectorAll("iframe, frame");
  for (var i = 0; i < frames.length; i++) {
    var doc = null;
    try {
      doc = frames[i].contentDocument; // null/throws if cross-origin
    } catch (_) {
      doc = null;
    }
    if (doc) {
      var fhit = findInRoot(doc, ov, options);
      if (fhit) return fhit;
    }
  }
  return null;
}

function submitForm(target, ov, readinessProfile) {
  var form = target.form;
  var pw = target.pw;
  var user = target.user;

  if (target.exchangeEcp) {
    var current = exchangeEcpTarget(document, ov, user, pw);
    if (
      !current ||
      current.submit !== target.submit ||
      !sameExchangeEcpHandler(target, current)
    )
      throw new Error("form-changed-or-unsafe");
    // clkLgn owns Exchange's validation and hidden fields. No native-submit
    // or Enter fallback, and no persistent/private-computer setting changes.
    target.submit.click();
    return "exchange-ecp-button-click";
  }

  if (target.porkbun) {
    // Never requestSubmit/form.submit/Enter: the real action is AJAX, while
    // the form's native POST goes to a hidden dummy iframe.
    var current = porkbunTarget(document, ov, user, pw);
    if (
      !current ||
      current.submit !== target.submit ||
      current.porkbun.click !== target.porkbun.click ||
      current.porkbun.exec !== target.porkbun.exec ||
      current.porkbun.login !== target.porkbun.login
    )
      throw new Error("form-changed-or-unsafe");
    target.submit.click();
    return "porkbun-button-click";
  }

  if (readinessProfile === "cpanel") {
    var cpanelSubmit = submitCpanelForm(target);
    if (cpanelSubmit) return cpanelSubmit;
  }

  // Explicit selectors were validated together before any field was filled.
  if (ov && ov.submit) {
    if (!target.submit) return "no-submit";
    target.submit.click();
    return "override-submit";
  }

  // Scope the search to the login form (or nearest container) — never
  // document-wide (spike takeaway).
  var btn = target.submit || findSubmitButton(target);
  if (btn) {
    btn.click();
    return "button-click";
  }
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return "requestSubmit";
    }
    var ev = new Event("submit", { bubbles: true, cancelable: true });
    var notCancelled = form.dispatchEvent(ev);
    if (notCancelled) form.submit();
    return "form.submit";
  }
  // Last resort: Enter in the password field.
  try {
    pw.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );
    pw.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );
  } catch (_) {}
  return "enter-key";
}

function findSubmitButton(target) {
  var scope = target.form || nearestScope(target.pw, target.user);
  return (
    scope.querySelector("button[type=submit], input[type=submit]") ||
    scope.querySelector("button:not([type])") ||
    scope.querySelector(
      "[role=button][type=submit], button[id*=login i], button[class*=login i], button[id*=signin i]",
    )
  );
}

// ------------------------------------------------------------------------
// 4. ORCHESTRATION — single attempt, observable result, no cred retention
// ------------------------------------------------------------------------
function attempt(creds, ov) {
  // Instagram requires the bounded async ready-button lifecycle, never the
  // legacy synchronous entrypoint's keystroke or unguarded submit fallback.
  if (instagramSelectors(ov))
    return { ok: false, reason: "form-readiness-required" };
  var target = findLoginForm(ov);
  if (!target || !target.pw) {
    return { ok: false, reason: "no-form" };
  }
  if (!(ov && ov.submit)) target.submit = findSubmitButton(target);
  var joomlaCapture = null;
  var joomlaOptions = { fields: [] };
  var validate;
  if (isJoomlaPasswordForm(target) || target.porkbun || target.exchangeEcp) {
    try {
      joomlaCapture = captureTarget(target, joomlaOptions);
      validate = function () {
        return sameCapturedTarget(joomlaCapture, ov, joomlaOptions);
      };
    } catch (_) {
      return { ok: false, reason: "form-changed-or-unsafe" };
    }
  }
  var joomlaMfa = hasJoomlaTwoFactorField(target);
  // Do not automatically send credentials to an external form action, even
  // when a login-looking form was served by the intended upstream page.
  var destination = target.submit && target.submit.getAttribute("formaction");
  if (!destination && target.submit && target.submit.tagName === "A")
    destination = target.submit.getAttribute("href");
  if (!destination && target.form)
    destination = target.form.getAttribute("action");
  if (destination) {
    var action = new URL(destination, target.pw.ownerDocument.baseURI);
    if (
      action.origin !== window.location.origin ||
      action.username ||
      action.password
    ) {
      return { ok: false, reason: "unsafe-form-action" };
    }
  }
  var userOk;
  var pwOk;
  try {
    userOk = target.user
      ? fillField(target.user, creds.username, validate)
      : true;
    pwOk = fillField(target.pw, creds.password, validate);
    if (!pwOk && !target.porkbun) {
      // Event-dispatch fill didn't stick — try keystroke fallback once.
      typeField(target.pw, creds.password, validate);
      if (target.user) typeField(target.user, creds.username, validate);
      pwOk = target.pw.value === creds.password;
    }
  } catch (_) {
    return { ok: false, reason: "form-changed-or-unsafe" };
  }
  if (joomlaCapture !== null) {
    try {
      if (
        !validate() ||
        target.user.value !== creds.username ||
        target.pw.value !== creds.password
      )
        return { ok: false, reason: "form-changed-or-unsafe" };
    } catch (_) {
      return { ok: false, reason: "form-changed-or-unsafe" };
    }
  }
  if (joomlaMfa || hasJoomlaTwoFactorField(target))
    return manualJoomlaMfa(target);
  var how = submitForm(target, ov);
  return {
    ok: true,
    reason: "submitted",
    via: how,
    userFilled: userOk,
    pwFilled: pwOk,
  };
}
