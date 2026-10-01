/* Private auto-login apps/cpanel.js. Assembled inside the coordinator IIFE. */
function cpanelSessionDestination(payload, view) {
  if (
    !payload ||
    (payload.status !== 1 && payload.status !== "1" && payload.status !== true)
  )
    return null;
  var token =
    typeof payload.security_token === "string" ? payload.security_token : "";
  var redirect = typeof payload.redirect === "string" ? payload.redirect : "";
  if (token && token.charAt(0) !== "/") token = "/" + token;
  token = token.replace(/\/$/, "");
  if (token && !/^\/cpsess[0-9]+$/.test(token)) return null;
  try {
    var destination = redirect
      ? new URL(redirect, view.location.href)
      : new URL(token + "/", view.location.href);
    if (
      !/^https?:$/.test(destination.protocol) ||
      destination.username ||
      destination.password
    )
      return null;
    var path = destination.pathname + destination.search + destination.hash;
    if (token && !/^\/cpsess[0-9]+(?:\/|$)/.test(destination.pathname))
      path = token + (destination.pathname.charAt(0) === "/" ? "" : "/") + path;
    if (!/^\/cpsess[0-9]+(?:\/|$)/.test(path)) return null;
    return path;
  } catch (_) {
    return null;
  }
}

function navigateCpanelSession(view, path) {
  var doc = view.document;
  var destination = new URL(path, view.location.href);
  if (typeof view.__sorng_map_navigation === "function") {
    var mapped = view.__sorng_map_navigation(destination.href);
    if (new URL(mapped).origin !== view.location.origin)
      throw new Error("unsafe-cpanel-session-destination");
    // This is a direct same-frame navigation to an explicitly mapped proxy
    // URL. It cannot be cancelled by cPanel's document click handlers and it
    // preserves the exact query plus any per-document generation proof.
    view.location.assign(mapped);
    return;
  }
  var transition = doc.createElement("form");
  // A GET form replaces rather than appends the action query. Preserve every
  // cPanel post-login field explicitly while keeping the navigation itself
  // event-free and scoped to this iframe.
  transition.action = destination.pathname + destination.hash;
  transition.method = "get";
  transition.target = "_self";
  transition.hidden = true;
  destination.searchParams.forEach(function (value, name) {
    var field = doc.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    transition.appendChild(field);
  });
  (doc.body || doc.documentElement).appendChild(transition);
  try {
    // form.submit() bypasses page submit/click listeners while the routing
    // prototype still maps the request through the local proxy. This
    // deliberately does not grant cPanel top-navigation access to the shell.
    transition.submit();
  } finally {
    transition.remove();
  }
}

function observeCpanelLoginResponse(form) {
  var view = form.ownerDocument && form.ownerDocument.defaultView;
  var NativeXHR = view && view.XMLHttpRequest;
  var proto = NativeXHR && NativeXHR.prototype;
  if (
    !proto ||
    typeof proto.open !== "function" ||
    typeof proto.send !== "function"
  )
    return function () {};
  var nativeOpen = proto.open;
  var nativeSend = proto.send;
  var loginRequests = new WeakSet();
  var navigated = false;
  var timer = null;
  var observedOpen = function (method, url) {
    try {
      var parsed = new URL(String(url), form.ownerDocument.baseURI);
      if (
        String(method).toUpperCase() === "POST" &&
        parsed.origin === view.location.origin &&
        parsed.pathname === "/login/" &&
        parsed.searchParams.get("login_only") === "1"
      )
        loginRequests.add(this);
    } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };
  var observedSend = function () {
    var request = this;
    if (loginRequests.has(request)) {
      var pageReadyState = request.onreadystatechange;
      request.onreadystatechange = function () {
        if (navigated || request.readyState !== 4) return;
        try {
          if (request.status >= 200 && request.status < 300) {
            var payload = null;
            if (
              request.responseType === "json" &&
              request.response &&
              typeof request.response === "object"
            )
              payload = request.response;
            else {
              var text =
                typeof request.responseText === "string"
                  ? request.responseText
                  : "";
              if (text && text.length <= 64 * 1024) payload = JSON.parse(text);
            }
            var path = cpanelSessionDestination(payload, view);
            if (path) {
              navigated = true;
              navigateCpanelSession(view, path);
              return;
            }
          }
        } catch (_) {}
        if (typeof pageReadyState === "function")
          return pageReadyState.apply(this, arguments);
      };
      restore();
    }
    return nativeSend.apply(this, arguments);
  };
  proto.open = observedOpen;
  proto.send = observedSend;
  function restore() {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    if (proto.open === observedOpen) proto.open = nativeOpen;
    if (proto.send === observedSend) proto.send = nativeSend;
  }
  // Newer/custom login themes can queue the XHR after their submit handler
  // returns. Keep this exact-endpoint observer alive briefly, then restore
  // the shared prototype even if no request was created.
  timer = view.setTimeout(restore, 5000);
  return restore;
}

