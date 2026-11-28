function synologyButtonReady(button) {
  return !(
    button.matches(".disable,.spin,[aria-disabled=true]") ||
    ("disabled" in button && button.disabled)
  );
}
function synologyTotpTarget(payload, field, button, requireReady) {
  // DSM's Vue 2 mount replaces the served #sds-login-vue placeholder with
  // #sds-login-vue-inst; a mounted root wins over a leftover placeholder.
  var roots = document.querySelectorAll("#sds-login-vue-inst");
  if (!roots.length) roots = document.querySelectorAll("#sds-login-vue");
  var root = roots.length === 1 ? roots[0] : null,
    panel = field.closest(".login-tabs-content-wrapper"),
    container = field.closest("#dsm-otp-fieldset");
  if (
    payload.codeSelector !==
      '#dsm-otp-fieldset input[name="one-time-code"][autocomplete="one-time-code"]' ||
    payload.submitSelector !==
      'div[role="button"][syno-id="otp-panel-next-btn"]' ||
    location.hash !== "#/signin/otp" ||
    !["/", "/webman/index.cgi"].includes(location.pathname) ||
    document.querySelector("base") ||
    roots.length !== 1 ||
    document.querySelectorAll("#dsm-otp-fieldset").length !== 1 ||
    !root ||
    !panel ||
    !root.contains(panel) ||
    !(container instanceof HTMLDivElement) ||
    !(field instanceof HTMLInputElement) ||
    field.type !== "text" ||
    field.form ||
    field.disabled ||
    field.matches(":disabled") ||
    field.readOnly ||
    !visible(field) ||
    !(button instanceof HTMLElement) ||
    !visible(button) ||
    button.closest(".login-tabs-content-wrapper") !== panel ||
    (requireReady && !synologyButtonReady(button)) ||
    [
      "action",
      "method",
      "target",
      "formaction",
      "formmethod",
      "formtarget",
      "onclick",
    ].some(function (key) {
      return container.hasAttribute(key) || button.hasAttribute(key);
    }) ||
    Array.prototype.some.call(
      root.querySelectorAll(
        'input[type="password"], input[name*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i]',
      ),
      visible,
    )
  )
    throw new Error("challenge");
  return {
    field: field,
    button: button,
    form: container,
    root: root,
    panel: panel,
    fingerprint: JSON.stringify([
      location.href,
      document.baseURI,
      panel.id,
      payload.submission,
    ]),
  };
}
// Conservative semantic contract, not a captured/live-verified dashboard DOM.
// A generic one-time-code input can also be Cloudflare email MFA.
function cloudflareVisible(element) {
  if (!visible(element)) return false;
  for (var node = element; node; node = node.parentElement) {
    var style = getComputedStyle(node);
    if (
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false;
  }
  return true;
}
function cloudflareText(element) {
  // Exclude hidden copy and alternative-method links/buttons, including when
  // nested in a label/heading. Never read input values or the whole page.
  if (
    !cloudflareVisible(element) ||
    element.matches(
      'a, [role="link"], button:not([type="submit"]), [role="button"], input, select, textarea, script, style, template',
    )
  )
    return "";
  return Array.prototype.map
    .call(element.childNodes, function (node) {
      return node.nodeType === 3
        ? node.textContent
        : node.nodeType === 1
          ? cloudflareText(node)
          : "";
    })
    .join(" ");
}
function cloudflareButtonReady(button) {
  return !button.matches(":disabled,[aria-disabled=true],[aria-busy=true]");
}
function cloudflareTotpTarget(payload, field, button, requireReady) {
  var form = field.form;
  if (
    payload.codeSelector !== 'form input[autocomplete="one-time-code"]' ||
    payload.submitSelector !==
      'form:has(input[autocomplete="one-time-code"]) button[type="submit"]' ||
    !["/login", "/login/"].includes(location.pathname) ||
    document.querySelector("base") ||
    !(field instanceof HTMLInputElement) ||
    !["text", "tel", "number"].includes(field.type) ||
    field.ownerDocument !== document ||
    field.matches(":disabled,[aria-disabled=true]") ||
    field.readOnly ||
    !(form instanceof HTMLFormElement) ||
    !form.isConnected ||
    form.ownerDocument !== document ||
    field.closest("form") !== form ||
    !(button instanceof HTMLButtonElement) ||
    button.type !== "submit" ||
    button.form !== form ||
    button.closest("form") !== form ||
    button.ownerDocument !== document ||
    !cloudflareVisible(field) ||
    !cloudflareVisible(button) ||
    (requireReady && !cloudflareButtonReady(button)) ||
    ["target", "formaction", "formmethod", "formtarget"].some(function (key) {
      return (
        form.hasAttribute(key) ||
        button.hasAttribute(key) ||
        field.hasAttribute(key)
      );
    })
  )
    throw new Error("challenge");
  var spa = !form.hasAttribute("action") && !form.hasAttribute("method"),
    action = form.getAttribute("action"),
    method = form.getAttribute("method"),
    destination = new URL(action || location.href, document.baseURI);
  if (
    (!spa && (!action || !method || method.toLowerCase() !== "post")) ||
    destination.origin !== location.origin ||
    destination.username ||
    destination.password ||
    !["/login", "/login/"].includes(destination.pathname)
  )
    throw new Error("challenge");
  var context = [];
  Array.prototype.forEach.call(field.labels || [], function (label) {
    if (label.closest("form") === form) context.push(cloudflareText(label));
  });
  context.push(field.getAttribute("aria-label") || "");
  ["aria-labelledby", "aria-describedby"].forEach(function (key) {
    (field.getAttribute(key) || "").split(/\s+/).forEach(function (id) {
      var label = id && document.getElementById(id);
      if (label && label.closest("form") === form)
        context.push(cloudflareText(label));
    });
  });
  Array.prototype.forEach.call(
    form.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend'),
    function (heading) {
      context.push(cloudflareText(heading));
    },
  );
  var positive = context.join(" ").replace(/\s+/g, " ").trim(),
    negative = (
      positive +
      " " +
      cloudflareText(form) +
      " " +
      field.name +
      " " +
      field.id
    )
      .replace(/[_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (
    !/\b(?:authenticator app(?:lication)?|(?:google|microsoft) authenticator|totp|time[- ]based one[- ]time password)\b/i.test(
      positive,
    ) ||
    /\b(?:e[- ]?mail|sms|text message|recovery|backup|back up|enroll\w*|set\s*up|setup|enabl\w*|activat\w*|register\w*|(?:re)?configur\w*|scan|qr|secret key|security key|passkey|password|captcha|turnstile)\b/i.test(
      negative.replace(/\btime[- ]based one[- ]time password\b/gi, "TOTP"),
    ) ||
    Array.prototype.some.call(form.elements, function (control) {
      return (
        control instanceof HTMLInputElement &&
        control.type === "password" &&
        cloudflareVisible(control)
      );
    }) ||
    Array.prototype.some.call(
      form.querySelectorAll(
        'input[type="email"],input[name*="captcha" i],[class*="captcha" i],[class*="turnstile" i],iframe',
      ),
      cloudflareVisible,
    )
  )
    throw new Error("challenge");
  return {
    field: field,
    button: button,
    form: form,
    spa: spa,
    fingerprint: JSON.stringify([
      location.href,
      document.baseURI,
      payload.submission,
      action,
      method,
      positive,
      negative,
      [form, field, button].map(function (control) {
        return [
          "id",
          "name",
          "type",
          "form",
          "autocomplete",
          "aria-label",
          "aria-labelledby",
          "aria-describedby",
        ].map(function (key) {
          return control.getAttribute(key);
        });
      }),
    ]),
  };
}
function porkbunTotpTarget(payload, field, button) {
  // Reviewed public /account/login DOM and skaboink.js: the app-code input
  // remains in loginForm, but the AJAX Login button is outside that form.
  // Never native-submit its /blank iframe action or fill email/recovery codes.
  var root = document.getElementById("accountLoginContainer");
  var form = field.form;
  var panel = field.closest("#twoFactorLoginContainer");
  var user =
    form && form.querySelector('input#loginUsername[name="loginUsername"]');
  var password =
    form &&
    form.querySelector(
      'input#loginPassword[name="loginPassword"][type="password"]',
    );
  var action = new URL(
    form ? form.getAttribute("action") || "" : "",
    document.baseURI,
  );
  if (
    payload.codeSelector !==
      'form#loginForm #twoFactorLoginContainer input#twoFactorLoginCode[autocomplete="one-time-code"]' ||
    payload.submitSelector !==
      "#accountLoginButtonContainer button#accountLoginButton" ||
    location.pathname !== "/account/login" ||
    !root ||
    !root.isConnected ||
    document.querySelectorAll("#accountLoginContainer").length !== 1 ||
    !(form instanceof HTMLFormElement) ||
    form.id !== "loginForm" ||
    document.querySelectorAll("#loginForm").length !== 1 ||
    !root.contains(form) ||
    !root.contains(button) ||
    !panel ||
    !form.contains(panel) ||
    !visible(panel) ||
    !(field instanceof HTMLInputElement) ||
    field.type !== "text" ||
    field.disabled ||
    field.readOnly ||
    field.matches(":disabled") ||
    !visible(field) ||
    !(button instanceof HTMLButtonElement) ||
    button.form !== null ||
    button.disabled ||
    button.matches(":disabled,[aria-disabled=true]") ||
    !visible(button) ||
    !button.closest("#accountLoginButtonContainer") ||
    button.getAttribute("onclick")?.trim() !== "logInExec();" ||
    typeof button.onclick !== "function" ||
    typeof window.logInExec !== "function" ||
    typeof window.logIn !== "function" ||
    button.hasAttribute("formaction") ||
    button.hasAttribute("formtarget") ||
    button.hasAttribute("formmethod") ||
    button.hasAttribute("form") ||
    form.method.toLowerCase() !== "post" ||
    form.target !== "lame_login_iframe" ||
    action.origin !== location.origin ||
    action.pathname !== "/blank" ||
    action.username ||
    action.password ||
    !user ||
    !password ||
    !user.value ||
    !password.value ||
    user.form !== form ||
    password.form !== form ||
    Array.prototype.some.call(
      document.querySelectorAll(
        '#twoFactorLoginContainerEmail, #twoFactorLoginContainerEmailNoCookie, #noCookieSmsContainer, #modal_forceCcaptcha, #modal_bypassTwoFactor, input[id^="bypassTwoFactor"], input#twoFactorLoginCode2',
      ),
      visible,
    )
  )
    throw new Error("challenge");
  return {
    field: field,
    button: button,
    form: form,
    root: root,
    panel: panel,
    handlers: [button.onclick, window.logInExec, window.logIn],
    // Private, short-lived challenge state only. Pin the account that the
    // site's handler will re-send; never include this fingerprint in reports.
    fingerprint: JSON.stringify([
      location.href,
      document.baseURI,
      action.href,
      form.target,
      button.getAttribute("onclick"),
      user.value,
      password.value,
    ]),
  };
}
function sameTotpHandlers(target, original) {
  return original.handlers
    ? !!target.handlers &&
        original.handlers.every(function (handler, index) {
          return target.handlers[index] === handler;
        })
    : !target.handlers;
}
function totpTarget(payload, requireReady) {
  if (
    !payload ||
    typeof payload.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(payload.nonce) ||
    !["post", "spa", "synology", "google", "cloudflare", "porkbun"].includes(
      payload.submission,
    )
  )
    throw new Error("challenge");
  var selectors = [payload.codeSelector, payload.submitSelector];
  if (
    selectors.some(function (selector) {
      return (
        typeof selector !== "string" ||
        !selector.length ||
        selector.length > 512
      );
    })
  )
    throw new Error("challenge");
  var fields = document.querySelectorAll(payload.codeSelector),
    buttons = document.querySelectorAll(payload.submitSelector);
  if (payload.submission === "cloudflare") {
    fields = Array.prototype.filter.call(fields, cloudflareVisible);
    buttons = Array.prototype.filter.call(buttons, cloudflareVisible);
  }
  if (fields.length !== 1 || buttons.length !== 1) throw new Error("challenge");
  var field = fields[0],
    button = buttons[0],
    form = field.form;
  if (payload.submission === "porkbun")
    return porkbunTotpTarget(payload, field, button);
  if (payload.submission === "synology")
    return synologyTotpTarget(payload, field, button, requireReady !== false);
  if (payload.submission === "cloudflare")
    return cloudflareTotpTarget(payload, field, button, requireReady !== false);
  if (payload.submission === "google") {
    if (
      payload.codeSelector !==
        'input#totpPin[name="totpPin"][autocomplete="one-time-code"]' ||
      payload.submitSelector !==
        '#totpNext button[type="button"], button#totpNext[type="button"]' ||
      ![
        "/v3/signin/challenge/totp",
        "/signin/v2/challenge/totp",
        "/signin/challenge/totp",
      ].includes(location.pathname) ||
      !(field instanceof HTMLInputElement) ||
      !["text", "tel", "number"].includes(field.type) ||
      !(button instanceof HTMLButtonElement) ||
      field.disabled ||
      field.readOnly ||
      button.disabled ||
      !visible(field) ||
      !visible(button) ||
      Array.prototype.some.call(
        document.querySelectorAll(
          'input[type="password"], input[name*="captcha" i], iframe[src*="recaptcha" i], input[name*="recovery" i]',
        ),
        visible,
      )
    )
      throw new Error("challenge");
    var googleRoot = field.closest("form") || field.parentElement;
    if (!googleRoot || !googleRoot.isConnected || !googleRoot.contains(button))
      throw new Error("challenge");
    return {
      field: field,
      button: button,
      form: googleRoot,
      fingerprint: JSON.stringify([
        location.href,
        document.baseURI,
        payload.submission,
      ]),
    };
  }
  if (
    !(field instanceof HTMLInputElement) ||
    !["text", "tel", "number"].includes(field.type) ||
    field.ownerDocument !== document ||
    field.disabled ||
    field.matches(":disabled") ||
    field.readOnly ||
    !visible(field) ||
    !(form instanceof HTMLFormElement) ||
    !form.isConnected ||
    form.ownerDocument !== document ||
    !(
      (button instanceof HTMLButtonElement ||
        button instanceof HTMLInputElement) &&
      button.type === "submit"
    ) ||
    button.form !== form ||
    button.disabled ||
    button.matches(":disabled") ||
    !visible(button) ||
    button.ownerDocument !== document ||
    Array.prototype.some.call(form.elements, function (control) {
      return control instanceof HTMLInputElement && control.type === "password";
    })
  )
    throw new Error("challenge");
  if (
    (form.target && form.target !== "_self") ||
    (button.formTarget && button.formTarget !== "_self")
  )
    throw new Error("challenge");
  var action =
    button.getAttribute("formaction") || form.getAttribute("action") || "";
  var method = (
    button.getAttribute("formmethod") ||
    form.getAttribute("method") ||
    "get"
  ).toLowerCase();
  if (payload.submission === "spa") {
    // Reviewed SPA handlers receive submit, but native navigation is prevented.
    if (
      action ||
      button.hasAttribute("formaction") ||
      button.hasAttribute("formmethod") ||
      form.hasAttribute("method")
    )
      throw new Error("challenge");
  } else if (method !== "post") throw new Error("challenge");
  var target = new URL(action || location.href, document.baseURI);
  if (target.origin !== location.origin || target.username || target.password)
    throw new Error("challenge");
  return {
    field: field,
    button: button,
    form: form,
    fingerprint: JSON.stringify([
      target.href,
      method,
      form.target,
      button.formTarget,
      payload.submission,
    ]),
  };
}
