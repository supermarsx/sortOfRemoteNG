/* Private auto-login common/dom.js. Assembled inside the coordinator IIFE. */
// ------------------------------------------------------------------------
// 1. NATIVE-SETTER VALUE WRITE  (the key R2 insight)
//
// React (and Vue with v-model on a tracked ref) patches the input's
// INSTANCE value setter and only commits state when it sees a real `input`
// event whose value came through the *native* prototype setter. Assigning
// `el.value = x` either goes through the patched setter (reverted on next
// render) or updates the DOM without notifying state (submits empty). The
// fix: grab the ORIGINAL prototype setter, call it, then dispatch a bubbling
// `input` event so the framework's onChange fires with the value in place.
// ------------------------------------------------------------------------
function setNativeValue(el, value) {
  try {
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    var nativeSetter = desc && desc.set;
    var ownDesc = Object.getOwnPropertyDescriptor(el, "value");
    var ownSetter = ownDesc && ownDesc.set;
    if (nativeSetter && ownSetter && nativeSetter !== ownSetter) {
      // Framework patched the instance setter — bypass it.
      nativeSetter.call(el, value);
    } else if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value; // last-ditch
    }
  } catch (_) {
    try {
      el.value = value;
    } catch (__) {}
  }
}

function checkGuard(guard) {
  if (guard && !guard()) throw new Error("form-changed-or-unsafe");
}

function fireInputEvents(el, guard) {
  // `input` drives React/Vue state; `change` drives plain-DOM + jQuery
  // validation; focus/blur help Angular touched/dirty tracking.
  checkGuard(guard);
  try {
    el.dispatchEvent(new Event("focus", { bubbles: false }));
  } catch (_) {}
  checkGuard(guard);
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (_) {}
  checkGuard(guard);
  try {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (_) {}
  checkGuard(guard);
  try {
    el.dispatchEvent(new Event("blur", { bubbles: false }));
  } catch (_) {}
  checkGuard(guard);
}

function fillField(el, value, guard, postWriteGuard) {
  if (!el) return false;
  checkGuard(guard);
  try {
    el.focus();
  } catch (_) {}
  checkGuard(guard);
  setNativeValue(el, value);
  // Reviewed staged clients can allow their same owned field to become
  // disabled during validation, but never before the actual value write.
  var afterWrite = postWriteGuard || guard;
  checkGuard(afterWrite);
  fireInputEvents(el, afterWrite);
  return el.value === value;
}

// Keystroke-style fill for the rare device UI that only reacts to real key
// events. Used only as a fallback when the event-dispatch fill leaves the
// field empty.
function typeField(el, value, guard) {
  if (!el) return false;
  checkGuard(guard);
  try {
    el.focus();
  } catch (_) {}
  checkGuard(guard);
  setNativeValue(el, "");
  for (var i = 0; i < value.length; i++) {
    checkGuard(guard);
    var ch = value.charAt(i);
    try {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true }),
      );
    } catch (_) {}
    checkGuard(guard);
    setNativeValue(el, el.value + ch);
    checkGuard(guard);
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_) {}
    checkGuard(guard);
    try {
      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    } catch (_) {}
    checkGuard(guard);
  }
  try {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (_) {}
  checkGuard(guard);
  return el.value === value;
}

// ------------------------------------------------------------------------
// 2. FIELD DETECTION (conservative, with authoritative override hooks)
// ------------------------------------------------------------------------
var USER_HINTS = [
  "username",
  "user",
  "userid",
  "user_id",
  "login",
  "loginid",
  "email",
  "account",
  "admin",
  "j_username",
];

function isVisible(el) {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  var view = el.ownerDocument && el.ownerDocument.defaultView;
  if (!view) return el.offsetParent !== null;
  var s = view.getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")
    return false;
  // offsetParent is null under display:none ancestors; allow position:fixed
  // (some device login modals are fixed-position — spike caveat).
  return el.offsetParent !== null || s.position === "fixed";
}

function matchesHint(el) {
  var id = (el.id || "").toLowerCase();
  var name = (el.name || "").toLowerCase();
  var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (ac === "username" || ac === "email") return true;
  return USER_HINTS.some(function (h) {
    return id.indexOf(h) !== -1 || name.indexOf(h) !== -1;
  });
}

// Normalise selector overrides into a consistent shape. The endpoint mirrors
// `HttpAutoLoginSelectors` (snake_case: username_selector / password_selector
// / submit_selector). The injected bootstrap may pass either the raw object
// or the same snake_case shape.
function normSel(sel) {
  if (!sel || typeof sel !== "object") return null;
  return {
    username: sel.username_selector || sel.username || null,
    password: sel.password_selector || sel.password || null,
    submit: sel.submit_selector || sel.submit || null,
  };
}

// ------------------------------------------------------------------------
// 3. SUBMIT (button click preferred, requestSubmit, form.submit, Enter)
//
// Order matters: a real submit-button click runs the page's own onclick
// validation (SPA login buttons often intercept here and never native-submit).
// requestSubmit() fires the `submit` event (validation + handlers), unlike
// form.submit() which bypasses them.
// ------------------------------------------------------------------------
// Smallest ancestor of `pw` that also contains `user` — keeps the formless
// button search from reaching across the document to a DIFFERENT form's
// submit button (spike bug fix).
function nearestScope(pw, user) {
  if (!user) return pw.parentElement || pw.ownerDocument;
  var node = pw.parentElement;
  while (node && !node.contains(user)) node = node.parentElement;
  return node || pw.ownerDocument;
}
