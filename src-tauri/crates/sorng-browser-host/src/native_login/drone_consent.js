function droneScmConsentTarget(doc, bridge) {
  try {
    var view = doc && doc.defaultView;
    if (!view || !bridge || typeof bridge !== "object") return null;
    var location = view.location;
    if (
      location.protocol !== "https:" ||
      location.origin !== bridge.origin ||
      !Array.isArray(bridge.paths) ||
      bridge.paths.indexOf(location.pathname) < 0 ||
      typeof bridge.clientId !== "string" ||
      !bridge.clientId ||
      typeof bridge.redirectUri !== "string" ||
      view.top !== view
    )
      return null;
    // The address that rendered the page must name the same application and
    // the same callback; a mismatch is another application's consent.
    var query = new URL(location.href).searchParams;
    if (
      query.getAll("client_id").length !== 1 ||
      query.get("client_id") !== bridge.clientId ||
      query.getAll("redirect_uri").length !== 1 ||
      query.get("redirect_uri") !== bridge.redirectUri
    )
      return null;
    var forms = doc.querySelectorAll(bridge.formSelector);
    if (forms.length !== 1) return null;
    var form = forms[0];
    var action = new URL(form.getAttribute("action") || "", location.href);
    if (
      action.origin !== bridge.origin ||
      action.pathname !== bridge.formAction ||
      action.search ||
      form.hasAttribute("target")
    )
      return null;
    // Hidden fields the provider posts back: exactly one of each, equal to
    // the saved application and Drone's own callback.
    function only(name) {
      var fields = form.querySelectorAll(
        'input[type="hidden"][name="' + name + '"]',
      );
      return fields.length === 1 ? fields[0].value : null;
    }
    if (
      only("client_id") !== bridge.clientId ||
      only("redirect_uri") !== bridge.redirectUri
    )
      return null;
    var buttons = doc.querySelectorAll(bridge.buttonSelector);
    if (buttons.length !== 1) return null;
    var button = buttons[0];
    if (
      button.form !== form ||
      button.disabled ||
      button.hasAttribute("formaction") ||
      button.hasAttribute("formtarget") ||
      button.hasAttribute("formmethod") ||
      button.getAttribute("aria-disabled") === "true" ||
      !button.isConnected ||
      (typeof isVisible === "function" && !isVisible(button))
    )
      return null;
    return button;
  } catch (_) {
    return null;
  }
}

function droneConsentClient(bridge) {
  const doc = document,
    href = location.href;
  let ended = false,
    pending = false,
    captured = null,
    timer;
  const visible = (el) =>
    el &&
    el.isConnected &&
    !el.hidden &&
    getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden" &&
    (el.offsetParent !== null || el.getClientRects().length > 0);
  const cancel = () => {
    ended = true;
    clearTimeout(timer);
    captured = null;
  };
  doc.addEventListener("pointerdown", cancel, { capture: true, once: true });
  doc.addEventListener("keydown", cancel, { capture: true, once: true });
  window.addEventListener("pagehide", cancel, { once: true });
  function target() {
    if (
      ended ||
      document !== doc ||
      location.href !== href ||
      window.top !== window
    )
      return null;
    const button = droneScmConsentTarget(doc, bridge);
    return visible(button) ? button : null;
  }
  const deadline = Date.now() + 8000;
  function poll() {
    if (ended || Date.now() >= deadline) {
      cancel();
      return;
    }
    captured = target();
    if (captured) {
      pending = true;
      notify("scm-consent");
    } else timer = setTimeout(poll, 100);
  }
  timer = setTimeout(poll, 0);
  return function (
    origin,
    username,
    password,
    autoSubmit,
    expires,
    options,
    stage,
  ) {
    const button = target();
    if (
      !pending ||
      stage !== "scm-consent" ||
      origin !== bridge.origin ||
      username ||
      password ||
      !autoSubmit ||
      !Number.isFinite(expires) ||
      expires <= Date.now() ||
      !button ||
      button !== captured
    ) {
      cancel();
      return false;
    }
    pending = false;
    ended = true;
    captured = null;
    clearTimeout(timer);
    button.click();
    return true;
  };
}
