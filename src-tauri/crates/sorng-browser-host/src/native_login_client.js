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
  /* NATIVE_LOGIN_CHALLENGE */

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
  /* NATIVE_LOGIN_DRONE_CONSENT */

  // A separate action-only stage; no username/password enters this closure.

  /* NATIVE_LOGIN_OTP */
  var stopped = false;
  var cancelActive = null;
  /* REVIEWED_FORM_MODULES */
  /* NATIVE_KEYBOARD_CLIENT */
  // Native production always passes true. The old three-argument standalone
  // harness remains useful for testing the shared provider/form modules.
  const keyboard =
    nativeTyping === true
      ? createLoginKeyboard(notify, () => cancel("user-input"))
      : null;
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
  // cause: the fixed rejection cause an active form attempt reports.
  function cancel(cause) {
    stopped = true;
    stopWatchingParent();
    if (keyboard) keyboard.cancel();
    clearTimeout(startTimer);
    clearTimeout(expiryTimer);
    if (cancelActive) cancelActive(cause);
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
  // Fixed rejection causes, the NativeLoginRejection wire names in
  // native_features.rs. The renderer forwards nothing else: never page text,
  // field values or account data.
  function rejection(cause) {
    return [
      "verification-required",
      "credentials-rejected",
      "focus-unavailable",
      "user-input",
      "page-changed",
      "field-not-empty",
      "submit-unavailable",
      "step-not-found",
      "expired",
    ].includes(cause)
      ? `form-rejected|${cause}`
      : "form-rejected";
  }
  // The native keyboard's fixed failure kinds as rejection causes.
  function typingCause(error) {
    const kind = error && error.message;
    return kind === "native-typing-focus"
      ? "focus-unavailable"
      : kind === "native-typing-user"
        ? "user-input"
        : kind === "native-typing-expired"
          ? "expired"
          : null;
  }
  // Displayed now: connected, not hidden by an attribute or style, and at
  // least a small box. Layout-free documents report no box and nothing shows.
  function displayedBox(element, minimum) {
    if (!element || !element.isConnected) return false;
    const view = element.ownerDocument.defaultView || window;
    for (let node = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      )
        return false;
    }
    return Array.from(element.getClientRects()).some(
      (rect) => rect.width >= minimum && rect.height >= minimum,
    );
  }
  // A verification the user must answer (Turnstile, hCaptcha, reCAPTCHA v2
  // or a challenge popup) that is displayed and not yet answered. Invisible
  // scoring such as reCAPTCHA v3 is not one. Detection only: nothing here
  // clicks, solves or reads a widget, and an answered widget's token field
  // lets the attempt go on.
  function verificationFrame(source, base) {
    let url;
    try {
      url = new URL(source, base);
    } catch (_) {
      return false;
    }
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "challenges.cloudflare.com") return true;
    if (host === "hcaptcha.com" || host.endsWith(".hcaptcha.com"))
      return !/checkbox-invisible/.test(url.hash);
    if (host.endsWith(".arkoselabs.com") || host.endsWith(".funcaptcha.com"))
      return true;
    return (
      [
        "www.google.com",
        "google.com",
        "www.recaptcha.net",
        "recaptcha.net",
      ].includes(host) &&
      /^\/recaptcha\/(api2|enterprise)\/(anchor|bframe)$/.test(url.pathname) &&
      url.searchParams.get("size") !== "invisible"
    );
  }
  function verificationPending(root) {
    try {
      const answered = Array.from(
        root.querySelectorAll(
          '[name="cf-turnstile-response"], [name="g-recaptcha-response"], [name="h-captcha-response"]',
        ),
      ).some((field) => typeof field.value === "string" && field.value !== "");
      if (answered) return false;
      for (const frame of root.querySelectorAll("iframe[src]"))
        if (
          verificationFrame(frame.getAttribute("src"), root.baseURI) &&
          displayedBox(frame, 16)
        )
          return true;
      return Array.from(
        root.querySelectorAll(".cf-turnstile, .h-captcha, .g-recaptcha"),
      ).some(
        (element) =>
          (element.getAttribute("data-size") || "").toLowerCase() !==
            "invisible" && displayedBox(element, 16),
      );
    } catch (_) {
      return false;
    }
  }
  // Refusal markers after a submit, watched for at most 12 s: an alert
  // anywhere, or an error element next to the login fields. Page text is
  // compared here only, never kept past the watch or forwarded.
  function refusalScope(fields) {
    let scope = fields[0]?.parentElement || null;
    while (scope && !fields.every((field) => scope.contains(field)))
      scope = scope.parentElement;
    for (let up = 0; scope && up < 3; up++) {
      const parent = scope.parentElement;
      if (!parent || parent === document.body) break;
      scope = parent;
    }
    return scope;
  }
  function refusalMarkers(fields) {
    const scope = refusalScope(fields);
    const found = new Map();
    const add = (element) => {
      if (fields.some((field) => element === field || element.contains(field)))
        return;
      const text = displayedBox(element, 1)
        ? (element.textContent || "").trim().slice(0, 512)
        : "";
      if (text) found.set(element, text);
    };
    document
      .querySelectorAll('[role="alert"], [aria-live="assertive"]')
      .forEach(add);
    if (scope)
      scope
        .querySelectorAll(
          '.alert-danger, .alert-error, .error-message, .invalid-feedback, .form-error, .login-error, [class*="error" i], [data-testid*="error" i]',
        )
        .forEach(add);
    return {
      alerts: found,
      invalid: fields.filter(
        (field) => field.getAttribute("aria-invalid") === "true",
      ),
    };
  }
  function afterSubmitBaseline(fields) {
    const live = fields.filter(Boolean);
    try {
      return live.length
        ? { fields: live, before: refusalMarkers(live) }
        : null;
    } catch (_) {
      return null;
    }
  }
  function watchAfterSubmit(baseline) {
    if (!baseline) return;
    const watched = document,
      href = location.href,
      began = Date.now();
    let timer = null,
      ended = false;
    const end = () => {
      ended = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", end);
      baseline = null;
    };
    window.addEventListener("pagehide", end, { once: true });
    timer = setInterval(() => {
      if (ended) return;
      if (
        document !== watched ||
        location.href !== href ||
        Date.now() - began > 12000
      )
        return end();
      let cause = null;
      try {
        if (verificationPending(watched)) cause = "verification-required";
        else if (baseline.fields.every((field) => displayedBox(field, 1))) {
          const seen = refusalMarkers(baseline.fields);
          if (
            seen.invalid.some(
              (field) => !baseline.before.invalid.includes(field),
            ) ||
            Array.from(seen.alerts).some(
              ([element, text]) => baseline.before.alerts.get(element) !== text,
            )
          )
            cause = "credentials-rejected";
        }
      } catch (_) {
        return end();
      }
      if (!cause) return;
      end();
      notify(rejection(cause));
    }, 250);
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
  /* NATIVE_LOGIN_PROVIDERS */
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
  /* NATIVE_LOGIN_DEFERRED_FORM */
  // Reviewed declarative login steps (t102 contract L1, the reference is
  // src/utils/connection/httpLoginSteps.ts). Each document runs from the first
  // step that applies to it; the host keeps the position between documents
  // (one release per origin and stage, earlier steps first) and checks every
  // request against the same steps. Nothing outside the steps is ever typed,
  // clicked or submitted, and there is no fallback to form detection.
  /* NATIVE_LOGIN_DECLARATIVE */
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
