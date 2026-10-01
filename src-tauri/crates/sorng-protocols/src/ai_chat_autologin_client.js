/* Shared semantic DOM mechanics only. Provider clients own stages and secrets.
 * Fixtures model an explicit contract, not captured hydrated provider markup. */
(function () {
  "use strict";
  if (window.__sorng_ai_chat_form) return;
  function painted(node) {
    if (
      !(node instanceof HTMLElement) ||
      !node.isConnected ||
      !node.getClientRects().length
    )
      return false;
    for (var parent = node; parent; parent = parent.parentElement) {
      var style = getComputedStyle(parent);
      if (
        parent.hidden ||
        parent.hasAttribute("inert") ||
        parent.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      )
        return false;
    }
    return true;
  }
  function at(origin, paths) {
    if (!paths.includes(location.pathname) || location.hash) return false;
    if (new URL(location.href).searchParams.has("error")) return false;
    if (location.origin === origin) return true;
    if (typeof window.__sorng_map_navigation !== "function") return false;
    try {
      var mapped = new URL(
        window.__sorng_map_navigation(origin + location.pathname),
      );
      return (
        mapped.origin === location.origin &&
        mapped.pathname === location.pathname
      );
    } catch (_) {
      return false;
    }
  }
  function blocked() {
    return Array.from(
      document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[autocomplete="new-password"], input[type="file"], ' +
          'input[name*="captcha" i], input[name*="otp" i], input[name*="verification" i], ' +
          'input[name*="recovery" i], iframe, [role="dialog"], [role="alert"], [aria-invalid="true"]',
      ),
    ).some(function (node) {
      return (
        painted(node) &&
        (node.getAttribute("role") !== "alert" || !!node.textContent.trim())
      );
    });
  }
  function locate(stage, expectedEmail, allowUnverifiedIdentity) {
    if (blocked()) return null;
    var fields = Array.from(
      document.querySelectorAll(
        stage === "email" ? 'input[type="email"]' : 'input[type="password"]',
      ),
    ).filter(painted);
    if (fields.length !== 1) return null;
    var field = fields[0],
      form = field.form;
    if (
      !form ||
      !form.contains(field) ||
      !painted(form) ||
      field.readOnly ||
      field.matches(":disabled") ||
      field.closest('[aria-busy="true"], [aria-disabled="true"]')
    )
      return null;
    if (
      field.autocomplete &&
      !(stage === "email" ? /^(email|username)$/i : /^current-password$/i).test(
        field.autocomplete,
      )
    )
      return null;
    if (
      /signup|register|reset|recovery|confirm|new.?password|otp|verification/i.test(
        field.name,
      )
    )
      return null;
    var buttons = Array.from(form.elements).filter(function (element) {
      return element.tagName === "BUTTON" && element.type === "submit";
    });
    if (buttons.length !== 1) return null;
    var button = buttons[0];
    // A unique submit control can still be signup/recovery/federation. Its
    // semantic label/value must not turn an email grant into those actions.
    if (
      /\b(sign\s*up|create\s+(?:an?\s+)?account|register|reset|recover|forgot|google|apple|microsoft|sso|passkey|security\s*key)\b/i.test(
        [
          button.textContent,
          button.getAttribute("aria-label"),
          button.name,
          button.value,
        ].join(" "),
      )
    )
      return null;
    if (
      !form.contains(button) ||
      !painted(button) ||
      button.closest('[aria-busy="true"]') ||
      ["formaction", "formmethod", "formtarget", "formenctype", "form"].some(
        function (name) {
          return button.hasAttribute(name);
        },
      )
    )
      return null;
    var identity = null;
    var unsafe = Array.from(form.elements).some(function (element) {
      if (element === field || element === button) return false;
      if (field.name && element.name === field.name) return true;
      if (
        stage === "password" &&
        element.tagName === "INPUT" &&
        (element.type === "email" ||
          element.autocomplete === "username" ||
          /^(email|username)$/i.test(element.name))
      ) {
        if (
          identity ||
          !element.value ||
          (!expectedEmail && !allowUnverifiedIdentity) ||
          (expectedEmail && element.value !== expectedEmail) ||
          (painted(element) && !element.readOnly && !element.disabled)
        )
          return true;
        identity = element;
        return false;
      }
      return (
        painted(element) &&
        !element.disabled &&
        !element.readOnly &&
        (element.isContentEditable ||
          /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) &&
        !/^(hidden|button|submit)$/.test(element.type)
      );
    });
    if (
      unsafe ||
      Array.from(form.querySelectorAll('[contenteditable="true"]')).some(
        painted,
      )
    )
      return null;
    var action = new URL(
      form.getAttribute("action") || location.href,
      document.baseURI,
    );
    var method = form.getAttribute("method");
    var base = document.querySelector("base[target]");
    var context =
      form.getAttribute("target") ??
      (base && base.getAttribute("target")) ??
      "";
    if (
      action.origin !== location.origin ||
      action.username ||
      action.password ||
      action.hash ||
      action.pathname !== location.pathname ||
      /(?:[?&])(?:screen_hint|action|mode|flow)=(?:signup|register|reset|recovery)(?:&|$)/i.test(
        action.search,
      ) ||
      (method !== null && method.toLowerCase() !== "post") ||
      (context && context.toLowerCase() !== "_self")
    )
      return null;
    return {
      stage: stage,
      form: form,
      field: field,
      button: button,
      identity: identity,
      fingerprint: JSON.stringify([
        location.href,
        document.baseURI,
        form.getAttribute("action"),
        method,
        context,
        form.enctype,
        field.name,
        field.type,
        field.autocomplete,
        identity && identity.value,
      ]),
    };
  }
  function same(left, right) {
    return (
      !!left &&
      !!right &&
      left.form === right.form &&
      left.field === right.field &&
      left.button === right.button &&
      left.identity === right.identity &&
      left.fingerprint === right.fingerprint
    );
  }
  function ready(target) {
    return (
      !target.button.matches(":disabled") &&
      !target.button.closest('[aria-disabled="true"], [aria-busy="true"]') &&
      target.field.checkValidity()
    );
  }
  function click(target) {
    function prevent(event) {
      event.preventDefault();
    }
    target.form.addEventListener("submit", prevent, true);
    try {
      target.button.click();
    } finally {
      target.form.removeEventListener("submit", prevent, true);
    }
  }
  function read(token, password, signal) {
    return fetch(
      "/__sortofremoteng_autologin?" +
        (password ? "phase=password&" : "") +
        "nonce=" +
        encodeURIComponent(token),
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: signal,
      },
    ).then(function (response) {
      if (!response.ok) throw new Error("grant");
      return response.json();
    });
  }
  function clearOwned(field, value) {
    if (!field || field.value !== value) return;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(field, "");
    if (field.isConnected) {
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  window.__sorng_ai_chat_form = Object.freeze({
    at: at,
    blocked: blocked,
    locate: locate,
    same: same,
    ready: ready,
    click: click,
    read: read,
    clearOwned: clearOwned,
  });
})();
