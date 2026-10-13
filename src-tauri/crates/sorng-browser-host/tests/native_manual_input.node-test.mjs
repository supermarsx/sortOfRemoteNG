import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(
  new URL("../src/native_manual_input_client.js", import.meta.url),
  "utf8",
);
function fixture(url = "https://example.test/login") {
  const listeners = new Map();
  let time = 10;
  const doc = {
    activeElement: null,
    body: {},
    focused: true,
    hasFocus() {
      return this.focused;
    },
    addEventListener(name, fn) {
      const a = listeners.get(name) || [];
      a.push(fn);
      listeners.set(name, a);
    },
  };
  class Element {
    focus() {
      doc.activeElement = this;
      doc.focused = true;
      fire("focusin", { target: this });
    }
  }
  class Input extends Element {
    constructor() {
      super();
      this._value = "";
      this.type = "text";
      this.isConnected = true;
      this.ownerDocument = doc;
      this.disabled = false;
      this.readOnly = false;
    }
    get value() {
      return this._value;
    }
    getClientRects() {
      return [1];
    }
  }
  class Area extends Input {
    get value() {
      return this._value;
    }
  }
  const win = { addEventListener: doc.addEventListener };
  win.top = win;
  const parsed = new URL(url);
  const location = {
    href: parsed.href,
    protocol: parsed.protocol,
    origin: parsed.origin,
  };
  const context = vm.createContext({
    document: doc,
    window: win,
    location,
    performance: { now: () => time },
    HTMLInputElement: Input,
    HTMLTextAreaElement: Area,
    HTMLElement: Element,
  });
  const run = vm.runInContext(source, context);
  function fire(name, event = {}) {
    for (const fn of listeners.get(name) || []) fn(event);
  }
  const input = new Input();
  input.focus();
  return {
    run,
    doc,
    input,
    Input,
    Area,
    win,
    location,
    fire,
    advance(ms) {
      time += ms;
    },
  };
}

// Real DOM focus retargeting matters here: focusin between fields under the
// same shadow host does not reach document. Only the native window blur and
// clock are simulated; no browser/profile/network or real credentials are used.
test("detailed native receipts classify iframe and nonempty captures and wait only for the masked field", () => {
  const f = fixture();
  f.win.top = {};
  assert.equal(f.run("capture", "a", 0, true).reason, "unsupported-frame");
  f.win.top = f.win;
  f.input._value = "existing";
  assert.equal(f.run("capture", "a", 0, true).reason, "field-not-empty");
  f.input._value = "";
  assert.equal(f.run("capture", "a", 0, true).success, true);
  assert.equal(f.run("restore", "a", 0, true).success, true);
  const pending = f.run("check", "a", 1, true);
  assert.equal(pending.success, false);
  assert.equal(pending.reason, "pending");
  f.input._value = "•";
  assert.equal(f.run("check", "a", 1, true).success, true);
  f.doc.activeElement = f.doc.body;
  assert.equal(f.run("check", "a", 1, true).reason, "focus-lost");
});
function domFixture(t, url = "https://example.test/login") {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const { window: win } = dom;
  const doc = win.document;
  const blurListeners = [];
  const addListener = win.addEventListener.bind(win);
  win.addEventListener = (name, listener, options) => {
    if (name === "blur") blurListeners.push(listener);
    addListener(name, listener, options);
  };
  let time = 10;
  let windowFocused = true;
  const hasFocus = doc.hasFocus.bind(doc);
  doc.hasFocus = () => windowFocused && hasFocus();
  win.performance.now = () => time;
  // jsdom cannot mark an event trusted; record the client's document
  // listeners so a test can hand them the user's trusted key and input events.
  const docListeners = new Map();
  const addDocListener = doc.addEventListener.bind(doc);
  doc.addEventListener = (name, listener, options) => {
    if (!docListeners.has(name)) docListeners.set(name, []);
    docListeners.get(name).push(listener);
    addDocListener(name, listener, options);
  };
  const run = win.eval(source);
  function trusted(name, props) {
    const event = {
      isTrusted: true,
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...props,
    };
    for (const listener of docListeners.get(name) || []) listener(event);
    return event;
  }
  function input(parent = doc.body, tag = "input") {
    const el = doc.createElement(tag);
    // jsdom has no layout engine. Only this fixture field is made visible.
    el.getClientRects = () => [1];
    parent.append(el);
    return el;
  }
  function shadow(parent = doc.body, mode = "open") {
    const host = doc.createElement("div");
    parent.append(host);
    return host.attachShadow({ mode });
  }
  return {
    win,
    doc,
    run,
    input,
    shadow,
    trusted,
    blur(trusted = true) {
      windowFocused = false;
      for (const listener of blurListeners)
        listener({ target: win, isTrusted: trusted });
    },
    focusWindow() {
      windowFocused = true;
    },
    advance(ms) {
      time += ms;
    },
  };
}

