// Private native factory; shared modules retain their existing form semantics.
// No proxy nonce endpoint, page-global callback, or credentials in source.
(function nativeLoginClient(notify, configuration, adapter, nativeTyping) {
  "use strict";
  // Full-page security verification is not a login form. Hold every adapter
  // before requesting any native grant, then start a fresh detection period.
  if (document.readyState === "loading" || cloudflareInterstitial())
    return holdCloudflareChallenge();
  // Kept within the factory: approved-OTP and standalone provider clients do
  // not assemble the shared form modules, but still obey this same hold.
  function cloudflareInterstitial() {
    const markers = Array.from(
      document.querySelectorAll(
        "#challenge-form, #challenge-running, #challenge-stage, #cf-wrapper, .cf-browser-verification",
      ),
    );
    const marker = markers.some((element) => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          node.hidden ||
          node.getAttribute("aria-hidden") === "true" ||
          style.display === "none" ||
          style.visibility === "hidden"
        )
          return false;
      }
      return true;
    });
    const text = (document.body?.textContent || "").slice(0, 20000);
    const title = document.title || "";
    const known =
      marker ||
      (markers.length === 0 &&
        ((/performing security verification|incompatible browser extension or network configuration/i.test(
          text,
        ) &&
          /cloudflare|challenges.cloudflare.com|ray id/i.test(text)) ||
          (/just a moment|attention required/i.test(title) &&
            /cloudflare|security verification|enable javascript and cookies/i.test(
              text,
            ))));
    if (!known) return null;
    return /incompatible browser extension or network configuration/i.test(text)
      ? "incompatible"
      : "waiting";
  }
  function holdCloudflareChallenge() {
    const doc = document,
      origin = location.origin;
    const began = Date.now();
    let challengeBegan = began;
    const retryKey = "sorng-cloudflare-reload.v1";
    let active = null,
      timer = null,
      stopped = false,
      reloaded = false,
      challengeSeen = false;
    const cancelHold = () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", cancelHold);
      window.removeEventListener("unload", cancelHold);
      window.removeEventListener("load", poll);
    };
    window.addEventListener("pagehide", cancelHold, { once: true });
    window.addEventListener("unload", cancelHold, { once: true });
    // A full reload replaces this closure. A short, non-secret session marker
    // prevents the successor from repeating the same single reload.
    try {
      reloaded = Date.now() - Number(sessionStorage.getItem(retryKey)) < 120000;
    } catch (_) {
      reloaded = true;
    }
    if (cloudflareInterstitial()) {
      challengeSeen = true;
      notify("challenge-waiting");
    }
    window.addEventListener("load", poll, { once: true });
    function poll() {
      if (stopped || document !== doc || location.origin !== origin)
        return cancelHold();
      clearTimeout(timer);
      const challenge = cloudflareInterstitial();
      if (challenge && !challengeSeen) {
        challengeSeen = true;
        challengeBegan = Date.now();
        notify("challenge-waiting");
      }
      if (!challenge && doc.readyState === "loading") {
        if (Date.now() - began >= 60000) {
          cancelHold();
          notify("form-rejected");
          return;
        }
        timer = setTimeout(poll, 125);
        return;
      }
      if (!challenge) {
        clearTimeout(timer);
        window.removeEventListener("pagehide", cancelHold);
        window.removeEventListener("unload", cancelHold);
        window.removeEventListener("load", poll);
        try {
          sessionStorage.removeItem(retryKey);
        } catch (_) {}
        active = nativeLoginClient(
          notify,
          configuration,
          adapter,
          nativeTyping,
        );
        return;
      }
      if (Date.now() - challengeBegan >= 120000) {
        cancelHold();
        notify("challenge-timeout");
        return;
      }
      if (
        challenge === "incompatible" &&
        !reloaded &&
        Date.now() - challengeBegan >= 5000
      ) {
        reloaded = true;
        try {
          sessionStorage.setItem(retryKey, String(Date.now()));
        } catch (_) {}
        notify("challenge-reloading");
        // The authenticated native observation performs the one-per-attempt reload.
        // Page script never owns the retry budget or the browser reload action.
      }
      timer = setTimeout(poll, 125);
    }
    timer = setTimeout(poll, 0);
    const deliverAfterChallenge = (...args) =>
      active ? active(...args) : false;
    Object.defineProperty(deliverAfterChallenge, "nativeTyping", {
      value: (...args) => active?.nativeTyping?.(...args) ?? false,
    });
    Object.defineProperty(deliverAfterChallenge, "declarativeReason", {
      get: () => active?.declarativeReason,
    });
    return deliverAfterChallenge;
  }
  // Independently installed by the renderer with native-owned reviewed MFA
  // metadata. The OTP closure survives completion of the password adapter.
  if (adapter === "approved-otp")
    return approvedOtpStage(notify, configuration);
  if (configuration?.droneScmConsent) {
    const bridge = configuration.droneScmConsent;
    if (adapter === "modular-form" && bridge.paths?.includes(location.pathname))
      return droneConsentClient(bridge);
    configuration = { ...configuration };
    delete configuration.droneScmConsent;
  }
  // The user requested the reviewed PTisp onboarding tour to be dismissed.
  // This action-only helper never receives credentials or visits another origin.
  if (
    adapter === "modular-form" &&
    window.top === window &&
    location.origin === "https://my.ptisp.pt" &&
    configuration?.selectors?.username ===
      '.login-form-page #classic-card form input[type="email"][autocomplete="email"]'
  ) {
    /* REVIEWED_PTISP_TOUR */
  }
  if (configuration?.mfa) {
    configuration = { ...configuration };
    delete configuration.mfa;
  }
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

  // A separate action-only stage; no username/password enters this closure.
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
  function approvedOtpStage(signal, setup) {
    const doc = document;
    const now = Date.now.bind(Date);
    const started = now();
    // This local nonce satisfies the shared DOM guard's shape contract only;
    // native process/document nonces and owner consent authorize the operation.
    const guardSetup = {
      ...setup,
      nonce: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    };
    let stopped = false,
      timer,
      target = null,
      prefix = "",
      armed = false;
    let deadline = 0,
      autoSubmit = false,
      receipt = null,
      submitted = false;
    const emit = (stage, index = 0) =>
      signal(`totp|${stage}|${setup.id}|${index}`);
    const later = (fn, ms) => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
    const cancel = () => {
      if (!stopped) emit("cancel");
      stopped = true;
      armed = false;
      prefix = "";
      target = null;
      clearTimeout(timer);
    };
    const visible = (el) =>
      el &&
      el.isConnected &&
      el.ownerDocument === doc &&
      !el.hidden &&
      el.getAttribute("aria-hidden") !== "true" &&
      getComputedStyle(el).display !== "none" &&
      getComputedStyle(el).visibility !== "hidden" &&
      (el.offsetParent !== null || el.getClientRects().length > 0);
    /* REVIEWED_TOTP_GUARDS */
    function contaboOtpTarget(payload) {
      if (
        payload.id !== "contabo-otp" ||
        payload.submission !== "spa" ||
        payload.codeSelector !==
          'form#otp_login_form input#otp_password[name="data[otp_password]"]' ||
        payload.submitSelector !== 'button#otp_login_button[type="button"]' ||
        location.pathname !== "/account/login"
      )
        throw new Error("challenge");
      const fields = doc.querySelectorAll(payload.codeSelector),
        buttons = doc.querySelectorAll(payload.submitSelector);
      if (fields.length !== 1 || buttons.length !== 1)
        throw new Error("challenge");
      const field = fields[0],
        button = buttons[0],
        form = field.form,
        panel = field.closest("#otp_login_dlg"),
        root = panel?.closest('[role="dialog"]');
      if (
        !(field instanceof HTMLInputElement) ||
        field.type !== "text" ||
        field.disabled ||
        field.readOnly ||
        !(form instanceof HTMLFormElement) ||
        form.id !== "otp_login_form" ||
        form.method.toLowerCase() !== "post" ||
        !(button instanceof HTMLButtonElement) ||
        button.type !== "button" ||
        button.form ||
        button.disabled ||
        !root ||
        !panel ||
        !root.contains(button) ||
        button.closest('[role="dialog"]') !== root ||
        !visible(root) ||
        !visible(panel) ||
        !visible(field) ||
        !visible(button) ||
        form.target ||
        ["formaction", "formtarget", "formmethod"].some((key) =>
          button.hasAttribute(key),
        )
      )
        throw new Error("challenge");
      const action = new URL(form.getAttribute("action") || "", location.href);
      if (
        action.origin !== payload.origin ||
        action.pathname !== "/account/login_otp" ||
        action.search ||
        action.hash ||
        action.username ||
        action.password ||
        form.querySelector('input[type="password"]')
      )
        throw new Error("challenge");
      return {
        field,
        button,
        form,
        root,
        panel,
        spa: true,
        handlers: [button.onclick, form.onsubmit],
        fingerprint: JSON.stringify([
          location.href,
          action.href,
          field.name,
          button.id,
        ]),
      };
    }
    function controls(requireReady = false) {
      if (
        stopped ||
        document !== doc ||
        window.top !== window ||
        now() - started > 600000 ||
        location.protocol !== "https:" ||
        location.origin !== setup.origin ||
        !setup.paths.includes(location.pathname)
      )
        return null;
      try {
        const found =
          setup.id === "contabo-otp"
            ? contaboOtpTarget(guardSetup)
            : totpTarget(guardSetup, requireReady);
        return { ...found, input: found.field, href: location.href };
      } catch (_) {
        return null;
      }
    }
    function current(requireReady = false) {
      const found = controls(requireReady);
      return (
        target &&
        found &&
        found.input === target.input &&
        found.button === target.button &&
        found.form === target.form &&
        found.fingerprint === target.fingerprint &&
        found.href === target.href &&
        found.root === target.root &&
        found.panel === target.panel &&
        sameTotpHandlers(found, target) &&
        doc.activeElement === target.input &&
        target.input.value === prefix &&
        (target.input.selectionStart === null ||
          (target.input.selectionStart === prefix.length &&
            target.input.selectionEnd === prefix.length)) &&
        (!deadline || now() < deadline)
      );
    }
    function discover() {
      if (stopped) return;
      const found = controls();
      // Keep looking while the challenge is absent or another live control
      // holds focus. Never take focus away from it or replace manual input.
      // A control that is no longer shown is not live: an unpainted page may
      // leave focus on the panel it has just hidden.
      const focused = doc.activeElement;
      const tacticalModal = found?.input.closest(
        '.q-dialog[role="dialog"][aria-modal="true"]',
      );
      // Quasar's reviewed Tactical modal can hold focus on its non-interactive
      // inner container while autofocus settles. That container owns this
      // challenge; it is not a user-selected input or action to preserve.
      const tacticalContainer =
        found &&
        tacticalModal &&
        setup.id === "tacticalrmm-totp" &&
        setup.submission === "spa" &&
        location.pathname === "/login" &&
        setup.codeSelector ===
          '.q-dialog form input[autocomplete="one-time-code"][inputmode="numeric"]' &&
        setup.submitSelector ===
          '.q-dialog form:has(input[autocomplete="one-time-code"][inputmode="numeric"]) button[type="submit"]' &&
        focused instanceof HTMLDivElement &&
        focused.matches('.q-dialog__inner[tabindex="-1"]') &&
        !focused.hasAttribute("role") &&
        !focused.closest('[contenteditable]:not([contenteditable="false"])') &&
        focused.contains(found.input) &&
        tacticalModal.contains(found.form) &&
        focused.closest('.q-dialog[role="dialog"][aria-modal="true"]') ===
          tacticalModal &&
        visible(tacticalModal) &&
        Array.from(
          doc.querySelectorAll('.q-dialog[role="dialog"][aria-modal="true"]'),
        ).filter(visible).length === 1;
      if (
        !found ||
        (!found.input.value &&
          focused !== doc.body &&
          focused !== found.input &&
          visible(focused) &&
          !tacticalContainer)
      ) {
        if (now() - started < 600000) later(discover, 200);
        else cancel();
        return;
      }
      if (found.input.value) return;
      target = found;
      found.input.focus({ preventScroll: true });
      later(() => {
        if (current()) emit("start");
        else cancel();
      }, setup.fillDelayMs);
    }
    // Both facts are in for `index` digits: the host's receipt and the trusted
    // input event of the digit it names. Ask for the next digit, or finish.
    function entered(index) {
      clearTimeout(timer);
      receipt = null;
      if (armed || prefix.length !== index || !current()) {
        cancel();
        return false;
      }
      if (index < setup.digits) {
        armed = true;
        emit("key", index);
        return true;
      }
      if (!autoSubmit) {
        stopped = true;
        prefix = "";
        target = null;
        return true;
      }
      const earliest = now() + setup.submitDelayMs;
      const settledBy = Math.min(deadline, earliest + 3000);
      const finish = () => {
        if (!current() || now() >= settledBy) {
          cancel();
          return;
        }
        if (now() < earliest || !current(true)) {
          later(finish, 50);
          return;
        }
        emit("finish", index);
      };
      if (setup.submitDelayMs) later(finish, setup.submitDelayMs);
      else finish();
      return true;
    }
    function inputEvent(event) {
      if (!target || stopped) return;
      if (
        !armed ||
        !event.isTrusted ||
        event.target !== target.input ||
        !/^\d$/.test(event.data || "") ||
        event.inputType !== "insertText" ||
        target.input.value !== prefix + event.data
      ) {
        cancel();
        return;
      }
      prefix += event.data;
      armed = false;
      // The host's receipt for this digit may have overtaken its DOM event.
      if (receipt === prefix.length) entered(receipt);
    }
    doc.addEventListener("input", inputEvent, true);
    doc.addEventListener(
      "beforeinput",
      (event) => {
        if (!target || stopped) return;
        if (
          !armed ||
          !event.isTrusted ||
          !current() ||
          event.target !== target.input ||
          !/^\d$/.test(event.data || "") ||
          event.inputType !== "insertText"
        ) {
          // Suppress only a pending injected key aimed at a stale target.
          if (armed) event.preventDefault();
          cancel();
        }
      },
      true,
    );
    doc.addEventListener(
      "keydown",
      (event) => {
        if (!target || stopped) return;
        if (
          !armed ||
          !current() ||
          !/^\d$/.test(event.key) ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey
        ) {
          if (armed) event.preventDefault();
          cancel();
        }
      },
      true,
    );
    doc.addEventListener(
      "pointerdown",
      () => {
        if (target) cancel();
      },
      true,
    );
    doc.addEventListener(
      "focusin",
      (event) => {
        if (target && event.target !== target.input) cancel();
      },
      true,
    );
    window.addEventListener("pagehide", cancel, { once: true });
    if (
      !setup ||
      typeof setup.id !== "string" ||
      !/^[a-z0-9-]{1,128}$/.test(setup.id) ||
      !Array.isArray(setup.paths) ||
      !Number.isInteger(setup.digits) ||
      setup.digits < 6 ||
      setup.digits > 8 ||
      [setup.fillDelayMs, setup.submitDelayMs].some(
        (v) => !Number.isInteger(v) || v < 0 || v > 30000,
      )
    ) {
      stopped = true;
      return () => false;
    }
    later(discover, 0);
    // Metadata only. OTP characters arrive solely through Chromium key events.
    return function (command, index, until, submit) {
      if (
        stopped ||
        !target ||
        !Number.isInteger(index) ||
        !Number.isFinite(until)
      )
        return false;
      if (command === "cancel") {
        cancel();
        return false;
      }
      if (command === "wait") {
        if (deadline || prefix || index < 1 || index > 33020 || !current()) {
          cancel();
          return false;
        }
        later(() => {
          if (current()) emit("start");
          else cancel();
        }, index);
        return true;
      }
      if (
        until <= now() ||
        until > now() + 3600000 ||
        (deadline && deadline !== until)
      ) {
        cancel();
        return false;
      }
      deadline = until;
      autoSubmit = submit === true;
      if (command === "submit") {
        if (
          submitted ||
          !autoSubmit ||
          index !== setup.digits ||
          prefix.length !== setup.digits ||
          !current(true) ||
          target.button.disabled ||
          target.button.getAttribute("aria-disabled") === "true"
        ) {
          cancel();
          return false;
        }
        const button = target.button;
        if (setup.submission === "spa" || target.spa)
          target.form.addEventListener(
            "submit",
            (event) => event.preventDefault(),
            { capture: true, once: true },
          );
        submitted = true;
        stopped = true;
        prefix = "";
        target = null;
        button.click();
        return true;
      }
      if (
        command !== "probe" ||
        receipt !== null ||
        index < 0 ||
        index > setup.digits
      ) {
        cancel();
        return false;
      }
      // One receipt per request, in order. The next digit is requested by the
      // later of this receipt and the trusted input event of the digit it
      // names. No timer is on that path, so a hidden page's throttled timers
      // cannot slow typing, and nothing retries or repeats a character.
      if (!armed) return entered(index);
      if (index !== prefix.length + 1) {
        cancel();
        return false;
      }
      receipt = index;
      // The receipt overtook its DOM event. A digit the engine never delivers
      // fails closed here.
      later(cancel, Math.max(0, Math.min(1500, deadline - now())));
      return true;
    };
  }
  var stopped = false;
  var cancelActive = null;
  /* REVIEWED_FORM_MODULES */
  /* NATIVE_KEYBOARD_CLIENT */
  // Native production always passes true. The old three-argument standalone
  // harness remains useful for testing the shared provider/form modules.
  const keyboard =
    nativeTyping === true ? createLoginKeyboard(notify, () => cancel()) : null;
  const attachKeyboard = (deliver) => {
    if (keyboard)
      Object.defineProperty(deliver, "nativeTyping", {
        value: keyboard.dispatch,
      });
    return deliver;
  };
  const writeCredential = (element, value, guard, stage, field) =>
    keyboard && !field.startsWith("extra")
      ? keyboard.write(element, value, guard, stage, field, expires)
      : Promise.resolve(fillField(element, value, guard));
  const doc = document;
  const origin = location.origin;
  // The address an attempt is bound to. A modular form in the top document is
  // bound when its form is found: until then `routing` is true, nothing has
  // been requested, and a single-page application may still route to its
  // login view inside the document it was loaded in ("/" becomes "/#!/auth").
  let initialHref = location.href;
  let routing = false;
  const topDocument = window.top === window;
  let loginFrame = null;
  const parentNavigationEvents = [
    "pagehide",
    "unload",
    "hashchange",
    "popstate",
  ];
  const now = Date.now.bind(Date);
  let requested = false;
  let delivered = false;
  let expires = 0;
  let readyDeadline = 0;
  let expiryTimer;
  let startTimer;
  let config;
  // Bounds of the waits that follow detection: a stage grant (the host can
  // hold a request for 30 s under manual entry), the page finishing its load
  // and settling while it holds no credential, and a delivered credential.
  const GRANT_WAIT_MS = 35000;
  const SETTLE_WAIT_MS = 60000;
  const CREDENTIAL_LIMIT_MS = 30000;
  function authorizedLoginFrame() {
    try {
      const parent = window.parent;
      const element = window.frameElement;
      if (
        parent === window ||
        parent !== window.top ||
        !element ||
        element.tagName !== "IFRAME" ||
        !element.isConnected ||
        element.ownerDocument !== parent.document ||
        !parent.document.documentElement.contains(element) ||
        element.contentWindow !== window ||
        element.contentDocument !== doc ||
        window.origin !== origin ||
        parent.location.origin !== origin ||
        parent.location.protocol !== location.protocol ||
        parent.location.hostname !== location.hostname ||
        parent.location.port !== location.port ||
        !config?.sameOriginLoginFrames?.some(
          (name) =>
            name === window.name ||
            name === element.getAttribute("name") ||
            name === element.getAttribute("id"),
        ) ||
        (element.hasAttribute("sandbox") &&
          !["allow-scripts", "allow-same-origin"].every((token) =>
            element
              .getAttribute("sandbox")
              .toLowerCase()
              .split(/\s+/)
              .includes(token),
          ))
      )
        return null;
      // The structural native gate does not select a DOM name. Exactly one
      // direct child may match the private allowlist, including mixed id/name
      // matches. Recheck before every receipt so a later sibling cannot steal
      // an already selected login. Never descend into peer frame documents.
      let selected = null;
      for (const peer of parent.document.querySelectorAll("iframe")) {
        let matches = false;
        try {
          matches =
            config.sameOriginLoginFrames.includes(peer.getAttribute("id")) ||
            config.sameOriginLoginFrames.includes(peer.getAttribute("name"));
          if (!matches)
            matches = config.sameOriginLoginFrames.includes(
              peer.contentWindow?.name,
            );
        } catch (_) {
          /* An unrelated cross-origin peer cannot expose its name. */
        }
        if (matches) {
          if (selected) return null;
          selected = peer;
        }
      }
      if (selected !== element) return null;
      return {
        parent,
        element,
        document: parent.document,
        href: parent.location.href,
      };
    } catch (_) {
      // Cross-origin and opaque sandbox contexts must fail closed, including
      // when the top document navigates while a native key receipt is pending.
      return null;
    }
  }
  function currentLoginContext() {
    if (topDocument) return window.top === window;
    const frame = authorizedLoginFrame();
    return !!(
      loginFrame &&
      frame &&
      frame.parent === loginFrame.parent &&
      frame.element === loginFrame.element &&
      frame.document === loginFrame.document &&
      frame.href === loginFrame.href
    );
  }
  function stopWatchingParent() {
    if (loginFrame) {
      try {
        for (const event of parentNavigationEvents)
          loginFrame.parent.removeEventListener(event, cancel);
      } catch (_) {
        /* The parent may already have navigated cross-origin. */
      }
    }
  }
  function current() {
    return (
      !stopped &&
      document === doc &&
      currentLoginContext() &&
      (location.protocol === "https:" || location.protocol === "http:") &&
      location.origin === origin &&
      (configuration?.provider || routing || location.href === initialHref)
    );
  }
  // Native key events start only after the main document's load end, and
  // every stage is released once per attempt. Ask for nothing before it: the
  // wait is never charged to a credential, and a document replaced while it
  // loads leaves every release to its successor.
  function mainDocumentLoaded() {
    try {
      return (loginFrame ? loginFrame.document : doc).readyState === "complete";
    } catch (_) {
      return false;
    }
  }
  // True while the field holds only what native typing has entered so far.
  function typedPrefix(value, typed, text) {
    return !!text && typed === text.length && value.startsWith(text);
  }
  function cancel() {
    stopped = true;
    stopWatchingParent();
    if (keyboard) keyboard.cancel();
    clearTimeout(startTimer);
    clearTimeout(expiryTimer);
    if (cancelActive) cancelActive();
    cancelActive = null;
  }
  function report(result) {
    // Fixed status only. Never forward arbitrary messages or provider data.
    notify(
      result?.reason === "challenge-timeout"
        ? "challenge-timeout"
        : result && result.ok
          ? "form-completed"
          : "form-rejected",
    );
  }
  // HTTP documents have getRandomValues but no SubtleCrypto. Keep the same
  // salted SHA-256 edit/identity receipts without retaining credential text.
  function sha256(input) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ]);
    const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
    const words = new Uint32Array(64);
    const view = new DataView(padded.buffer);
    const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
    try {
      padded.set(input);
      padded[input.length] = 0x80;
      view.setUint32(padded.length - 8, Math.floor(input.length / 0x20000000));
      view.setUint32(padded.length - 4, input.length * 8);
      for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
          const x = words[i - 15],
            y = words[i - 2];
          const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
          const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
          words[i] = words[i - 16] + s0 + words[i - 7] + s1;
        }
        let [a, b, c, d, e, f, g, h] = state;
        for (let i = 0; i < 64; i++) {
          const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
          const choice = (e & f) ^ (~e & g);
          const t1 = (h + s1 + choice + constants[i] + words[i]) | 0;
          const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
          const majority = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (s0 + majority) | 0;
          h = g;
          g = f;
          f = e;
          e = (d + t1) | 0;
          d = c;
          c = b;
          b = a;
          a = (t1 + t2) | 0;
        }
        const block = [a, b, c, d, e, f, g, h];
        for (let i = 0; i < 8; i++) state[i] += block[i];
      }
      const result = new Uint8Array(32);
      const output = new DataView(result.buffer);
      for (let i = 0; i < 8; i++) output.setUint32(i * 4, state[i]);
      return result;
    } finally {
      padded.fill(0);
      words.fill(0);
      state.fill(0);
    }
  }
  async function credentialDigest(value, salt) {
    const bytes = new TextEncoder().encode(value);
    const input = new Uint8Array(salt.length + bytes.length);
    input.set(salt);
    input.set(bytes, salt.length);
    bytes.fill(0);
    try {
      const hash = crypto.subtle
        ? new Uint8Array(await crypto.subtle.digest("SHA-256", input))
        : sha256(input);
      return Array.from(hash).join(",");
    } finally {
      input.fill(0);
    }
  }
  // Dedicated provider contracts. Each request is made only after its exact
  // controls settle; no password is held while an SPA paints the next stage.
  // Polling is bounded readiness observation, never a fill/submit retry loop.
  function providerClient(
    provider,
    timing = { fillDelayMs: 0, submitDelayMs: 0 },
  ) {
    const providers = [
      "bitwarden-self-hosted",
      "synology-dsm",
      "cloudflare",
      "voip-phone",
      "adobe-admin-console",
      "chatgpt",
      "claude",
      "google-account",
    ];
    if (
      !providers.includes(provider) ||
      !current() ||
      !timing ||
      Array.isArray(timing) ||
      Object.keys(timing).some(
        (key) => !["fillDelayMs", "submitDelayMs"].includes(key),
      ) ||
      ["fillDelayMs", "submitDelayMs"].some(
        (key) =>
          !Number.isInteger(timing[key]) ||
          timing[key] < 0 ||
          timing[key] > 30000,
      )
    )
      return () => false;
    const initial = new URL(location.href);
    const limit =
      now() + 60000 + 2 * (timing.fillDelayMs + timing.submitDelayMs);
    const consumed = new Set();
    let stage =
      provider === "voip-phone"
        ? "form"
        : provider === "chatgpt" &&
            origin === "https://auth.openai.com" &&
            location.pathname === "/log-in/password"
          ? "bound-password"
          : provider === "google-account" &&
              /^\/(v3\/signin|signin\/v2|signin)\/challenge\/pwd$/.test(
                location.pathname,
              )
            ? "password"
            : "identifier";
    let pending = null,
      stable = null,
      stableSince = 0,
      action = null;
    let owned = [],
      identifierHash = null,
      bitwarden = null;
    let timer,
      secretTimer,
      packet = null,
      busy = false;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    function dropPacket() {
      if (packet) packet.username = packet.password = "";
      packet = null;
    }
    function clearOwned() {
      for (const entry of owned) {
        // A manual edit belongs to the user, even during cancellation. Text
        // native typing entered is erased whole or partial.
        const text = entry.element.value;
        if (
          entry.value !== null &&
          (text === entry.value || typedPrefix(entry.value, entry.typed, text))
        )
          clearFilledField(entry.element);
        else if (entry.hash) {
          const value = entry.element.value,
            hash = entry.hash;
          identityDigest(value)
            .then((actual) => {
              if (actual === hash && entry.element.value === value)
                clearFilledField(entry.element);
            })
            .catch(() => {});
        }
        entry.value = "";
        entry.hash = null;
      }
      owned = [];
    }
    function finish(ok) {
      if (stopped) return;
      if (keyboard) keyboard.cancel();
      if (!ok) clearOwned();
      for (const entry of owned) entry.value = "";
      owned = [];
      dropPacket();
      clearInterval(timer);
      clearTimeout(secretTimer);
      window.removeEventListener("hashchange", navigation);
      window.removeEventListener("popstate", navigation);
      pending = stable = action = identifierHash = bitwarden = null;
      cancelActive = null;
      stopped = true;
      doc.removeEventListener("input", edited, true);
      doc.removeEventListener("click", edited, true);
      notify(ok ? "form-completed" : "form-rejected");
    }
    function edited(event) {
      if (!event.isTrusted) return;
      if (!keyboard?.ownsEvent(event)) return finish(false);
      const entry = owned.find((item) => item.element === event.target);
      if (entry) entry.typed = event.target.value.length;
    }
    function painted(node) {
      if (
        !node ||
        node.ownerDocument !== doc ||
        !node.isConnected ||
        !node.getClientRects().length
      )
        return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
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
    function only(root, selector, visible = false) {
      const nodes = Array.from(root.querySelectorAll(selector)).filter(
        (node) => !visible || painted(node),
      );
      return nodes.length === 1 ? nodes[0] : null;
    }
    function blocked() {
      if (
        window._cf_chl_opt ||
        doc.querySelector(
          "#challenge-form, #challenge-running, #challenge-stage",
        )
      )
        return true;
      const responses = doc.querySelectorAll(
        'input[name="cf-turnstile-response"]',
      );
      const completedTurnstile =
        provider === "cloudflare" &&
        responses.length === 1 &&
        responses[0].value.trim();
      return Array.from(
        doc.querySelectorAll(
          'input[autocomplete="one-time-code"], input[autocomplete="new-password"], ' +
            'input[name*="otp" i], input[name*="captcha" i]:not([type="hidden"]), input[name*="verification" i], ' +
            'input[name*="recovery" i], input[type="file"], iframe, .cf-turnstile, [role="dialog"], [role="alert"], [aria-invalid="true"]',
        ),
      ).some((node) => {
        if (
          completedTurnstile &&
          (node.matches(".cf-turnstile") ||
            (node.tagName === "IFRAME" &&
              new URL(node.getAttribute("src") || "about:blank", doc.baseURI)
                .origin === "https://challenges.cloudflare.com"))
        )
          return false;
        return (
          painted(node) &&
          (node.getAttribute("role") !== "alert" || node.textContent.trim())
        );
      });
    }
    function route() {
      // The limit bounds detection. A delivered credential or action keeps
      // its own validity instead.
      const live = packet !== null || owned.length > 0 || action !== null;
      if (
        !current() ||
        now() >= (live ? Math.max(limit, expires) : limit) ||
        new URL(location.href).searchParams.has("error")
      )
        return false;
      switch (provider) {
        case "google-account":
          return (
            origin === "https://accounts.google.com" &&
            !location.hash &&
            (stage === "identifier"
              ? /^\/(v3\/signin|signin\/v2|signin)\/identifier$/.test(
                  location.pathname,
                )
              : /^\/(v3\/signin|signin\/v2|signin)\/(identifier|challenge\/pwd)$/.test(
                  location.pathname,
                ))
          );
        case "cloudflare":
          return (
            origin === "https://dash.cloudflare.com" &&
            location.href === initial.href &&
            ["/login", "/login/"].includes(location.pathname) &&
            !location.hash
          );
        case "claude":
          return (
            origin === "https://claude.ai" &&
            location.href === initial.href &&
            ["/login", "/login/"].includes(location.pathname) &&
            !location.hash
          );
        case "chatgpt":
          return (
            !location.hash &&
            (stage === "identifier"
              ? (origin === "https://chatgpt.com" &&
                  location.pathname === "/auth/login") ||
                (origin === "https://auth.openai.com" &&
                  location.pathname === "/log-in")
              : origin === "https://auth.openai.com" &&
                ["/log-in", "/log-in/password"].includes(location.pathname))
          );
        case "adobe-admin-console":
          return (
            origin === "https://auth.services.adobe.com" &&
            location.pathname === "/en_US/index.html" &&
            location.search === initial.search &&
            (stage === "identifier"
              ? ["", "#", "#/"].includes(location.hash)
              : ["", "/", "/password"].includes(
                  location.hash.slice(1).split("?")[0],
                ))
          );
        case "synology-dsm":
          return (
            location.pathname === initial.pathname &&
            location.search === initial.search &&
            (stage === "identifier"
              ? ["", "#", "#/", "#/signin", "#/signin/"].includes(location.hash)
              : [
                  "",
                  "#",
                  "#/",
                  "#/signin",
                  "#/signin/",
                  "#/signin/password",
                ].includes(location.hash))
          );
        default:
          return location.href === initial.href;
      }
    }
    function fingerprint(target) {
      const { form, button, field } = target;
      if (
        !form ||
        !button ||
        !field ||
        !painted(field) ||
        !painted(button) ||
        (field.form !== form &&
          !(
            provider === "google-account" &&
            !field.form &&
            form.contains(field)
          )) ||
        field.readOnly ||
        field.matches(":disabled") ||
        field.hasAttribute("form") ||
        button.hasAttribute("form") ||
        ["formaction", "formmethod", "formtarget", "formenctype"].some((name) =>
          button.hasAttribute(name),
        )
      )
        return null;
      const actionUrl = new URL(
        form.getAttribute("action") || location.href,
        doc.baseURI,
      );
      const method = form.getAttribute("method");
      const context =
        form.getAttribute("target") ??
        doc.querySelector("base[target]")?.getAttribute("target") ??
        "";
      if (
        actionUrl.origin !== origin ||
        actionUrl.username ||
        actionUrl.password ||
        (method !== null && method.toLowerCase() !== "post") ||
        (context && context.toLowerCase() !== "_self")
      )
        return null;
      if (
        ["chatgpt", "claude", "adobe-admin-console", "cloudflare"].includes(
          provider,
        ) &&
        actionUrl.pathname !== location.pathname
      )
        return null;
      if (
        /signup|register|reset|recovery|confirm|new.?password|otp|verification/i.test(
          field.name,
        ) ||
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
      return JSON.stringify([
        location.href,
        doc.baseURI,
        actionUrl.href,
        method,
        context,
        form.enctype,
        field.name,
        field.type,
        field.autocomplete,
        target.identity?.value,
        target.user?.name,
        target.user?.type,
        target.user?.autocomplete,
        target.extra?.map((node) => [
          node.name,
          node.type,
          node.getAttribute("onclick"),
          node.getAttribute("onsubmit"),
        ]),
      ]);
    }
    function locate() {
      if (!route() || blocked() || doc.readyState === "loading") return null;
      let field,
        button,
        form,
        identity = null,
        user = null,
        extra = [];
      if (provider === "bitwarden-self-hosted") {
        user = only(
          doc,
          'form input#email[type="email"][data-testid="login-email-input"]',
        );
        const pass = only(
          doc,
          'form input#masterPassword[type="password"][data-testid="login-master-password-input"]',
        );
        const next = only(
          doc,
          'form button[type="button"][data-testid="login-continue-button"]',
        );
        const submit = only(
          doc,
          'form button[type="submit"][data-testid="login-submit-button"]',
        );
        if (
          !user ||
          !pass ||
          !next ||
          !submit ||
          !user.form ||
          [pass, next, submit].some((node) => node.form !== user.form)
        )
          return null;
        extra = [user, pass, next, submit];
        if (bitwarden && extra.some((node, index) => node !== bitwarden[index]))
          throw new Error("replaced");
        form = user.form;
        field = stage === "identifier" ? user : pass;
        button = stage === "identifier" ? next : submit;
        if (
          stage === "identifier"
            ? painted(pass) || painted(submit)
            : painted(user) || painted(next)
        )
          return null;
        if (stage === "password") identity = user;
      } else if (provider === "google-account") {
        if (
          stage === "password" &&
          !/^\/(v3\/signin|signin\/v2|signin)\/challenge\/pwd$/.test(
            location.pathname,
          )
        )
          return null;
        field = only(
          doc,
          stage === "identifier"
            ? 'input#identifierId[name="identifier"][type="email"], input#identifierId[name="identifier"][type="text"]'
            : 'input[name="Passwd"][type="password"]',
        );
        const id = stage === "identifier" ? "identifierNext" : "passwordNext";
        // Google's server-rendered form omits type on its Next button (the
        // HTML default is submit). Keep the exact reviewed ID and the form,
        // origin, method and target checks below for this variant too.
        button = only(
          doc,
          `#${id} button[type="button"], #${id} button[type="submit"], #${id} button:not([type]), button#${id}[type="button"], button#${id}[type="submit"], button#${id}:not([type])`,
        );
        // Next may be disabled until input validation completes. Keep the
        // reviewed target stable while filling; ready() gates the later click
        // on enabled/non-busy controls within the existing grant deadline.
        if (!field || !button) return null;
        form = field.form || doc.body;
        if (!field.form && (button.form || button.type !== "button"))
          return null;
        if (stage === "password") {
          // Google's password panel includes a labelled Show password toggle.
          // It is not a credential or consent field: accept only one unchecked,
          // unnamed control in this exact form and never change its state.
          const toggles = Array.from(
            form.querySelectorAll('input[type="checkbox"]'),
          ).filter(painted);
          if (toggles.length > 1) return null;
          if (toggles.length === 1) {
            const toggle = toggles[0];
            const labels = Array.from(toggle.labels || []).filter(painted);
            if (
              toggle.form !== field.form ||
              toggle.name ||
              toggle.checked ||
              toggle.required ||
              toggle.disabled ||
              toggle.readOnly ||
              toggle.hasAttribute("form") ||
              labels.length !== 1 ||
              !form.contains(labels[0]) ||
              !labels[0].textContent.trim() ||
              (toggle.hasAttribute("aria-labelledby") &&
                toggle.getAttribute("aria-labelledby") !== labels[0].id)
            )
              return null;
            // Keep the exact checkbox and label in the target snapshot. A
            // replacement/changed association during delivery fails closed.
            extra = [toggle, labels[0]];
          }
        }
      } else if (provider === "synology-dsm") {
        const roots = doc.querySelectorAll("#sds-login-vue-inst");
        const root =
          roots.length === 1
            ? roots[0]
            : roots.length
              ? null
              : only(doc, "#sds-login-vue");
        if (!root) return null;
        if (stage === "password" && location.hash !== "#/signin/password")
          return null;
        form = only(
          root,
          stage === "identifier"
            ? "form#dsm-user-fieldset"
            : "form#dsm-pass-fieldset",
        );
        if (!form) return null;
        field = only(
          form,
          stage === "identifier"
            ? 'input[syno-id="username"][type="text"][name="username"][autocomplete="username"]'
            : 'input[syno-id="password"][type="password"][name="current-password"][autocomplete="current-password"]',
        );
        const panel = form.closest(".login-tabs-content-wrapper");
        if (!panel || !root.contains(panel)) return null;
        button = only(
          panel,
          stage === "identifier"
            ? 'div[role="button"][syno-id="account-panel-next-btn"]'
            : 'div[role="button"][syno-id="password-panel-next-btn"]',
        );
        if (!button)
          button = only(panel, ":scope > div.login-btn-mobile:not([syno-id])");
        extra = [root, panel];
      } else if (provider === "adobe-admin-console") {
        if (
          stage === "password" &&
          location.hash.slice(1).split("?")[0] !== "/password"
        )
          return null;
        form = only(
          doc,
          stage === "identifier" ? "form#EmailForm" : "form#PasswordForm",
        );
        if (!form) return null;
        field = only(
          form,
          stage === "identifier"
            ? 'input#EmailPage-EmailField[name="username"][type="email"]'
            : 'input#PasswordPage-PasswordField[name="password"][type="password"]',
        );
        button = only(
          form,
          stage === "identifier"
            ? 'button[data-id="EmailPage-ContinueButton"][type="submit"]'
            : 'button[data-id="PasswordPage-ContinueButton"][type="submit"]',
        );
        if (stage === "password") {
          identity = only(
            form,
            'input[name="username"][autocomplete="username"]',
          );
          if (!identity || painted(identity) || !identity.readOnly) return null;
        }
      } else if (provider === "voip-phone") {
        // Keyless SIP-T20P only: the reviewed OnConfirm handler owns encryption
        // and submission. Never requestSubmit(), Enter or HTTP-auth fallback.
        form = only(doc, 'form[name="formInput"]');
        const model = only(doc, "#loginPhoneModel");
        if (!form || !model) return null;
        const copy = model.cloneNode(true);
        copy
          .querySelectorAll("script,style,template,noscript,[hidden],[inert]")
          .forEach((node) => node.remove());
        const handler = (value) =>
          (value || "").replace(/\s/g, "").replace(/;$/, "");
        const url = new URL(form.action, doc.baseURI);
        if (
          copy.textContent.trim() !== "Enterprise IP phone SIP-T20P" ||
          form.method !== "post" ||
          (form.getAttribute("autocomplete") || "").toLowerCase() !== "off" ||
          handler(form.getAttribute("onsubmit")) !== "returnfalse" ||
          typeof form.onsubmit !== "function" ||
          typeof window.OnConfirm !== "function" ||
          url.pathname !== "/servlet" ||
          url.hash ||
          [...url.searchParams].length !== 2 ||
          url.searchParams.get("p") !== "login" ||
          url.searchParams.get("q") !== "login"
        )
          return null;
        user = only(form, 'input[name="username"][type="text"]');
        field = only(form, 'input[name="pwd"][type="password"]');
        button = only(form, 'input#idConfirm[type="button"]');
        const clear = only(form, 'input#idCancel[type="button"]');
        const jump = only(form, 'input[name="jumpto"][type="hidden"]');
        const acc = only(form, 'input[name="acc"][type="hidden"]');
        if (
          !user ||
          !button ||
          !clear ||
          !jump ||
          !acc ||
          jump.value !== "status" ||
          acc.value !== "" ||
          handler(button.getAttribute("onclick")) !== "OnConfirm()" ||
          typeof button.onclick !== "function" ||
          handler(clear.getAttribute("onclick")) !== "OnClear()" ||
          !painted(user) ||
          user.readOnly ||
          user.matches(":disabled")
        )
          return null;
        extra = [model, clear, jump, acc];
      } else {
        if (
          provider === "chatgpt" &&
          stage !== "identifier" &&
          location.pathname !== "/log-in/password"
        )
          return null;
        field = only(
          doc,
          stage === "identifier"
            ? 'form input[type="email"], form input[autocomplete="username"]:not([type="hidden"]), form input[name="email"][type="text"]'
            : 'form input[type="password"]',
          true,
        );
        form = field?.form;
        if (!form) return null;
        button = only(
          form,
          'button[type="submit"], input[type="submit"]',
          true,
        );
        if (stage === "password" || stage === "bound-password") {
          identity = only(
            form,
            'input[type="email"], input[autocomplete="username"], input[name="email"], input[name="username"]',
          );
          if (stage === "bound-password" && (!identity || !identity.value))
            return null;
          if (
            identity &&
            provider !== "cloudflare" &&
            painted(identity) &&
            !identity.readOnly &&
            !identity.disabled
          )
            return null;
        }
      }
      if (
        !field ||
        !button ||
        !form ||
        (button.form && button.form !== form) ||
        extra.some(
          (node) =>
            node.ownerDocument !== doc ||
            !node.isConnected ||
            node.hasAttribute("form") ||
            node.matches(":disabled"),
        )
      )
        return null;
      const allowed = new Set([field, user, identity, ...extra]);
      // Never fill registration, recovery, MFA or an ambiguous second login.
      if (
        Array.from(
          form.querySelectorAll("input,textarea,select,[contenteditable=true]"),
        ).some(
          (node) =>
            !allowed.has(node) &&
            painted(node) &&
            !["button", "submit", "hidden"].includes(node.type) &&
            !(
              provider === "cloudflare" &&
              stage === "identifier" &&
              node.type === "password" &&
              !node.value
            ),
        )
      )
        return null;
      const target = {
        field,
        button,
        form,
        identity,
        user,
        extra,
        onConfirm: provider === "voip-phone" ? window.OnConfirm : null,
        onclick: button.onclick,
        onsubmit: form.onsubmit,
      };
      target.fingerprint = fingerprint(target);
      return target.fingerprint ? target : null;
    }
    function same(a, b) {
      return (
        a &&
        b &&
        [
          "field",
          "button",
          "form",
          "identity",
          "user",
          "onConfirm",
          "onclick",
          "onsubmit",
          "fingerprint",
        ].every((key) => a[key] === b[key]) &&
        a.extra.length === b.extra.length &&
        a.extra.every((node, index) => node === b.extra[index])
      );
    }
    function valid(target) {
      return (
        current() &&
        ((action?.deferred && !action.authorized) || now() < expires) &&
        same(target, locate())
      );
    }
    function ready(target) {
      return (
        !target.button.matches(":disabled") &&
        !target.button.closest('[aria-disabled="true"], [aria-busy="true"]') &&
        !target.form.closest('[aria-busy="true"]') &&
        target.field.checkValidity()
      );
    }
    const identityDigest = (value) => credentialDigest(value, salt);
    async function ownedMatch() {
      const entries = owned.slice(),
        values = entries.map((entry) => entry.element.value);
      try {
        const hashes = await Promise.all(values.map(identityDigest));
        return entries.every(
          (entry, index) =>
            entry.hash === hashes[index] &&
            entry.element.value === values[index],
        );
      } finally {
        values.fill("");
      }
    }
    function advance(target, submit) {
      if (
        !valid(target) ||
        (!action?.deferred &&
          !owned.every((entry) => entry.element.value === entry.value))
      )
        return finish(false);
      const identifier = stage === "identifier";
      // A combined Cloudflare form needs no Next click. Each field still has
      // its own fresh delivery, including when consent permits filling only.
      const combined =
        provider === "cloudflare" &&
        identifier &&
        only(target.form, 'input[type="password"]', true);
      if (submit && !combined && !ready(target)) return;
      if (identifier && submit && !combined && provider !== "claude") {
        stage = "password";
        if (provider === "bitwarden-self-hosted") bitwarden = target.extra;
      } else if (combined) stage = "password";
      action = null;
      clearTimeout(secretTimer);
      if (submit && !combined) {
        // Prevent a missing-method SPA from falling back to a native GET.
        const prevent = (event) => event.preventDefault();
        if (!target.form.hasAttribute("method"))
          target.form.addEventListener("submit", prevent, true);
        try {
          target.button.click();
        } finally {
          target.form.removeEventListener("submit", prevent, true);
        }
      }
      for (const entry of owned) entry.value = "";
      owned = [];
      if (!identifier || provider === "claude" || (!submit && !combined))
        finish(true);
    }
    async function tick() {
      if (stopped || busy) return;
      busy = true;
      try {
        if (!route()) return finish(false);
        if (action) {
          if (!valid(action.target)) return finish(false);
          if (now() >= action.at && (!action.submit || ready(action.target))) {
            if (action.deferred) {
              if (!(await ownedMatch()) || !valid(action.target))
                return finish(false);
              if (!action.authorized) {
                if (!pending) {
                  const code =
                    stage === "identifier"
                      ? "id-submit"
                      : stage === "form"
                        ? "form-submit"
                        : "pw-submit";
                  pending = { stage: code, target: action.target };
                  notify(code);
                }
                return;
              }
            }
            advance(action.target, action.submit);
          }
          return;
        }
        if (pending || consumed.has(stage)) return;
        const found = locate();
        if (!found) {
          stable = null;
          return;
        }
        if (found.field.value || (stage === "form" && found.user.value))
          return finish(false);
        if (!same(stable, found)) {
          stable = found;
          stableSince = now();
          return;
        }
        if (
          now() - stableSince < Math.max(400, timing.fillDelayMs) ||
          !mainDocumentLoaded()
        )
          return;
        pending = { stage, target: found };
        stable = null;
        notify(stage);
      } catch (_) {
        finish(false);
      } finally {
        busy = false;
      }
    }
    async function consume(target, deliveredStage, autoSubmit) {
      try {
        const data = packet;
        if (
          deliveredStage === "identifier" ||
          deliveredStage === "bound-password"
        )
          identifierHash = await identityDigest(data.username);
        if (
          deliveredStage === "password" ||
          deliveredStage === "bound-password"
        ) {
          if (
            (!identifierHash && provider !== "google-account") ||
            (target.identity &&
              (await identityDigest(target.identity.value)) !== identifierHash)
          )
            throw new Error("identity");
        }
        if (!valid(target) || !data || packet !== data)
          throw new Error("expired");
        const write = async (element, value, field) => {
          owned.push({ element, value });
          await writeCredential(
            element,
            value,
            () => valid(target),
            deliveredStage,
            field,
          );
          if (!valid(target) || element.value !== value)
            throw new Error("changed");
        };
        if (deliveredStage === "form")
          await write(target.user, data.username, "username");
        await write(
          target.field,
          deliveredStage === "identifier" ? data.username : data.password,
          deliveredStage === "identifier" ? "username" : "password",
        );
        dropPacket();
        const combined =
          provider === "cloudflare" &&
          stage === "identifier" &&
          only(target.form, 'input[type="password"]', true);
        const deferred = autoSubmit && !combined && timing.submitDelayMs > 0;
        if (deferred) {
          await Promise.all(
            owned.map(async (entry) => {
              try {
                entry.hash = await identityDigest(entry.value);
              } finally {
                entry.value = null;
              }
            }),
          );
          if (!valid(target)) throw new Error("expired");
          clearTimeout(secretTimer);
        }
        action = {
          target,
          submit: autoSubmit,
          deferred,
          authorized: false,
          at:
            now() +
            Math.max(
              provider === "cloudflare" ? 750 : 400,
              autoSubmit && !combined ? timing.submitDelayMs : 0,
            ),
        };
      } catch (_) {
        finish(false);
      }
    }
    cancelActive = () => finish(false);
    // Cancel synchronously; a navigation must not leave a deferred click alive.
    const navigation = () => {
      if (!route() || pending || action) finish(false);
    };
    window.addEventListener("pagehide", () => finish(false), { once: true });
    window.addEventListener("unload", () => finish(false), { once: true });
    window.addEventListener("hashchange", navigation);
    window.addEventListener("popstate", navigation);
    doc.addEventListener("input", edited, true);
    doc.addEventListener("click", edited, true);
    timer = setInterval(tick, 100);
    return function (
      expectedOrigin,
      username,
      password,
      autoSubmit,
      deadline,
      deliveredStage,
    ) {
      const isAction = ["id-submit", "pw-submit", "form-submit"].includes(
        deliveredStage,
      );
      if (
        !current() ||
        expectedOrigin !== origin ||
        !pending ||
        pending.stage !== deliveredStage ||
        consumed.has(deliveredStage) ||
        typeof username !== "string" ||
        typeof password !== "string" ||
        typeof autoSubmit !== "boolean" ||
        !Number.isFinite(deadline) ||
        deadline <= now() ||
        (isAction
          ? username !== "" || password !== ""
          : deliveredStage === "identifier"
            ? !username || password !== ""
            : deliveredStage === "password"
              ? username !== "" || !password
              : !username || !password)
      )
        return false;
      const target = pending.target;
      pending = null;
      consumed.add(deliveredStage);
      expires = Math.min(deadline, now() + CREDENTIAL_LIMIT_MS);
      secretTimer = setTimeout(
        () => finish(false),
        Math.max(0, expires - now()),
      );
      if (isAction) {
        if (!action || !autoSubmit) {
          finish(false);
          return false;
        }
        action.authorized = true;
        return true;
      }
      packet = { username, password };
      consume(target, deliveredStage, autoSubmit);
      return true;
    };
  }
  if (
    configuration &&
    Object.prototype.hasOwnProperty.call(configuration, "provider")
  ) {
    if (
      Object.keys(configuration).some(
        (key) => !["provider", "timing"].includes(key),
      )
    )
      return () => false;
    return attachKeyboard(
      providerClient(configuration.provider, configuration.timing),
    );
  }
  const sharedVisible = isVisible;
  isVisible = function (element) {
    // A disabled submit control can be the stable, selected SPA control. Its
    // enabled state gates the later action grant, not credential-free discovery
    // or filling (many frameworks enable it only after input validation).
    if (
      adapter === "modular-form" &&
      element &&
      (element.tagName === "BUTTON" ||
        (element.tagName === "INPUT" &&
          ["button", "submit"].includes(element.type)))
    ) {
      if (element.ownerDocument !== doc || !element.isConnected) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          parent.hidden ||
          parent.hasAttribute("inert") ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
      }
      return (
        element.offsetParent !== null ||
        getComputedStyle(element).position === "fixed"
      );
    }
    return sharedVisible(element);
  };
  const sharedFind = findLoginForm;
  findLoginForm = function (selectors, options) {
    if (!current() || (delivered && now() >= expires)) return null;
    const target = sharedFind(selectors, options);
    // Native delivery belongs to this exact authorized document. Never search
    // another frame for controls, even when its origin and name would match.
    if (!target || target.pw.ownerDocument !== doc) return null;
    if (target.exchangeEcp) {
      const destination = target.form.querySelector(
        'input[name="destination"]',
      );
      if (
        !destination ||
        new URL(destination.value, doc.baseURI).origin !== origin
      )
        return null;
    }
    return target;
  };
  const sharedSame = sameCapturedTarget;
  const sharedFingerprint = targetFingerprint;
  targetFingerprint = function (target) {
    const submit = target.submit || findSubmitButton(target);
    const form = target.form;
    if (
      submit &&
      submit.hasAttribute("formmethod") &&
      submit.getAttribute("formmethod").toLowerCase() !== "post"
    ) {
      throw new Error("unsafe-form-method");
    }
    const destination =
      submit && submit.hasAttribute("formtarget")
        ? submit.getAttribute("formtarget")
        : ((form && form.getAttribute("target")) ??
          doc.querySelector("base[target]")?.getAttribute("target") ??
          "");
    // Porkbun's reviewed handler owns its deliberate dummy-frame contract.
    if (
      !target.porkbun &&
      destination &&
      destination.toLowerCase() !== "_self"
    ) {
      throw new Error("unsafe-form-target");
    }
    return sharedFingerprint(target);
  };
  sameCapturedTarget = function (captured, selectors, options) {
    return (
      current() && now() < expires && sharedSame(captured, selectors, options)
    );
  };
  const sharedFill = fillField;
  fillField = function (element, value, guard, postGuard) {
    const checked = (inner) => () =>
      current() &&
      now() < expires &&
      element.ownerDocument === doc &&
      element.isConnected &&
      (!inner || inner());
    return sharedFill(
      element,
      value,
      checked(guard),
      checked(postGuard || guard),
    );
  };
  function deferredFormClient() {
    let phase = "readiness",
      done = false,
      captured = null,
      metadata = null;
    let timer,
      lifetime,
      records = [],
      busy = false,
      eligibleAt = 0,
      waitDeadline = 0;
    let controlHash = null,
      quietSince = 0;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const digest = (value) => credentialDigest(value, salt);
    function scrub(entries, erase) {
      for (const entry of entries) {
        const value = entry.value;
        entry.value = null;
        if (!erase) {
          entry.hash = null;
          continue;
        }
        if (value !== null) {
          // Erase what native typing entered, whole or partial; never a value
          // somebody else changed.
          const text = entry.element.value;
          if (text === value || typedPrefix(value, entry.typed, text))
            clearFilledField(entry.element);
        } else if (entry.hash) {
          // No cleartext remains in the waiting action. Compare before clearing
          // so cancellation never erases a user's replacement value.
          const currentValue = entry.element.value;
          const hash = entry.hash;
          digest(currentValue)
            .then((actual) => {
              if (actual === hash && entry.element.value === currentValue)
                clearFilledField(entry.element);
            })
            .catch(() => {});
        }
        entry.hash = null;
      }
    }
    function finish(ok, status) {
      if (done) return;
      if (keyboard) keyboard.cancel();
      done = true;
      stopped = true;
      stopWatchingParent();
      clearInterval(timer);
      clearTimeout(lifetime);
      clearTimeout(expiryTimer);
      scrub(records, !ok);
      records = [];
      if (captured)
        captured.extras.forEach((field) => {
          field.value = "";
        });
      captured = metadata = null;
      cancelActive = null;
      doc.removeEventListener("input", edited, true);
      doc.removeEventListener("click", edited, true);
      if (status !== null) notify(ok ? "form-completed" : "form-rejected");
    }
    function edited(event) {
      if (!event.isTrusted) return;
      if (!keyboard?.ownsEvent(event)) return finish(false);
      const entry = records.find((item) => item.element === event.target);
      if (entry) entry.typed = event.target.value.length;
    }
    // No deadline covers the whole attempt. Finding the form has the detection
    // deadline; every later wait starts its own bound here.
    function bound(ms) {
      waitDeadline = now() + ms;
      clearTimeout(lifetime);
      lifetime = setTimeout(() => finish(false), Math.max(0, ms));
    }
    function valid() {
      if (done || !current() || now() >= waitDeadline || !captured)
        return false;
      // Extra values are separately hashed; do not keep them in the shared
      // capture while a saved delay or disabled button is being observed.
      return (
        sharedSame({ ...captured, extras: [] }, config.selectors, metadata) &&
        captured.extras.every((field) => {
          const nodes = captured.target.form.querySelectorAll(field.selector);
          return (
            nodes.length === 1 &&
            nodes[0] === field.element &&
            field.element.type === field.type &&
            field.element.name === field.name &&
            field.element.id === field.id &&
            allowedExtra(field.element, captured.target)
          );
        })
      );
    }
    async function valuesMatch() {
      if (!valid()) return false;
      const entries = records.slice();
      const values = entries.map((entry) => entry.element.value);
      try {
        const hashes = await Promise.all(values.map(digest));
        return (
          valid() &&
          entries.every(
            (entry, index) =>
              entry.hash === hashes[index] &&
              entry.element.value === values[index],
          )
        );
      } finally {
        values.fill("");
      }
    }
    function controlsReady() {
      const target = captured.target;
      if (phase === "waiting-fill" && config.readinessProfile !== "cpanel")
        return true;
      return (
        (!target.submit ||
          (!target.submit.matches(":disabled") &&
            !target.submit.closest(
              '[aria-busy="true"], [aria-disabled="true"], [inert]',
            ))) &&
        (config.readinessProfile !== "cpanel" ||
          (doc.readyState === "complete" &&
            target.user &&
            target.form &&
            typeof target.form.onsubmit === "function"))
      );
    }
    async function controlsSettled() {
      if (config.readinessProfile !== "cpanel") return true;
      // Track cPanel's property-only hydration with a digest, never a cached
      // cleartext form snapshot during a deferred submission.
      const hash = await digest(
        JSON.stringify(
          Array.from(captured.target.form.elements).map((field) => [
            field.name,
            field.type,
            field.value,
            field.checked,
            field.disabled,
          ]),
        ),
      );
      if (hash !== controlHash) {
        controlHash = hash;
        quietSince = now();
        return false;
      }
      return now() - quietSince >= 250;
    }
    function prepare() {
      if (done || phase !== "found") return;
      // An address change since the form was found ends the attempt before
      // anything is requested, also when no event announced it.
      if (!current()) return finish(false);
      if (!mainDocumentLoaded()) return;
      phase = "form-prepare";
      bound(GRANT_WAIT_MS);
      notify(phase);
    }
    async function tick() {
      if (phase === "readiness") return detect();
      if (phase === "found") return prepare();
      if (done || busy || !["waiting-fill", "waiting-submit"].includes(phase))
        return;
      busy = true;
      try {
        if (!valid()) return finish(false);
        if (now() < eligibleAt || !controlsReady()) return;
        if (!(await controlsSettled()) || !valid()) return;
        if (
          phase === "waiting-fill" &&
          (captured.target.pw.value || captured.target.user?.value)
        )
          return finish(false);
        if (phase === "waiting-submit" && !(await valuesMatch()))
          return finish(false);
        // A credential request gets its own bound. A submit request stays
        // under the one that began when the fill ended, so typed values never
        // outlive it.
        if (phase === "waiting-fill") bound(GRANT_WAIT_MS);
        phase = phase === "waiting-fill" ? "form" : "form-submit";
        notify(phase);
      } catch (_) {
        finish(false);
      } finally {
        busy = false;
      }
    }
    function timing(options) {
      return JSON.stringify([
        options.formSelector,
        options.fillDelayMs,
        options.submitDelayMs,
        options.detectionTimeoutMs,
        options.submit,
      ]);
    }
    async function fill(username, password, options, autoSubmit) {
      try {
        if (
          !valid() ||
          now() >= expires ||
          timing(options) !== timing(metadata)
        )
          throw new Error("changed");
        const target = captured.target;
        if (target.pw.value || target.user?.value) throw new Error("edited");
        captured = captureTarget(target, options);
        const writes = [
          target.user && [target.user, username, "username"],
          [target.pw, password, "password"],
          ...captured.extras.map((field, index) => [
            field.element,
            field.value,
            `extra${index}`,
          ]),
        ].filter(Boolean);
        const guard = () => valid() && now() < expires;
        for (const [element, value, field] of writes) {
          if (!guard()) throw new Error("expired");
          const entry = { element, value, hash: null };
          records.push(entry);
          await writeCredential(element, value, guard, "form", field);
          if (!guard() || element.value !== value) throw new Error("changed");
        }
        // Drop function-local cleartext before the asynchronous action wait.
        username = password = "";
        writes.forEach((write) => {
          write[1] = "";
        });
        captured.extras.forEach((field) => {
          field.value = "";
        });
        options.fields.forEach((field) => {
          field.value = "";
        });
        await Promise.all(
          records.map(async (entry) => {
            try {
              entry.hash = await digest(entry.value);
            } finally {
              entry.value = null;
            }
          }),
        );
        if (!guard()) throw new Error("expired");
        clearTimeout(expiryTimer);
        if (
          !autoSubmit ||
          !options.submit ||
          captured.joomlaMfa ||
          hasJoomlaTwoFactorField(target)
        )
          return finish(true);
        phase = "waiting-submit";
        eligibleAt =
          now() +
          Math.max(
            options.submitDelayMs,
            config.readinessProfile === "cpanel"
              ? CPANEL_POLICY.submitSettleMs
              : 0,
          );
        // The submit control, the saved delay and the submit grant get the
        // saved detection time again; after it the typed values are erased.
        bound(metadata.detectionTimeoutMs);
        tick();
      } catch (_) {
        finish(false);
      } finally {
        username = password = "";
        options.fields.forEach((field) => {
          field.value = "";
        });
      }
    }
    async function submit(autoSubmit) {
      try {
        if (
          !autoSubmit ||
          !metadata.submit ||
          !(await valuesMatch()) ||
          now() >= expires ||
          !controlsReady()
        )
          return finish(false);
        if (captured.joomlaMfa || hasJoomlaTwoFactorField(captured.target))
          return finish(true);
        // Consume the sole action before invoking any page event handlers.
        phase = "submitted";
        guardedSubmit(
          captured.target,
          config.selectors,
          config.readinessProfile,
        );
        finish(true);
      } catch (_) {
        finish(false);
      }
    }
    routing = topDocument;
    // In a top document, finding the form has the saved detection time from
    // load end, not from navigation: a document that is slow to load has used
    // none of it. The wait for load end has its own bound, and nothing is
    // bound or asked during it.
    bound(SETTLE_WAIT_MS);
    function detect() {
      if (done || phase !== "readiness") return;
      if (topDocument && !mainDocumentLoaded()) return;
      phase = "detecting";
      clearTimeout(lifetime);
      waitForSelectedLoginForm(config.selectors, config.readiness).then(
        (result) => {
          // Found, or detection gave up: the attempt is bound to the address
          // it has now, and from here on any change of address ends it.
          if (routing) initialHref = location.href;
          routing = false;
          if (!current() || !result.ok)
            return finish(
              false,
              result.reason === "challenge-timeout" ? null : undefined,
            );
          // The detection deadline ends here: it governed finding the form.
          phase = "found";
          cancelActive = () => finish(false);
          bound(SETTLE_WAIT_MS);
          prepare();
        },
      );
    }
    startTimer = setTimeout(detect, 0);
    // Each step runs on the event that enables it: a grant, the end of the
    // fill, load end. The interval only serves time-based conditions.
    timer = setInterval(tick, 100);
    window.addEventListener("load", tick, { once: true });
    const abort = () => {
      if (cancelActive) cancelActive();
      finish(false);
    };
    window.addEventListener("pagehide", abort, { once: true });
    window.addEventListener("unload", abort, { once: true });
    // While the form is still being looked for an address change only moves
    // the address the attempt will be bound to. An event can also arrive late,
    // for a change made before the binding: it names another old address and
    // the bound one still stands.
    const routed = (event) => {
      if (routing) return;
      if (
        !topDocument ||
        location.href !== initialHref ||
        event.oldURL === initialHref
      )
        abort();
    };
    window.addEventListener("hashchange", routed);
    window.addEventListener("popstate", routed);
    doc.addEventListener("input", edited, true);
    doc.addEventListener("click", edited, true);
    return function (
      expectedOrigin,
      username,
      password,
      autoSubmit,
      deadline,
      rawOptions,
      deliveredStage,
    ) {
      if (!current()) {
        finish(false);
        return false;
      }
      if (
        done ||
        expectedOrigin !== origin ||
        deliveredStage !== phase ||
        !["form-prepare", "form", "form-submit"].includes(phase) ||
        typeof autoSubmit !== "boolean" ||
        !Number.isFinite(deadline) ||
        deadline <= now() ||
        (phase === "form"
          ? typeof username !== "string" ||
            !username ||
            typeof password !== "string" ||
            !password
          : username !== "" || password !== "")
      )
        return false;
      let options;
      try {
        options = normalizeFormOptions(rawOptions);
        if (rawOptions?.fields)
          rawOptions.fields.forEach((field) => {
            field.value = "";
          });
        if (phase !== "form" && options.fields.length)
          throw new Error("metadata-secrets");
        // Typing gets the credential's own validity, never what detection or
        // the wait for load end left over.
        expires = Math.min(deadline, now() + CREDENTIAL_LIMIT_MS);
        if (phase === "form-prepare") {
          metadata = options;
          const target = findLoginForm(config.selectors, metadata);
          if (!target) throw new Error("changed");
          captured = captureTarget(target, metadata);
          eligibleAt =
            now() +
            Math.max(
              metadata.fillDelayMs,
              config.readinessProfile === "cpanel"
                ? CPANEL_POLICY.pageSettleMs
                : 0,
            );
          phase = "waiting-fill";
          // The saved delay and cPanel hydration: no credential is in the
          // page yet.
          bound(eligibleAt - now() + SETTLE_WAIT_MS);
          tick();
        } else {
          const operation = phase;
          phase = "processing";
          expiryTimer = setTimeout(
            () => finish(false),
            Math.max(0, expires - now()),
          );
          if (operation === "form") {
            bound(expires - now());
            fill(username, password, options, autoSubmit);
          } else submit(autoSubmit);
        }
        return true;
      } catch (_) {
        finish(false);
        return false;
      }
    };
  }
  // Reviewed declarative login steps (t102 contract L1, the reference is
  // src/utils/connection/httpLoginSteps.ts). Each document runs from the first
  // step that applies to it; the host keeps the position between documents
  // (one release per origin and stage, earlier steps first) and checks every
  // request against the same steps. Nothing outside the steps is ever typed,
  // clicked or submitted, and there is no fallback to form detection.
  function declarativeClient() {
    const DETECT_DEFAULT_MS = 8000;
    const STABLE_MS = 400;
    const STAGES = {
      click: "form-prepare",
      identifier: "identifier",
      password: "password",
      form: "form",
    };
    const SUBMITS = {
      identifier: "id-submit",
      password: "pw-submit",
      form: "form-submit",
    };
    let steps = null,
      connectionOrigin = "",
      detectionMs = DETECT_DEFAULT_MS,
      fillDelayMs = 0,
      submitDelayMs = 0;
    let done = false,
      reason = "unsupported-steps",
      handedOver = false,
      from = 0,
      phase = "loading",
      current_ = null,
      pending = null,
      stable = null,
      stableSince = 0,
      seekDeadline = 0,
      eligibleAt = 0,
      records = [],
      typedLast = null,
      timer,
      lifetime,
      busy = false;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const digest = (value) => credentialDigest(value, salt);
    const own = (record, key) =>
      Object.prototype.hasOwnProperty.call(record, key);
    const plain = (value) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype;
    const keysWithin = (record, allowed) =>
      Object.keys(record).every((key) => allowed.includes(key));
    const printable = (value, limit) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= limit &&
      !/[\x00-\x1f\x7f-\x9f]/.test(value) &&
      value[0] !== " " &&
      value[value.length - 1] !== " ";
    const selectorText = (value) => printable(value, 512);
    const exactOrigin = (value) => {
      try {
        return (
          typeof value === "string" &&
          value.length <= 2048 &&
          new URL(value).origin === value &&
          /^https?:$/.test(new URL(value).protocol)
        );
      } catch (_) {
        return false;
      }
    };
    const safePath = (value) =>
      typeof value === "string" &&
      value.length <= 512 &&
      value[0] === "/" &&
      value
        .slice(1)
        .split("/")
        .every((segment, index, all) =>
          segment === ""
            ? index === all.length - 1
            : /^[A-Za-z0-9._~-]+$/.test(segment) &&
              segment !== "." &&
              segment !== "..",
        );
    function strings(value, max, valid) {
      if (!Array.isArray(value) || value.length < 1 || value.length > max)
        throw new Error();
      const seen = [];
      for (const entry of value) {
        if (!valid(entry) || seen.includes(entry)) throw new Error();
        seen.push(entry);
      }
      return seen;
    }
    // The validator's structural and order rules, on concrete origins. Any
    // rule broken rejects the whole file: nothing of it is used.
    function resolveSteps(login) {
      if (
        !plain(login) ||
        !keysWithin(login, [
          "connectionOrigin",
          "passwordOnly",
          "credentialOrigins",
          "loginSteps",
        ]) ||
        !exactOrigin(login.connectionOrigin) ||
        typeof login.passwordOnly !== "boolean"
      )
        throw new Error();
      const passwordOnly = login.passwordOnly;
      const listed =
        Array.isArray(login.credentialOrigins) &&
        login.credentialOrigins.length === 0
          ? []
          : strings(
              login.credentialOrigins,
              8,
              (value) =>
                exactOrigin(value) &&
                value.startsWith("https://") &&
                value.length <= 512,
            );
      if (
        !Array.isArray(login.loginSteps) ||
        login.loginSteps.length < 1 ||
        login.loginSteps.length > 16
      )
        throw new Error();
      const resolved = [];
      login.loginSteps.forEach((raw, index) => {
        if (!plain(raw) || (!own(STAGES, raw.kind) && raw.kind !== "submit"))
          throw new Error();
        const kind = raw.kind;
        if (passwordOnly && (kind === "identifier" || kind === "form"))
          throw new Error();
        if (own(raw, "waitFor") && !selectorText(raw.waitFor))
          throw new Error();
        const step = {
          index,
          kind,
          waitFor: own(raw, "waitFor") ? raw.waitFor : null,
          selectors: {},
        };
        let keys;
        if (kind === "submit") {
          if (!["click", "spa", "enter"].includes(raw.submission))
            throw new Error();
          keys = raw.submission === "enter" ? [] : ["control"];
          if (
            !keysWithin(raw, [
              "kind",
              "submission",
              "waitFor",
              ...(keys.length ? ["selectors"] : []),
            ])
          )
            throw new Error();
          const target = resolved[resolved.length - 1];
          if (
            !target ||
            !["identifier", "password", "form"].includes(target.kind)
          )
            throw new Error();
          Object.assign(step, {
            submission: raw.submission,
            submits: target.kind,
            origin: target.origin,
            paths: target.paths,
            prefixes: target.prefixes,
            frame: target.frame,
          });
        } else {
          if (
            !keysWithin(raw, [
              "kind",
              "origin",
              "paths",
              "pathPrefixes",
              "frame",
              "waitFor",
              "selectors",
            ])
          )
            throw new Error();
          if (
            own(raw, "origin") &&
            (!exactOrigin(raw.origin) ||
              !raw.origin.startsWith("https://") ||
              !listed.includes(raw.origin))
          )
            throw new Error();
          step.origin = own(raw, "origin")
            ? raw.origin
            : login.connectionOrigin;
          step.paths = own(raw, "paths")
            ? strings(raw.paths, 16, safePath)
            : [];
          step.prefixes = own(raw, "pathPrefixes")
            ? strings(
                raw.pathPrefixes,
                16,
                (value) =>
                  safePath(value) && value.length > 1 && value.endsWith("/"),
              )
            : [];
          if (
            own(raw, "frame") &&
            (typeof raw.frame !== "string" ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(raw.frame))
          )
            throw new Error();
          step.frame = own(raw, "frame") ? raw.frame : null;
          keys = {
            click: ["control"],
            identifier: ["username"],
            password: ["password"],
            form: ["username", "password"],
          }[kind];
        }
        if (keys.length) {
          if (
            !plain(raw.selectors) ||
            !keysWithin(raw.selectors, keys) ||
            !keys.every((key) => selectorText(raw.selectors[key]))
          )
            throw new Error();
          for (const key of keys) {
            // An unparsable selector is refused up front, as data.
            doc.createDocumentFragment().querySelector(raw.selectors[key]);
            step.selectors[key] = raw.selectors[key];
          }
        }
        if (step.waitFor)
          doc.createDocumentFragment().querySelector(step.waitFor);
        resolved.push(step);
      });
      // Order rules (checkSequence), per concrete origin.
      const credential = (kind) =>
        ["identifier", "password", "form"].includes(kind);
      if (!resolved.some((step) => credential(step.kind))) throw new Error();
      const typed = new Set(),
        submitted = new Set(),
        clicked = new Set();
      let usernameSeen = false;
      resolved.forEach((step, index) => {
        if (credential(step.kind)) {
          const fields =
            step.kind === "form"
              ? ["username", "password"]
              : [step.kind === "identifier" ? "username" : "password"];
          for (const field of fields) {
            if (typed.has(`${field} ${step.origin}`)) throw new Error();
            typed.add(`${field} ${step.origin}`);
          }
          if (step.kind === "password" && !usernameSeen && !passwordOnly)
            throw new Error();
          if (step.kind !== "password") usernameSeen = true;
        } else if (step.kind === "click") {
          if (
            clicked.has(step.origin) ||
            !resolved
              .slice(index + 1)
              .some(
                (later) =>
                  credential(later.kind) && later.origin === step.origin,
              )
          )
            throw new Error();
          clicked.add(step.origin);
        } else {
          const stage =
            step.submits === "identifier" ? "identifier" : "password";
          if (submitted.has(`${stage} ${step.origin}`)) throw new Error();
          submitted.add(`${stage} ${step.origin}`);
        }
      });
      const frames = [
        ...new Set(resolved.map((step) => step.frame).filter(Boolean)),
      ];
      if (frames.length > 8) throw new Error();
      connectionOrigin = login.connectionOrigin;
      return { steps: resolved, frames };
    }
    function integer(value, min, max) {
      if (!Number.isInteger(value) || value < min || value > max)
        throw new Error();
      return value;
    }
    function finish(ok, why) {
      if (done) return;
      done = true;
      stopped = true;
      reason = why;
      if (keyboard) keyboard.cancel();
      stopWatchingParent();
      clearInterval(timer);
      clearTimeout(lifetime);
      clearTimeout(expiryTimer);
      scrub(!ok);
      pending = current_ = stable = typedLast = null;
      cancelActive = null;
      doc.removeEventListener("input", edited, true);
      doc.removeEventListener("click", edited, true);
      notify(ok ? "form-completed" : "form-rejected");
    }
    function scrub(erase) {
      for (const entry of records) {
        const value = entry.value;
        entry.value = null;
        if (erase && value !== null) {
          // Erase what native typing entered, whole or partial; never a value
          // somebody else changed.
          const text = entry.element.value;
          if (text === value || typedPrefix(value, entry.typed, text))
            setNativeValue(entry.element, "");
        } else if (erase && entry.hash) {
          const text = entry.element.value,
            hash = entry.hash;
          digest(text)
            .then((actual) => {
              if (actual === hash && entry.element.value === text)
                setNativeValue(entry.element, "");
            })
            .catch(() => {});
        }
        entry.hash = null;
      }
      records = [];
    }
    function edited(event) {
      if (!event.isTrusted) return;
      // The user is in charge: any input or click of theirs ends the attempt.
      if (!keyboard?.ownsEvent(event)) return finish(false, "user-input");
      const entry = records.find((item) => item.element === event.target);
      if (entry) entry.typed = event.target.value.length;
    }
    function bound(ms, why) {
      clearTimeout(lifetime);
      lifetime = setTimeout(() => finish(false, why), Math.max(0, ms));
    }
    // Displayed to the user: connected, in this document, not hidden by an
    // attribute, style or zero size. A background tab still has layout.
    function shown(element) {
      if (
        !element ||
        element.ownerDocument !== doc ||
        !element.isConnected ||
        (element.tagName === "INPUT" && element.type === "hidden")
      )
        return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
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
      return Array.from(element.getClientRects()).some(
        (rect) => rect.width > 0 && rect.height > 0,
      );
    }
    const enabled = (element) =>
      !element.matches(":disabled") &&
      !element.closest('[aria-disabled="true"], [inert]');
    const textEntry = (element) =>
      element.tagName === "INPUT" &&
      ["text", "email", "tel", "search", "url"].includes(element.type) &&
      !element.readOnly &&
      enabled(element);
    const passwordEntry = (element) =>
      element.tagName === "INPUT" &&
      element.type === "password" &&
      !element.readOnly &&
      enabled(element);
    const control = (element) =>
      element.tagName === "BUTTON" ||
      (element.tagName === "INPUT" &&
        ["submit", "button", "image"].includes(element.type)) ||
      (element.tagName === "A" &&
        (!element.hasAttribute("href") ||
          new URL(element.getAttribute("href"), doc.baseURI).origin ===
            origin)) ||
      element.getAttribute("role") === "button" ||
      element.getAttribute("role") === "tab";
    // Exactly one displayed element of the right kind, or null to keep
    // waiting. A selector the browser cannot parse or a match of the wrong
    // kind is a layout mismatch.
    function select(selector, accept) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(selector);
      } catch (_) {
        throw new Error("layout-mismatch");
      }
      const visible = Array.from(nodes).filter(shown);
      if (visible.length !== 1) return null;
      if (!accept(visible[0])) throw new Error("layout-mismatch");
      return visible[0];
    }
    // The step applies to this document on its LIVE address, at the moment
    // it acts: origin, path gate, and top document or the named child frame.
    function applies(step) {
      if (location.origin !== origin || step.origin !== origin) return false;
      if (
        location.protocol !== "https:" &&
        !(location.protocol === "http:" && origin === connectionOrigin)
      )
        return false;
      const path = location.pathname;
      if (
        (step.paths.length || step.prefixes.length) &&
        !step.paths.includes(path) &&
        !step.prefixes.some((prefix) => path.startsWith(prefix))
      )
        return false;
      if (step.frame === null) return topDocument;
      if (topDocument || !loginFrame) return false;
      return (
        loginFrame.element.getAttribute("id") === step.frame ||
        loginFrame.element.getAttribute("name") === step.frame
      );
    }
    function waited(step) {
      if (!step.waitFor) return true;
      try {
        return doc.querySelector(step.waitFor) !== null;
      } catch (_) {
        throw new Error("layout-mismatch");
      }
    }
    function target(step) {
      if (!applies(step) || !waited(step)) return null;
      if (step.kind === "click") {
        const button = select(step.selectors.control, control);
        return button && enabled(button) ? { button } : null;
      }
      const user =
        step.kind === "password"
          ? null
          : select(step.selectors.username, textEntry);
      const pw =
        step.kind === "identifier"
          ? null
          : select(step.selectors.password, passwordEntry);
      if (
        (step.kind !== "password" && !user) ||
        (step.kind !== "identifier" && !pw) ||
        (user && user === pw)
      )
        return null;
      return { user, pw };
    }
    function same(a, b) {
      return (
        !!a &&
        !!b &&
        a.button === b.button &&
        a.user === b.user &&
        a.pw === b.pw
      );
    }
    function stepCurrent() {
      return (
        !done &&
        current() &&
        !!current_ &&
        same(current_.target, target(current_.step))
      );
    }
    // A form that submits outside this document, by GET (credentials in the
    // address) or to another origin is never submitted.
    function safeForm(form, submitter) {
      if (!form) return true;
      const action = new URL(
        submitter?.getAttribute("formaction") ||
          form.getAttribute("action") ||
          location.href,
        doc.baseURI,
      );
      const method = (
        submitter?.getAttribute("formmethod") ||
        form.getAttribute("method") ||
        "get"
      ).toLowerCase();
      const context =
        submitter?.getAttribute("formtarget") ??
        form.getAttribute("target") ??
        doc.querySelector("base[target]")?.getAttribute("target") ??
        "";
      return (
        action.origin === origin &&
        !action.username &&
        !action.password &&
        (method === "post" || method === "dialog") &&
        (!context || context.toLowerCase() === "_self")
      );
    }
    function seek() {
      if (done || phase !== "seeking") return;
      if (now() >= seekDeadline) return finish(false, "layout-mismatch");
      let found = null;
      for (let index = from; index < steps.length && !found; index++) {
        const step = steps[index];
        if (step.kind === "submit") continue;
        const located = target(step);
        if (located) found = { step, target: located };
      }
      if (!found) {
        stable = null;
        return;
      }
      if (found.target.user?.value || found.target.pw?.value)
        return finish(false, "field-not-empty");
      if (
        !stable ||
        stable.step !== found.step ||
        !same(stable.target, found.target)
      ) {
        stable = found;
        stableSince = now();
        return;
      }
      if (
        now() - stableSince < Math.max(STABLE_MS, fillDelayMs) ||
        !mainDocumentLoaded()
      )
        return;
      current_ = found;
      stable = null;
      phase = "requested";
      pending = { stage: STAGES[found.step.kind] };
      bound(GRANT_WAIT_MS, "no-grant");
      notify(pending.stage);
    }
    function next(index) {
      // Continue in this document from the step after `index`, if any applies.
      current_ = null;
      if (index + 1 >= steps.length) return finish(true, "completed");
      from = index + 1;
      phase = "seeking";
      seekDeadline = now() + detectionMs;
      bound(detectionMs + GRANT_WAIT_MS, "layout-mismatch");
    }
    async function valuesMatch() {
      const entries = records.slice();
      const values = entries.map((entry) => entry.element.value);
      try {
        const hashes = await Promise.all(values.map(digest));
        return entries.every(
          (entry, index) =>
            entry.hash === hashes[index] &&
            entry.element.value === values[index],
        );
      } finally {
        values.fill("");
      }
    }
    function submitTarget(step) {
      if (!waited(step)) return null;
      if (step.submission === "enter")
        return typedLast && shown(typedLast) ? { field: typedLast } : null;
      const button = select(step.selectors.control, (el) => control(el));
      return button && enabled(button) ? { button } : null;
    }
    async function awaitSubmit() {
      if (done || phase !== "waiting-submit" || busy) return;
      busy = true;
      try {
        const step = steps[current_.step.index + 1];
        if (!stepCurrent() || !applies(step))
          return finish(false, "navigation");
        if (now() < eligibleAt) return;
        const located = submitTarget(step);
        if (!located) return;
        if (!(await valuesMatch()) || !stepCurrent())
          return finish(false, "changed");
        current_.submit = located;
        phase = "submit-requested";
        pending = { stage: SUBMITS[current_.step.kind] };
        notify(pending.stage);
      } catch (_) {
        finish(false, "layout-mismatch");
      } finally {
        busy = false;
      }
    }
    function tick() {
      if (done) return;
      try {
        if (phase === "loading") {
          if (!mainDocumentLoaded()) return;
          phase = "seeking";
          seekDeadline = now() + detectionMs;
          bound(detectionMs + GRANT_WAIT_MS, "layout-mismatch");
        }
        if (phase === "seeking") return seek();
        if (phase === "waiting-submit") return awaitSubmit();
        if (["requested", "submit-requested"].includes(phase) && !stepCurrent())
          return finish(false, "navigation");
      } catch (_) {
        finish(false, "layout-mismatch");
      }
    }
    async function type(username, password, autoSubmit) {
      const step = current_.step,
        located = current_.target;
      try {
        const writes = [
          located.user && [located.user, username, "username"],
          located.pw && [located.pw, password, "password"],
        ].filter(Boolean);
        const guard = () => stepCurrent() && now() < expires;
        for (const [element, value, field] of writes) {
          if (!guard() || element.value) throw new Error("changed");
          const entry = { element, value, hash: null };
          records.push(entry);
          await keyboard.write(
            element,
            value,
            guard,
            STAGES[step.kind],
            field,
            expires,
          );
          if (!guard() || element.value !== value) throw new Error("changed");
          typedLast = element;
        }
        username = password = "";
        writes.forEach((write) => {
          write[1] = "";
        });
        await Promise.all(
          records.map(async (entry) => {
            try {
              entry.hash =
                entry.value === null ? entry.hash : await digest(entry.value);
            } finally {
              entry.value = null;
            }
          }),
        );
        if (!guard()) throw new Error("expired");
        clearTimeout(expiryTimer);
        const following = steps[step.index + 1];
        if (!following || following.kind !== "submit") return next(step.index);
        // Fill-only consent: every submit is skipped and the steps end here.
        if (!autoSubmit) return finish(true, "fill-only");
        phase = "waiting-submit";
        eligibleAt = now() + submitDelayMs;
        bound(submitDelayMs + detectionMs, "layout-mismatch");
        awaitSubmit();
      } catch (_) {
        finish(false, done ? reason : "changed");
      } finally {
        username = password = "";
      }
    }
    function submit() {
      const step = steps[current_.step.index + 1];
      const located = submitTarget(step);
      if (
        !located ||
        located.button !== current_.submit.button ||
        located.field !== current_.submit.field
      )
        throw new Error("changed");
      const field = located.field;
      const form = located.button ? located.button.form : field.form;
      if (
        step.submission === "click" &&
        (!form || !safeForm(form, located.button))
      )
        throw new Error("unsafe");
      if (step.submission === "enter" && !safeForm(form, null))
        throw new Error("unsafe");
      // Consumed before any page handler runs.
      handedOver = true;
      phase = "submitted";
      const index = step.index;
      if (step.submission === "spa") {
        // A single-page form has no POST action: never let it fall back to a
        // native submission that would put the fields in the address.
        if (form)
          form.addEventListener("submit", (event) => event.preventDefault(), {
            capture: true,
            once: true,
          });
        located.button.click();
      } else if (step.submission === "click") {
        located.button.click();
      } else {
        const fire = (kind, charCode) =>
          field.dispatchEvent(
            new KeyboardEvent(kind, {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              charCode,
              bubbles: true,
              cancelable: true,
            }),
          );
        const proceed = fire("keydown", 0);
        if (proceed) fire("keypress", 13);
        fire("keyup", 0);
        if (
          proceed &&
          form &&
          field.isConnected &&
          typeof form.requestSubmit === "function"
        )
          form.requestSubmit();
      }
      for (const entry of records) entry.hash = null;
      records = [];
      if (!done) next(index);
    }
    // Configuration: native-owned values only (never page content).
    try {
      if (!keyboard) throw new Error();
      const raw = JSON.parse(JSON.stringify(configuration));
      if (
        !plain(raw) ||
        !keysWithin(raw, [
          "declarativeLogin",
          "readiness",
          "timing",
          "selectors",
        ])
      )
        throw new Error();
      // `selectors` beside steps are not read: the steps win.
      if (own(raw, "readiness")) {
        if (
          !plain(raw.readiness) ||
          !keysWithin(raw.readiness, ["detectionTimeoutMs"])
        )
          throw new Error();
        if (own(raw.readiness, "detectionTimeoutMs"))
          detectionMs = integer(raw.readiness.detectionTimeoutMs, 1000, 60000);
      }
      if (own(raw, "timing")) {
        if (
          !plain(raw.timing) ||
          !keysWithin(raw.timing, ["fillDelayMs", "submitDelayMs"])
        )
          throw new Error();
        fillDelayMs = own(raw.timing, "fillDelayMs")
          ? integer(raw.timing.fillDelayMs, 0, 30000)
          : 0;
        submitDelayMs = own(raw.timing, "submitDelayMs")
          ? integer(raw.timing.submitDelayMs, 0, 30000)
          : 0;
      }
      const resolved = resolveSteps(raw.declarativeLogin);
      steps = resolved.steps;
      config = resolved.frames.length
        ? { sameOriginLoginFrames: resolved.frames }
        : {};
      routing = true;
      if (!topDocument) loginFrame = authorizedLoginFrame();
      if (!current()) throw new Error();
      // No step runs on this document's origin: nothing to ask for here.
      if (
        !steps.some((step) => step.kind !== "submit" && step.origin === origin)
      )
        reason = "not-applicable";
      else reason = null;
      if (reason) throw new Error();
    } catch (_) {
      cancel();
      const refused = () => false;
      Object.defineProperty(refused, "declarativeReason", {
        value: reason || "unsupported-steps",
      });
      return refused;
    }
    if (loginFrame) {
      for (const event of parentNavigationEvents)
        loginFrame.parent.addEventListener(
          event,
          () => finish(handedOver, handedOver ? "handed-over" : "navigation"),
          { once: true },
        );
    }
    cancelActive = () => finish(false, "cancelled");
    const leave = () =>
      finish(handedOver, handedOver ? "handed-over" : "navigation");
    window.addEventListener("pagehide", leave, { once: true });
    window.addEventListener("unload", leave, { once: true });
    doc.addEventListener("input", edited, true);
    doc.addEventListener("click", edited, true);
    // The wait for load end has its own bound; detection starts at load end.
    bound(SETTLE_WAIT_MS, "layout-mismatch");
    startTimer = setTimeout(tick, 0);
    timer = setInterval(tick, 100);
    window.addEventListener("load", tick, { once: true });
    const deliver = function (
      expectedOrigin,
      username,
      password,
      autoSubmit,
      deadline,
      rawOptions,
      deliveredStage,
    ) {
      try {
        if (rawOptions?.fields?.length) {
          rawOptions.fields.forEach((field) => {
            field.value = "";
          });
          throw new Error();
        }
        if (
          done ||
          !current() ||
          expectedOrigin !== origin ||
          !pending ||
          pending.stage !== deliveredStage ||
          typeof autoSubmit !== "boolean" ||
          !Number.isFinite(deadline) ||
          deadline <= now() ||
          typeof username !== "string" ||
          typeof password !== "string" ||
          (deliveredStage === "identifier"
            ? !username || password !== ""
            : deliveredStage === "password"
              ? username !== "" || !password
              : deliveredStage === "form"
                ? !username || !password
                : username !== "" || password !== "")
        )
          return false;
        if (!stepCurrent()) {
          finish(false, "navigation");
          return false;
        }
        pending = null;
        expires = Math.min(deadline, now() + CREDENTIAL_LIMIT_MS);
        if (phase === "submit-requested") {
          if (!autoSubmit) {
            finish(false, "fill-only");
            return false;
          }
          submit();
          return true;
        }
        if (current_.step.kind === "click") {
          // The pre-step: one click on the selected, displayed control.
          const button = current_.target.button;
          handedOver = true;
          const index = current_.step.index;
          button.click();
          if (!done) next(index);
          return true;
        }
        phase = "typing";
        bound(expires - now(), "expired");
        expiryTimer = setTimeout(
          () => finish(false, "expired"),
          Math.max(0, expires - now()),
        );
        type(username, password, autoSubmit);
        return true;
      } catch (_) {
        finish(false, done ? reason : "changed");
        return false;
      } finally {
        username = password = "";
      }
    };
    Object.defineProperty(deliver, "declarativeReason", {
      get: () => (done ? reason : null),
    });
    return deliver;
  }
  if (adapter === "declarative-steps")
    return attachKeyboard(declarativeClient());
  try {
    config = JSON.parse(JSON.stringify(configuration));
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some(
        (key) =>
          ![
            "selectors",
            "readiness",
            "readinessProfile",
            "sameOriginLoginFrames",
          ].includes(key),
      )
    )
      throw new Error();
    // This allowlist is native-owned configuration, never inferred from page
    // content or accepted through a later credential/options delivery.
    if (
      Object.prototype.hasOwnProperty.call(config, "sameOriginLoginFrames") &&
      (adapter !== "modular-form" ||
        !Array.isArray(config.sameOriginLoginFrames) ||
        config.sameOriginLoginFrames.length < 1 ||
        config.sameOriginLoginFrames.length > 8 ||
        new Set(config.sameOriginLoginFrames).size !==
          config.sameOriginLoginFrames.length ||
        config.sameOriginLoginFrames.some(
          (name) =>
            typeof name !== "string" ||
            name.length < 1 ||
            name.length > 128 ||
            /[^A-Za-z0-9_-]/.test(name),
        ))
    )
      throw new Error();
    if (
      config.readinessProfile !== undefined &&
      config.readinessProfile !== "cpanel"
    )
      throw new Error();
    if (config.selectors !== undefined && config.selectors !== null) {
      if (
        typeof config.selectors !== "object" ||
        Array.isArray(config.selectors)
      )
        throw new Error();
      for (const [key, value] of Object.entries(config.selectors)) {
        if (
          !["username", "password", "submit"].includes(key) ||
          typeof value !== "string" ||
          !value.trim() ||
          value.length > 512 ||
          /[\x00-\x1f\x7f]/.test(value)
        )
          throw new Error();
        doc.createDocumentFragment().querySelector(value);
      }
    }
    if (!topDocument) loginFrame = authorizedLoginFrame();
    if (!current()) throw new Error();
  } catch (_) {
    cancel();
    return function () {
      return false;
    };
  }
  if (loginFrame) {
    for (const event of parentNavigationEvents)
      loginFrame.parent.addEventListener(event, cancel, { once: true });
  }
  if (adapter === "modular-form") return attachKeyboard(deferredFormClient());
  window.addEventListener("pagehide", cancel, { once: true });
  window.addEventListener("unload", cancel, { once: true });
  window.addEventListener("hashchange", cancel, { once: true });
  window.addEventListener("popstate", cancel, { once: true });
  // Give CEF time to register its document record before readiness notification.
  startTimer = setTimeout(() => {
    if (!current()) return;
    waitForSelectedLoginForm(config.selectors, config.readiness).then(
      (result) => {
        if (!current() || !result.ok) return;
        readyDeadline = result.deadline;
        requested = true;
        notify("form");
      },
    );
  }, 0);
  return function (
    expectedOrigin,
    username,
    password,
    autoSubmit,
    deadline,
    rawOptions,
  ) {
    if (
      !current() ||
      !requested ||
      delivered ||
      expectedOrigin !== origin ||
      typeof username !== "string" ||
      typeof password !== "string" ||
      typeof autoSubmit !== "boolean" ||
      !Number.isFinite(deadline) ||
      deadline <= now() ||
      readyDeadline <= now()
    )
      return false;
    delivered = true;
    let options;
    try {
      options = normalizeFormOptions(rawOptions);
      // Saved options can restrict native consent, never upgrade fill-only.
      options.submit = options.submit && autoSubmit;
    } catch (_) {
      cancel();
      return false;
    }
    expires = Math.min(deadline, readyDeadline);
    expiryTimer = setTimeout(cancel, Math.max(0, expires - now()));
    bootstrapFill(
      { username, password },
      config.selectors,
      options,
      config.readinessProfile,
      expires,
    ).finally(() => {
      clearTimeout(expiryTimer);
      stopped = true;
      stopWatchingParent();
    });
    return true;
  };
});
