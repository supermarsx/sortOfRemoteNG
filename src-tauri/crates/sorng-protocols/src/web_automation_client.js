/* Page-only website automation. Called inside the early reporter's private
 * closure with its document identity. No Tauri/native/storage bridge exists.
 * A page can execute its own JS already; these identity labels are freshness
 * fences, not authorization. The trusted parent separately arms each operation.
 */
(function installWebsiteAutomation(identity, cleanUrl) {
  "use strict";
  var parentWindow = window.parent;
  if (parentWindow === window) return;
  var nativePrint = window.print;
  var nativeFocus = window.focus;
  var selectorPattern =
    /^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$/;
  var recording = null,
    stepNumber = 0,
    darkMode = null;
  var closed = false;
  var credentialFocus = null;
  var credentialWatch = null,
    focusRevision = 0,
    focusToken = null,
    focusedControl = null;
  function reportCredentialFocus() {
    ++focusRevision;
    focusedControl = credentialControl(document.activeElement)
      ? document.activeElement
      : null;
    focusToken = focusedControl
      ? Array.from(crypto.getRandomValues(new Uint8Array(16)), function (byte) {
          return byte.toString(16).padStart(2, "0");
        }).join("")
      : null;
    if (credentialWatch)
      reply(
        credentialWatch.request,
        credentialWatch.origin,
        "credentialFocusState",
        {
          focusRevision: focusRevision,
          focusToken: focusToken,
        },
      );
  }
  function credentialControl(field) {
    return (
      (field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement) &&
      (!(field instanceof HTMLInputElement) ||
        /^(text|password|email|search|tel|url|number)$/.test(field.type)) &&
      field.isConnected &&
      field.ownerDocument === document &&
      !field.disabled &&
      !field.readOnly &&
      !field.matches(":disabled,[aria-disabled=true]") &&
      !field.closest("[inert]") &&
      visible(field)
    );
  }
  function clearCredentialFocus() {
    credentialFocus = null;
  }
  document.addEventListener(
    "focusin",
    function (event) {
      if (credentialFocus && event.target !== credentialFocus.field)
        clearCredentialFocus();
      reportCredentialFocus();
    },
    true,
  );
  window.addEventListener("hashchange", clearCredentialFocus);
  window.addEventListener("popstate", clearCredentialFocus);
  function captureCredential(payload, origin) {
    credentialFocus = null;
    var field = document.activeElement;
    if (
      !payload ||
      !/^[0-9a-f]{32}$/.test(payload.nonce) ||
      !credentialWatch ||
      credentialWatch.origin !== origin ||
      payload.focusRevision !== focusRevision ||
      payload.focusToken !== focusToken ||
      !focusToken ||
      field !== focusedControl ||
      !credentialControl(field)
    )
      throw new Error("focus");
    credentialFocus = {
      field: field,
      nonce: payload.nonce,
      origin: origin,
      href: location.href,
      base: document.baseURI,
      type: field.type,
      form: field.form,
      start: field.selectionStart,
      end: field.selectionEnd,
    };
  }
  function typeCredential(payload, origin) {
    var target = credentialFocus;
    if (
      !target ||
      !payload ||
      payload.nonce !== target.nonce ||
      origin !== target.origin ||
      typeof payload.value !== "string" ||
      !payload.value.length ||
      payload.value.length > 1024 ||
      /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(payload.value) ||
      location.href !== target.href ||
      document.baseURI !== target.base ||
      document.activeElement !== target.field ||
      !credentialControl(target.field) ||
      target.field.type !== target.type ||
      target.field.form !== target.form ||
      target.field.selectionStart !== target.start ||
      target.field.selectionEnd !== target.end
    )
      throw new Error("focus");
    // Number controls are eligible only for a current generated TOTP code.
    // Username/password actions carry no validity window, even when all digits.
    if (target.type === "number" && !payload.validity)
      throw new Error("code required");
    if (
      payload.validity &&
      (!Number.isFinite(payload.validity.starts) ||
        !Number.isFinite(payload.validity.expires) ||
        Date.now() < payload.validity.starts ||
        Date.now() >= payload.validity.expires ||
        !/^\d{6,8}$/.test(payload.value))
    )
      throw new Error("expired");
    var field = target.field;
    // Insert at the captured selection, exactly once. Never click, submit, or
    // synthesize Enter. Clear the lease before page event handlers execute.
    credentialFocus = null;
    var start = target.start == null ? field.value.length : target.start;
    var end = target.end == null ? start : target.end;
    // Numeric controls expose no selection API: replace the complete OTP value.
    var value =
      target.type === "number"
        ? payload.value
        : field.value.slice(0, start) + payload.value + field.value.slice(end);
    if (field.maxLength >= 0 && value.length > field.maxLength)
      throw new Error("length");
    var proto =
      field instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    if (target.start != null)
      field.setSelectionRange(
        start + payload.value.length,
        start + payload.value.length,
      );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  var totpChallenge = null,
    totpSubmitted = false,
    totpRevision = 0,
    totpPendingField = null,
    totpPendingCode = null;
  // DSM's reviewed desktop OTP panel is deliberately not a form. Keep this
  // fixed contract separate from generic POST/SPA form validation.
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
  function totpTarget(payload, requireReady) {
    if (
      !payload ||
      typeof payload.nonce !== "string" ||
      !/^[0-9a-f]{32}$/.test(payload.nonce) ||
      !["post", "spa", "synology", "google", "cloudflare"].includes(
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
    if (fields.length !== 1 || buttons.length !== 1)
      throw new Error("challenge");
    var field = fields[0],
      button = buttons[0],
      form = field.form;
    if (payload.submission === "synology")
      return synologyTotpTarget(payload, field, button, requireReady !== false);
    if (payload.submission === "cloudflare")
      return cloudflareTotpTarget(
        payload,
        field,
        button,
        requireReady !== false,
      );
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
      if (
        !googleRoot ||
        !googleRoot.isConnected ||
        !googleRoot.contains(button)
      )
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
        return (
          control instanceof HTMLInputElement && control.type === "password"
        );
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
  function probeTotp(payload) {
    var revision = ++totpRevision;
    totpChallenge = null;
    if (totpSubmitted) throw new Error("challenge");
    // DSM keeps its Vue Next control disabled until the input event updates
    // component state. The empty challenge is still valid and safe to arm.
    var target = totpTarget(payload, false);
    if (target.field.value) throw new Error("challenge");
    totpChallenge = {
      payload: payload,
      target: target,
      expires: Date.now() + 15000,
      revision: revision,
    };
  }
  function submitTotp(payload) {
    var challenge = totpChallenge;
    totpChallenge = null;
    if (
      totpSubmitted ||
      !challenge ||
      challenge.revision !== totpRevision ||
      !payload ||
      payload.nonce !== challenge.payload.nonce ||
      typeof payload.code !== "string" ||
      !/^[0-9]{6,8}$/.test(payload.code) ||
      Date.now() >= challenge.expires ||
      !Number.isFinite(payload.expires) ||
      Date.now() >= payload.expires ||
      payload.expires > Date.now() + 3600000
    )
      throw new Error("challenge");
    var operation = ++totpRevision;
    var target = totpTarget(challenge.payload, false),
      original = challenge.target;
    if (
      target.field !== original.field ||
      target.button !== original.button ||
      target.form !== original.form ||
      target.root !== original.root ||
      target.panel !== original.panel ||
      target.fingerprint !== original.fingerprint ||
      target.field.value
    )
      throw new Error("challenge");
    var setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setValue.call(target.field, payload.code);
    target.field.dispatchEvent(new Event("input", { bubbles: true }));
    target.field.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      var checked = totpTarget(challenge.payload, false);
      if (
        checked.field !== original.field ||
        checked.button !== original.button ||
        checked.form !== original.form ||
        checked.root !== original.root ||
        checked.panel !== original.panel ||
        checked.fingerprint !== original.fingerprint ||
        checked.field.value !== payload.code ||
        Date.now() >= payload.expires
      )
        throw new Error("challenge");
    } catch (_) {
      if (target.field.value === payload.code) setValue.call(target.field, "");
      throw new Error("challenge");
    }
    totpSubmitted = true; // Consumed before clicking, including uncertain outcomes.
    function clickSubmit(checked) {
      // Install only when we actually click: a cancelled settling task must
      // not leave a handler behind on the user's next manual submission.
      if (challenge.payload.submission === "spa" || checked.spa)
        checked.form.addEventListener(
          "submit",
          function (event) {
            event.preventDefault();
          },
          { capture: true, once: true },
        );
      checked.button.click();
    }
    if (
      challenge.payload.submission === "spa" ||
      challenge.payload.submission === "cloudflare" ||
      (challenge.payload.submission === "synology" &&
        !synologyButtonReady(target.button))
    ) {
      totpPendingField = target.field;
      totpPendingCode = payload.code;
      // Vue/Quasar commits model props on the next render tick. Submitting in
      // the input event's turn can validate the old empty model ("required")
      // despite the DOM containing a code. Yield once before SPA submission.
      // DSM may also need its enabled state to commit. Revalidate
      // the exact captured field/button/panel while waiting; never click a
      // replacement or carry the code into another challenge.
      return new Promise(function (resolve, reject) {
        var deadline = Math.min(
          challenge.expires,
          payload.expires,
          Date.now() + 3000,
        );
        function clearAndReject() {
          if (target.field.value === payload.code) {
            setValue.call(target.field, "");
            target.field.dispatchEvent(new Event("input", { bubbles: true }));
            target.field.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (totpPendingField === target.field) {
            totpPendingField = null;
            totpPendingCode = null;
          }
          reject(new Error("challenge"));
        }
        function ready() {
          var checked;
          try {
            if (
              closed ||
              operation !== totpRevision ||
              Date.now() >= challenge.expires ||
              Date.now() >= payload.expires
            )
              return clearAndReject();
            checked = totpTarget(challenge.payload, false);
            if (
              checked.field !== original.field ||
              checked.button !== original.button ||
              checked.form !== original.form ||
              checked.root !== original.root ||
              checked.panel !== original.panel ||
              checked.fingerprint !== original.fingerprint ||
              checked.field.value !== payload.code
            )
              return clearAndReject();
            if (
              (challenge.payload.submission === "synology" &&
                !synologyButtonReady(checked.button)) ||
              (challenge.payload.submission === "cloudflare" &&
                !cloudflareButtonReady(checked.button))
            ) {
              if (Date.now() < deadline) return setTimeout(ready, 25);
              return clearAndReject();
            }
            totpTarget(challenge.payload, true);
            if (operation !== totpRevision || closed) return clearAndReject();
            totpPendingField = null;
            totpPendingCode = null;
            clickSubmit(checked);
            resolve();
          } catch (_) {
            clearAndReject();
          }
        }
        setTimeout(ready, 0);
      });
    }
    clickSubmit(target);
  }
  function matches(message) {
    return (
      message &&
      message.version === 1 &&
      message.type === "sorng_web_automation" &&
      message.sessionId === identity.sessionId &&
      message.documentToken === identity.documentToken &&
      message.documentSequence === identity.documentSequence &&
      message.navigationToken === identity.navigationToken &&
      message.url === cleanUrl &&
      typeof message.requestId === "string" &&
      /^[0-9a-f]{32}$/.test(message.requestId)
    );
  }
  function reply(request, origin, status, extra) {
    if (closed) return;
    parentWindow.postMessage(
      Object.assign(
        {
          type: "proxy_web_automation",
          version: 1,
          sessionId: identity.sessionId,
          documentToken: identity.documentToken,
          documentSequence: identity.documentSequence,
          navigationToken: identity.navigationToken,
          url: cleanUrl,
          requestId: request.requestId,
          status: status,
        },
        extra || {},
      ),
      origin,
    );
  }
  function sensitive(element) {
    if (!(element instanceof HTMLElement)) return true;
    if (
      element.closest('[contenteditable="true"], [contenteditable=""], iframe')
    )
      return true;
    var controls = [element];
    var form = element.form || element.closest("form");
    if (form)
      controls = controls.concat(Array.prototype.slice.call(form.elements));
    return controls.some(function (control) {
      var type = (control.getAttribute("type") || "").toLowerCase();
      // A form's CSRF/route bookkeeping is never read into a step. It must not
      // disable all public controls merely because a hidden input exists.
      if (control !== element && type === "hidden") return false;
      if (["password", "hidden", "file"].indexOf(type) >= 0) return true;
      var hints = ["name", "id", "autocomplete", "aria-label", "data-secret"]
        .map(function (key) {
          return control.getAttribute(key) || "";
        })
        .join(" ");
      if (
        /pass(?:word|phrase|wd)?|secret|token|one.?time|\botp\b|\bmfa\b|\b2fa\b|auth|credential|api.?key|card.?number|cvv|cvc/i.test(
          hints,
        )
      )
        return true;
      return (
        control.labels &&
        Array.prototype.some.call(control.labels, function (label) {
          return /password|passphrase|secret|token|one.?time|authentication|verification code|credit card/i.test(
            label.textContent || "",
          );
        })
      );
    });
  }
  function visible(element) {
    if (!element.isConnected || element.closest("[hidden],[inert]"))
      return false;
    var style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }
  // Recording and replay share one supported-control contract. No value is
  // captured, including native date/time/color/range controls.
  function fillControl(element) {
    return (
      (element instanceof HTMLInputElement &&
        [
          "text",
          "search",
          "email",
          "url",
          "tel",
          "number",
          "date",
          "datetime-local",
          "month",
          "week",
          "time",
          "range",
          "color",
        ].indexOf(element.type) >= 0) ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    );
  }
  function clickControl(element) {
    if (element instanceof HTMLInputElement)
      return element.type === "button" || element.type === "submit";
    if (element instanceof HTMLButtonElement && element.type === "reset")
      return false;
    return element.matches("a,button,[role=button],[role=link]");
  }
  function selectorFor(element) {
    var parts = [],
      node = element;
    while (node && node !== document.body && parts.length < 24) {
      var tag = node.localName;
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(tag)) return null;
      var index = 1,
        previous = node.previousElementSibling;
      while (previous) {
        if (previous.localName === tag) index++;
        previous = previous.previousElementSibling;
      }
      if (index > 9999) return null;
      parts.unshift(tag + ":nth-of-type(" + index + ")");
      node = node.parentElement;
    }
    if (node !== document.body || !parts.length) return null;
    var selector = "html > body > " + parts.join(" > ");
    return selector.length <= 512 && selectorPattern.test(selector)
      ? selector
      : null;
  }
  function record(event) {
    if (!recording || !event.isTrusted || closed) return;
    var element =
      event.target instanceof Element
        ? event.target.closest(
            "a,button,input,textarea,select,[role=button],[role=link]",
          )
        : null;
    if (!element || sensitive(element) || !visible(element)) return;
    var selector = selectorFor(element);
    if (!selector) return;
    var step;
    if (event.type === "change") {
      if (
        element instanceof HTMLInputElement &&
        ["checkbox", "radio"].indexOf(element.type) >= 0
      )
        step = { kind: "check", selector: selector, checked: element.checked };
      else if (fillControl(element))
        step = { kind: "fill", selector: selector }; // Never copies values, page attributes, text or URLs into a step.
    } else if (clickControl(element)) {
      step = { kind: "click", selector: selector };
    }
    if (!step) return;
    if (stepNumber >= 200) {
      reply(recording.request, recording.origin, "limit");
      recording = null;
      return;
    }
    stepNumber++;
    reply(recording.request, recording.origin, "step", {
      step: step,
      stepNumber: stepNumber,
    });
  }
  document.addEventListener("click", record, true);
  document.addEventListener("change", record, true);
  function applyStep(step, value) {
    if (
      !step ||
      typeof step.selector !== "string" ||
      step.selector.length > 512 ||
      !selectorPattern.test(step.selector)
    )
      throw new Error("target");
    var matches = document.querySelectorAll(step.selector);
    if (matches.length !== 1) throw new Error("target");
    var element = matches[0];
    if (sensitive(element) || !visible(element) || element.disabled)
      throw new Error("target");
    if (step.kind === "click") {
      if (!clickControl(element)) throw new Error("target");
      if (
        element instanceof HTMLAnchorElement &&
        new URL(element.href, location.href).origin !== location.origin
      )
        throw new Error("target");
      element.click();
      return;
    }
    if (
      step.kind === "check" &&
      typeof step.checked === "boolean" &&
      element instanceof HTMLInputElement &&
      ["checkbox", "radio"].indexOf(element.type) >= 0
    ) {
      var checkSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      ).set;
      checkSetter.call(element, step.checked);
    } else if (
      step.kind === "fill" &&
      typeof value === "string" &&
      value.length <= 4096 &&
      fillControl(element)
    ) {
      var proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    } else throw new Error("target");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setDark(payload) {
    if (!darkMode) darkMode = sorngWebDarkMode();
    return darkMode.set(payload);
  }
  window.addEventListener("message", function (event) {
    if (
      closed ||
      event.source !== parentWindow ||
      !event.origin ||
      event.origin === "null" ||
      !matches(event.data)
    )
      return;
    var request = event.data,
      payload = request.payload;
    try {
      switch (request.action) {
        case "credentialWatch":
          credentialWatch = { request: request, origin: event.origin };
          clearCredentialFocus();
          reportCredentialFocus();
          reply(request, event.origin, "ok");
          return;
        case "credentialFocus":
          captureCredential(payload, event.origin);
          reply(request, event.origin, "ok");
          return;
        case "credentialType":
          typeCredential(payload, event.origin);
          reply(request, event.origin, "ok");
          return;
        case "credentialCancel":
          clearCredentialFocus();
          reply(request, event.origin, "ok");
          return;
        case "totpProbe":
          probeTotp(payload);
          reply(request, event.origin, "ok");
          return;
        case "totpSubmit":
          var submission = submitTotp(payload);
          if (submission && typeof submission.then === "function")
            submission.then(
              function () {
                reply(request, event.origin, "ok");
              },
              function () {
                reply(request, event.origin, "failed");
              },
            );
          else reply(request, event.origin, "ok");
          return;
        case "totpCancel":
          ++totpRevision;
          totpChallenge = null;
          if (totpPendingField) {
            var pendingSetValue = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set;
            if (totpPendingField.value === totpPendingCode) {
              pendingSetValue.call(totpPendingField, "");
              totpPendingField.dispatchEvent(
                new Event("input", { bubbles: true }),
              );
              totpPendingField.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
            }
            totpPendingField = null;
            totpPendingCode = null;
          }
          reply(request, event.origin, "ok");
          return;
        case "recordStart":
          recording = { request: request, origin: event.origin };
          stepNumber = 0;
          reply(request, event.origin, "ok");
          return;
        case "recordStop":
          recording = null;
          reply(request, event.origin, "ok");
          return;
        case "cancel":
          clearCredentialFocus();
          // Recording/appearance and credential typing have separate parent
          // bridges. Revoke the current lease, but keep value-free observation
          // alive so another bridge's cancellation cannot disable future typing.
          reportCredentialFocus();
          recording = null;
          reply(request, event.origin, "ok");
          return;
        case "step":
          applyStep(payload && payload.step, payload && payload.value);
          reply(request, event.origin, "ok");
          return;
        case "script":
          if (
            !payload ||
            typeof payload.code !== "string" ||
            payload.code.length > 65536
          )
            return;
          // Explicit user code, only page privileges; no return values are sent.
          Promise.resolve(Function('"use strict";\n' + payload.code)()).then(
            function () {
              reply(request, event.origin, "ok");
            },
            function () {
              reply(request, event.origin, "failed");
            },
          );
          return;
        case "dark":
          if (!payload || typeof payload.enabled !== "boolean") return;
          setDark(payload).then(
            function (outcome) {
              // A closed two-member enum, never page text: it only says which
              // path themed the page so the app can word the difference.
              reply(
                request,
                event.origin,
                "ok",
                outcome === "engine" || outcome === "cssOnly"
                  ? { darkOutcome: outcome }
                  : undefined,
              );
            },
            function () {
              reply(request, event.origin, "failed");
            },
          );
          return;
        case "print":
          if (typeof nativePrint !== "function") throw new Error("print");
          if (typeof nativeFocus === "function") nativeFocus.call(window);
          nativePrint.call(window);
          reply(request, event.origin, "ok");
          return;
        default:
          return;
      }
    } catch (_) {
      reply(request, event.origin, "failed");
    }
  });
  window.addEventListener("pagehide", function () {
    clearCredentialFocus();
    credentialWatch = null;
    closed = true;
    ++totpRevision;
    totpChallenge = null;
    totpPendingField = null;
    totpPendingCode = null;
    recording = null;
    if (darkMode) darkMode.dispose();
    document.removeEventListener("click", record, true);
    document.removeEventListener("change", record, true);
  });
})(p, u.href);
