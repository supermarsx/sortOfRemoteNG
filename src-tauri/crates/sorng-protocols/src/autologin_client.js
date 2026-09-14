/* ============================================================================
 * t20 web auto-login — injected client fill+submit routine (PRODUCTION ASSET)
 *
 * Owner: t20-e5. Lifted from the validated spike
 * `.orchestration/scratch/t20-e1/autologin-fill.js` (e1) and frozen as the real
 * injected asset. Embedded into the served HTML by the proxy ahead of the e3
 * bootstrap (see `themed_autologin::autologin_client_script`), which checks for
 * `window.__sorng_autologin.fetchCredsAndRun` and defers to it when present.
 *
 * Responsibilities (per e3 contract + spike refinements):
 *   1. Fetch the credential ONCE from the same-origin, nonce-guarded endpoint
 *      `GET /__sortofremoteng_autologin?nonce=<nonce>` with
 *      `credentials:'same-origin'`, `cache:'no-store'`. On any non-200: do
 *      NOTHING and do NOT retry (403 = not armed / nonce already spent).
 *   2. Locate the device login form with conservative heuristics, walking the
 *      main document plus same-origin iframes (cross-origin frames are
 *      inaccessible — documented R1 limitation). If a selector OVERRIDE is set
 *      but does not match, treat it as "no login form here" — AUTHORITATIVE,
 *      never fall back to the heuristic (spike refinement #2 / R4).
 *   3. Fill username/password via the native-setter + bubbling `input`/`change`
 *      event technique (the critical React/Vue controlled-input fix — R2), with
 *      a per-keystroke `typeField` fallback for device UIs that only react to
 *      real key events. Submit exactly once (button click / requestSubmit /
 *      form.submit / Enter fallback).
 *   4. Single-shot on the client too: a one-run guard prevents double execution
 *      even if the bootstrap and a stray re-invocation both call in.
 *   5. NEVER log the credential. The creds object is dropped from JS reach after
 *      the single fill+submit (no module-scope retention).
 *
 * Separate MFA/CAPTCHA pages have no fillable primary login form. Joomla's
 * legacy combined password/second-factor form is filled but left for manual
 * submission; a secretkey field does not identify the second-factor method.
 *
 * Dependency-free, framework-agnostic, IIFE — safe to inline verbatim.
 * ==========================================================================*/

