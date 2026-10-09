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
  const focus = HTMLElement.prototype.focus;
  const initialOrigin = location.origin;
  let target = null,
    targetUrl = "",
    token = "",
    consumed = false,
    invalid = false,
    expected = 0;
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
    !el.disabled &&
    !el.readOnly &&
    el.getClientRects().length > 0;
  function rememberFocus() {
    const el = focusedElement();
    if (target && el !== target) invalid = true;
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
      if (target) invalid = true;
    },
    true,
  );
  document.addEventListener(
    "paste",
    () => {
      if (target) invalid = true;
    },
    true,
  );
  document.addEventListener(
    "compositionstart",
    () => {
      if (target) invalid = true;
    },
    true,
  );
  // Blur into the trusted app popup is tolerated; any other editable focus is not.
  return function (action, id, length) {
    try {
      if (action === "cancel") {
        target = null;
        targetUrl = "";
        token = "";
        invalid = true;
        return true;
      }
      if (location.origin !== initialOrigin || location.protocol !== "https:")
        return false;
      if (action === "capture") {
        const el = focusedElement();
        const handoff =
          el === lastFocused &&
          location.href === shellBlurUrl &&
          now() >= shellBlurAt &&
          now() - shellBlurAt <= 1500;
        if (
          (!document.hasFocus() && !handoff) ||
          !eligible(el) ||
          value(el).length !== 0
        )
          return false;
        target = el;
        // A same-document SPA route can change before an explicit capture.
        // Bind that current URL; subsequent navigation still rejects typing.
        targetUrl = location.href;
        token = id;
        consumed = false;
        invalid = false;
        expected = 0;
        return true;
      }
      if (
        !target ||
        invalid ||
        id !== token ||
        location.href !== targetUrl ||
        !eligible(target)
      )
        return false;
      if (action === "restore") {
        if (consumed || value(target).length !== 0) return false;
        consumed = true;
        const active = focusedElement();
        if (active !== target && active !== document.body) return false;
        focus.call(target, { preventScroll: true });
      } else if (
        action !== "check" ||
        !consumed ||
        length < expected ||
        length > expected + 2
      )
        return false;
      expected = length;
      return (
        // Native focus invokes page handlers synchronously; recheck their effects.
        !invalid &&
        location.href === targetUrl &&
        eligible(target) &&
        document.hasFocus() &&
        focusedElement() === target &&
        value(target).length === expected
      );
    } catch (_) {
      invalid = true;
      return false;
    }
  };
})();
