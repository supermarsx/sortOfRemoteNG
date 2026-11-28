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
  const limit = now() + 60000 + 2 * (timing.fillDelayMs + timing.submitDelayMs);
  const consumed = new Set();
  let cookieConsentAttempted = false;
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
  function obscuredGoogleConnectionFrame(node) {
    // Google's connection probe can remain about:blank when its auxiliary
    // origin is denied. Its positive layout box sits behind the opaque body;
    // it is not a displayed challenge. Never admit an opaque/redirected
    // document, a focused frame, or a frame brought in front of that cover.
    if (
      provider !== "google-account" ||
      origin !== "https://accounts.google.com" ||
      !/^\/(v3\/signin|signin\/v2|signin)\/(identifier|challenge\/pwd)$/.test(
        location.pathname,
      ) ||
      node.tagName !== "IFRAME" ||
      node.parentElement !== doc.body ||
      node.tabIndex >= 0 ||
      doc.activeElement === node ||
      node.hasAttribute("srcdoc")
    )
      return false;
    try {
      const url = new URL(node.getAttribute("src"), doc.baseURI);
      if (
        url.origin !== "https://accounts.youtube.com" ||
        url.pathname !== "/accounts/CheckConnection" ||
        url.username ||
        url.password ||
        url.hash
      )
        return false;
      const child = node.contentDocument;
      if (
        !child ||
        child.URL !== "about:blank" ||
        !child.body ||
        child.body.textContent.trim() ||
        child.querySelector(
          "input,button,select,textarea,iframe,object,embed,script,[contenteditable=true]",
        )
      )
        return false;
      const style = getComputedStyle(node);
      const cover = getComputedStyle(doc.body);
      if (
        !["absolute", "fixed"].includes(style.position) ||
        !(Number(style.zIndex) < 0) ||
        style.pointerEvents !== "auto" ||
        cover.opacity !== "1" ||
        !(
          /^rgb\(/.test(cover.backgroundColor) ||
          /^rgba\([^)]*,\s*1\s*\)$/.test(cover.backgroundColor)
        )
      )
        return false;
      const rect = node.getBoundingClientRect();
      const body = doc.body.getBoundingClientRect();
      if (
        rect.width <= 1 ||
        rect.height <= 1 ||
        rect.left < 0 ||
        rect.top < 0 ||
        rect.right > window.innerWidth ||
        rect.bottom > window.innerHeight ||
        body.left > rect.left ||
        body.top > rect.top ||
        body.right < rect.right ||
        body.bottom < rect.bottom
      )
        return false;
      const xs = [
        rect.left + 0.5,
        (rect.left + rect.right) / 2,
        rect.right - 0.5,
      ];
      const ys = [
        rect.top + 0.5,
        (rect.top + rect.bottom) / 2,
        rect.bottom - 0.5,
      ];
      return xs.every((x) =>
        ys.every((y) => {
          const hit = doc.elementFromPoint(x, y);
          return hit && hit !== node;
        }),
      );
    } catch (_) {
      return false;
    }
  }
  function yealinkE2Password(node) {
    // The SIP-T21P_E2 login marks its only password input "new-password";
    // the phone has no registration flow. Exempt exactly that control.
    // locate() still validates the whole reviewed page before any request.
    return (
      provider === "voip-phone" &&
      !doc.querySelector("form") &&
      node.matches(
        'div.loginbox input#idPassword[type="password"][autocomplete="new-password"]:not([name])',
      ) &&
      doc.querySelectorAll('input[type="password"]').length === 1
    );
  }
  function blocked() {
    // Challenge script globals and hidden nodes can survive a completed
    // challenge. Only the currently displayed interstitial blocks a form.
    if (cloudflareInterstitial()) return true;
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
      if (obscuredGoogleConnectionFrame(node)) return false;
      if (yealinkE2Password(node)) return false;
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
  function acceptCloudflareCookies() {
    if (
      provider !== "cloudflare" ||
      cookieConsentAttempted ||
      stage !== "identifier" ||
      consumed.size ||
      pending ||
      packet ||
      action ||
      owned.length ||
      !route() ||
      cloudflareInterstitial()
    )
      return false;
    // Cloudflare's published OneTrust SDK owns this exact consent control.
    // Never click a generic dialog/Accept label or a challenge control.
    // https://ot.www.cloudflare.com/public/vendor/onetrust/scripttemplates/202503.1.0/otBannerSdk.js
    const roots = doc.querySelectorAll(
      "#onetrust-consent-sdk #onetrust-banner-sdk",
    );
    if (roots.length !== 1 || !painted(roots[0])) return false;
    const root = roots[0];
    const buttons = root.querySelectorAll("button#onetrust-accept-btn-handler");
    if (
      buttons.length !== 1 ||
      !root.querySelector("#onetrust-policy") ||
      root.querySelector(
        "form,input,textarea,select,iframe,[contenteditable=true]",
      )
    )
      return false;
    const button = buttons[0];
    if (
      !painted(button) ||
      button.matches(":disabled") ||
      button.form ||
      ["formaction", "formtarget", "formmethod", "formenctype"].some((key) =>
        button.hasAttribute(key),
      )
    )
      return false;
    cookieConsentAttempted = true;
    button.click();
    return true;
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
          (provider === "google-account" ||
            (provider === "voip-phone" && target.formless)) &&
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
      extra = [],
      pageHandler = null,
      formless = false;
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
      if (!field.form && (button.form || button.type !== "button")) return null;
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
    } else if (provider === "voip-phone" && doc.querySelector("form")) {
      // Reviewed keyless SIP-T20P/T21P: OnConfirm owns password processing
      // and submission. Never requestSubmit(), Enter or HTTP-auth fallback.
      form = only(doc, 'form[name="formInput"]');
      let model = only(doc, "#loginPhoneModel");
      let t21p = false;
      if (form && !doc.querySelectorAll("#loginPhoneModel").length) {
        model = only(
          form,
          ":scope > table > tbody > tr:first-child > td:nth-child(2)",
        );
        t21p =
          !!model &&
          !model.hasAttribute("id") &&
          model.parentElement.children.length === 2;
        if (!t21p) return null;
      }
      if (!form || !model) return null;
      const copy = model.cloneNode(true);
      copy
        .querySelectorAll("script,style,template,noscript,[hidden],[inert]")
        .forEach((node) => node.remove());
      const handler = (value) =>
        (value || "").replace(/\s/g, "").replace(/;$/, "");
      const url = new URL(form.action, doc.baseURI);
      if (
        copy.textContent.trim() !==
          (t21p
            ? "Enterprise IP phone SIP-T21P"
            : "Enterprise IP phone SIP-T20P") ||
        form.method !== "post" ||
        !(
          (t21p && !form.hasAttribute("autocomplete")) ||
          (form.getAttribute("autocomplete") || "").toLowerCase() === "off"
        ) ||
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
      pageHandler = window.OnConfirm;
    } else if (provider === "voip-phone") {
      // Reviewed SIP-T21P_E2 (52.84 servlet UI). There is no <form>: the
      // page's CheckLogin() reads the two id-only inputs, encrypts the
      // password with its per-session key and sends the request itself.
      // Fill both inputs and click Confirm once; never Enter (CallEnter),
      // a form submission, a replayed request or an HTTP-auth fallback.
      const text = (node) => {
        const copy = node.cloneNode(true);
        copy
          .querySelectorAll("script,style,template,noscript,[hidden],[inert]")
          .forEach((child) => child.remove());
        return copy.textContent.trim();
      };
      const handler = (value) =>
        (value || "").replace(/\s/g, "").replace(/;$/, "");
      form = only(doc, "div.loginbox");
      if (!form || !form.parentElement || form.parentElement !== doc.body)
        return null;
      const model = only(form, "td.loginDevText");
      const notice = only(form, "td#notice");
      // The page's own authentication state. Only a fresh "none" admits a
      // fill: "lock" (or anything unrecognized) is terminal, never retried.
      const status = only(doc, "div#_RES_INFO_");
      if (!model || !notice || !status || form.contains(status)) return null;
      let auth = null;
      try {
        auth = JSON.parse(status.textContent);
      } catch (_) {
        return null;
      }
      if (
        painted(status) ||
        !auth ||
        typeof auth !== "object" ||
        Array.isArray(auth) ||
        Object.keys(auth).join() !== "authstatus" ||
        auth.authstatus !== "none" ||
        text(model) !== "Enterprise IP Phone SIP-T21P_E2" ||
        // A shown error (wrong password, lockout) ends the attempt.
        text(notice) !== "" ||
        typeof window.CheckLogin !== "function"
      )
        return null;
      user = only(form, 'input#idUsername[type="text"]:not([name])');
      field = only(
        form,
        'input#idPassword[type="password"][autocomplete="new-password"]:not([name])',
      );
      button = only(form, 'button#idConfirm[type="button"]');
      const clear = only(form, 'button#idCancel[type="button"]');
      if (
        !user ||
        !field ||
        !button ||
        !clear ||
        form.querySelectorAll("input").length !== 2 ||
        handler(button.getAttribute("onclick")) !== "CheckLogin()" ||
        typeof button.onclick !== "function" ||
        handler(clear.getAttribute("onclick")) !== "g_url.RefreshPage()" ||
        !painted(user) ||
        user.readOnly ||
        user.matches(":disabled")
      )
        return null;
      extra = [model, notice, status, clear];
      pageHandler = window.CheckLogin;
      formless = true;
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
      button = only(form, 'button[type="submit"], input[type="submit"]', true);
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
      onConfirm: pageHandler,
      formless,
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
          entry.hash === hashes[index] && entry.element.value === values[index],
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
      if (acceptCloudflareCookies()) {
        stable = null;
        return;
      }
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
    secretTimer = setTimeout(() => finish(false), Math.max(0, expires - now()));
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
