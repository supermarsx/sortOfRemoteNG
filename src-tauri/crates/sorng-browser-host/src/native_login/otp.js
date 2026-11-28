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
  let startRequested = false,
    preGrantRetries = 0,
    recoveryAnchor = null;
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
  function tacticalModalFor(found) {
    const tacticalModal = found?.input.closest(
      '.q-dialog[role="dialog"][aria-modal="true"]',
    );
    return found &&
      tacticalModal &&
      setup.id === "tacticalrmm-totp" &&
      setup.submission === "spa" &&
      location.pathname === "/login" &&
      setup.codeSelector ===
        '.q-dialog form input[autocomplete="one-time-code"][inputmode="numeric"]' &&
      setup.submitSelector ===
        '.q-dialog form:has(input[autocomplete="one-time-code"][inputmode="numeric"]) button[type="submit"]' &&
      tacticalModal.contains(found.form) &&
      visible(tacticalModal) &&
      Array.from(
        doc.querySelectorAll('.q-dialog[role="dialog"][aria-modal="true"]'),
      ).filter(visible).length === 1
      ? tacticalModal
      : null;
  }
  function tacticalFocusContainer(found, focused) {
    const tacticalModal = tacticalModalFor(found);
    // Quasar's reviewed focus queue can move focus to this noninteractive
    // owner container. Never extend this exception to a real action/input.
    return (
      tacticalModal &&
      focused instanceof HTMLDivElement &&
      focused.matches('.q-dialog__inner[tabindex="-1"]') &&
      !focused.hasAttribute("role") &&
      !focused.closest('[contenteditable]:not([contenteditable="false"])') &&
      focused.contains(found.input) &&
      focused.closest('.q-dialog[role="dialog"][aria-modal="true"]') ===
        tacticalModal
    );
  }
  /* TACTICAL_FOCUS_RETRY */
  function rediscoverBeforeGrant() {
    const previous = target;
    const found = controls();
    const modal = tacticalModalFor(found);
    const focused = doc.activeElement;
    if (!previous || !found || !modal) return false;
    if (
      !tacticalFocusRetryAllowed({
        stopped,
        beforeGrant: !startRequested,
        attempts: preGrantRetries,
        empty: !prefix && !previous.input.value && !found.input.value,
        sameScope:
          previous.form === found.form &&
          previous.href === found.href &&
          previous.fingerprint === found.fingerprint &&
          sameTotpHandlers(found, previous),
        sameInput: previous.input === found.input,
        previousDetached: !previous.input.isConnected,
        focus:
          focused === found.input
            ? "input"
            : focused === doc.body
              ? "body"
              : tacticalFocusContainer(found, focused)
                ? "container"
                : "other",
      })
    )
      return false;
    // No start/grant has been requested. Keep the same form/modal/document
    // pinned while its focus/render queue settles, with a finite retry cap.
    recoveryAnchor = { form: found.form, modal, href: found.href };
    preGrantRetries++;
    target = null;
    later(discover, 200);
    return true;
  }
  function discover() {
    if (stopped) return;
    const found = controls();
    if (
      recoveryAnchor &&
      (!found ||
        found.form !== recoveryAnchor.form ||
        found.href !== recoveryAnchor.href ||
        tacticalModalFor(found) !== recoveryAnchor.modal)
    ) {
      cancel();
      return;
    }
    // Never take focus away from another live control or replace manual input.
    const focused = doc.activeElement;
    const tacticalContainer = tacticalFocusContainer(found, focused);
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
    if (target !== found || stopped) return;
    later(() => {
      if (current()) {
        startRequested = true;
        emit("start");
      } else if (!rediscoverBeforeGrant()) cancel();
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
    if (!target && recoveryAnchor && !stopped) cancel();
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
      if (!target && recoveryAnchor && !stopped) cancel();
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
      if (!target && recoveryAnchor && !stopped) cancel();
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
      if (target || recoveryAnchor) cancel();
    },
    true,
  );
  doc.addEventListener(
    "focusin",
    (event) => {
      if (!target && recoveryAnchor && !stopped) {
        const found = controls();
        if (
          !found ||
          (event.target !== found.input &&
            !tacticalFocusContainer(found, event.target))
        )
          cancel();
      }
      if (target && event.target !== target.input && !rediscoverBeforeGrant())
        cancel();
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