test("capture binds the current SPA route, then rejects route changes until recaptured", (t) => {
  const f = domFixture(t);
  const input = f.input();
  input.focus();
  f.win.history.pushState({}, "", "/login/password?step=2#field");
  f.blur();
  assert.equal(f.run("capture", "a", 0), true);
  f.focusWindow();
  f.win.history.replaceState({}, "", "/login/changed");
  assert.equal(f.run("restore", "a", 0), false);
  assert.equal(f.run("capture", "b", 0), true);
  assert.equal(f.run("restore", "a", 0), false);
  assert.equal(f.run("restore", "b", 0), true);
  f.win.history.pushState({}, "", "/login/after-restore");
  assert.equal(f.run("check", "b", 0), false);
});

test("SPA routing cannot reuse a blur receipt from the preceding URL", (t) => {
  const f = domFixture(t);
  f.input().focus();
  f.blur();
  f.win.history.pushState({}, "", "/login/password");
  assert.equal(f.run("capture", "a", 0), false);
  f.focusWindow();
  assert.equal(f.run("capture", "b", 0), true);
});

for (const tag of ["input", "textarea"]) {
  test(`nested open-shadow ${tag} supports exact-field capture, restore and check`, (t) => {
    const f = domFixture(t);
    const outer = f.shadow();
    const inner = f.shadow(outer);
    const input = f.input(inner, tag);
    if (tag === "input") input.type = "password";
    input.focus();
    assert.equal(f.doc.activeElement, outer.host);
    assert.equal(outer.activeElement, inner.host);
    assert.equal(inner.activeElement, input);
    assert.equal(f.run("capture", "a", 0), true);
    input.blur();
    assert.equal(f.doc.activeElement, f.doc.body);
    assert.equal(f.run("restore", "a", 0), true);
    assert.equal(inner.activeElement, input);
    input.value = "x";
    assert.equal(f.run("check", "a", 1), true);
    assert.equal(f.run("restore", "a", 0), false);
  });
}

for (const timing of ["before-restore", "after-restore"]) {
  test(`a focus excursion within one shadow host invalidates capture ${timing}`, (t) => {
    const f = domFixture(t);
    const root = f.shadow(f.shadow());
    const captured = f.input(root);
    const other = f.input(root);
    captured.focus();
    assert.equal(f.run("capture", "a", 0), true);
    if (timing === "after-restore")
      assert.equal(f.run("restore", "a", 0), true);
    let documentFocusEvents = 0;
    f.doc.addEventListener("focusin", () => documentFocusEvents++);
    other.focus();
    captured.focus();
    assert.equal(documentFocusEvents, 0);
    assert.equal(
      f.run(timing === "before-restore" ? "restore" : "check", "a", 0),
      false,
    );
  });
}