function submitCpanelForm(target) {
  var form = target.form;
  if (!form) return null;
  // cPanel's stock login template targets `_top` when goto_uri is `/` and
  // installs an AJAX handler which posts to `/login/?login_only=1`. Keep that
  // handler: cPanel's JSON response owns security-token/session navigation,
  // while a native document POST does not follow the same contract. The
  // stock script caches these controls in window globals, though, so a form
  // replaced during late login-page hydration otherwise submits values from
  // disconnected, empty inputs (`no_username`). Rebind only the known cPanel
  // globals to the already validated current target before activating the
  // real button. cPanel's click path also owns its loading state and other
  // stock pre-submit behavior, so calling form.onsubmit directly is not an
  // equivalent login attempt. The routing module's document-capture hook
  // rewrites form.action before cPanel's handler runs, though, while cPanel
  // naively appends `?login_only=1` to that value. Restore the validated raw
  // action at the form capture boundary (after the document hook and before
  // cPanel's handler) and prevent only the native document POST.
  if (form.getAttribute("target") === "_top")
    form.setAttribute("target", "_self");
  var view = form.ownerDocument && form.ownerDocument.defaultView;
  if (view) {
    var bindings = {
      login_form: form,
      login_username_el: target.user,
      login_password_el: target.pw,
      login_submit_el: target.submit,
      // A real pointer press re-arms cPanel's duplicate-submit guard through
      // document.body.onmousedown. Programmatic click does not synthesize
      // that event, while this client has its own structural one-shot guard.
      LOGIN_SUBMIT_OK: true,
    };
    Object.keys(bindings).forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(view, name)) return;
      try {
        view[name] = bindings[name];
      } catch (_) {}
    });
    try {
      if (view.login_button && target.submit)
        view.login_button.button = target.submit;
    } catch (_) {}
  }
  if (typeof form.onsubmit !== "function")
    throw new Error("cpanel-submit-handler-not-ready");
  if (!target.submit || typeof target.submit.click !== "function")
    throw new Error("cpanel-submit-button-not-ready");
  var originalActionAttribute = form.getAttribute("action");
  if (originalActionAttribute === null)
    throw new Error("cpanel-form-action-not-ready");
  var originalActionUrl = new URL(
    originalActionAttribute,
    form.ownerDocument.baseURI,
  );
  if (originalActionUrl.origin !== window.location.origin)
    throw new Error("unsafe-form-action");
  // A late form.action assignment has already passed through the routing
  // setter and can carry this local proof. cPanel concatenates its AJAX flag
  // with `?`, so leaving the proof in place turns login_only into part of the
  // proof value and the router then removes that entire malformed pair.
  // Return the action to its application-owned path/query before the stock
  // handler appends it.
  var originalQuery = originalActionUrl.search
    .slice(1)
    .split("&")
    .filter(function (pair) {
      return pair && pair.split("=")[0] !== "__sorng_generation_v1";
    })
    .join("&");
  var originalAction =
    originalActionUrl.pathname + (originalQuery ? "?" + originalQuery : "");
  var submitObserved = false;
  function preserveCpanelAjaxAction(event) {
    if (event.target !== form) return;
    submitObserved = true;
    var action = form.getAttributeNode("action");
    if (!action) throw new Error("cpanel-form-action-not-ready");
    // Attr.value bypasses the routing module's patched setAttribute/action
    // setters. The action was fingerprinted as same-origin before filling.
    action.value = originalAction;
  }
  function preventNativeCpanelSubmit(event) {
    if (event.target === form) event.preventDefault();
  }
  form.addEventListener("submit", preserveCpanelAjaxAction, true);
  // Register after cPanel's installed onsubmit handler. The stock handler
  // must receive the same uncancelled event as a manual click, while this
  // final guard still prevents a native document POST if it falls through.
  form.addEventListener("submit", preventNativeCpanelSubmit);
  var restoreCpanelResponseObserver = observeCpanelLoginResponse(form);
  var clickCompleted = false;
  try {
    target.submit.click();
    clickCompleted = true;
  } finally {
    if (!clickCompleted) restoreCpanelResponseObserver();
    form.removeEventListener("submit", preserveCpanelAjaxAction, true);
    form.removeEventListener("submit", preventNativeCpanelSubmit);
  }
  if (!submitObserved) {
    restoreCpanelResponseObserver();
    throw new Error("cpanel-submit-event-not-observed");
  }
  return "cpanel-ajax-button-click";
}

// Stock cPanel hydrates cached controls after exposing its form/handler.
// Preserve the page/input settle phases and the bounded detection allowance.
var CPANEL_POLICY = {
  pageSettleMs: 3000,
  submitSettleMs: 1000,
  detectionFloorMs: 12000,
};

