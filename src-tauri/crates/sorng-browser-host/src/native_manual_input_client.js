(function () {
  "use strict";
  // Private closure retained by the renderer. No page-visible token or secret.
  const inputValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).get;
  const areaValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).get;
  const inputSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  const areaSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).set;
  const focus = HTMLElement.prototype.focus;
  const doc = document;
  const initialOrigin = location.origin;
  let target = null,
    targetUrl = "",
    token = "",
    consumed = false,
    invalid = false,
    expected = 0,
    // True from a receipt that lets the host send one key until the next
    // request: that key may still be on its way when the user presses Escape.
    sending = false,
    stray = null;
  let failureReason = "focus-lost",
    pendingReceipt = false;
  const now = performance.now.bind(performance);
  let lastFocused = null,
    shellBlurAt = -Infinity,
    shellBlurUrl = "";
  const observedRoots = new WeakSet();
  function focusedElement() {
    let el = document.activeElement;
    // Resolve only open shadow roots in this document, never iframe contents.
    for (let depth = 0; el && depth < 32; depth++) {
      const root = el.shadowRoot;
      if (!root) return el;
      if (!observedRoots.has(root)) {
        observedRoots.add(root);
        // Focus moves within one host are retargeted away from document.
        root.addEventListener("focusin", rememberFocus, true);
      }
      const inner = root.activeElement;
      if (!inner) return el;
      el = inner;
    }
    return null;
  }
  const value = (el) =>
    el instanceof HTMLInputElement ? inputValue.call(el) : areaValue.call(el);
  const eligible = (el) =>
    ((el instanceof HTMLInputElement &&
      ["text", "email", "password", "tel", "search", "url", "number"].includes(
        el.type,
      )) ||
      el instanceof HTMLTextAreaElement) &&
    el.isConnected &&
    el.ownerDocument === doc &&
    !el.disabled &&
    !el.readOnly &&
    el.getClientRects().length > 0;
  function rememberFocus() {
    const el = focusedElement();
    if (target && el !== target) {
      invalid = true;
      failureReason = "focus-lost";
    }
    lastFocused = eligible(el) ? el : null;
    shellBlurAt = -Infinity;
    shellBlurUrl = "";
  }
  document.addEventListener("focusin", rememberFocus, true);
  window.addEventListener(
    "blur",
    (event) => {
      // A sibling native WebView can receive focus before toolbar pointerdown.
      // Native admission independently requires the focused owner app window.
      if (event.isTrusted && event.target === window) {
        const el = focusedElement();
        if (eligible(el)) {
          lastFocused = el;
          shellBlurAt = now();
          shellBlurUrl = location.href;
        }
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      if (target) {
        invalid = true;
        failureReason = "cancelled";
      }
    },
    true,
  );
  document.addEventListener(
    "paste",
    () => {
      if (target) {
        invalid = true;
        failureReason = "cancelled";
      }
    },
    true,
  );
  document.addEventListener(
    "compositionstart",
    () => {
      if (target) {
        invalid = true;
        failureReason = "cancelled";
      }
    },
    true,
  );
  // Escape from the user while typing runs takes the field back: the next
  // receipt stops typing, and the text typed so far is erased the way a
  // user's delete is seen (native setter, then input and change events).
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !target ||
        !consumed ||
        invalid ||
        !event.isTrusted ||
        event.key !== "Escape" ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      try {
        const el = focusedElement();
        if (el !== target || (event.target !== el && !el.getRootNode().host))
          return;
        invalid = true;
        failureReason = "cancelled";
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sending) stray = { el, until: now() + 1500 };
        // Only what the receipts allow: the field was empty at capture.
        const typed = value(el).length;
        if (typed > 0 && typed >= expected && typed <= expected + 2) {
          (el instanceof HTMLInputElement ? inputSetter : areaSetter).call(
            el,
            "",
          );
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (_) {
        invalid = true;
      }
    },
    true,
  );
  document.addEventListener(
    "beforeinput",
    (event) => {
      if (!stray || !event.isTrusted || event.inputType !== "insertText")
        return;
      const held = stray;
      stray = null;
      let failureReason = "focus-lost",
        pendingReceipt = false;
      if (focusedElement() === held.el && now() < held.until)
        event.preventDefault();
    },
    true,
  );
  // Blur into the trusted app popup is tolerated; any other editable focus is not.
  function denied(reason) {
    failureReason = reason;
    return false;
  }
  function execute(action, id, length) {
    sending = false;
    pendingReceipt = false;
    try {
      if (action === "cancel") {
        target = null;
        targetUrl = "";
        token = "";
        invalid = true;
        return true;
      }
      if (window.top !== window) return denied("unsupported-frame");
      if (
        document !== doc ||
        location.origin !== initialOrigin ||
        !["http:", "https:"].includes(location.protocol)
      )
        return denied("stale");
      if (action === "capture") {
        const el = focusedElement();
        const handoff =
          el === lastFocused &&
          location.href === shellBlurUrl &&
          now() >= shellBlurAt &&
          now() - shellBlurAt <= 1500;
        if ((!document.hasFocus() && !handoff) || !eligible(el))
          return denied("focus-lost");
        if (value(el).length !== 0) return denied("field-not-empty");
        target = el;
        // A same-document SPA route can change before an explicit capture.
        // Bind that current URL; subsequent navigation still rejects typing.
        targetUrl = location.href;
        token = id;
        consumed = false;
        invalid = false;
        failureReason = "focus-lost";
        expected = 0;
        return true;
      }
      if (invalid) return false;
      if (!target || id !== token || location.href !== targetUrl)
        return denied("stale");
      if (!eligible(target)) return denied("focus-lost");
      if (action === "restore") {
        if (consumed) return denied("stale");
        if (value(target).length !== 0) return denied("field-not-empty");
        consumed = true;
        const active = focusedElement();
        if (active !== target && active !== document.body)
          return denied("focus-lost");
        focus.call(target, { preventScroll: true });
      } else if (
        action !== "check" ||
        !consumed ||
        length < expected ||
        length > expected + 2
      )
        return false;
      expected = length;
      sending =
        // Native focus invokes page handlers synchronously; recheck their effects.
        !invalid &&
        location.href === targetUrl &&
        eligible(target) &&
        document.hasFocus() &&
        focusedElement() === target &&
        value(target).length === expected;
      // A masked/framework input may apply the trusted key asynchronously.
      // Only an exact-field, unmodified shorter value can wait; no extra key
      // is authorized until its receipt catches up within the native deadline.
      pendingReceipt =
        !sending &&
        !invalid &&
        action === "check" &&
        location.href === targetUrl &&
        eligible(target) &&
        document.hasFocus() &&
        focusedElement() === target &&
        value(target).length < expected;
      if (!sending && !pendingReceipt) failureReason = "focus-lost";
      return sending;
    } catch (_) {
      invalid = true;
      failureReason = "stale";
      return false;
    }
  }
  return function (action, id, length, detailed) {
    const success = execute(action, id, length);
    return detailed === true
      ? {
          success,
          reason: success ? "" : pendingReceipt ? "pending" : failureReason,
        }
      : success;
  };
})();
