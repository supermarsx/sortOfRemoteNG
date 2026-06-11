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
 * MFA/CAPTCHA pages have no fillable primary login form -> `no-form` no-op; the
 * page passes through to the admin untouched.
 *
 * Dependency-free, framework-agnostic, IIFE — safe to inline verbatim.
 * ==========================================================================*/

(function () {
  'use strict';

  // Idempotent install: if a previous injection already defined the full asset,
  // don't clobber its single-run state.
  if (
    window.__sorng_autologin &&
    typeof window.__sorng_autologin.fetchCredsAndRun === 'function' &&
    window.__sorng_autologin.__full
  ) {
    return;
  }

  // Client-side single-shot guard. The proxy also disarms after the first
  // credential hand-out (structural single-shot), but we guard here too so a
  // double bootstrap invocation never fills/submits twice.
  var hasRun = false;

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
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var nativeSetter = desc && desc.set;
      var ownDesc = Object.getOwnPropertyDescriptor(el, 'value');
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

  function fireInputEvents(el) {
    // `input` drives React/Vue state; `change` drives plain-DOM + jQuery
    // validation; focus/blur help Angular touched/dirty tracking.
    try {
      el.dispatchEvent(new Event('focus', { bubbles: false }));
    } catch (_) {}
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
    try {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    try {
      el.dispatchEvent(new Event('blur', { bubbles: false }));
    } catch (_) {}
  }

  function fillField(el, value) {
    if (!el) return false;
    try {
      el.focus();
    } catch (_) {}
    setNativeValue(el, value);
    fireInputEvents(el);
    return el.value === value;
  }

  // Keystroke-style fill for the rare device UI that only reacts to real key
  // events. Used only as a fallback when the event-dispatch fill leaves the
  // field empty.
  function typeField(el, value) {
    if (!el) return false;
    try {
      el.focus();
    } catch (_) {}
    setNativeValue(el, '');
    for (var i = 0; i < value.length; i++) {
      var ch = value.charAt(i);
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      } catch (_) {}
      setNativeValue(el, el.value + ch);
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) {}
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      } catch (_) {}
    }
    try {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    return el.value === value;
  }

  // ------------------------------------------------------------------------
  // 2. FIELD DETECTION (conservative, with authoritative override hooks)
  // ------------------------------------------------------------------------
  var USER_HINTS = [
    'username', 'user', 'userid', 'user_id', 'login', 'loginid',
    'email', 'account', 'admin', 'j_username',
  ];

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return el.offsetParent !== null;
    var s = view.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')
      return false;
    // offsetParent is null under display:none ancestors; allow position:fixed
    // (some device login modals are fixed-position — spike caveat).
    return el.offsetParent !== null || s.position === 'fixed';
  }

  function matchesHint(el) {
    var id = (el.id || '').toLowerCase();
    var name = (el.name || '').toLowerCase();
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'username' || ac === 'email') return true;
    return USER_HINTS.some(function (h) {
      return id.indexOf(h) !== -1 || name.indexOf(h) !== -1;
    });
  }

  // Normalise selector overrides into a consistent shape. The endpoint mirrors
  // `HttpAutoLoginSelectors` (snake_case: username_selector / password_selector
  // / submit_selector). The injected bootstrap may pass either the raw object
  // or the same snake_case shape.
  function normSel(sel) {
    if (!sel || typeof sel !== 'object') return null;
    return {
      username: sel.username_selector || sel.username || null,
      password: sel.password_selector || sel.password || null,
      submit: sel.submit_selector || sel.submit || null,
    };
  }

  function findInRoot(root, ov) {
    var pw = null;
    if (ov && ov.password) {
      // AUTHORITATIVE: a set-but-unmatched override means "no login form in
      // this root" — never fall back to the heuristic (would risk filling a
      // wrong/different field — R4 / spike refinement #2).
      pw = root.querySelector(ov.password);
      if (!pw) return null;
    } else {
      var ps = root.querySelectorAll('input[type=password]');
      for (var i = 0; i < ps.length; i++) {
        if (isVisible(ps[i])) {
          pw = ps[i];
          break;
        }
      }
    }
    if (!pw) return null; // no login form here

    var user = null;
    if (ov && ov.username) {
      // Same authority for the username override: if it's set we use exactly
      // it (may be null if it doesn't match; we still proceed to fill pw).
      user = root.querySelector(ov.username);
    }
    if (!user && !(ov && ov.username)) {
      var form = pw.form || root;
      var all = form.querySelectorAll(
        'input[type=text], input[type=email], input:not([type]), input[type=tel]'
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
    return { user: user, pw: pw, form: pw.form || null };
  }

  // Walk the main document plus SAME-ORIGIN iframes (cross-origin frames are
  // inaccessible — documented R1 limitation).
  function findLoginForm(ov) {
    var hit = findInRoot(document, ov);
    if (hit) return hit;
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      var doc = null;
      try {
        doc = frames[i].contentDocument; // null/throws if cross-origin
      } catch (_) {
        doc = null;
      }
      if (doc) {
        var fhit = findInRoot(doc, ov);
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

    // An explicit submit override is authoritative when it matches.
    if (ov && ov.submit) {
      var so = (form || document).querySelector(ov.submit) ||
        document.querySelector(ov.submit);
      if (so) {
        so.click();
        return 'override-submit';
      }
    }

    // Scope the search to the login form (or nearest container) — never
    // document-wide (spike takeaway).
    var scope = form || nearestScope(pw, user);
    var btn =
      scope.querySelector('button[type=submit], input[type=submit]') ||
      scope.querySelector('button:not([type])') ||
      scope.querySelector(
        '[role=button][type=submit], button[id*=login i], button[class*=login i], button[id*=signin i]'
      );
    if (btn) {
      btn.click();
      return 'button-click';
    }
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return 'requestSubmit';
      }
      var ev = new Event('submit', { bubbles: true, cancelable: true });
      var notCancelled = form.dispatchEvent(ev);
      if (notCancelled) form.submit();
      return 'form.submit';
    }
    // Last resort: Enter in the password field.
    try {
      pw.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })
      );
      pw.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true })
      );
    } catch (_) {}
    return 'enter-key';
  }

  // ------------------------------------------------------------------------
  // 4. ORCHESTRATION — single attempt, observable result, no cred retention
  // ------------------------------------------------------------------------
  function attempt(creds, ov) {
    var target = findLoginForm(ov);
    if (!target || !target.pw) {
      return { ok: false, reason: 'no-form' };
    }
    var userOk = target.user ? fillField(target.user, creds.username) : true;
    var pwOk = fillField(target.pw, creds.password);
    if (!pwOk) {
      // Event-dispatch fill didn't stick — try keystroke fallback once.
      typeField(target.pw, creds.password);
      if (target.user) typeField(target.user, creds.username);
      pwOk = target.pw.value === creds.password;
    }
    var how = submitForm(target, ov);
    return {
      ok: true,
      reason: 'submitted',
      via: how,
      userFilled: userOk,
      pwFilled: pwOk,
    };
  }

  // The form on a device UI may render after DOMContentLoaded (SPA). Retry
  // detection a few times with backoff, then give up. We only ever SUBMIT
  // once — the retries are purely to *find* the form, not to resubmit.
  function bootstrapFill(creds, ov) {
    var tries = 0;
    var MAX = 20; // ~5s with the schedule below
    var submitted = false;
    function tick() {
      if (submitted) return;
      var target = findLoginForm(ov);
      if (target && target.pw) {
        submitted = true;
        var r = attempt(creds, ov);
        report(r);
        return;
      }
      if (++tries >= MAX) {
        report({ ok: false, reason: 'form-not-found-timeout' });
        return;
      }
      setTimeout(tick, Math.min(100 + tries * 50, 400));
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tick);
    } else {
      tick();
    }
  }

  function report(result) {
    // The ONLY signal back to the app — the parent React hook listens for this.
    // It never carries the credential, only the outcome.
    try {
      window.parent.postMessage(
        { type: 'proxy_autologin_result', result: result },
        '*'
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
  var AUTOLOGIN_PATH = '/__sortofremoteng_autologin';

  function fetchCredsAndRun(nonce, selectors) {
    // Client single-shot: never fetch/fill/submit more than once per page.
    if (hasRun) return;
    hasRun = true;

    var injectedOv = normSel(selectors);

    fetch(AUTOLOGIN_PATH + '?nonce=' + encodeURIComponent(nonce), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (r) {
        // Non-200 => do nothing, do NOT retry.
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (data) {
        // Endpoint selectors (from the connection config) are AUTHORITATIVE
        // and override anything templated into the bootstrap.
        var ov = normSel(data && data.selectors) || injectedOv;
        var creds = { username: data.username, password: data.password };
        // Hand the creds to the single fill+submit, then drop our reference so
        // the secret is not retained in module scope.
        try {
          bootstrapFill(creds, ov);
        } finally {
          creds.username = null;
          creds.password = null;
          creds = null;
          data.username = null;
          data.password = null;
        }
      })
      .catch(function (status) {
        report({ ok: false, reason: 'cred-fetch-' + status });
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
  };
})();