(function () {
  "use strict";

  // Idempotent install: if a previous injection already defined the full asset,
  // don't clobber its single-run state.
  if (
    window.__sorng_autologin &&
    typeof window.__sorng_autologin.fetchCredsAndRun === "function" &&
    window.__sorng_autologin.__full
  ) {
    return;
  }

  // Client-side single-shot guard. The proxy also disarms after the first
  // credential hand-out (structural single-shot), but we guard here too so a
  // double bootstrap invocation never fills/submits twice.
  var hasRun = false;
  var stopped = false;
  var cancelActive = null;
  var fetchController = null;
  function cancelRun() {
    stopped = true;
    if (window.__sorng_bitwarden_login) window.__sorng_bitwarden_login.cancel();
    if (window.__sorng_synology_login) window.__sorng_synology_login.cancel();
    if (fetchController) fetchController.abort();
    fetchController = null;
    if (cancelActive) cancelActive();
    cancelActive = null;
  }
  window.addEventListener("pagehide", cancelRun);
  window.addEventListener("unload", cancelRun);

  // ------------------------------------------------------------------------
  // 1. NATIVE-SETTER VALUE WRITE  (the key R2 insight)
  //
  // React (and Vue with v-model on a tracked ref) patches the input's
  // INSTANCE value setter and only commits state when it sees a real `input`
  // event whose value came through the *native* prototype setter. Assigning
  // `el.value = x` either goes through the patched setter (reverted on next
  // render) or updates the DOM without notifying state (submits empty). The
  // fix: grab the ORIGINAL prototype setter, call it, then dispatch a bubbling
  // `input` event so the framework's onChange fires with the value in place.
  // ------------------------------------------------------------------------
  function setNativeValue(el, value) {
    try {
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, "value");
      var nativeSetter = desc && desc.set;
      var ownDesc = Object.getOwnPropertyDescriptor(el, "value");
      var ownSetter = ownDesc && ownDesc.set;
      if (nativeSetter && ownSetter && nativeSetter !== ownSetter) {
        // Framework patched the instance setter — bypass it.
        nativeSetter.call(el, value);
      } else if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value; // last-ditch
      }
    } catch (_) {
      try {
        el.value = value;
      } catch (__) {}
    }
  }

  function checkGuard(guard) {
    if (guard && !guard()) throw new Error("form-changed-or-unsafe");
  }
  function fireInputEvents(el, guard) {
    // `input` drives React/Vue state; `change` drives plain-DOM + jQuery
    // validation; focus/blur help Angular touched/dirty tracking.
    checkGuard(guard);
    try {
      el.dispatchEvent(new Event("focus", { bubbles: false }));
    } catch (_) {}
    checkGuard(guard);
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_) {}
    checkGuard(guard);
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
    checkGuard(guard);
    try {
      el.dispatchEvent(new Event("blur", { bubbles: false }));
    } catch (_) {}
    checkGuard(guard);
  }

  function fillField(el, value, guard, postWriteGuard) {
    if (!el) return false;
    checkGuard(guard);
    try {
      el.focus();
    } catch (_) {}
    checkGuard(guard);
    setNativeValue(el, value);
    // Reviewed staged clients can allow their same owned field to become
    // disabled during validation, but never before the actual value write.
    var afterWrite = postWriteGuard || guard;
    checkGuard(afterWrite);
    fireInputEvents(el, afterWrite);
    return el.value === value;
  }

  // Keystroke-style fill for the rare device UI that only reacts to real key
  // events. Used only as a fallback when the event-dispatch fill leaves the
  // field empty.
  function typeField(el, value, guard) {
    if (!el) return false;
    checkGuard(guard);
    try {
      el.focus();
    } catch (_) {}
    checkGuard(guard);
    setNativeValue(el, "");
    for (var i = 0; i < value.length; i++) {
      checkGuard(guard);
      var ch = value.charAt(i);
      try {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, bubbles: true }),
        );
      } catch (_) {}
      checkGuard(guard);
      setNativeValue(el, el.value + ch);
      checkGuard(guard);
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (_) {}
      checkGuard(guard);
      try {
        el.dispatchEvent(
          new KeyboardEvent("keyup", { key: ch, bubbles: true }),
        );
      } catch (_) {}
      checkGuard(guard);
    }
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
    checkGuard(guard);
    return el.value === value;
  }

  // ------------------------------------------------------------------------
  // 2. FIELD DETECTION (conservative, with authoritative override hooks)
  // ------------------------------------------------------------------------
  var USER_HINTS = [
    "username",
    "user",
    "userid",
    "user_id",
    "login",
    "loginid",
    "email",
    "account",
    "admin",
    "j_username",
  ];

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return el.offsetParent !== null;
    var s = view.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")
      return false;
    // offsetParent is null under display:none ancestors; allow position:fixed
    // (some device login modals are fixed-position — spike caveat).
    return el.offsetParent !== null || s.position === "fixed";
  }

  function matchesHint(el) {
    var id = (el.id || "").toLowerCase();
    var name = (el.name || "").toLowerCase();
    var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "username" || ac === "email") return true;
    return USER_HINTS.some(function (h) {
      return id.indexOf(h) !== -1 || name.indexOf(h) !== -1;
    });
  }

  // Normalise selector overrides into a consistent shape. The endpoint mirrors
  // `HttpAutoLoginSelectors` (snake_case: username_selector / password_selector
  // / submit_selector). The injected bootstrap may pass either the raw object
  // or the same snake_case shape.
  function normSel(sel) {
    if (!sel || typeof sel !== "object") return null;
    return {
      username: sel.username_selector || sel.username || null,
      password: sel.password_selector || sel.password || null,
      submit: sel.submit_selector || sel.submit || null,
    };
  }

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
    var submit = null;
    if (ov && ov.submit) {
      var scope = pw.form || nearestScope(pw, user);
      submit = scope.querySelector(ov.submit);
      if (
        !submit ||
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

  // ------------------------------------------------------------------------
  // 3. SUBMIT (button click preferred, requestSubmit, form.submit, Enter)
  //
  // Order matters: a real submit-button click runs the page's own onclick
  // validation (SPA login buttons often intercept here and never native-submit).
  // requestSubmit() fires the `submit` event (validation + handlers), unlike
  // form.submit() which bypasses them.
  // ------------------------------------------------------------------------
  // Smallest ancestor of `pw` that also contains `user` — keeps the formless
  // button search from reaching across the document to a DIFFERENT form's
  // submit button (spike bug fix).
  function nearestScope(pw, user) {
    if (!user) return pw.parentElement || pw.ownerDocument;
    var node = pw.parentElement;
    while (node && !node.contains(user)) node = node.parentElement;
    return node || pw.ownerDocument;
  }

  function submitForm(target, ov) {
    var form = target.form;
    var pw = target.pw;
    var user = target.user;

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

  // ------------------------------------------------------------------------
  // 4. ORCHESTRATION — single attempt, observable result, no cred retention
  // ------------------------------------------------------------------------
  function attempt(creds, ov) {
    var target = findLoginForm(ov);
    if (!target || !target.pw) {
      return { ok: false, reason: "no-form" };
    }
    if (!(ov && ov.submit)) target.submit = findSubmitButton(target);
    var joomlaCapture = null;
    var joomlaOptions = { fields: [] };
    var validate;
    if (isJoomlaPasswordForm(target)) {
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
      if (!pwOk) {
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

  // The form on a device UI may render after DOMContentLoaded (SPA). Retry
  // detection a few times with backoff, then give up. We only ever SUBMIT
  // once — the retries are purely to *find* the form, not to resubmit.
  function normalizeFormOptions(raw) {
    if (raw === undefined)
      return {
        version: 1,
        fillDelayMs: 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 8000,
        submit: true,
        fields: [],
      };
    var keys = [
      "version",
      "formSelector",
      "fillDelayMs",
      "submitDelayMs",
      "detectionTimeoutMs",
      "submit",
      "fields",
    ];
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(function (key) {
        return keys.indexOf(key) < 0;
      }) ||
      raw.version !== 1 ||
      typeof raw.submit !== "boolean"
    )
      throw new Error("invalid-form-options");
    function selector(value) {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 512 ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        throw new Error("invalid-form-options");
      document.createDocumentFragment().querySelector(value);
      return value;
    }
    ["fillDelayMs", "submitDelayMs", "detectionTimeoutMs"].forEach(
      function (key) {
        var min = key === "detectionTimeoutMs" ? 1000 : 0;
        var max = key === "detectionTimeoutMs" ? 60000 : 30000;
        if (!Number.isInteger(raw[key]) || raw[key] < min || raw[key] > max)
          throw new Error("invalid-form-options");
      },
    );
    if (
      raw.detectionTimeoutMs < raw.fillDelayMs + raw.submitDelayMs ||
      !Array.isArray(raw.fields) ||
      raw.fields.length > 16
    )
      throw new Error("invalid-form-options");
    var seen = new Set();
    var bytes = 0;
    var fields = raw.fields.map(function (field) {
      if (
        !field ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        Object.keys(field).some(function (key) {
          return key !== "selector" && key !== "value";
        })
      )
        throw new Error("invalid-form-options");
      var target = selector(field.selector);
      if (
        seen.has(target) ||
        typeof field.value !== "string" ||
        field.value.length > 4096 ||
        field.value.indexOf("\0") !== -1
      )
        throw new Error("invalid-form-options");
      seen.add(target);
      bytes += new TextEncoder().encode(field.value).length;
      if (bytes > 16384) throw new Error("invalid-form-options");
      return { selector: target, value: field.value };
    });
    return {
      version: 1,
      formSelector:
        raw.formSelector === undefined ? undefined : selector(raw.formSelector),
      fillDelayMs: raw.fillDelayMs,
      submitDelayMs: raw.submitDelayMs,
      detectionTimeoutMs: raw.detectionTimeoutMs,
      submit: raw.submit,
      fields: fields,
    };
  }

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
    if (targetFingerprint(target) !== captured.fingerprint) return false;
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

  function guardedSubmit(target, ov) {
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
      return submitForm(target, ov);
    } finally {
      if (form && !method) form.removeEventListener("submit", preventGet, true);
    }
  }

  function bootstrapFill(creds, ov, rawOptions) {
    // This promise OWNS the secret until detection finishes. Clearing it in
    // the fetch caller before a delayed SPA render used to submit null values.
    return new Promise(function (resolve) {
      var tries = 0;
      var finished = false;
      var retryTimer = null;
      var lifetimeTimer = null;
      var origin = window.location.origin;
      var options;
      var activeCapture;
      function finish(result) {
        if (finished) return;
        finished = true;
        clearTimeout(retryTimer);
        clearTimeout(lifetimeTimer);
        document.removeEventListener("DOMContentLoaded", tick);
        if (cancelActive === cancel) cancelActive = null;
        creds.username = null;
        creds.password = null;
        creds = null;
        if (options)
          options.fields.forEach(function (field) {
            field.value = "";
          });
        if (activeCapture)
          activeCapture.extras.forEach(function (field) {
            field.value = "";
          });
        report(result);
        resolve(result);
      }
      function cancel() {
        finish({ ok: false, reason: "cancelled" });
      }
      function guarded(captured) {
        return (
          !finished &&
          !stopped &&
          window.location.origin === origin &&
          sameCapturedTarget(captured, ov, options)
        );
      }
      function fail() {
        finish({ ok: false, reason: "form-changed-or-unsafe" });
      }
      function fill(captured) {
        if (finished) return;
        try {
          if (!guarded(captured)) {
            fail();
            return;
          }
          var target = captured.target;
          var validate = function () {
            return guarded(captured);
          };
          if (target.user) {
            fillField(target.user, creds.username, validate);
            if (!guarded(captured)) {
              fail();
              return;
            }
          }
          fillField(target.pw, creds.password, validate);
          if (!guarded(captured)) {
            fail();
            return;
          }
          if (target.pw.value !== creds.password)
            typeField(target.pw, creds.password, validate);
          if (
            !guarded(captured) ||
            target.pw.value !== creds.password ||
            (target.user && target.user.value !== creds.username)
          ) {
            fail();
            return;
          }
          for (var i = 0; i < captured.extras.length; i++) {
            var field = captured.extras[i];
            if (!guarded(captured)) {
              fail();
              return;
            }
            fillField(field.element, field.value, validate);
            if (!guarded(captured) || field.element.value !== field.value) {
              fail();
              return;
            }
          }
          if (!options.submit) {
            finish({ ok: true, reason: "filled-only" });
            return;
          }
          var submit = function () {
            if (finished) return;
            try {
              if (
                !guarded(captured) ||
                target.pw.value !== creds.password ||
                (target.user && target.user.value !== creds.username) ||
                captured.extras.some(function (field) {
                  return field.element.value !== field.value;
                })
              ) {
                fail();
                return;
              }
              if (captured.joomlaMfa || hasJoomlaTwoFactorField(target)) {
                finish(manualJoomlaMfa(target));
                return;
              }
              var via = guardedSubmit(target, ov);
              finish({
                ok: true,
                reason: "submitted",
                via: via,
                userFilled: !!target.user,
                pwFilled: true,
              });
            } catch (_) {
              fail();
            }
          };
          if (options.submitDelayMs)
            retryTimer = setTimeout(submit, options.submitDelayMs);
          else submit();
        } catch (_) {
          fail();
        }
      }
      function tick() {
        if (finished) return;
        if (stopped || window.location.origin !== origin) {
          cancel();
          return;
        }
        try {
          var target = findLoginForm(ov, options);
          if (target && target.pw) {
            // No retries after an attempted submit, including thrown handlers.
            var captured = captureTarget(target, options);
            activeCapture = captured;
            if (options.fillDelayMs)
              retryTimer = setTimeout(function () {
                fill(captured);
              }, options.fillDelayMs);
            else fill(captured);
            return;
          }
          if (++tries >= 20 && rawOptions == null) {
            finish({ ok: false, reason: "form-not-found-timeout" });
            return;
          }
          retryTimer = setTimeout(tick, Math.min(100 + tries * 50, 400));
        } catch (error) {
          var reason =
            error &&
            [
              "unsafe-form-action",
              "unsafe-form-method",
              "unsafe-form-target",
              "invalid-extra-field",
            ].indexOf(error.message) >= 0
              ? error.message
              : "form-fill-failed";
          finish({ ok: false, reason: reason });
        }
      }
      cancelActive = cancel;
      try {
        options = normalizeFormOptions(rawOptions);
      } catch (_) {
        finish({ ok: false, reason: "invalid-form-options" });
        return;
      }
      // Bounds even a document which never reaches DOMContentLoaded.
      lifetimeTimer = setTimeout(function () {
        finish({ ok: false, reason: "form-not-found-timeout" });
      }, options.detectionTimeoutMs);
      if (stopped) {
        cancel();
        return;
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tick, { once: true });
      } else {
        tick();
      }
    });
  }

  function report(result) {
    // Fixed diagnostic result only; no credentials are included in the event.
    // It never carries the credential, only the outcome.
    try {
      window.parent.postMessage(
        { type: "proxy_autologin_result", result: result },
        "*",
      );
    } catch (_) {}
    try {
      window.__autologin_last = result;
    } catch (_) {}
  }

  // ------------------------------------------------------------------------
  // 5. CREDENTIAL HANDSHAKE — fetch once, fill, drop the secret
  //
  // The injected HTML carries ONLY the per-page nonce + non-secret selectors.
  // The credential is fetched exactly once from the nonce-guarded same-origin
  // endpoint; non-200 => no-op, no retry (403 = not armed / nonce spent).
  // ------------------------------------------------------------------------
  var AUTOLOGIN_PATH = "/__sortofremoteng_autologin";

  function fetchCredsAndRun(nonce, selectors, loginFlow) {
    // Client single-shot: never fetch/fill/submit more than once per page.
    if (hasRun || stopped) return;
    hasRun = true;

    // Native closed purpose hint: DSM must see a complete account panel before
    // dispensing its username and starting the short password continuation.
    if (loginFlow === "synology") {
      var synology = window.__sorng_synology_login;
      if (!synology || typeof synology.runWhenReady !== "function") {
        report({ ok: false, reason: "autologin-client-unavailable" });
        return;
      }
      return synology.runWhenReady(nonce, {
        fillField: fillField,
        isVisible: isVisible,
        report: report,
      });
    }
    if (loginFlow != null) {
      report({ ok: false, reason: "invalid-login-flow" });
      return;
    }

    var injectedOv = normSel(selectors);

    fetchController =
      typeof AbortController === "function" ? new AbortController() : null;
    return fetch(AUTOLOGIN_PATH + "?nonce=" + encodeURIComponent(nonce), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: fetchController ? fetchController.signal : undefined,
    })
      .then(function (r) {
        // Non-200 => do nothing, do NOT retry.
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (data) {
        // Endpoint selectors (from the connection config) are AUTHORITATIVE
        // and override anything templated into the bootstrap.
        fetchController = null;
        var creds = null;
        try {
          if (stopped) return;
          if (
            data &&
            (data.loginFlow === "bitwarden" || data.loginFlow === "synology")
          ) {
            var reviewedClient =
              data.loginFlow === "synology"
                ? window.__sorng_synology_login
                : window.__sorng_bitwarden_login;
            if (!reviewedClient) {
              report({ ok: false, reason: "autologin-client-unavailable" });
              return;
            }
            return reviewedClient.run(data, {
              fillField: fillField,
              isVisible: isVisible,
              report: report,
            });
          }
          if (
            !data ||
            typeof data.username !== "string" ||
            typeof data.password !== "string"
          ) {
            report({ ok: false, reason: "invalid-credential-response" });
            return;
          }
          var ov = normSel(data.selectors) || injectedOv;
          creds = { username: data.username, password: data.password };
          return bootstrapFill(creds, ov, data.formAutomation);
        } finally {
          // Drop the transport object now; bootstrap owns its private copy.
          if (data && typeof data === "object") {
            data.username = null;
            data.password = null;
            data.continuation = null;
            if (
              data.formAutomation &&
              Array.isArray(data.formAutomation.fields)
            )
              data.formAutomation.fields.forEach(function (field) {
                if (field && typeof field === "object") field.value = "";
              });
          }
        }
      })
      .catch(function () {
        fetchController = null;
        report({
          ok: false,
          reason: stopped ? "cancelled" : "cred-fetch-failed",
        });
      });
  }

  // Export. `__full` marks this as e5's complete asset so the e3 bootstrap (and
  // any re-injection) defers to it and does not clobber the single-run state.
  window.__sorng_autologin = {
    __full: true,
    setNativeValue: setNativeValue,
    fillField: fillField,
    typeField: typeField,
    findLoginForm: findLoginForm,
    submitForm: submitForm,
    attempt: attempt,
    bootstrap: bootstrapFill,
    fetchCredsAndRun: fetchCredsAndRun,
    cancel: cancelRun,
  };
})();