test("shadow popup handoff remains trusted, exact-field and bounded to 1500ms", (t) => {
  for (const kind of [
    "valid",
    "boundary",
    "expired",
    "untrusted",
    "changed",
    "nonempty",
  ]) {
    const f = domFixture(t);
    const root = f.shadow();
    const input = f.input(root);
    input.focus();
    f.blur(kind !== "untrusted");
    f.advance(kind === "expired" ? 1501 : kind === "boundary" ? 1500 : 500);
    if (kind === "changed") f.input(root).focus();
    if (kind === "nonempty") input.value = "fixture";
    const valid = kind === "valid" || kind === "boundary";
    assert.equal(f.run("capture", "a", 0), valid, kind);
    if (valid) {
      f.focusWindow();
      assert.equal(f.run("restore", "a", 0), true);
    }
  }
});

test("shadow capture rejects changed field eligibility and user edits before restore", (t) => {
  for (const kind of [
    "removed",
    "disabled",
    "readonly",
    "hidden",
    "nonempty",
    "pointerdown",
    "paste",
    "compositionstart",
  ]) {
    const f = domFixture(t);
    const input = f.input(f.shadow());
    input.focus();
    assert.equal(f.run("capture", "a", 0), true, kind);
    if (kind === "removed") input.remove();
    else if (kind === "disabled") input.disabled = true;
    else if (kind === "readonly") input.readOnly = true;
    else if (kind === "hidden") input.getClientRects = () => [];
    else if (kind === "nonempty") input.value = "fixture";
    else
      input.dispatchEvent(
        new f.win.Event(kind, { bubbles: true, composed: true }),
      );
    assert.equal(f.run("restore", "a", 0), false, kind);
  }
});

test("a reentrant focus excursion during shadow restoration rejects the first receipt", (t) => {
  const f = domFixture(t);
  const root = f.shadow();
  const captured = f.input(root);
  const other = f.input(root);
  captured.focus();
  assert.equal(f.run("capture", "a", 0), true);
  captured.blur();
  let redirected = false;
  root.addEventListener("focusin", () => {
    if (redirected) return;
    redirected = true;
    other.focus();
    captured.focus();
  });
  assert.equal(f.run("restore", "a", 0), false);
  assert.equal(redirected, true);
  assert.equal(root.activeElement, captured);
  assert.equal(f.run("check", "a", 0), false);
});

test("restore rechecks the captured URL and eligibility after page focus callbacks", (t) => {
  for (const kind of ["navigation", "readonly", "hidden"]) {
    const f = domFixture(t);
    const input = f.input(f.shadow());
    input.focus();
    assert.equal(f.run("capture", "a", 0), true);
    input.blur();
    input.addEventListener("focus", () => {
      if (kind === "navigation") f.win.history.pushState({}, "", "/other");
      if (kind === "readonly") input.readOnly = true;
      if (kind === "hidden") input.getClientRects = () => [];
    });
    assert.equal(f.run("restore", "a", 0), false, kind);
  }
});

test("closed shadow roots and iframe fields remain unsupported", (t) => {
  for (const kind of ["closed", "iframe", "shadow-iframe"]) {
    const f = domFixture(t);
    let input;
    if (kind === "closed") input = f.input(f.shadow(f.doc.body, "closed"));
    else {
      const iframe = f.doc.createElement("iframe");
      // A shadow iframe host is also ineligible; its content is never traversed.
      (kind === "iframe" ? f.doc.body : f.shadow()).append(iframe);
      if (iframe.contentDocument) {
        input = iframe.contentDocument.createElement("input");
        iframe.contentDocument.body.append(input);
      } else input = iframe;
    }
    input.focus();
    assert.equal(f.run("capture", "a", 0), false, kind);
  }
});

