// Private native factory; shared modules retain their existing form semantics.
// No proxy nonce endpoint, page-global callback, or credentials in source.
(function (notify, configuration, adapter, nativeTyping) {
  "use strict";
  // Independently installed by the renderer with native-owned reviewed MFA
  // metadata. The OTP closure survives completion of the password adapter.
  if (adapter === "approved-otp") return approvedOtpStage(notify, configuration);
  if (configuration?.mfa) {
    configuration = { ...configuration };
    delete configuration.mfa;
  }
  function approvedOtpStage(signal, setup) {
    const doc = document;
    const now = Date.now.bind(Date);
    const started = now();
    // This local nonce satisfies the shared DOM guard's shape contract only;
    // native process/document nonces and owner consent authorize the operation.
    const guardSetup = { ...setup, nonce: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("") };
    let stopped = false, timer, target = null, prefix = "", armed = false;
    let deadline = 0, autoSubmit = false, pending = false, submitted = false;
    const emit = (stage, index = 0) => signal(`totp|${stage}|${setup.id}|${index}`);
    const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
    const cancel = () => {
      if (!stopped) emit("cancel");
      stopped = true; armed = false; prefix = ""; target = null; clearTimeout(timer);
    };
    const visible = (el) => el && el.isConnected && el.ownerDocument === doc &&
      !el.hidden && el.getAttribute("aria-hidden") !== "true" &&
      getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" &&
      (el.offsetParent !== null || el.getClientRects().length > 0);
    /* REVIEWED_TOTP_GUARDS */
    function controls(requireReady = false) {
      if (stopped || document !== doc || window.top !== window ||
          now() - started > 600000 || location.protocol !== "https:" ||
          location.origin !== setup.origin || !setup.paths.includes(location.pathname)) return null;
      try {
        const found = totpTarget(guardSetup, requireReady);
        return { ...found, input: found.field, href: location.href };
      } catch (_) { return null; }
    }
    function current(requireReady = false) {
      const found = controls(requireReady);
      return target && found && found.input === target.input && found.button === target.button &&
        found.form === target.form && found.fingerprint === target.fingerprint && found.href === target.href &&
        found.root === target.root && found.panel === target.panel && sameTotpHandlers(found, target) &&
        doc.activeElement === target.input && target.input.value === prefix &&
        (target.input.selectionStart === null ||
         (target.input.selectionStart === prefix.length && target.input.selectionEnd === prefix.length)) &&
        (!deadline || now() < deadline);
    }
    function discover() {
      if (stopped) return;
      const found = controls();
      if (!found) { if (now() - started < 600000) later(discover, 200); else cancel(); return; }
      // Never replace manual input or take focus away from another live control.
      if (found.input.value || (doc.activeElement !== doc.body && doc.activeElement !== found.input)) return;
      target = found;
      found.input.focus({ preventScroll: true });
      later(() => { if (current()) emit("start"); else cancel(); }, setup.fillDelayMs);
    }
    function inputEvent(event) {
      if (!target || stopped) return;
      if (!armed || !event.isTrusted || event.target !== target.input ||
          !/^\d$/.test(event.data || "") || event.inputType !== "insertText" ||
          target.input.value !== prefix + event.data) { cancel(); return; }
      prefix += event.data;
      armed = false;
    }
    doc.addEventListener("input", inputEvent, true);
    doc.addEventListener("beforeinput", (event) => {
      if (!target || stopped) return;
      if (!armed || !event.isTrusted || !current() || event.target !== target.input ||
          !/^\d$/.test(event.data || "") || event.inputType !== "insertText") {
        // Suppress only a pending injected key aimed at a stale target.
        if (armed) event.preventDefault();
        cancel();
      }
    }, true);
    doc.addEventListener("keydown", (event) => {
      if (!target || stopped) return;
      if (!armed || !current() || !/^\d$/.test(event.key) || event.ctrlKey || event.altKey || event.metaKey) {
        if (armed) event.preventDefault();
        cancel();
      }
    }, true);
    doc.addEventListener("pointerdown", () => { if (target) cancel(); }, true);
    doc.addEventListener("focusin", (event) => {
      if (target && event.target !== target.input) cancel();
    }, true);
    window.addEventListener("pagehide", cancel, { once: true });
    if (!setup || typeof setup.id !== "string" || !/^[a-z0-9-]{1,128}$/.test(setup.id) ||
        !Array.isArray(setup.paths) || !Number.isInteger(setup.digits) || setup.digits < 6 || setup.digits > 8 ||
        [setup.fillDelayMs, setup.submitDelayMs].some(v => !Number.isInteger(v) || v < 0 || v > 30000)) {
      stopped = true;
      return () => false;
    }
    later(discover, 0);
    // Metadata only. OTP characters arrive solely through Chromium key events.
    return function (command, index, until, submit) {
      if (stopped || !target || !Number.isInteger(index) || !Number.isFinite(until)) return false;
      if (command === "cancel") { cancel(); return false; }
      if (command === "wait") {
        if (deadline || prefix || index < 1 || index > 33020 || !current()) { cancel(); return false; }
        later(() => { if (current()) emit("start"); else cancel(); }, index);
        return true;
      }
      if (until <= now() || until > now() + 3600000 || (deadline && deadline !== until)) { cancel(); return false; }
      deadline = until; autoSubmit = submit === true;
      if (command === "submit") {
        if (submitted || !autoSubmit || index !== setup.digits || prefix.length !== setup.digits || !current(true) ||
            target.button.disabled || target.button.getAttribute("aria-disabled") === "true") { cancel(); return false; }
        const button = target.button;
        if (setup.submission === "spa" || target.spa) target.form.addEventListener("submit", event => event.preventDefault(), { capture: true, once: true });
        submitted = true; stopped = true; prefix = ""; target = null;
        button.click();
        return true;
      }
      if (command !== "probe" || pending || index < 0 || index > setup.digits) { cancel(); return false; }
      pending = true;
      // Let Chromium process the previous native key before validating its
      // resulting input event. Polling never retries or repeats a character.
      const limit = Math.min(deadline, now() + 1500);
      const probe = () => {
        if (stopped) return;
        if (armed && prefix.length === index - 1 && now() < limit) { later(probe, 25); return; }
        pending = false;
        if (armed || prefix.length !== index || !current()) { cancel(); return; }
        if (index === setup.digits) {
          if (autoSubmit) {
            const earliest = now() + setup.submitDelayMs;
            const settledBy = Math.min(deadline, earliest + 3000);
            const finish = () => {
              if (!current() || now() >= settledBy) { cancel(); return; }
              if (now() < earliest || !current(true)) { later(finish, 50); return; }
              emit("finish", index);
            };
            later(finish, setup.submitDelayMs);
          } else { stopped = true; prefix = ""; target = null; }
        } else {
          armed = true;
          emit("key", index);
        }
      };
      later(probe, 50);
      return true;
    };
  }
  var stopped = false;
  var cancelActive = null;
  /* REVIEWED_FORM_MODULES */
  /* NATIVE_KEYBOARD_CLIENT */
  // Native production always passes true. The old three-argument standalone
  // harness remains useful for testing the shared provider/form modules.
  const keyboard = nativeTyping === true ? createLoginKeyboard(notify) : null;
  const attachKeyboard = deliver => {
    if (keyboard) Object.defineProperty(deliver, "nativeTyping", { value: keyboard.dispatch });
    return deliver;
  };
  const writeCredential = (element, value, guard, stage, field) => keyboard
    && !field.startsWith("extra") ? keyboard.write(element, value, guard, stage, field, expires)
    : Promise.resolve(fillField(element, value, guard));
  const doc = document;
  const origin = location.origin;
  const initialHref = location.href;
  const now = Date.now.bind(Date);
  let requested = false;
  let delivered = false;
  let expires = 0;
  let readyDeadline = 0;
  let expiryTimer;
  let startTimer;
  let config;
  function current() {
    return (
      !stopped &&
      document === doc &&
      window.top === window &&
      location.protocol === "https:" &&
      location.origin === origin &&
      (configuration?.provider || location.href === initialHref)
    );
  }
  function cancel() {
    stopped = true;
    if (keyboard) keyboard.cancel();
    clearTimeout(startTimer);
    clearTimeout(expiryTimer);
    if (cancelActive) cancelActive();
    cancelActive = null;
  }
  function report(result) {
    // Fixed status only. Never forward arbitrary messages or provider data.
    notify(result && result.ok ? "form-completed" : "form-rejected");
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
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    function dropPacket() {
      if (packet) packet.username = packet.password = "";
      packet = null;
    }
    function clearOwned() {
      for (const entry of owned) {
        // A manual edit belongs to the user, even during cancellation.
        if (entry.value !== null && entry.element.value === entry.value)
          setter.call(entry.element, "");
        else if (entry.hash) {
          const value = entry.element.value,
            hash = entry.hash;
          identityDigest(value)
            .then((actual) => {
              if (actual === hash && entry.element.value === value)
                setter.call(entry.element, "");
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
      if (event.isTrusted && !keyboard?.ownsEvent(event)) finish(false);
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
      if (
        !current() ||
        now() >= limit ||
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
        if (!field || !button || button.disabled) return null;
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
              toggle.form !== field.form || toggle.name || toggle.checked ||
              toggle.required || toggle.disabled || toggle.readOnly ||
              toggle.hasAttribute("form") || labels.length !== 1 ||
              !form.contains(labels[0]) || !labels[0].textContent.trim() ||
              (toggle.hasAttribute("aria-labelledby") &&
                toggle.getAttribute("aria-labelledby") !== labels[0].id)
            ) return null;
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
    async function identityDigest(value) {
      const bytes = new TextEncoder().encode(value);
      const salted = new Uint8Array(salt.length + bytes.length);
      salted.set(salt);
      salted.set(bytes, salt.length);
      bytes.fill(0);
      try {
        return Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", salted)),
        ).join(",");
      } finally {
        salted.fill(0);
      }
    }
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
        if (now() - stableSince < Math.max(400, timing.fillDelayMs)) return;
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
          await writeCredential(element, value, () => valid(target), deliveredStage, field);
          if (!valid(target) || element.value !== value)
            throw new Error("changed");
        };
        if (deliveredStage === "form") await write(target.user, data.username, "username");
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
      expires = Math.min(deadline, limit);
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
    return attachKeyboard(providerClient(configuration.provider, configuration.timing));
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
    // Native renderer delivery is main-document scoped, not a frame wildcard.
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
      eligibleAt = 0;
    let controlHash = null,
      quietSince = 0;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    async function digest(value) {
      const bytes = new TextEncoder().encode(value);
      const input = new Uint8Array(salt.length + bytes.length);
      input.set(salt);
      input.set(bytes, salt.length);
      bytes.fill(0);
      try {
        return Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
        ).join(",");
      } finally {
        input.fill(0);
      }
    }
    function scrub(entries, erase) {
      for (const entry of entries) {
        const value = entry.value;
        entry.value = null;
        if (!erase) {
          entry.hash = null;
          continue;
        }
        if (value !== null) {
          if (entry.element.value === value) setNativeValue(entry.element, "");
        } else if (entry.hash) {
          // No cleartext remains in the waiting action. Compare before clearing
          // so cancellation never erases a user's replacement value.
          const currentValue = entry.element.value;
          const hash = entry.hash;
          digest(currentValue)
            .then((actual) => {
              if (actual === hash && entry.element.value === currentValue)
                setNativeValue(entry.element, "");
            })
            .catch(() => {});
        }
        entry.hash = null;
      }
    }
    function finish(ok) {
      if (done) return;
      if (keyboard) keyboard.cancel();
      done = true;
      stopped = true;
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
      notify(ok ? "form-completed" : "form-rejected");
    }
    function edited(event) {
      if (event.isTrusted && !keyboard?.ownsEvent(event)) finish(false);
    }
    function valid() {
      if (done || !current() || now() >= readyDeadline || !captured)
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
    async function tick() {
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
          ...captured.extras.map((field, index) => [field.element, field.value, `extra${index}`]),
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
    startTimer = setTimeout(() => {
      waitForSelectedLoginForm(config.selectors, config.readiness).then(
        (result) => {
          if (!current() || !result.ok) return finish(false);
          readyDeadline = result.deadline;
          phase = "form-prepare";
          cancelActive = () => finish(false);
          lifetime = setTimeout(
            () => finish(false),
            Math.max(0, readyDeadline - now()),
          );
          notify(phase);
        },
      );
    }, 0);
    timer = setInterval(tick, 100);
    const abort = () => {
      if (cancelActive) cancelActive();
      finish(false);
    };
    window.addEventListener("pagehide", abort, { once: true });
    window.addEventListener("unload", abort, { once: true });
    window.addEventListener("hashchange", abort);
    window.addEventListener("popstate", abort);
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
      if (
        !current() ||
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
        expires = Math.min(deadline, readyDeadline);
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
        } else {
          const operation = phase;
          phase = "processing";
          expiryTimer = setTimeout(
            () => finish(false),
            Math.max(0, expires - now()),
          );
          if (operation === "form")
            fill(username, password, options, autoSubmit);
          else submit(autoSubmit);
        }
        return true;
      } catch (_) {
        finish(false);
        return false;
      }
    };
  }
  try {
    config = JSON.parse(JSON.stringify(configuration));
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some(
        (key) => !["selectors", "readiness", "readinessProfile"].includes(key),
      )
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
    if (!current()) throw new Error();
  } catch (_) {
    cancel();
    return function () {
      return false;
    };
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
    });
    return true;
  };
});