// Per-run application state only. Credentials remain owned by the scheduler;
// value equality is queried through a callback and never copied here.
function createCpanelLifecycle(context) {
  var fingerprint = null;
  var cpanelCleanup = null;
  function dispose() {
    if (cpanelCleanup) cpanelCleanup();
  }
  function submitControlReady(target) {
    var submit = target.submit;
    return (
      !!submit &&
      !submit.disabled &&
      submit.getAttribute("aria-disabled") !== "true" &&
      !(typeof submit.matches === "function" && submit.matches(":disabled")) &&
      !!target.form &&
      typeof target.form.onsubmit === "function"
    );
  }
  function waitForCpanelStability(captured, ready, minimumDelay, filled) {
    if (cpanelCleanup) cpanelCleanup();
    var doc = captured.document;
    var view = doc.defaultView;
    var form = captured.target.form;
    var timer = null;
    var frame = null;
    var disposed = false;
    var observer = null;
    var snapshot = null;
    var eligibleAt = Date.now() + minimumDelay;
    // This is an activity debounce, not a fixed page-load sleep. Every
    // relevant mutation/event and every changed control value starts a new
    // quiet interval. The overall detection deadline is never extended.
    var quietMs = 250;
    function cleanup() {
      disposed = true;
      clearTimeout(timer);
      if (frame !== null && view.cancelAnimationFrame)
        view.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      doc.removeEventListener("readystatechange", changed);
      doc.removeEventListener("load", changed, true);
      view.removeEventListener("load", changed);
      doc.removeEventListener("input", fieldChanged, true);
      doc.removeEventListener("change", fieldChanged, true);
      if (cpanelCleanup === cleanup) cpanelCleanup = null;
      snapshot = null;
    }
    cpanelCleanup = cleanup;
    function fieldChanged(event) {
      if (form && event.target.form === form) changed();
    }
    function changed() {
      if (disposed || context.isFinished()) return;
      clearTimeout(timer);
      if (frame !== null && view.cancelAnimationFrame)
        view.cancelAnimationFrame(frame);
      frame = null;
      snapshot = null;
      timer = setTimeout(check, 0);
    }
    function state() {
      var target = captured.target;
      if (
        doc.readyState !== "complete" ||
        !submitControlReady(target) ||
        [target.user, target.pw, target.submit].some(function (control) {
          return (
            !control ||
            control.matches(":disabled") ||
            !!control.closest(
              '[aria-busy="true"], [aria-disabled="true"], [inert]',
            )
          );
        })
      )
        return null;
      // Value property writes (including hidden CSRF/session fields) do
      // not necessarily emit mutations or input events. Sample them too.
      return JSON.stringify(
        Array.from(form.elements).map(function (control) {
          return [
            control.name,
            control.type,
            control.value,
            control.checked,
            control.disabled,
          ];
        }),
      );
    }
    function check(afterPaint) {
      if (disposed || context.isFinished()) return;
      try {
        if (!context.guarded(captured)) {
          cleanup();
          context.fail();
          return;
        }
        var current = state();
        if (current === null || current !== snapshot) {
          snapshot = current;
          timer = setTimeout(check, quietMs);
          return;
        }
        if (Date.now() < eligibleAt) {
          timer = setTimeout(check, eligibleAt - Date.now());
          return;
        }
        if (!afterPaint) {
          // Yield a paint AND a task so input/load handlers' queued work
          // runs before the final validation. rAF alone runs before paint.
          if (view.requestAnimationFrame)
            frame = view.requestAnimationFrame(function () {
              frame = null;
              timer = setTimeout(function () {
                check(true);
              }, 0);
            });
          else
            timer = setTimeout(function () {
              check(true);
            }, 0);
          return;
        }
        if (filled && !context.valuesMatch(captured)) {
          cleanup();
          context.fail();
          return;
        }
        cleanup();
        ready();
      } catch (_) {
        cleanup();
        context.fail();
      }
    }
    observer = new MutationObserver(function (records) {
      if (
        records.some(function (record) {
          // Watch the form, its replacement, and ancestor readiness. Ignore
          // unrelated clocks/animations elsewhere on a hosting login page.
          return (
            record.target === form ||
            form.contains(record.target) ||
            (record.target.nodeType === 1 && record.target.contains(form))
          );
        })
      )
        changed();
    });
    observer.observe(doc, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    doc.addEventListener("readystatechange", changed);
    doc.addEventListener("load", changed, true);
    view.addEventListener("load", changed);
    doc.addEventListener("input", fieldChanged, true);
    doc.addEventListener("change", fieldChanged, true);
    check();
  }

  return {
    wait: waitForCpanelStability,
    dispose: dispose,
    accept: function (captured) {
      if (fingerprint === null) fingerprint = captured.fingerprint;
      return captured.fingerprint === fingerprint;
    },
    canReacquire: function (captured) {
      return targetFingerprint(captured.target) === fingerprint;
    },
  };
}