test("fresh captures reject another origin, HTTPS downgrade and an unobserved focus loss", () => {
  for (const kind of ["origin", "http", "unobserved-blur"]) {
    const f = fixture();
    if (kind === "origin") {
      f.location.href = "https://other.test/login";
      f.location.origin = "https://other.test";
    }
    if (kind === "http") {
      f.location.protocol = "http:";
      f.location.origin = "http://example.test";
      f.location.href = "http://example.test/login";
    }
    if (kind === "unobserved-blur") f.doc.focused = false;
    assert.equal(f.run("capture", "a", 0), false, kind);
  }
});
test("capture/restore/check is one-shot, exact field, value-free and never submits", () => {
  const f = fixture();
  assert.equal(f.run("capture", "a", 0), true);
  f.doc.focused = false;
  assert.equal(f.run("restore", "a", 0), true);
  f.input._value = "x";
  assert.equal(f.run("check", "a", 1), true);
  assert.equal(f.run("restore", "a", 0), false);
  assert.equal(f.run("check", "other", 1), false);
  assert.equal(f.run("cancel", "a", 0), true);
  assert.equal(f.run("check", "a", 1), false);
  assert.doesNotMatch(
    source,
    /\.submit\(|requestSubmit|clipboard|execCommand|\.value\s*=/,
  );
});
test("trusted sibling WebView blur before pointerdown permits only short exact-field handoff", () => {
  const f = fixture();
  f.doc.focused = false;
  f.fire("blur", { target: f.win, isTrusted: true });
  f.advance(500);
  assert.equal(f.run("capture", "a", 0), true);
  for (const kind of ["expired", "untrusted", "changed", "foreign-target"]) {
    const x = fixture();
    x.doc.focused = false;
    x.fire("blur", {
      target: kind === "foreign-target" ? {} : x.win,
      isTrusted: kind !== "untrusted",
    });
    if (kind === "expired") x.advance(1501);
    if (kind === "changed") x.doc.activeElement = new x.Input();
    assert.equal(x.run("capture", "a", 0), false, kind);
  }
});
for (const condition of [
  "navigation",
  "same-url-new-context",
  "new-field",
  "pointer",
  "removed",
  "readonly",
  "nonempty",
  "hidden",
  "iframe",
  "http",
  "length-mismatch",
]) {
  test(`manual input fails closed on ${condition}`, () => {
    const f = fixture();
    assert.equal(f.run("capture", "a", 0), true);
    if (condition === "navigation") f.location.href += "?changed";
    if (condition === "same-url-new-context") {
      assert.equal(fixture().run("restore", "a", 0), false);
      return;
    }
    if (condition === "new-field") new f.Input().focus();
    if (condition === "pointer") f.fire("pointerdown");
    if (condition === "removed") f.input.isConnected = false;
    if (condition === "readonly") f.input.readOnly = true;
    if (condition === "nonempty") f.input._value = "existing";
    if (condition === "hidden") f.input.getClientRects = () => [];
    if (condition === "iframe") f.doc.activeElement = { tagName: "IFRAME" };
    if (condition === "http") {
      f.location.protocol = "http:";
      f.location.origin = "http://example.test";
      f.location.href = "http://example.test/login";
    }
    if (condition === "length-mismatch") {
      assert.equal(f.run("restore", "a", 0), true);
      assert.equal(f.run("check", "a", 1), false);
      return;
    }
    assert.equal(f.run("restore", "a", 0), false);
  });
}
test("textarea and password fields are supported; capture never clears existing values", () => {
  for (const type of ["password", "textarea"]) {
    const f = fixture();
    const el = type === "textarea" ? new f.Area() : f.input;
    el.type = "password";
    el.focus();
    el._value = "existing";
    assert.equal(f.run("capture", "a", 0), false);
    assert.equal(el.value, "existing");
    el._value = "";
    assert.equal(f.run("capture", "a", 0), true);
  }
});

test("HTTP custom-port manual typing captures, restores and validates the exact shadow field", (t) => {
  const f = domFixture(t, "http://example.test:8080/login");
  const input = f.input(f.shadow());
  input.type = "password";
  input.focus();
  f.blur();
  assert.equal(f.run("capture", "a", 0), true);
  f.focusWindow();
  assert.equal(f.run("restore", "a", 0), true);
  input.value = "x";
  assert.equal(f.run("check", "a", 1), true);
  assert.equal(f.run("check", "wrong-token", 1), false);
  assert.equal(f.run("restore", "a", 0), false);
});

for (const change of [
  "host",
  "scheme",
  "port",
  "frame",
  "owner",
  "manual-edit",
  "expired-blur",
]) {
  test(`HTTP manual typing preserves the ${change} guard`, () => {
    const f = fixture("http://example.test:8080/login");
    if (change === "expired-blur") {
      f.doc.focused = false;
      f.fire("blur", { target: f.win, isTrusted: true });
      f.advance(1501);
      assert.equal(f.run("capture", "a", 0), false);
      return;
    }
    assert.equal(f.run("capture", "a", 0), true);
    if (["host", "scheme", "port"].includes(change)) {
      const url = new URL(
        change === "host"
          ? "http://other.test:8080/login"
          : change === "scheme"
            ? "https://example.test:8080/login"
            : "http://example.test:8081/login",
      );
      Object.assign(f.location, {
        href: url.href,
        origin: url.origin,
        protocol: url.protocol,
      });
    }
    if (change === "frame") f.win.top = {};
    if (change === "owner") f.input.ownerDocument = {};
    if (change === "manual-edit") f.input._value = "manual-user";
    assert.equal(f.run("restore", "a", 0), false);
    assert.equal(f.run("check", "a", 0), false);
    assert.equal(f.input.value, change === "manual-edit" ? "manual-user" : "");
  });
}

test("manual typing never captures unsupported schemes or a child frame", () => {
  for (const url of [
    "file:///login",
    "ftp://example.test/login",
    "about:blank",
  ]) {
    assert.equal(fixture(url).run("capture", "a", 0), false);
  }
  const f = fixture("http://example.test:8080/login");
  f.win.top = {};
  assert.equal(f.run("capture", "a", 0), false);
});

test("native restore follows one-shot validation and still awaits renderer receipt before keys", () => {
  const host = readFileSync(
    new URL("../src/cef_manual_input.rs", import.meta.url),
    "utf8",
  );
  const branch = host.slice(
    host.indexOf("ManualInputAction::Type {"),
    host.indexOf("pub(super) fn receive("),
  );
  const captureCheck = branch.indexOf("slot.capture != *capture_id");
  const consumed = branch.indexOf("slot.phase = Phase::Restore;");
  const nativeFocus = branch.indexOf(
    "host.focus(identity).is_err() || !current(&slot, true)",
  );
  const rendererRestore = branch.indexOf('dispatch(&mut slot, "restore")');
  assert.ok(
    captureCheck >= 0 &&
      consumed > captureCheck &&
      nativeFocus > consumed &&
      rendererRestore > nativeFocus,
  );
  assert.doesNotMatch(branch, /send_cef_character|\.tick\(/);
  const receipt = host.slice(host.indexOf("pub(super) fn receive("));
  assert.ok(
    receipt.indexOf("args.bool(2) != 1") <
      receipt.indexOf("send_cef_character("),
  );
  assert.ok(
    receipt.indexOf("!current(&slot, slot.input.is_some())") <
      receipt.indexOf("send_cef_character("),
  );
});

// Escape from the user while manual typing runs: typing stops at the next
// receipt and what it typed is erased the way a user's delete is seen.
function typingFixture(t, tag = "input") {
  const f = domFixture(t);
  const field = f.input(f.doc.body, tag);
  if (tag === "input") field.type = "password";
  field.focus();
  assert.equal(f.run("capture", "a", 0), true);
  assert.equal(f.run("restore", "a", 0), true);
  const observed = [];
  for (const type of ["input", "change"])
    field.addEventListener(type, (event) =>
      observed.push([type, field.value, event.isTrusted]),
    );
  // Model of one host key: it lands unless the page prevents its beforeinput.
  const key = (data) => {
    const event = f.trusted("beforeinput", {
      target: field,
      inputType: "insertText",
      data,
    });
    if (event.prevented) return false;
    field.value += data;
    return true;
  };
  const escape = (props = {}) =>
    f.trusted("keydown", { target: field, key: "Escape", ...props });
  return { ...f, field, observed, key, escape };
}

for (const tag of ["input", "textarea"]) {
  test(`Escape during manual typing into a ${tag} erases the typed text with input and change events`, (t) => {
    const f = typingFixture(t, tag);
    assert.equal(f.key("p"), true);
    assert.equal(f.run("check", "a", 1), true);
    assert.equal(f.key("w"), true);
    assert.equal(f.run("check", "a", 2), true);
    // The host may already have sent the next key when Escape lands.
    const event = f.escape();
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(f.field.value, "");
    assert.deepEqual(f.observed, [
      ["input", "", false],
      ["change", "", false],
    ]);
    // That key is held back once; typing has stopped at its next receipt.
    assert.equal(f.key("d"), false);
    assert.equal(f.field.value, "");
    assert.equal(f.run("check", "a", 3), false);
    // The user's own typing is theirs again.
    assert.equal(f.key("x"), true);
    assert.equal(f.field.value, "x");
  });
}

test("Escape between a receipt and the host's next key holds nothing back after the hold", (t) => {
  const f = typingFixture(t);
  assert.equal(f.key("p"), true);
  assert.equal(f.run("check", "a", 1), true);
  f.escape();
  f.advance(1501);
  assert.equal(f.key("x"), true);
  assert.equal(f.field.value, "x");
});

test("Escape never erases text beyond what manual typing has entered", (t) => {
  const f = typingFixture(t);
  assert.equal(f.key("p"), true);
  assert.equal(f.run("check", "a", 1), true);
  // Not ours: more than the receipts allow.
  f.field.value = "p-and-more";
  const event = f.escape();
  assert.equal(event.prevented, true);
  assert.equal(f.field.value, "p-and-more");
  assert.deepEqual(f.observed, []);
  assert.equal(f.run("check", "a", 1), false);
});

test("Escape outside active manual typing keeps its normal page behaviour", (t) => {
  // Captured but not typing yet.
  const a = domFixture(t);
  const one = a.input();
  one.focus();
  assert.equal(a.run("capture", "a", 0), true);
  const before = a.trusted("keydown", { target: one, key: "Escape" });
  assert.equal(before.prevented, undefined);
  assert.equal(a.run("restore", "a", 0), true);
  // Typing finished: the host retired the slot.
  const b = typingFixture(t);
  assert.equal(b.key("p"), true);
  assert.equal(b.run("check", "a", 1), true);
  assert.equal(b.run("cancel", "a", 0), true);
  const after = b.escape();
  assert.equal(after.prevented, undefined);
  assert.equal(after.stopped, undefined);
  assert.equal(b.field.value, "p");
  // Untrusted or modified Escape during typing is not the user's take-back.
  for (const props of [{ isTrusted: false }, { ctrlKey: true }]) {
    const c = typingFixture(t);
    assert.equal(c.key("p"), true);
    assert.equal(c.run("check", "a", 1), true);
    assert.equal(c.escape(props).prevented, undefined);
    assert.equal(c.field.value, "p");
    assert.equal(c.key("w"), true);
    assert.equal(c.run("check", "a", 2), true);
  }
  // Escape in another control is the page's.
  const d = typingFixture(t);
  const other = d.input();
  assert.equal(d.escape({ target: other }).prevented, undefined);
});
test("typing never resumes after Escape, even when a late key matches the next receipt", (t) => {
  const f = typingFixture(t);
  const event = f.escape();
  assert.equal(event.prevented, true);
  f.advance(1501);
  assert.equal(f.key("p"), true);
  assert.equal(f.run("check", "a", 1), false);
});
