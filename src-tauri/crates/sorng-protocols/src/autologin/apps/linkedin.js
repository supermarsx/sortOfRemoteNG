/* Private LinkedIn adapter, no API login or challenge bypass.
 * Public https://www.linkedin.com/login inspected 2026-10-06: email/username
 * and current-password inputs without a form, with an "Entrar" button and
 * responsive copies. Legacy exact named controls below are synthetic fixtures,
 * NOT a live-verified account login. Unknown layouts/locales fail closed.
 */
function linkedinSelectors(ov) {
  return !!(
    ov &&
    ov.username ===
      'input#username[name="session_key"], input[type="email"][autocomplete="username"]' &&
    ov.password ===
      'input#password[name="session_password"][type="password"], input[type="password"][autocomplete="current-password"]' &&
    ov.submit ===
      'button[type="submit"][data-litms-control-urn="login-submit"], button[type="button"]'
  );
}

function linkedinDisplayed(element) {
  if (!element || !element.isConnected) return false;
  for (var node = element; node; node = node.parentElement) {
    var style = window.getComputedStyle(node);
    if (
      node.hidden ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
  }
  return (
    element.offsetParent !== null ||
    window.getComputedStyle(element).position === "fixed"
  );
}

function linkedinDocument() {
  if (
    !/^\/(login\/?|uas\/login\/?)$/.test(location.pathname) ||
    /challenge|checkpoint|signup|join|reset|recover|oauth|sso/i.test(
      location.search,
    )
  )
    return false;
  if (location.origin === "https://www.linkedin.com") return true;
  // Exact upstream-to-session binding supplied by the existing proxy runtime.
  // Merely having a .localhost address or login-shaped DOM is insufficient.
  if (typeof window.__sorng_map_navigation !== "function") return false;
  try {
    var mapped = new URL(
      window.__sorng_map_navigation("https://www.linkedin.com/login"),
    );
    return (
      mapped.origin === location.origin &&
      mapped.pathname === "/login" &&
      !mapped.username &&
      !mapped.password
    );
  } catch (_) {
    return false;
  }
}

function linkedinTarget(root, ov) {
  if (root !== document || !linkedinSelectors(ov) || !linkedinDocument())
    return null;
  if (new URL(document.baseURI).origin !== location.origin) return null;
  function visible(selector, scope) {
    return Array.from((scope || document).querySelectorAll(selector)).filter(
      linkedinDisplayed,
    );
  }
  var users = visible(ov.username),
    passwords = visible(ov.password);
  if (users.length !== 1 || passwords.length !== 1) return null;
  var user = users[0],
    pw = passwords[0],
    form = pw.form,
    scope = form;
  if (
    !isVisible(user) ||
    !isVisible(pw) ||
    user.matches(":disabled") ||
    pw.matches(":disabled") ||
    user.form !== form ||
    !/^(email|text|tel)$/.test(user.type) ||
    pw.type !== "password"
  )
    return null;
  if (form) {
    // Traditional named POST form only. No default GET or alternate submit URL.
    if (
      user.id !== "username" ||
      user.name !== "session_key" ||
      pw.id !== "password" ||
      pw.name !== "session_password" ||
      form.method.toLowerCase() !== "post" ||
      !form.contains(user) ||
      !form.contains(pw)
    )
      return null;
    var action = new URL(form.getAttribute("action") || "", document.baseURI);
    var base = document.querySelector("base[target]");
    var context =
      form.getAttribute("target") ||
      (base && base.getAttribute("target")) ||
      "";
    if (
      action.origin !== location.origin ||
      action.username ||
      action.password ||
      action.hash ||
      !/^\/(checkpoint\/lg\/login-submit|uas\/login-submit)\/?$/.test(
        action.pathname,
      ) ||
      (context && context.toLowerCase() !== "_self")
    )
      return null;
  } else {
    if (
      user.type !== "email" ||
      user.autocomplete !== "username" ||
      pw.autocomplete !== "current-password"
    )
      return null;
    scope = pw.parentElement;
    while (scope && scope !== document.body && !scope.contains(user))
      scope = scope.parentElement;
    if (!scope || scope === document.body) return null;
    // The reviewed form-less layout places both inputs and the login button in
    // one compact container. Never expand to document-wide button discovery.
  }
  var buttons = visible(
    form
      ? 'button[type="submit"][data-litms-control-urn="login-submit"]'
      : 'button[type="button"]',
    scope,
  ).filter(function (button) {
    return form || /^(sign in|entrar)$/i.test(button.textContent.trim());
  });
  if (buttons.length !== 1) return null;
  var button = buttons[0];
  if (
    button.form !== form ||
    [user, pw, button].some(function (element) {
      return (
        !!element.closest('[aria-busy="true"]') || element.hasAttribute("form")
      );
    }) ||
    [user, pw].some(function (element) {
      return !!element.closest('[aria-disabled="true"]');
    }) ||
    ["formaction", "formmethod", "formtarget"].some(function (key) {
      return button.hasAttribute(key);
    })
  )
    return null;
  // No other credential controls, even hidden duplicates in this active panel.
  if (
    scope.querySelectorAll(ov.username).length !== 1 ||
    scope.querySelectorAll(ov.password).length !== 1 ||
    Array.from(scope.querySelectorAll("input, select, textarea")).some(
      function (field) {
        return (
          field !== user &&
          field !== pw &&
          /password|session_key|username|one.?time|otp|captcha|verification|recovery/i.test(
            [field.name, field.type, field.autocomplete].join(" "),
          )
        );
      },
    ) ||
    visible("input, select, textarea", scope).some(function (field) {
      return (
        field !== user &&
        field !== pw &&
        !/^(hidden|checkbox|radio|button|submit)$/.test(field.type)
      );
    })
  )
    return null;
  if (
    visible(
      '[role="dialog"], [role="alert"], input[autocomplete="one-time-code"], input[autocomplete="new-password"], iframe',
    ).some(function (element) {
      return (
        element.getAttribute("role") !== "alert" || element.textContent.trim()
      );
    })
  )
    return null;
  return {
    user: user,
    pw: pw,
    form: form,
    submit: button,
    linkedin: true,
    linkedinScope: scope,
  };
}

// Non-secret element identity captured before the one-shot credential fetch.
var linkedinPrepared = null;
function linkedinRememberTarget(target) {
  linkedinPrepared = { target: target, fingerprint: targetFingerprint(target) };
}
function linkedinEmpty(target) {
  return !!target && !target.user.value && !target.pw.value;
}

function runLinkedinForm(creds, ov, rawOptions, readinessDeadline) {
  return new Promise(function (resolve) {
    var prepared = linkedinPrepared,
      target = prepared && prepared.target;
    linkedinPrepared = null;
    var options,
      timer,
      lifetime,
      finished = false,
      passwordWritten = false;
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      if (cancelActive === cancel) cancelActive = null;
      if (!result.ok && passwordWritten && target.pw.value === creds.password) {
        try {
          setNativeValue(target.pw, "");
          if (target.pw.isConnected) {
            target.pw.dispatchEvent(new Event("input", { bubbles: true }));
            target.pw.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } catch (_) {}
      }
      creds.username = null;
      creds.password = null;
      creds = null;
      report(result);
      resolve(result);
    }
    function cancel() {
      finish({ ok: false, reason: "cancelled" });
    }
    function fail() {
      finish({ ok: false, reason: "form-changed-or-unsafe" });
    }
    function valid() {
      if (finished || stopped || !target) return false;
      var found = linkedinTarget(document, ov);
      return (
        !!found &&
        found.user === target.user &&
        found.pw === target.pw &&
        found.form === target.form &&
        found.submit === target.submit &&
        found.linkedinScope === target.linkedinScope &&
        targetFingerprint(found) === prepared.fingerprint
      );
    }
    function submit() {
      try {
        if (
          !valid() ||
          target.user.value !== creds.username ||
          target.pw.value !== creds.password
        )
          return fail();
        if (
          target.submit.matches(":disabled") ||
          target.submit.getAttribute("aria-disabled") === "true"
        ) {
          timer = setTimeout(submit, 100);
          return;
        }
        // A click uses the site's own handler; never retry, force native submit,
        // emulate a keystroke or seek another button after rejection.
        target.submit.click();
        finish({
          ok: true,
          reason: "submitted",
          via: "linkedin-button-click",
          userFilled: true,
          pwFilled: true,
        });
      } catch (_) {
        fail();
      }
    }
    function fill() {
      try {
        if (!valid() || !linkedinEmpty(target)) return fail();
        fillField(
          target.user,
          creds.username,
          function () {
            return valid() && linkedinEmpty(target);
          },
          function () {
            return (
              valid() &&
              target.user.value === creds.username &&
              !target.pw.value
            );
          },
        );
        fillField(
          target.pw,
          creds.password,
          function () {
            return (
              valid() &&
              target.user.value === creds.username &&
              !target.pw.value
            );
          },
          function () {
            passwordWritten = target.pw.value === creds.password;
            return (
              valid() && target.user.value === creds.username && passwordWritten
            );
          },
        );
        if (
          !valid() ||
          target.user.value !== creds.username ||
          target.pw.value !== creds.password
        )
          return fail();
        if (!options.submit) return finish({ ok: true, reason: "filled-only" });
        timer = setTimeout(submit, options.submitDelayMs);
      } catch (_) {
        fail();
      }
    }
    try {
      options = normalizeFormOptions(rawOptions);
      if (
        options.fields.length ||
        options.formSelector ||
        !valid() ||
        !linkedinEmpty(target)
      )
        return fail();
      cancelActive = cancel;
      var duration = Math.min(
        options.detectionTimeoutMs,
        readinessDeadline === undefined ? 0 : readinessDeadline - Date.now(),
      );
      if (duration <= 0)
        return finish({ ok: false, reason: "form-not-found-timeout" });
      lifetime = setTimeout(function () {
        finish({ ok: false, reason: "form-not-found-timeout" });
      }, duration);
      timer = setTimeout(fill, options.fillDelayMs);
    } catch (_) {
      fail();
    }
  });
}
