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
  // cause is one fixed rejection cause. keep leaves typed values in
  // place for the user (a verification they must answer before submitting).
  function finish(ok, status, cause, keep) {
    if (done) return;
    if (keyboard) keyboard.cancel();
    done = true;
    stopped = true;
    stopWatchingParent();
    clearInterval(timer);
    clearTimeout(lifetime);
    clearTimeout(expiryTimer);
    scrub(records, !ok && !keep);
    records = [];
    if (captured)
      captured.extras.forEach((field) => {
        field.value = "";
      });
    captured = metadata = null;
    cancelActive = null;
    doc.removeEventListener("input", edited, true);
    doc.removeEventListener("click", edited, true);
    if (status !== null) notify(ok ? "form-completed" : rejection(cause));
  }
  function edited(event) {
    if (!event.isTrusted) return;
    if (!keyboard?.ownsEvent(event))
      return finish(false, undefined, "user-input");
    const target = composedTarget(event);
    const entry = records.find((item) => item.element === target);
    if (entry) entry.typed = target.value.length;
  }
  // No deadline covers the whole attempt. Finding the form has the detection
  // deadline; every later wait starts its own bound here.
  function bound(ms) {
    waitDeadline = now() + ms;
    clearTimeout(lifetime);
    lifetime = setTimeout(timedOut, Math.max(0, ms));
  }
  function timedOut() {
    if (phase !== "waiting-submit") return finish(false, undefined, "expired");
    // The submit control never became usable. A verification waiting for
    // the user keeps the typed values so they can answer it and submit.
    if (verificationPending(doc))
      return finish(false, undefined, "verification-required", true);
    finish(false, undefined, "submit-unavailable");
  }
  const invalidCause = () =>
    now() >= waitDeadline ? "expired" : "page-changed";
  function valid() {
    if (done || !current() || now() >= waitDeadline || !captured) return false;
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
    if (!current()) return finish(false, undefined, "page-changed");
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
      if (!valid()) return finish(false, undefined, invalidCause());
      if (now() < eligibleAt || !controlsReady()) return;
      if (!(await controlsSettled()) || !valid()) return;
      if (
        phase === "waiting-fill" &&
        (captured.target.pw.value || captured.target.user?.value)
      )
        return finish(false, undefined, "field-not-empty");
      if (phase === "waiting-submit" && !(await valuesMatch()))
        return finish(false, undefined, "page-changed");
      // An unanswered verification holds the submit request until the
      // user answers it or this wait's bound ends (see timedOut).
      if (phase === "waiting-submit" && verificationPending(doc)) return;
      // A credential request gets its own bound. A submit request stays
      // under the one that began when the fill ended, so typed values never
      // outlive it.
      if (phase === "waiting-fill") bound(GRANT_WAIT_MS);
      phase = phase === "waiting-fill" ? "form" : "form-submit";
      notify(phase);
    } catch (_) {
      finish(false, undefined, "page-changed");
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
      if (!valid() || now() >= expires || timing(options) !== timing(metadata))
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
    } catch (error) {
      finish(
        false,
        undefined,
        typingCause(error) ||
          (error?.message === "edited"
            ? "field-not-empty"
            : error?.message === "expired" || now() >= expires
              ? "expired"
              : "page-changed"),
      );
    } finally {
      username = password = "";
      options.fields.forEach((field) => {
        field.value = "";
      });
    }
  }
  async function submit(autoSubmit) {
    try {
      if (!autoSubmit || !metadata.submit || !(await valuesMatch()))
        return finish(false, undefined, "page-changed");
      if (now() >= expires) return finish(false, undefined, "expired");
      if (!controlsReady())
        return finish(false, undefined, "submit-unavailable");
      if (captured.joomlaMfa || hasJoomlaTwoFactorField(captured.target))
        return finish(true);
      // The page's state before the one submit, to tell a refusal it then
      // shows from what was already there.
      const baseline = afterSubmitBaseline([
        captured.target.user,
        captured.target.pw,
      ]);
      // Consume the sole action before invoking any page event handlers.
      phase = "submitted";
      guardedSubmit(captured.target, config.selectors, config.readinessProfile);
      finish(true);
      watchAfterSubmit(baseline);
    } catch (_) {
      finish(false, undefined, "page-changed");
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
        cancelActive = (cause) => finish(false, undefined, cause);
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
    if (cancelActive) cancelActive("page-changed");
    finish(false, undefined, "page-changed");
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
      finish(false, undefined, "page-changed");
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
          () => finish(false, undefined, "expired"),
          Math.max(0, expires - now()),
        );
        if (operation === "form") {
          bound(expires - now());
          fill(username, password, options, autoSubmit);
        } else submit(autoSubmit);
      }
      return true;
    } catch (_) {
      finish(false, undefined, "page-changed");
      return false;
    }
  };
}
