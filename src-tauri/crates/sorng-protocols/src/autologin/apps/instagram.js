/* Private ordinary Instagram form adapter; no private API or alternate flow.
 * The public fetch returned a React shell without rendered form inputs (the
 * web-tool fetch returned HTTP 429). Selectors are the explicit profile
 * contract, not a claimed snapshot of Instagram's hydrated DOM.
 */
function instagramSelectors(ov) {
  return !!(
    ov &&
    ov.username === 'form input[name="username"]' &&
    ov.password === 'form input[name="password"][type="password"]' &&
    ov.submit === 'form button[type="submit"]'
  );
}

function instagramDisplayed(element) {
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

function instagramDocument() {
  if (location.pathname !== "/accounts/login/") return false;
  if (
    /challenge|checkpoint|two_factor|recovery|signup|oauth|sso/i.test(
      location.search,
    )
  )
    return false;
  var source = "https://www.instagram.com/accounts/login/";
  if (location.origin === "https://www.instagram.com") return true;
  if (typeof window.__sorng_map_navigation !== "function") return false;
  try {
    var mapped = new URL(window.__sorng_map_navigation(source));
    return (
      mapped.origin === location.origin &&
      mapped.pathname === "/accounts/login/"
    );
  } catch (_) {
    return false;
  }
}

function instagramTarget(root, ov, user, pw) {
  if (!instagramSelectors(ov) || root !== document || !instagramDocument())
    return null;
  var users = document.querySelectorAll(ov.username);
  var passwords = document.querySelectorAll(ov.password);
  var buttons = document.querySelectorAll(ov.submit);
  var form = pw && pw.form;
  var button = buttons.length === 1 && buttons[0];
  if (
    !user ||
    !pw ||
    !form ||
    users.length !== 1 ||
    passwords.length !== 1 ||
    !button ||
    user.form !== form ||
    button.form !== form ||
    !form.contains(user) ||
    !form.contains(pw) ||
    !form.contains(button) ||
    !instagramDisplayed(user) ||
    !instagramDisplayed(pw) ||
    !instagramDisplayed(button) ||
    !isVisible(user) ||
    !isVisible(pw) ||
    [user, pw].some(function (field) {
      return field.matches(":disabled") || field.readOnly;
    }) ||
    [user, pw, button].some(function (element) {
      return !!element.closest('[aria-busy="true"]');
    }) ||
    [user, pw].some(function (element) {
      return !!element.closest('[aria-disabled="true"]');
    }) ||
    ["formaction", "formmethod", "formtarget", "form"].some(function (name) {
      return button.hasAttribute(name);
    })
  )
    return null;
  var action = new URL(
    form.getAttribute("action") || location.href,
    document.baseURI,
  );
  var base = document.querySelector("base[target]");
  var context =
    form.getAttribute("target") ?? (base && base.getAttribute("target")) ?? "";
  if (
    action.origin !== location.origin ||
    action.username ||
    action.password ||
    action.hash ||
    action.pathname !== "/accounts/login/" ||
    (context && context.toLowerCase() !== "_self") ||
    (form.hasAttribute("method") &&
      form.getAttribute("method").toLowerCase() !== "post")
  )
    return null;
  // Hidden site tokens are left untouched. Extra credential fields (including
  // hidden duplicates), visible entry controls, challenges and errors stop us.
  if (
    Array.from(form.elements).some(function (element) {
      if (element === user || element === pw || element === button)
        return false;
      if (
        /username|password|otp|one.?time|verification|captcha|challenge|recovery/i.test(
          [element.name, element.type, element.autocomplete].join(" "),
        )
      )
        return true;
      return (
        instagramDisplayed(element) &&
        /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName) &&
        !/^(hidden|checkbox|radio|button|submit)$/.test(element.type)
      );
    })
  )
    return null;
  if (
    Array.from(
      document.querySelectorAll(
        '[role="dialog"], [role="alert"], input[autocomplete="one-time-code"], input[autocomplete="new-password"], iframe',
      ),
    ).some(function (element) {
      return (
        instagramDisplayed(element) &&
        (element.getAttribute("role") !== "alert" || element.textContent.trim())
      );
    })
  )
    return null;
  return { user: user, pw: pw, form: form, submit: button, instagram: true };
}

function instagramEmpty(target) {
  return !!target && !target.user.value && !target.pw.value;
}

function runInstagramForm(creds, ov, rawOptions, readinessDeadline) {
  // Only this run owns credentials; app discovery/readiness keeps no secrets.
  return new Promise(function (resolve) {
    var timer = null,
      lifetime = null,
      finished = false,
      passwordWritten = false,
      target,
      fingerprint,
      options;
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      if (cancelActive === cancel) cancelActive = null;
      // Clear only this run's unchanged insertion on its original field.
      // Never wipe user edits or a replacement control during SPA rerenders.
      if (
        !result.ok &&
        passwordWritten &&
        target &&
        target.pw.value === creds.password
      ) {
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
      if (options)
        options.fields.forEach(function (field) {
          field.value = "";
        });
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
      if (finished || stopped) return false;
      var found = findLoginForm(ov, options);
      return (
        !!found &&
        found.user === target.user &&
        found.pw === target.pw &&
        found.form === target.form &&
        found.submit === target.submit &&
        targetFingerprint(found) === fingerprint &&
        found.form.getAttribute("target") === target.context
      );
    }
    function submitWhenReady() {
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
          timer = setTimeout(submitWhenReady, 100);
          return;
        }
        // Commit the one attempt before calling any website handler. No retry,
        // native form.submit, requestSubmit or simulated keyboard fallback.
        var via = guardedSubmit(target, ov);
        finish({
          ok: true,
          reason: "submitted",
          via: via,
          userFilled: true,
          pwFilled: true,
        });
      } catch (_) {
        fail();
      }
    }
    function fill() {
      try {
        if (!valid() || !instagramEmpty(target)) return fail();
        fillField(target.user, creds.username, valid);
        fillField(target.pw, creds.password, valid, function () {
          passwordWritten = target.pw.value === creds.password;
          return valid();
        });
        if (
          !valid() ||
          target.user.value !== creds.username ||
          target.pw.value !== creds.password
        )
          return fail();
        if (!options.submit) return finish({ ok: true, reason: "filled-only" });
        timer = setTimeout(submitWhenReady, options.submitDelayMs);
      } catch (_) {
        fail();
      }
    }
    try {
      options = normalizeFormOptions(rawOptions);
      if (options.fields.length) throw new Error("invalid-extra-field");
      target = findLoginForm(ov, options);
      if (!target || !target.instagram || !instagramEmpty(target))
        return fail();
      fingerprint = targetFingerprint(target);
      target.context = target.form.getAttribute("target");
      cancelActive = cancel;
      if (stopped) return cancel();
      var duration = Math.min(
        options.detectionTimeoutMs,
        readinessDeadline === undefined
          ? options.detectionTimeoutMs
          : readinessDeadline - Date.now(),
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
