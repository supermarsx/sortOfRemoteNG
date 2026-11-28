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
    preparation = null,
    preparationAttempted = false,
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
      if (own(raw, "waitFor") && !selectorText(raw.waitFor)) throw new Error();
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
        step.origin = own(raw, "origin") ? raw.origin : login.connectionOrigin;
        step.paths = own(raw, "paths") ? strings(raw.paths, 16, safePath) : [];
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
              (later) => credential(later.kind) && later.origin === step.origin,
            )
        )
          throw new Error();
        clicked.add(step.origin);
      } else {
        const stage = step.submits === "identifier" ? "identifier" : "password";
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
  // The fixed rejection cause of a stop, from its reason and the phase it
  // ended in. A typing failure names its own cause (	yped).
  function causeOf(why, during, typed) {
    if (typed) return typed;
    switch (why) {
      case "user-input":
      case "field-not-empty":
      case "verification-required":
      case "expired":
        return why;
      case "no-grant":
        return "expired";
      case "changed":
      case "navigation":
        return "page-changed";
      case "layout-mismatch":
        // The submit control never became usable, or the next step of a
        // flow that already typed in this document never appeared.
        if (during === "waiting-submit") return "submit-unavailable";
        return from > 0 ? "step-not-found" : "page-changed";
      default:
        return undefined;
    }
  }
  function finish(ok, why, typed) {
    if (done) return;
    const during = phase;
    // A verification the user must answer still showing when the submit
    // wait ends: keep the typed values so they can answer it and submit.
    const keep =
      !ok &&
      during === "waiting-submit" &&
      why === "layout-mismatch" &&
      verificationPending(doc);
    if (keep) why = "verification-required";
    done = true;
    stopped = true;
    reason = why;
    if (keyboard) keyboard.cancel();
    stopWatchingParent();
    clearInterval(timer);
    clearTimeout(lifetime);
    clearTimeout(expiryTimer);
    scrub(!ok && !keep);
    pending = current_ = stable = typedLast = null;
    cancelActive = null;
    doc.removeEventListener("input", edited, true);
    doc.removeEventListener("click", edited, true);
    notify(ok ? "form-completed" : rejection(causeOf(why, during, typed)));
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
    const target = composedTarget(event);
    const entry = records.find((item) => item.element === target);
    if (entry) entry.typed = target.value.length;
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
    const forms = Array.from(new Set([user?.form, pw?.form].filter(Boolean)));
    // Admission precedes the native grant, including fill-only delivery.
    // Only a reviewed SPA submit permits a non-POST form method; its
    // origin and browsing context are still pinned to this document.
    const following = steps[step.index + 1];
    const spa = following?.kind === "submit" && following.submission === "spa";
    if (forms.some((form) => !safeForm(form, null, spa))) return null;
    const submitters = Array.from(doc.querySelectorAll("button,input")).filter(
      (node) => forms.includes(node.form),
    );
    if (
      submitters.some(
        (node) =>
          ["submit", "image"].includes(node.type) &&
          !safeForm(node.form, node, spa),
      )
    )
      return null;
    // Bind the destination before the native grant arrives, including for
    // fill-only consent. The existing per-key guard rechecks this snapshot;
    // checking only at submit would already have delivered the credentials.
    const binding = JSON.stringify([
      doc.baseURI,
      doc.querySelector("base[target]")?.getAttribute("target"),
      forms.map((form) => [
        form.action,
        form.method,
        form.getAttribute("action"),
        form.getAttribute("method"),
        form.getAttribute("target"),
      ]),
      submitters.map((node) => [
        node.type,
        node.getAttribute("formaction"),
        node.getAttribute("formmethod"),
        node.getAttribute("formtarget"),
        node.getAttribute("form"),
        ["submit", "image"].includes(node.type)
          ? formAction(node.form, node).href
          : null,
      ]),
    ]);
    return { user, pw, forms, submitters, binding };
  }
  function same(a, b) {
    return (
      !!a &&
      !!b &&
      a.button === b.button &&
      a.user === b.user &&
      a.pw === b.pw &&
      a.binding === b.binding &&
      (a.forms || []).length === (b.forms || []).length &&
      (a.forms || []).every((form, index) => form === b.forms[index]) &&
      (a.submitters || []).length === (b.submitters || []).length &&
      (a.submitters || []).every((node, index) => node === b.submitters[index])
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
  function changedReason() {
    return current() && current_ && applies(current_.step)
      ? "changed"
      : "navigation";
  }
  // A form that submits outside this document, by GET (credentials in the
  // address) or to another origin is never submitted.
  function formAction(form, submitter) {
    const raw =
      submitter?.getAttribute("formaction") ?? form.getAttribute("action");
    // Present-empty action means this document, not the owner's action.
    return new URL(
      raw === null || raw === "" ? location.href : raw,
      doc.baseURI,
    );
  }
  function safeForm(form, submitter, spa = false) {
    if (!form) return true;
    const action = formAction(form, submitter);
    const method = (
      submitter?.getAttribute("formmethod") ??
      form.getAttribute("method") ??
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
      (spa || method === "post" || method === "dialog") &&
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
      prepareWindmillPasswordForm();
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
  const WINDMILL_SELECTORS = [
    [
      'input[id$="-email"][type="email"][autocomplete="username"]',
      'input[id$="-password"][type="password"][autocomplete="current-password"]',
    ],
    [
      'input[type="email"]:is([id$="-email"][autocomplete="username"],#email:is([autocomplete="email"],[autocomplete="username"]))',
      'input[type="password"][autocomplete="current-password"]:is([id$="-password"],#password)',
    ],
  ];
  function prepareWindmillPasswordForm() {
    if (
      preparation !== "windmill-password-form" ||
      preparationAttempted ||
      from !== 0 ||
      !current() ||
      !mainDocumentLoaded() ||
      location.pathname !== "/user/login" ||
      !steps[0] ||
      !applies(steps[0]) ||
      steps[0].kind !== "form" ||
      steps[0].frame !== null ||
      // The reviewed Windmill pairs only: Cloud runs the current release
      // (${uid}-email, ${uid}-password); self-hosted releases up to
      // v1.793 also render #email/#password (Login.svelte).
      !WINDMILL_SELECTORS.some(
        ([username, password]) =>
          steps[0].selectors.username === username &&
          steps[0].selectors.password === password,
      ) ||
      cloudflareInterstitial()
    )
      return;
    // Source-backed optional entry point, not SSO or a credential submit.
    // An already visible form goes through ordinary detection above.
    if (
      doc.querySelector(
        '[role="dialog"], iframe, input[autocomplete="one-time-code"]',
      )
    )
      return;
    const fields = doc.querySelectorAll(
      steps[0].selectors.username + "," + steps[0].selectors.password,
    );
    if (Array.from(fields).some((field) => field.value)) return;
    const buttons = Array.from(doc.querySelectorAll("button")).filter(
      (button) =>
        button.textContent.trim() === "Log in without third-party" &&
        control(button) &&
        enabled(button),
    );
    if (buttons.length !== 1) return;
    const button = buttons[0];
    if (
      button.form ||
      ["formaction", "formmethod", "formtarget", "formenctype"].some((key) =>
        button.hasAttribute(key),
      )
    )
      return;
    preparationAttempted = true;
    button.click();
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
          entry.hash === hashes[index] && entry.element.value === values[index],
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
      if (!stepCurrent()) return finish(false, changedReason());
      if (!applies(step)) return finish(false, "navigation");
      if (now() < eligibleAt) return;
      const located = submitTarget(step);
      if (!located) return;
      if (!(await valuesMatch()) || !stepCurrent())
        return finish(false, "changed");
      // An unanswered verification holds the submit request until the
      // user answers it or this wait's bound ends (see finish).
      if (verificationPending(doc)) return;
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
        return finish(false, changedReason());
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
    } catch (error) {
      finish(false, done ? reason : "changed", typingCause(error));
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
    // The page's state before the submit, to tell a refusal it then shows
    // from what was already there.
    const baseline = afterSubmitBaseline([
      current_.target.user,
      current_.target.pw,
    ]);
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
    // The last step was submitted: watch this document for a refusal.
    if (done && reason === "completed") watchAfterSubmit(baseline);
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
        "preparation",
      ])
    )
      throw new Error();
    if (own(raw, "preparation")) {
      if (raw.preparation !== "windmill-password-form") throw new Error();
      preparation = raw.preparation;
    }
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
    if (!steps.some((step) => step.kind !== "submit" && step.origin === origin))
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
  cancelActive = (cause) => finish(false, "cancelled", cause);
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
        finish(false, changedReason());
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
