/* Reviewed DSM 7 desktop Vue account/password panels, followed as a resumable
 * state machine. DSM boots as a single-page app: route normalisation, empty
 * mounts, re-renders, replaced roots and CSS-only visibility changes are waits,
 * and every evaluation locates the reviewed controls again instead of latching
 * them. Only named security or page conditions stop. Each credential grant is
 * requested once, a replaced Next is re-clicked at most once, Sign in is
 * clicked at most once, and there is no API login, factor selection or retry.
 * ES5 only: this file is embedded verbatim inside a script element. */
(function () {
  "use strict";
  if (window.__sorng_synology_login) return;
  // Named budgets in milliseconds. Idle budgets run from the last meaningful
  // progress; client windows stay below the native grant lifetimes.
  var WATCHDOG_MS = 500, // CSS-only and replaceState changes fire no event
    QUIET_MS = 400, // reviewed panel without mutations before acting
    MAX_SETTLE_MS = 3000, // act on identical controls despite panel churn
    ROUTE_GRACE_MS = 2000, // a path/search change must persist to stop
    STEP_GRACE_MS = 3000, // unknown #/signin/* step before hand-off
    REJECT_CONFIRM_MS = 1000, // post-submit error state must persist
    PAGE_IDLE_MS = 60000, // no page progress before account readiness
    PAGE_CAP_MS = 240000, // absolute account-readiness cap from run()
    LAYOUT_GRACE_MS = 45000, // root present, reviewed controls unmatched
    REQUEST_MS = 30000, // one credential request including its body
    SUBMIT_CAP_MS = 85000, // username release to Sign in (native 90s)
    RECLICK_MS = 8000, // replaced Next button without a transition
    VERIFY_MS = 30000, // post-submit observation
    LEFT_CONFIRM_MS = 2000, // post-submit: login root gone off #/signin*
    DESKTOP_CONFIRM_MS = 20000, // no login root, DSM desktop marker shown
    MAX_FILLS = 3, // writes per field stage, including refills
    TRACE_LIMIT = 40;
  // DSM serves an empty #sds-login-vue placeholder that its Vue 2 mount
  // replaces with #sds-login-vue-inst; older layouts keep the first id as a
  // persistent wrapper. See loginRoots() for how exactly one root is chosen.
  var ROOT = "#sds-login-vue-inst, #sds-login-vue",
    MOUNTED_ROOT = "#sds-login-vue-inst",
    PLACEHOLDER_ROOT = "#sds-login-vue",
    PANEL = ".login-tabs-content-wrapper",
    // Narrow (mobile) layouts render Next and Sign in without role or syno-id.
    COMPACT_BUTTON = "login-btn-mobile",
    // Best-effort DSM desktop markers (no live capture). A boot splash or an
    // empty mount is never evidence of an existing session.
    DESKTOP = "#sds-desktop, #sds-taskbar, .sds-desktop, .sds-taskbar",
    CONTROLS = {
      account: {
        form: "form#dsm-user-fieldset",
        field:
          '#dsm-user-fieldset input[syno-id="username"][type="text"][name="username"][autocomplete="username"]',
        button: 'div[role="button"][syno-id="account-panel-next-btn"]',
        waiting: "waiting_account_form",
      },
      password: {
        form: "form#dsm-pass-fieldset",
        field:
          '#dsm-pass-fieldset input[syno-id="password"][type="password"][name="current-password"][autocomplete="current-password"]',
        button: 'div[role="button"][syno-id="password-panel-next-btn"]',
        waiting: "waiting_password_form",
      },
    };
  var ran = false,
    stopped = false,
    cancelActive = null,
    status = null,
    terminalStatus = false,
    traceStart = null,
    traceSteps = [],
    print = {
      root: 0,
      panel: 0,
      form: 0,
      field: 0,
      button: 0,
      hash: "empty",
      readyState: document.readyState,
      stage: "account",
    },
    handoff = null;
  // Closed diagnostics only: fixed phase/reason strings, integer offsets and
  // counts, and closed route classes. Never values, ids, URLs or page text.
  function traceCopy() {
    return {
      steps: traceSteps.map(function (step) {
        return { t: step.t, phase: step.phase, reason: step.reason };
      }),
      fingerprint: {
        root: print.root,
        panel: print.panel,
        form: print.form,
        field: print.field,
        button: print.button,
        hash: print.hash,
        readyState: print.readyState,
        stage: print.stage,
      },
      handoff: handoff,
    };
  }
  // The private document reporter adds its native identity before
  // forwarding these fixed values to the parent application.
  function publish(phase, reason, terminal) {
    if (terminalStatus) return;
    terminalStatus = !!terminal;
    if (status && status.phase === phase && status.reason === reason) return;
    status = { phase: phase, reason: reason };
    traceSteps.push({
      t:
        traceStart === null
          ? 0
          : Math.max(0, Math.round(performance.now() - traceStart)),
      phase: phase,
      reason: reason,
    });
    if (traceSteps.length > TRACE_LIMIT) traceSteps.shift();
    try {
      document.dispatchEvent(
        new CustomEvent("sorng_synology_login_progress", {
          detail: { phase: phase, reason: reason, trace: traceCopy() },
        }),
      );
    } catch (_) {}
  }
  function cancel() {
    stopped = true;
    if (cancelActive) cancelActive();
    else publish("cancelled", "cancelled", true);
  }
  window.addEventListener("pagehide", cancel);
  window.addEventListener("unload", cancel);
  function routeKind(hash) {
    if (hash === "" || hash === "#") return "empty";
    if (hash === "#/") return "slash";
    if (hash === "#/signin" || hash === "#/signin/") return "signin";
    if (hash === "#/signin/password") return "password";
    if (hash.slice(0, 9).toLowerCase() !== "#/signin/") return "other";
    var step = hash.slice(9).toLowerCase();
    if (/passkey|fido|webauthn|security-?key|hardware/.test(step))
      return "passkey";
    if (/select/.test(step)) return "select-auth";
    if (/approv|secure/.test(step)) return "approve";
    if (/otp|2fa|two-?factor/.test(step)) return "otp";
    return "step";
  }
  function interactive(kind) {
    return ["otp", "approve", "select-auth", "passkey"].indexOf(kind) >= 0;
  }
  function accountRoute(kind) {
    return kind === "empty" || kind === "slash" || kind === "signin";
  }
  // A mounted root wins, so a leftover or enclosing placeholder never makes
  // one mounted root ambiguous; without one, the placeholder or wrapper counts.
  function loginRoots() {
    var mounted = document.querySelectorAll(MOUNTED_ROOT);
    return mounted.length
      ? mounted
      : document.querySelectorAll(PLACEHOLDER_ROOT);
  }
  // The served placeholder before (or without) a login mount, as on a DSM
  // page that is already signed in.
  function emptyPlaceholder(root) {
    return !!(
      root &&
      root.matches(PLACEHOLDER_ROOT) &&
      !root.firstElementChild
    );
  }
  // The reviewed button, else in a narrow layout the single unlabelled
  // compact button that is a direct child of the reviewed form's own panel.
  function actionButtons(selector, forms) {
    var reviewed = document.querySelectorAll(selector);
    if (reviewed.length || forms.length !== 1) return reviewed;
    var panel = forms[0].closest(PANEL);
    return panel
      ? Array.prototype.filter.call(panel.children, function (child) {
          return (
            child.localName === "div" &&
            child.classList.contains(COMPACT_BUTTON) &&
            !child.hasAttribute("syno-id")
          );
        })
      : [];
  }
  function shown(element) {
    if (!element || !element.isConnected) return false;
    var style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      (element.offsetParent === null && style.position !== "fixed")
    )
      return false;
    var rects = element.getClientRects();
    for (var index = 0; index < rects.length; index++)
      if (rects[index].width > 0 && rects[index].height > 0) return true;
    return false;
  }

  function run(data, helpers, readinessNonce) {
    if (ran || stopped)
      return Promise.resolve({ ok: false, reason: "cancelled" });
    ran = true;
    var username = data.username,
      continuation = data.continuation,
      preflight = readinessNonce !== undefined;
    data.username = data.continuation = null;
    traceStart = performance.now();
    return new Promise(function (resolve) {
      var begun = traceStart,
        start = new URL(location.href),
        finished = false,
        reported = false,
        clicked = false,
        busy = false,
        again = false,
        // account | account-fetch | account-fill | account-next |
        // password | password-fetch | password-fill | verifying
        stage = "account",
        observer = null,
        controller = null,
        requestAt = 0,
        password = null,
        usernameAt = preflight ? null : begun,
        wakeTimer = null,
        wakeAt = 0,
        due = WATCHDOG_MS,
        progressAt = begun,
        completeAt = null,
        lastReadyState = null,
        lastHash = null,
        lastShape = null,
        seen = null,
        replaced = false,
        readySince = null,
        mutatedAt = begun,
        fills = 0,
        guarded = [],
        written = [],
        nextClick = null,
        reclicking = false,
        reclicked = false,
        signInTarget = null,
        leftSince = null,
        desktopSince = null,
        signedOutSince = null,
        stepSince = null,
        verifyAt = 0,
        rejectSince = null;
      var readinessEvents = [
        "DOMContentLoaded",
        "readystatechange",
        "load",
        "transitionend",
        "animationend",
        "visibilitychange",
        "input",
        "change",
      ];
      var userEvents = ["keydown", "input", "paste"];
      function report(result) {
        if (reported) return;
        reported = true;
        helpers.report(result);
        resolve(result);
      }
      function detach() {
        userEvents.forEach(function (name) {
          document.removeEventListener(name, userInput, true);
        });
      }
      function finish(phase, reason) {
        if (finished) return;
        finished = true;
        if (observer) observer.disconnect();
        if (controller) controller.abort();
        controller = null;
        clearTimeout(wakeTimer);
        wakeTimer = null;
        window.removeEventListener("hashchange", evaluate);
        window.removeEventListener("popstate", evaluate);
        window.removeEventListener("resize", evaluate);
        window.removeEventListener("load", evaluate);
        readinessEvents.forEach(function (name) {
          document.removeEventListener(name, evaluate, true);
        });
        detach();
        releaseSubmit();
        // Clear only our own unsent value, never a user's edit.
        if (!clicked && password !== null) {
          var setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set;
          written.forEach(function (field) {
            if (field.value === password) setter.call(field, "");
          });
        }
        written = [];
        username = continuation = password = readinessNonce = null;
        cancelActive = null;
        try {
          fingerprint(
            locate(
              stage.indexOf("account") === 0 && stage !== "account-next"
                ? "account"
                : "password",
            ),
          );
        } catch (_) {}
        publish(phase, reason, true);
        report({
          ok: false,
          reason:
            phase === "timeout"
              ? "reviewed-login-timeout"
              : phase === "cancelled"
                ? "cancelled"
                : reason === "invalid-credential-response"
                  ? "invalid-credential-response"
                  : "reviewed-login-stopped",
        });
      }
      cancelActive = function () {
        if (clicked) finish("submitted", "sign-in-unconfirmed");
        else finish("cancelled", "cancelled");
      };
      function handOff(kind) {
        handoff = kind === "step" ? "other" : kind;
        finish("stopped", "interactive-step-required");
      }
      function wake(ms) {
        if (finished) return;
        ms = Math.max(0, Math.ceil(ms));
        var at = performance.now() + ms;
        if (wakeTimer !== null && wakeAt <= at) return;
        clearTimeout(wakeTimer);
        wakeAt = at;
        wakeTimer = setTimeout(function () {
          wakeTimer = null;
          evaluate();
        }, ms);
      }
      function soon(at, now) {
        if (at - now < due) due = at - now;
      }
      function absorb(records) {
        if (!records || !records.length) return;
        var now = performance.now(),
          loading = document.readyState === "loading",
          panel = seen && seen.panel;
        for (var index = 0; index < records.length; index++) {
          var target = records[index].target;
          // Streamed parser insertions are progress while still loading.
          if (loading && records[index].type === "childList") progressAt = now;
          if (panel && (panel === target || panel.contains(target)))
            mutatedAt = now;
        }
      }
      // Structural identity is independent of enabled/visible controls: Vue
      // can enable Next only after input, or overlap panels during transition.
      function locate(side) {
        var spec = CONTROLS[side],
          roots = loginRoots(),
          forms = document.querySelectorAll(spec.form),
          fields = document.querySelectorAll(spec.field),
          buttons = actionButtons(spec.button, forms),
          found = {
            roots: roots.length,
            panels: document.querySelectorAll(PANEL).length,
            forms: forms.length,
            fields: fields.length,
            buttons: buttons.length,
            root: roots.length === 1 ? roots[0] : null,
            target: null,
            waiting: "waiting_root",
            missing: null,
            unsafe: false,
            mismatch: false,
          };
        if (
          (forms.length === 1 &&
            ["action", "method", "target"].some(function (name) {
              return forms[0].hasAttribute(name);
            })) ||
          (buttons.length === 1 &&
            ["formaction", "formmethod", "formtarget", "onclick"].some(
              function (name) {
                return buttons[0].hasAttribute(name);
              },
            ))
        )
          found.unsafe = true;
        if (roots.length !== 1) {
          found.missing = roots.length ? "root-ambiguous" : "root-missing";
          return found;
        }
        found.waiting = spec.waiting;
        var part =
          forms.length !== 1
            ? ["form", forms.length]
            : fields.length !== 1
              ? ["field", fields.length]
              : buttons.length !== 1
                ? ["button", buttons.length]
                : null;
        if (part) {
          found.missing = part[0] + (part[1] ? "-ambiguous" : "-missing");
          return found;
        }
        var root = roots[0],
          form = forms[0],
          field = fields[0],
          button = buttons[0],
          panel = form.closest(PANEL);
        if (
          !panel ||
          !root.contains(panel) ||
          button.closest(PANEL) !== panel ||
          field.form !== form
        ) {
          found.missing = "page-busy";
          return found;
        }
        if (side === "password") {
          // The password panel names its account; compare it before release.
          var hidden = form.querySelectorAll(
              'input[name="username"][autocomplete="username"][hidden]',
            ),
            expected =
              typeof username === "string" ? username.trim().toLowerCase() : "",
            actual = hidden.length === 1 ? hidden[0].value.trim() : "";
          if (actual && expected && actual.toLowerCase() !== expected)
            found.mismatch = true;
          if (!actual || !expected || found.mismatch) {
            found.missing = "page-busy";
            return found;
          }
        }
        found.target = {
          root: root,
          panel: panel,
          form: form,
          field: field,
          button: button,
        };
        return found;
      }
      function fingerprint(found) {
        var cap = function (value) {
          return Math.min(value, 9);
        };
        var kind = routeKind(location.hash);
        print = {
          root: cap(found.roots),
          panel: cap(found.panels),
          form: cap(found.forms),
          field: cap(found.fields),
          button: cap(found.buttons),
          hash: kind === "step" ? "other" : kind,
          readyState: document.readyState,
          stage: clicked
            ? "submitted"
            : stage.indexOf("account") === 0
              ? "account"
              : "password",
        };
      }
      function same(target, current) {
        return !!(
          target &&
          current &&
          target.root === current.root &&
          target.form === current.form &&
          target.field === current.field &&
          target.button === current.button &&
          target.panel === current.panel
        );
      }
      // Re-acquire instead of stopping: identity changes restart settling.
      function track(target, now) {
        if (same(seen, target) || (!seen && !target)) return;
        if (seen && target) replaced = true;
        seen = target;
        readySince = null;
        if (target) progressAt = now;
      }
      // Ready when the panel stayed free of mutations for QUIET_MS, or when
      // identical controls persisted for MAX_SETTLE_MS despite churn.
      function quiet(now, phase, reason) {
        if (readySince === null) readySince = now;
        var since = Math.max(readySince, mutatedAt);
        if (now - since >= QUIET_MS || now - readySince >= MAX_SETTLE_MS) {
          replaced = false;
          return true;
        }
        publish(phase, replaced ? "controls-replaced" : reason);
        soon(Math.min(since + QUIET_MS, readySince + MAX_SETTLE_MS), now);
        return false;
      }
      function editBlock(target) {
        var field = target.field;
        return field.disabled || field.matches(":disabled")
          ? "field-disabled"
          : field.readOnly
            ? "field-readonly"
            : !helpers.isVisible(field) || !shown(field)
              ? "field-hidden"
              : null;
      }
      function clickBlock(target) {
        return !helpers.isVisible(target.button) || !shown(target.button)
          ? "button-hidden"
          : target.button.matches(
                ".disable,.spin,[aria-disabled=true],[disabled]",
              )
            ? "button-disabled"
            : null;
      }
      function desktopShown() {
        return Array.prototype.some.call(
          document.querySelectorAll(DESKTOP),
          shown,
        );
      }
      // A rendered control can still be clipped away by a clipping ancestor,
      // such as a zero-size overflow:hidden wrapper. Only ancestors inside
      // the login root are considered; a fixed element escapes the rest.
      function clipped(element, root) {
        var box = element.getBoundingClientRect(),
          style = window.getComputedStyle(element);
        for (
          var node = element.parentElement;
          node && node !== root && style.position !== "fixed";
          node = node.parentElement
        ) {
          style = window.getComputedStyle(node);
          if (
            /hidden|clip|scroll|auto/.test(
              style.overflow + " " + style.overflowX + " " + style.overflowY,
            )
          ) {
            var bounds = node.getBoundingClientRect();
            if (
              Math.min(box.right, bounds.right) -
                Math.max(box.left, bounds.left) <=
                0 ||
              Math.min(box.bottom, bounds.bottom) -
                Math.max(box.top, bounds.top) <=
                0
            )
              return true;
          }
        }
        return false;
      }
      function captcha(root) {
        return Array.prototype.some.call(
          root.querySelectorAll(
            'input[name*="captcha" i], input[id*="captcha" i], iframe[src*="captcha" i], iframe[title*="captcha" i]',
          ),
          function (element) {
            return shown(element) && !clipped(element, root);
          },
        );
      }
      // Guards run between each write/event of a fill: the same reviewed
      // controls, route and document, with no refusal condition.
      function current(side, target) {
        if (finished) return false;
        var found = locate(side),
          kind = routeKind(location.hash);
        return (
          location.pathname === start.pathname &&
          location.search === start.search &&
          !found.unsafe &&
          !found.mismatch &&
          same(found.target, target) &&
          !captcha(target.root) &&
          (side === "password" ? kind === "password" : accountRoute(kind))
        );
      }
      function preventNativeSubmit(event) {
        event.preventDefault();
      }
      function guardSubmit(form) {
        if (guarded.indexOf(form) >= 0) return;
        form.addEventListener("submit", preventNativeSubmit, true);
        guarded.push(form);
      }
      function releaseSubmit() {
        guarded.forEach(function (form) {
          form.removeEventListener("submit", preventNativeSubmit, true);
        });
        guarded = [];
      }
      function remember(field, value) {
        if (value === password && written.indexOf(field) < 0)
          written.push(field);
      }
      function write(target, value, side) {
        guardSubmit(target.form);
        readySince = mutatedAt = performance.now();
        try {
          helpers.fillField(
            target.field,
            value,
            function () {
              return current(side, target) && editBlock(target) === null;
            },
            function () {
              if (side === "password" && target.field.value === value)
                remember(target.field, value);
              return current(side, target) && target.field.value === value;
            },
          );
        } catch (_) {}
        if (side === "password" && target.field.value === value)
          remember(target.field, value);
        if (!finished && target.field.value === value && current(side, target))
          return true;
        // A guard refused the write; re-evaluate from scratch.
        readySince = null;
        again = true;
        return false;
      }
      function validAccount() {
        return (
          typeof username === "string" &&
          username &&
          username.trim() === username &&
          typeof continuation === "string" &&
          /^[0-9a-f]{32}$/.test(continuation)
        );
      }
      function clearReply(reply) {
        if (reply && typeof reply === "object")
          reply.username = reply.password = reply.continuation = null;
      }
      function request(nonce, passwordStage) {
        controller = new AbortController();
        return fetch(
          "/__sortofremoteng_autologin?" +
            (passwordStage ? "phase=password&" : "") +
            "nonce=" +
            encodeURIComponent(nonce),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          },
        ).then(function (response) {
          return response.ok
            ? response.json()
            : Promise.reject(new Error("expired"));
        });
      }
      function unavailable() {
        controller = null;
        if (!finished) finish("stopped", "credentials-unavailable");
      }
      function overdue(now) {
        return (
          now - requestAt >= REQUEST_MS ||
          (usernameAt !== null && now - usernameAt >= SUBMIT_CAP_MS)
        );
      }
      function requestUsername(now, target) {
        publish("requesting_username", "requesting-username");
        // A diagnostic listener may have changed the page synchronously.
        if (locate("account").unsafe)
          return finish("stopped", "unsafe-form-target");
        if (finished || editBlock(target) || !current("account", target)) {
          readySince = null;
          again = true;
          return;
        }
        var nonce = readinessNonce;
        readinessNonce = null;
        stage = "account-fetch";
        requestAt = progressAt = now;
        request(nonce, false).then(function (reply) {
          try {
            if (finished) return;
            controller = null;
            var at = performance.now();
            if (overdue(at)) return finish("timeout", "timeout");
            if (!reply || reply.loginFlow !== "synology")
              return finish("stopped", "invalid-credential-response");
            username = reply.username;
            continuation = reply.continuation;
            if (!validAccount())
              return finish("stopped", "invalid-credential-response");
            usernameAt = progressAt = at;
            stage = "account-fill";
            fills = 0;
          } finally {
            clearReply(reply);
          }
          evaluate();
        }, unavailable);
      }
      function requestPassword(now, target) {
        publish("requesting_password", "requesting-password");
        var found = locate("password");
        if (found.unsafe) return finish("stopped", "unsafe-form-target");
        if (found.mismatch) return finish("stopped", "account-mismatch");
        if (finished || editBlock(target) || !current("password", target)) {
          readySince = null;
          again = true;
          return;
        }
        var nonce = continuation;
        continuation = null;
        stage = "password-fetch";
        requestAt = progressAt = now;
        request(nonce, true).then(function (reply) {
          try {
            if (finished) return;
            controller = null;
            if (overdue(performance.now())) return finish("timeout", "timeout");
            if (
              !reply ||
              reply.loginFlow !== "synology" ||
              typeof reply.password !== "string"
            )
              return finish("stopped", "invalid-credential-response");
            password = reply.password;
            progressAt = performance.now();
            stage = "password-fill";
            fills = 0;
          } finally {
            clearReply(reply);
          }
          evaluate();
        }, unavailable);
      }
      // Trusted text edits in the login UI mean the user took over; toggling
      // a checkbox such as "stay signed in" does not.
      function userInput(event) {
        if (finished || clicked || !event.isTrusted) return;
        var target = event.target;
        if (
          !target ||
          target.nodeType !== 1 ||
          !target.closest(ROOT) ||
          !(
            target.localName === "textarea" ||
            (target.localName === "input" &&
              ["text", "password", "email", "tel", "number", "search"].indexOf(
                target.type,
              ) >= 0)
          )
        )
          return;
        if (event.type === "keydown") {
          var key = event.key;
          if (
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            typeof key !== "string" ||
            (key.length !== 1 && key !== "Backspace" && key !== "Delete")
          )
            return;
        }
        finish("stopped", "user-input-detected");
      }
      function pageBudget(now, reason) {
        if (now - progressAt >= PAGE_IDLE_MS || now - begun >= PAGE_CAP_MS)
          return finish("timeout", reason);
        soon(progressAt + PAGE_IDLE_MS, now);
        soon(begun + PAGE_CAP_MS, now);
      }
      function capReason(kind) {
        if (stage === "account") return "login-form-never-appeared";
        if (stage === "account-fill") return "next-not-advanced";
        if (stage === "account-next")
          return kind === "password" || locate("password").target
            ? "password-panel-never-appeared"
            : "next-not-advanced";
        var found = stage === "password-fill" ? locate("password") : null;
        return found && found.target && found.target.field.value === password
          ? "signin-button-never-enabled"
          : "password-panel-never-appeared";
      }
      function unknownStep(now) {
        if (stepSince === null) stepSince = now;
        if (now - stepSince >= STEP_GRACE_MS) return handOff("step");
        soon(stepSince + STEP_GRACE_MS, now);
        if (clicked) publish("verifying_sign_in", "submitted");
        else publish("waiting_password_form", "password-route");
      }
      function evaluate() {
        if (finished) return;
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          var rounds = 0;
          do {
            again = false;
            due = WATCHDOG_MS;
            if (observer) absorb(observer.takeRecords());
            step(performance.now());
          } while (again && !finished && ++rounds < 8);
        } catch (_) {
          finish("stopped", "form-changed");
        } finally {
          busy = false;
        }
        if (!finished) wake(due);
      }
      function step(now) {
        var url = new URL(location.href),
          hash = url.hash,
          kind = routeKind(hash),
          readyState = document.readyState;
        if (readyState !== lastReadyState) {
          if (lastReadyState !== null) progressAt = now;
          lastReadyState = readyState;
        }
        if (readyState === "complete" && completeAt === null) completeAt = now;
        if (hash !== lastHash) {
          if (lastHash !== null) progressAt = now;
          lastHash = hash;
          stepSince = null;
        }
        if (stage === "verifying") return verify(now, kind);
        if (
          url.origin !== start.origin ||
          url.pathname !== start.pathname ||
          url.search !== start.search
        ) {
          if (leftSince === null) leftSince = now;
          if (now - leftSince >= ROUTE_GRACE_MS)
            return finish("stopped", "left-login-page");
          return soon(leftSince + ROUTE_GRACE_MS, now);
        }
        leftSince = null;
        var side =
          stage.indexOf("account") === 0 && stage !== "account-next"
            ? "account"
            : "password";
        var found = locate(side);
        fingerprint(found);
        if (found.root && captcha(found.root))
          return finish("stopped", "captcha-required");
        if (found.unsafe) return finish("stopped", "unsafe-form-target");
        if (found.mismatch) return finish("stopped", "account-mismatch");
        var shape = [
          found.roots,
          found.forms,
          found.fields,
          found.buttons,
          side,
        ].join();
        if (shape !== lastShape) {
          progressAt = now;
          lastShape = shape;
        }
        track(found.target, now);
        if (stage === "account-fetch" || stage === "password-fetch") {
          if (overdue(now)) return finish("timeout", "timeout");
          soon(requestAt + REQUEST_MS, now);
        } else if (usernameAt !== null) {
          if (now - usernameAt >= SUBMIT_CAP_MS)
            return finish("timeout", capReason(kind));
        }
        if (usernameAt !== null) soon(usernameAt + SUBMIT_CAP_MS, now);
        if (stage === "account") return accountStage(now, kind, found);
        if (stage === "account-fetch") return;
        if (stage === "account-fill") return accountFill(now, kind, found);
        if (stage === "account-next") return accountNext(now, kind, found);
        return passwordStage(now, kind, found);
      }
      function accountStage(now, kind, found) {
        if (document.readyState === "loading") {
          readySince = null;
          publish("waiting_document", "document-loading");
          return pageBudget(now, "page-never-ready");
        }
        // Advisory and credential-free: only a visible DSM desktop marker,
        // held without a login root (or beside the never-mounted empty
        // placeholder), counts as an existing session. A slow QuickConnect
        // boot on "#/" keeps waiting under the page budgets.
        if (
          (found.roots === 0 ||
            (found.roots === 1 && emptyPlaceholder(found.root))) &&
          (kind === "empty" || kind === "slash" || kind === "other") &&
          desktopShown()
        ) {
          if (desktopSince === null) desktopSince = now;
          if (now - desktopSince >= DESKTOP_CONFIRM_MS)
            return finish("signed_in", "no-sign-in-page");
          soon(desktopSince + DESKTOP_CONFIRM_MS, now);
        } else desktopSince = null;
        if (!accountRoute(kind)) {
          readySince = null;
          publish("waiting_page", "route-pending");
          return pageBudget(
            now,
            found.roots ? "login-form-never-appeared" : "page-never-ready",
          );
        }
        if (!found.target) {
          readySince = null;
          publish(found.waiting, found.missing);
          // Reviewed controls without a recognised login root are a layout
          // this helper does not know, not a page that never became ready;
          // the trace keeps root-missing and the control counts.
          if (!found.roots && !(found.forms || found.fields || found.buttons))
            return pageBudget(now, "page-never-ready");
          if (completeAt !== null) {
            var layoutFrom = Math.max(completeAt, progressAt);
            if (now - layoutFrom >= LAYOUT_GRACE_MS)
              return finish("stopped", "layout-unrecognized");
            soon(layoutFrom + LAYOUT_GRACE_MS, now);
          }
          return pageBudget(now, "login-form-never-appeared");
        }
        var target = found.target,
          block = editBlock(target);
        if (block) {
          readySince = null;
          publish("waiting_account_editable", block);
          return pageBudget(now, "login-form-never-appeared");
        }
        if (!shown(target.button)) {
          readySince = null;
          publish("waiting_account_stable", "button-hidden");
          return pageBudget(now, "login-form-never-appeared");
        }
        if (!quiet(now, "waiting_account_stable", "form-settling"))
          return pageBudget(now, "login-form-never-appeared");
        if (preflight) return requestUsername(now, target);
        stage = "account-fill";
        fills = 0;
        accountFill(now, kind, found);
      }
      function accountFill(now, kind, found) {
        if (!accountRoute(kind)) {
          readySince = null;
          return publish("waiting_page", "route-pending");
        }
        if (!found.target) {
          readySince = null;
          return publish(found.waiting, found.missing);
        }
        var target = found.target,
          filled = target.field.value === username,
          block = editBlock(target);
        if (block) {
          readySince = null;
          return publish(
            filled ? "waiting_next_button" : "waiting_account_editable",
            block,
          );
        }
        if (!filled) {
          if (
            !quiet(
              now,
              "filling_username",
              fills ? "value-refilled" : "panel-quiet-wait",
            )
          )
            return;
          if (fills >= MAX_FILLS) return finish("stopped", "form-changed");
          if (fills) publish("filling_username", "value-refilled");
          fills++;
          if (!write(target, username, "account")) return;
        }
        block = clickBlock(target);
        if (block) {
          readySince = null;
          return publish("waiting_next_button", block);
        }
        if (!quiet(now, "waiting_next_button", "input-settling")) return;
        guardSubmit(target.form);
        var reclick = reclicking;
        reclicking = false;
        stage = "account-next";
        nextClick = { at: now, button: target.button };
        progressAt = now;
        target.button.click();
        publish(
          "waiting_password_form",
          reclick ? "next-reclicked" : "panel-transition",
        );
      }
      function accountNext(now, kind, found) {
        if (kind === "password") {
          stage = "password";
          fills = 0;
          readySince = null;
          return passwordStage(now, kind, found);
        }
        if (interactive(kind)) return handOff(kind);
        if (kind === "step") return unknownStep(now);
        if (kind === "other") {
          if (stepSince === null) stepSince = now;
          if (now - stepSince >= ROUTE_GRACE_MS)
            return finish("stopped", "route-changed");
          return soon(stepSince + ROUTE_GRACE_MS, now);
        }
        // Still on an account route: the transition has not started.
        if (found.target) {
          readySince = null;
          return publish("waiting_password_form", "password-route");
        }
        var account = locate("account");
        if (account.unsafe) return finish("stopped", "unsafe-form-target");
        if (
          !reclicked &&
          nextClick &&
          account.target &&
          account.target.button !== nextClick.button
        ) {
          // A re-rendered Next may have swallowed the click; retry once.
          if (now - nextClick.at >= RECLICK_MS) {
            reclicked = reclicking = true;
            stage = "account-fill";
            again = true;
            return;
          }
          soon(nextClick.at + RECLICK_MS, now);
        }
        publish("waiting_password_form", "panel-transition");
      }
      function passwordStage(now, kind, found) {
        if (kind !== "password") {
          if (interactive(kind)) return handOff(kind);
          if (kind === "step") return unknownStep(now);
          return finish("stopped", "route-changed");
        }
        var accountShown = Array.prototype.some.call(
          document.querySelectorAll(CONTROLS.account.field),
          shown,
        );
        if (accountShown) {
          readySince = null;
          return publish("waiting_password_form", "panel-transition");
        }
        if (!found.target) {
          readySince = null;
          if (stage !== "password-fetch") publish(found.waiting, found.missing);
          return;
        }
        if (stage === "password-fetch") return;
        var target = found.target,
          block = editBlock(target);
        if (stage === "password") {
          if (block) {
            readySince = null;
            return publish("waiting_password_form", block);
          }
          if (!quiet(now, "waiting_password_form", "panel-quiet-wait")) return;
          return requestPassword(now, target);
        }
        var filled = target.field.value === password;
        if (block) {
          readySince = null;
          return publish(
            filled ? "waiting_signin_button" : "waiting_password_form",
            block,
          );
        }
        if (!filled) {
          if (
            !quiet(
              now,
              "filling_password",
              fills ? "value-refilled" : "panel-quiet-wait",
            )
          )
            return;
          if (fills >= MAX_FILLS) return finish("stopped", "form-changed");
          if (fills) publish("filling_password", "value-refilled");
          fills++;
          if (!write(target, password, "password")) return;
        }
        block = clickBlock(target);
        if (block) {
          readySince = null;
          return publish("waiting_signin_button", block);
        }
        if (!quiet(now, "waiting_signin_button", "input-settling")) return;
        // Sign in is clicked once; nothing after this retries it.
        guardSubmit(target.form);
        clicked = true;
        stage = "verifying";
        verifyAt = progressAt = now;
        signInTarget = target;
        detach();
        target.button.click();
        releaseSubmit();
        written = [];
        password = null;
        fingerprint(found);
        publish("verifying_sign_in", "submitted");
        report({ ok: true, reason: "submitted" });
      }
      // Page-observed outcome after Sign in; advisory, not native proof.
      function verify(now, kind) {
        if (interactive(kind)) return handOff(kind);
        if (kind === "step") return unknownStep(now);
        var found = locate("password"),
          roots = loginRoots();
        fingerprint(found);
        if (found.root && captcha(found.root))
          return finish("stopped", "captcha-required");
        // An empty placeholder is not a login page, whatever its styling.
        var rootShown =
          roots.length > 1 ||
          (roots.length === 1 &&
            shown(roots[0]) &&
            !emptyPlaceholder(roots[0]));
        // Left the sign-in page: confirmed at once by the desktop marker,
        // otherwise only if it persists; a splash re-render is not enough.
        if (!rootShown && kind !== "signin" && kind !== "password") {
          if (desktopShown()) return finish("signed_in", "left-signin-page");
          if (signedOutSince === null) signedOutSince = now;
          if (now - signedOutSince >= LEFT_CONFIRM_MS)
            return finish("signed_in", "left-signin-page");
          soon(signedOutSince + LEFT_CONFIRM_MS, now);
        } else signedOutSince = null;
        var target = found.target,
          rejected =
            kind === "password" &&
            target &&
            !target.button.matches(".spin") &&
            ((same(target, signInTarget) && target.field.value === "") ||
              Array.prototype.some.call(
                target.panel.querySelectorAll(
                  '[role="alert"], .login-error-msg, [class*="error-msg" i]',
                ),
                shown,
              ) ||
              // DSM's message box sits in the panel footer, outside the panel.
              Array.prototype.some.call(
                target.root.querySelectorAll(".login-msg-box.error"),
                shown,
              ));
        if (rejected) {
          if (rejectSince === null) rejectSince = now;
          if (now - rejectSince >= REJECT_CONFIRM_MS)
            return finish("rejected", "error-visible");
          soon(rejectSince + REJECT_CONFIRM_MS, now);
        } else rejectSince = null;
        if (now - verifyAt >= VERIFY_MS)
          return finish("submitted", "sign-in-unconfirmed");
        soon(verifyAt + VERIFY_MS, now);
        publish("verifying_sign_in", "submitted");
      }
      if (
        preflight
          ? typeof readinessNonce !== "string" ||
            !/^[0-9a-f]{32}$/.test(readinessNonce)
          : !validAccount()
      ) {
        finish("stopped", "invalid-credential-response");
        return;
      }
      if (["/", "/webman/index.cgi"].indexOf(start.pathname) < 0) {
        finish("stopped", "unsupported-login-path");
        return;
      }
      userEvents.forEach(function (name) {
        document.addEventListener(name, userInput, true);
      });
      window.addEventListener("hashchange", evaluate);
      window.addEventListener("popstate", evaluate);
      window.addEventListener("resize", evaluate);
      window.addEventListener("load", evaluate);
      readinessEvents.forEach(function (name) {
        document.addEventListener(name, evaluate, true);
      });
      observer = new MutationObserver(function (records) {
        absorb(records);
        evaluate();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      evaluate();
    });
  }
  window.__sorng_synology_login = {
    run: run,
    runWhenReady: function (nonce, helpers) {
      return run({}, helpers, nonce);
    },
    cancel: cancel,
    getStatus: function () {
      return status ? { phase: status.phase, reason: status.reason } : null;
    },
    getTrace: traceCopy,
  };
  publish("waiting_document", "not-started");
})();
