/* Page-only website automation. Called inside the early reporter's private
 * closure with its document identity. No Tauri/native/storage bridge exists.
 * A page can execute its own JS already; these identity labels are freshness
 * fences, not authorization. The trusted parent separately arms each operation.
 */
(function installWebsiteAutomation(identity, cleanUrl) {
  "use strict";
  var parentWindow = window.parent;
  if (parentWindow === window) return;
  var selectorPattern =
    /^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$/;
  var recording = null,
    stepNumber = 0,
    darkDesired = false,
    darkLoading = null;
  var closed = false;
  var totpChallenge = null,
    totpSubmitted = false;
  function totpTarget(payload) {
    if (
      !payload ||
      typeof payload.nonce !== "string" ||
      !/^[0-9a-f]{32}$/.test(payload.nonce) ||
      !["post", "spa"].includes(payload.submission)
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
    if (fields.length !== 1 || buttons.length !== 1)
      throw new Error("challenge");
    var field = fields[0],
      button = buttons[0],
      form = field.form;
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
    totpChallenge = null;
    if (totpSubmitted) throw new Error("challenge");
    var target = totpTarget(payload);
    if (target.field.value) throw new Error("challenge");
    totpChallenge = {
      payload: payload,
      target: target,
      expires: Date.now() + 15000,
    };
  }
  function submitTotp(payload) {
    var challenge = totpChallenge;
    totpChallenge = null;
    if (
      totpSubmitted ||
      !challenge ||
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
    var target = totpTarget(challenge.payload),
      original = challenge.target;
    if (
      target.field !== original.field ||
      target.button !== original.button ||
      target.form !== original.form ||
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
      var checked = totpTarget(challenge.payload);
      if (
        checked.field !== original.field ||
        checked.button !== original.button ||
        checked.form !== original.form ||
        checked.fingerprint !== original.fingerprint ||
        checked.field.value !== payload.code ||
        Date.now() >= payload.expires
      )
        throw new Error("challenge");
    } catch (_) {
      setValue.call(target.field, "");
      throw new Error("challenge");
    }
    totpSubmitted = true; // Consumed before clicking, including uncertain outcomes.
    if (challenge.payload.submission === "spa")
      target.form.addEventListener(
        "submit",
        function (event) {
          event.preventDefault();
        },
        { capture: true, once: true },
      );
    target.button.click();
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
  function enableDark() {
    if (!darkDesired || closed || !window.DarkReader) return;
    window.DarkReader.setFetchMethod(function (url) {
      var target = new URL(url, location.href);
      if (
        target.origin !== location.origin ||
        target.username ||
        target.password
      )
        return Promise.reject(new Error("External dark-mode resource blocked"));
      return fetch(target.href, {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
    });
    window.DarkReader.enable({ brightness: 100, contrast: 100, sepia: 0 });
  }
  function setDark(enabled) {
    darkDesired = enabled;
    if (!enabled) {
      if (window.DarkReader) window.DarkReader.disable();
      return Promise.resolve();
    }
    if (window.DarkReader) {
      enableDark();
      return Promise.resolve();
    }
    if (!darkLoading)
      darkLoading = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = location.origin + "/__sortofremoteng_web_darkreader_v1.js";
        script.onload = function () {
          enableDark();
          resolve();
        };
        script.onerror = function () {
          darkLoading = null;
          script.remove();
          reject(new Error("dark"));
        };
        (document.head || document.documentElement).appendChild(script);
      });
    return darkLoading;
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
        case "totpProbe":
          probeTotp(payload);
          reply(request, event.origin, "ok");
          return;
        case "totpSubmit":
          submitTotp(payload);
          reply(request, event.origin, "ok");
          return;
        case "totpCancel":
          totpChallenge = null;
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
          setDark(payload.enabled).then(
            function () {
              reply(request, event.origin, "ok");
            },
            function () {
              reply(request, event.origin, "failed");
            },
          );
          return;
        default:
          return;
      }
    } catch (_) {
      reply(request, event.origin, "failed");
    }
  });
  window.addEventListener("pagehide", function () {
    closed = true;
    totpChallenge = null;
    recording = null;
    darkDesired = false;
    document.removeEventListener("click", record, true);
    document.removeEventListener("change", record, true);
  });
})(p, u.href);
