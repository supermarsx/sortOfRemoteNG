import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(
  resolve(base, "native_login_profiles.rs"),
  "utf8",
);
const modules = [
  ...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g),
]
  .map(([, path]) => readFileSync(resolve(base, path), "utf8"))
  .join("");
const source = readFileSync(resolve(base, "native_login_client.js"), "utf8")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
    readFileSync(resolve(base, "native_login_typing.js"), "utf8"),
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(
  t,
  manual = false,
  google = false,
  visibilityToggle = false,
  waitForInput = false,
  background = null,
  url = "https://device.test/login",
) {
  const dom = new JSDOM(
    google
      ? '<form method="POST"><input id="identifierId" name="identifier" type="text" autocomplete="username"><input name="hiddenPassword" type="password" aria-hidden="true" tabindex="-1"><button name="action" id="identifierNext">Next</button></form>'
      : '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>',
    {
      url: google ? "https://accounts.google.com/v3/signin/identifier" : url,
      runScripts: "outside-only",
    },
  );
  const win = dom.window,
    doc = win.document;
  const errors = [];
  win.addEventListener("error", (event) => {
    errors.push(event.error);
    event.preventDefault();
  });
  if (background) {
    Object.defineProperty(doc, "visibilityState", { get: () => "hidden" });
    Object.defineProperty(doc, "hidden", { get: () => true });
    doc.hasFocus = () => false;
    win.focus = () => assert.fail("automatic login must not activate a window");
  }
  t.after(() => {
    win.dispatchEvent(new win.Event("pagehide"));
    win.close();
  });
  Object.defineProperty(win.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  win.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 100, height: 20 }] : [];
  };
  if (win.location.protocol === "https:")
    Object.defineProperty(win.crypto, "subtle", { value: webcrypto.subtle });
  win.TextEncoder = TextEncoder;
  const listeners = new Map(),
    original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (["keydown", "beforeinput", "input", "keyup"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return original(type, callback, ...args);
  };
  const values = background || {
    username: google ? "operator@example.test" : "operator",
    password: "pA55@word",
  };
  const signals = [],
    keys = [];
  let delivered,
    submits = 0;
  const until = Date.now() + 15000;
  let expired = false;
  win.Date.now = () => (expired ? until + 1 : Date.now());
  const options = {
    version: 1,
    fillDelayMs: 30,
    submitDelayMs: 50,
    detectionTimeoutMs: 8000,
    submit: true,
    fields: [],
  };
  let identifierValue;
  doc.addEventListener("submit", (event) => {
    event.preventDefault();
    submits++;
  });
  if (google && waitForInput) {
    doc.querySelector("button").disabled = true;
    doc.addEventListener(
      "input",
      (event) => {
        const expected =
          event.target.name === "identifier"
            ? values.username
            : values.password;
        doc.querySelector("button").disabled = event.target.value !== expected;
      },
      true,
    );
  }
  if (google)
    doc.querySelector("button").onclick = (event) => {
      event.preventDefault();
      identifierValue = doc.getElementById("identifierId").value;
      assert.equal(doc.querySelector('[name="hiddenPassword"]').value, "");
      win.history.replaceState(null, "", "/v3/signin/challenge/pwd");
      doc.body.innerHTML =
        '<form method="POST"><input id="password" name="Passwd" type="password">' +
        (visibilityToggle
          ? '<input type="checkbox" id="show-password" aria-labelledby="show-password-label"><label id="show-password-label" for="show-password">Show password</label>'
          : "") +
        '<button id="passwordNext">Next</button></form>';
      if (waitForInput) doc.querySelector("button").disabled = true;
    };
  function key(field, index) {
    const input = doc.getElementById(
        google && field === "username" ? "identifierId" : field,
      ),
      unit = values[field][index];
    const event = {
      target: input,
      isTrusted: true,
      key: unit,
      data: unit,
      inputType: "insertText",
      preventDefault() {
        this.prevented = true;
      },
    };
    for (const type of ["keydown", "beforeinput"])
      for (const fn of listeners.get(type) || []) fn(event);
    if (event.prevented) return;
    // Only the model driver writes; the production path calls send_key_event.
    input.value += unit;
    input.setSelectionRange(input.value.length, input.value.length);
    for (const fn of listeners.get("input") || []) fn(event);
    for (const fn of listeners.get("keyup") || []) fn(event);
    keys.push([field, index]);
  }
  const notify = (event) => {
    signals.push(event);
    setTimeout(() => {
      if (event.startsWith("type|")) {
        if (manual) return;
        const [, action, stage, field, n] = event.split("|"),
          index = Number(n),
          role = `type|${stage}|${field}`;
        if (action === "start")
          delivered.nativeTyping("probe", 0, until, false, role);
        if (action === "key") {
          key(field, index);
          delivered.nativeTyping("probe", index + 1, until, false, role);
        }
      } else if (google && ["identifier", "password"].includes(event)) {
        delivered(
          "https://accounts.google.com",
          event === "identifier" ? values.username : "",
          event === "password" ? values.password : "",
          true,
          until,
          event,
        );
      } else if (["form-prepare", "form", "form-submit"].includes(event)) {
        delivered(
          new URL(url).origin,
          event === "form" ? values.username : "",
          event === "form" ? values.password : "",
          true,
          until,
          { ...options, fields: [] },
          event,
        );
      }
    }, 0);
  };
  delivered = win.eval(source)(
    notify,
    google
      ? { provider: "google-account" }
      : {
          selectors: {
            username: "#username",
            password: "#password",
            submit: "#login",
          },
        },
    google ? "google-account" : "modular-form",
    true,
  );
  return {
    doc,
    win,
    signals,
    keys,
    values,
    until,
    delivered,
    errors,
    expire: () => {
      expired = true;
    },
    submits: () => submits,
    identifierValue: () => identifierValue,
  };
}

for (const visibilityToggle of [false, true]) {
  test(`Google implicit Next buttons work with production native-keyboard mode across SPA stages (visibility toggle: ${visibilityToggle})`, async (t) => {
    const f = fixture(t, false, true, visibilityToggle);
    for (let i = 0; i < 160 && f.submits() === 0; i++) await delay(50);
    assert.equal(f.submits(), 1, JSON.stringify(f.signals));
    assert.equal(f.identifierValue(), f.values.username);
    assert.equal(f.doc.getElementById("password").value, f.values.password);
    assert.equal(
      f.keys.length,
      f.values.username.length + f.values.password.length,
    );
    assert.equal(f.signals.filter((s) => s === "identifier").length, 1);
    assert.equal(f.signals.filter((s) => s === "password").length, 1);
    assert.equal(f.signals.at(-1), "form-completed");
    assert.equal(
      f.signals.some((s) => s.includes(f.values.password)),
      false,
    );
    if (visibilityToggle)
      assert.equal(f.doc.getElementById("show-password").checked, false);
  });
}

test("Google native keyboard can fill both stages while Next waits for complete input", async (t) => {
  const f = fixture(t, false, true, true, true);
  for (let i = 0; i < 160 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.submits(), 1, JSON.stringify(f.signals));
  assert.equal(f.identifierValue(), f.values.username);
  assert.equal(f.doc.getElementById("password").value, f.values.password);
  assert.equal(
    f.keys.length,
    f.values.username.length + f.values.password.length,
  );
  assert.equal(f.signals.filter((s) => s === "identifier").length, 1);
  assert.equal(f.signals.filter((s) => s === "password").length, 1);
  assert.equal(f.signals.at(-1), "form-completed");
  assert.equal(f.doc.getElementById("show-password").checked, false);
});

test("Google disabled Next support still cancels native typing when focus moves away", async (t) => {
  const f = fixture(t, true, true, false, true);
  for (
    let i = 0;
    i < 40 && !f.signals.includes("type|start|identifier|username|0");
    i++
  )
    await delay(50);
  assert.ok(f.signals.includes("type|start|identifier|username|0"));
  const help = f.doc.createElement("a");
  help.href = "#help";
  f.doc.body.appendChild(help);
  help.focus();
  assert.equal(
    f.delivered.nativeTyping(
      "probe",
      0,
      f.until,
      false,
      "type|identifier|username",
    ),
    false,
  );
  await delay(100);
  assert.equal(f.doc.activeElement, help);
  assert.equal(f.doc.getElementById("identifierId").value, "");
  assert.equal(f.keys.length, 0);
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.at(-1), "form-rejected");
});

test("native production form uses paced keyboard receipts for both username and password", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 100 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.submits(), 1, JSON.stringify(f.signals));
  assert.equal(f.doc.getElementById("username").value, f.values.username);
  assert.equal(f.doc.getElementById("password").value, f.values.password);
  assert.equal(
    f.keys.length,
    f.values.username.length + f.values.password.length,
  );
  assert.ok(f.signals.includes("form-submit"));
  assert.equal(
    f.signals.some((s) => s.includes(f.values.password)),
    false,
  );
});

test("native credential typing cannot overwrite manual edits while awaiting keyboard grant", async (t) => {
  const f = fixture(t, true);
  for (
    let i = 0;
    i < 40 && !f.signals.some((s) => s.startsWith("type|start"));
    i++
  )
    await delay(50);
  const input = f.doc.getElementById("username");
  input.value = "manual-user";
  f.delivered.nativeTyping("probe", 0, f.until, false, "type|form|username");
  await delay(100);
  assert.equal(f.doc.getElementById("username").value, "manual-user");
  assert.equal(f.doc.getElementById("password").value, "");
  assert.equal(f.submits(), 0);
  assert.equal(
    f.signals.some((s) => s.startsWith("type|key")),
    false,
  );
});

test("HTTP custom-port production typing completes with private receipts and no SubtleCrypto", async (t) => {
  const f = fixture(
    t,
    false,
    false,
    false,
    false,
    null,
    "http://device.test:8080/login",
  );
  assert.equal(f.win.crypto.subtle, undefined);
  for (let i = 0; i < 100 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.submits(), 1, JSON.stringify(f.signals));
  assert.equal(f.doc.getElementById("username").value, f.values.username);
  assert.equal(f.doc.getElementById("password").value, f.values.password);
  assert.equal(
    f.keys.length,
    f.values.username.length + f.values.password.length,
  );
  assert.equal(f.signals.at(-1), "form-completed");
  assert.deepEqual(f.errors, []);
});

for (const change of [
  "manual-edit",
  "wrong-receipt",
  "expired-grant",
  "action-scheme",
  "action-port",
]) {
  test(`HTTP typing rejects ${change} before sending keys without SubtleCrypto`, async (t) => {
    const f = fixture(
      t,
      true,
      false,
      false,
      false,
      null,
      "http://device.test:8080/login",
    );
    assert.equal(f.win.crypto.subtle, undefined);
    for (
      let i = 0;
      i < 40 && !f.signals.includes("type|start|form|username|0");
      i++
    )
      await delay(50);
    assert.ok(f.signals.includes("type|start|form|username|0"));
    if (change === "manual-edit")
      f.doc.getElementById("username").value = "manual-user";
    if (change === "action-scheme")
      f.doc.querySelector("form").action = "https://device.test:8080/login";
    if (change === "action-port")
      f.doc.querySelector("form").action = "http://device.test:8081/login";
    if (change === "expired-grant") f.expire();
    // The start grant is checked against the live field at once, not on a timer.
    assert.equal(
      f.delivered.nativeTyping(
        "probe",
        0,
        f.until,
        false,
        change === "wrong-receipt"
          ? "type|form|password"
          : "type|form|username",
      ),
      false,
    );
    await delay(100);
    assert.equal(f.doc.getElementById("password").value, "");
    assert.equal(f.keys.length, 0);
    assert.equal(
      f.signals.some((signal) => signal.startsWith("type|key")),
      false,
    );
    assert.equal(f.submits(), 0);
    if (change !== "wrong-receipt")
      assert.equal(f.signals.at(-1), "form-rejected");
    assert.deepEqual(f.errors, []);
    if (change === "manual-edit")
      assert.equal(f.doc.getElementById("username").value, "manual-user");
  });
}

test("concurrent background form and Google tabs complete their own login without activation", async (t) => {
  // CEF input is modelled here; the production bridge's native gates are covered
  // separately. Each document remains hidden and unfocused throughout delivery.
  const tabs = Array.from({ length: 8 }, (_, index) =>
    fixture(t, false, index % 2 === 1, false, false, {
      username: `operator${index}@example.test`,
      password: `secret-${index}`,
    }),
  );
  for (let i = 0; i < 160 && tabs.some((f) => f.submits() === 0); i++)
    await delay(50);
  for (const f of tabs) {
    assert.equal(f.doc.hidden, true);
    assert.equal(f.doc.hasFocus(), false);
    assert.equal(f.submits(), 1, JSON.stringify(f.signals));
    assert.equal(
      f.doc.getElementById("username")?.value ?? f.identifierValue(),
      f.values.username,
    );
    assert.equal(f.doc.getElementById("password").value, f.values.password);
    assert.equal(
      f.keys.length,
      f.values.username.length + f.values.password.length,
    );
    assert.equal(f.signals.at(-1), "form-completed");
    assert.deepEqual(f.errors, []);
  }
});

for (const change of [
  "field-focus",
  "navigation",
  "form-action",
  "manual-edit",
  "pagehide",
]) {
  test(`background automatic typing cancels on ${change} before disclosing a character`, async (t) => {
    const f = fixture(t, true, false, false, false, {
      username: "operator",
      password: "secret",
    });
    for (
      let i = 0;
      i < 40 && !f.signals.includes("type|start|form|username|0");
      i++
    )
      await delay(50);
    assert.ok(f.signals.includes("type|start|form|username|0"));
    if (change === "field-focus") f.doc.getElementById("password").focus();
    if (change === "navigation") f.win.history.replaceState(null, "", "/other");
    if (change === "form-action")
      f.doc.querySelector("form").action = "https://other.test/collect";
    if (change === "manual-edit")
      f.doc.getElementById("username").value = "manual";
    if (change === "pagehide") f.win.dispatchEvent(new f.win.Event("pagehide"));
    f.delivered.nativeTyping("probe", 0, f.until, false, "type|form|username");
    await delay(100);
    assert.equal(
      f.signals.some((s) => s.startsWith("type|key")),
      false,
    );
    assert.equal(f.doc.getElementById("password").value, "");
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.errors, []);
    if (change === "manual-edit")
      assert.equal(f.doc.getElementById("username").value, "manual");
  });
}

// The keyboard helper alone against a model of the native host: `probe 0`
// grants the start, each later `probe N` says N units were sent as CEF keys.
const typingSource = readFileSync(
  resolve(base, "native_login_typing.js"),
  "utf8",
);
function keyboardFixture(t, text = "pA55@word") {
  const dom = new JSDOM(
    '<form><input id="username"><input id="password" type="password"></form>',
    {
      url: "https://device.test/login",
      runScripts: "outside-only",
    },
  );
  const win = dom.window,
    doc = win.document;
  t.after(() => win.close());
  // Frozen page timers: a hidden page may run them at 1 Hz or not at all.
  const timers = [];
  win.setTimeout = (callback, ms) => {
    timers.push({ callback, ms, cleared: false });
    return timers.length;
  };
  win.clearTimeout = (id) => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  const listeners = new Map(),
    original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
    return original(type, callback, ...args);
  };
  const signals = [],
    role = "type|form|username",
    until = Date.now() + 15000;
  const keyboard = win.eval(`${typingSource}\ncreateLoginKeyboard`)((event) =>
    signals.push(event),
  );
  const input = doc.getElementById("username");
  // Model of host.send_key_event: trusted keydown, beforeinput and input, then keyup.
  const trusted = (data, key) => ({
    target: input,
    isTrusted: true,
    key,
    data,
    inputType: "insertText",
    preventDefault() {
      this.prevented = true;
    },
  });
  const emit = (type, event) => {
    for (const fn of listeners.get(type) || []) fn(event);
  };
  function press(data, key = data) {
    const event = trusted(data, key);
    emit("keydown", event);
    emit("beforeinput", event);
    if (event.prevented) return false;
    input.value += data;
    input.setSelectionRange(input.value.length, input.value.length);
    emit("input", event);
    return true;
  }
  const release = (data, key = data) => emit("keyup", trusted(data, key));
  const key = (data, name = data) => {
    const entered = press(data, name);
    release(data, name);
    return entered;
  };
  const outcome = keyboard
    .write(input, text, () => true, "form", "username", until)
    .then(
      () => "typed",
      (error) => error.message,
    );
  // Promise reactions run before the immediate, so "pending" means unsettled.
  const settled = () =>
    Promise.race([
      outcome,
      new Promise((done) => setImmediate(() => done("pending"))),
    ]);
  const probe = (index) =>
    keyboard.dispatch("probe", index, until, false, role);
  const wait = (ms) => keyboard.dispatch("wait", ms, 0, false, role);
  const keys = () => signals.filter((signal) => signal.startsWith("type|key|"));
  // Runs only the pending timers that were scheduled with this delay.
  const fire = (ms) =>
    timers
      .filter((timer) => !timer.cleared && timer.ms === ms)
      .forEach((timer) => {
        timer.cleared = true;
        timer.callback();
      });
  return {
    win,
    doc,
    input,
    signals,
    role,
    until,
    text,
    press,
    release,
    key,
    probe,
    wait,
    keys,
    fire,
    settled,
    timers,
  };
}
const START = "type|start|form|username|0",
  CANCEL = "type|cancel|form|username|0";
const KEY = (index) => `type|key|form|username|${index}`;

test("key receipts are event-driven: a field types to completion while every page timer is frozen", async (t) => {
  const f = keyboardFixture(t);
  assert.deepEqual(f.signals, [START]);
  assert.equal(f.probe(0), true);
  for (let index = 0; index < f.text.length; index++) {
    assert.equal(f.signals.at(-1), KEY(index), JSON.stringify(f.signals));
    assert.equal(f.key(f.text[index]), true);
    assert.equal(f.probe(index + 1), true);
  }
  assert.equal(await f.settled(), "typed");
  assert.equal(f.input.value, f.text);
  assert.equal(f.keys().length, f.text.length);
  assert.equal(f.signals.includes(CANCEL), false);
  assert.equal(
    f.signals.some((signal) => signal.includes(f.text)),
    false,
  );
});

test("a host receipt that overtakes its DOM input event waits for that event, not for a timer", async (t) => {
  const f = keyboardFixture(t, "ab");
  assert.equal(f.probe(0), true);
  assert.deepEqual(f.keys(), [KEY(0)]);
  // The process message can arrive before Chromium dispatches the key.
  assert.equal(f.probe(1), true);
  assert.deepEqual(f.keys(), [KEY(0)]);
  assert.equal(f.key("a"), true);
  assert.deepEqual(f.keys(), [KEY(0), KEY(1)]);
  assert.equal(f.probe(2), true);
  assert.equal(await f.settled(), "pending");
  assert.equal(f.key("b"), true);
  assert.equal(await f.settled(), "typed");
  assert.equal(f.input.value, "ab");
});

test("a key the engine never delivers fails closed and is never requested twice", async (t) => {
  const f = keyboardFixture(t, "ab");
  assert.equal(f.probe(0), true);
  assert.equal(f.probe(1), true);
  assert.equal(await f.settled(), "pending");
  f.fire(1500);
  assert.equal(await f.settled(), "native-typing-cancelled");
  assert.deepEqual(f.keys(), [KEY(0)]);
  assert.equal(f.signals.at(-1), CANCEL);
  assert.equal(f.input.value, "");
});

for (const [label, drive] of [
  ["a receipt for a key that was not requested", (f) => f.probe(1)],
  [
    "a receipt that skips a character",
    (f) => {
      f.probe(0);
      f.key("a");
      return f.probe(2);
    },
  ],
  [
    "a receipt that claims more than one key",
    (f) => {
      f.probe(0);
      return f.probe(3);
    },
  ],
  [
    "a repeated receipt",
    (f) => {
      f.probe(0);
      f.probe(1);
      return f.probe(1);
    },
  ],
  [
    "a repeated start grant",
    (f) => {
      f.probe(0);
      return f.probe(0);
    },
  ],
  [
    "a receipt after the last key",
    (f) => {
      f.probe(0);
      f.key("a");
      f.probe(1);
      f.key("b");
      f.probe(2);
      f.press("c");
      f.probe(3);
      return f.probe(4);
    },
  ],
  [
    "an untrusted input event",
    (f) => {
      f.probe(0);
      f.input.value = "a";
      f.input.dispatchEvent(
        new f.win.InputEvent("input", {
          data: "a",
          inputType: "insertText",
          bubbles: true,
        }),
      );
      return false;
    },
  ],
]) {
  test(`event-driven receipts reject ${label}`, async (t) => {
    const f = keyboardFixture(t, "abc");
    assert.equal(drive(f), false);
    assert.equal(await f.settled(), "native-typing-cancelled");
    assert.equal(f.signals.at(-1), CANCEL);
    assert.equal(f.keys().length <= 3, true);
  });
}

test("a wait repeats only an ungranted start; the host never asks the page to wait for a key", async (t) => {
  const f = keyboardFixture(t, "ab");
  // Load has not ended, or a manual-input slot owns the keyboard.
  assert.equal(f.wait(200), true);
  assert.deepEqual(f.signals, [START]);
  f.fire(200);
  assert.deepEqual(f.signals, [START, START]);
  assert.equal(f.probe(0), true);
  assert.deepEqual(f.keys(), [KEY(0)]);
  // An early or interlocked key request is held by the host itself.
  assert.equal(f.wait(200), false);
  assert.equal(await f.settled(), "native-typing-cancelled");
  assert.deepEqual(f.keys(), [KEY(0)]);
  assert.equal(f.input.value, "");
});

test("a key that arrives while the start waits is the user's: typing stops without touching it", async (t) => {
  const f = keyboardFixture(t, "ab");
  assert.equal(f.wait(200), true);
  assert.equal(f.press("x"), true);
  assert.equal(await f.settled(), "native-typing-cancelled");
  f.fire(200);
  assert.deepEqual(f.signals, [START, CANCEL]);
  assert.equal(f.input.value, "x");
});

test("a field is left only after its last key is released", async (t) => {
  const f = keyboardFixture(t, "ab");
  assert.equal(f.probe(0), true);
  assert.equal(f.key("a"), true);
  assert.equal(f.probe(1), true);
  assert.equal(f.press("b"), true);
  assert.equal(f.probe(2), true);
  // Focus must not move to the next field while this key is still down.
  assert.equal(await f.settled(), "pending");
  f.release("b");
  assert.equal(await f.settled(), "typed");
  assert.equal(f.input.value, "ab");
});

test("a keyup the engine never delivers delays the field once instead of failing it", async (t) => {
  const f = keyboardFixture(t, "a");
  assert.equal(f.probe(0), true);
  assert.equal(f.press("a"), true);
  assert.equal(f.probe(1), true);
  assert.equal(await f.settled(), "pending");
  f.fire(250);
  assert.equal(await f.settled(), "typed");
  assert.deepEqual(f.keys(), [KEY(0)]);
});

test("a surrogate pair is one key whose receipt counts both units", async (t) => {
  const pair = "\u{1f642}";
  const f = keyboardFixture(t, `a${pair}`);
  assert.equal(f.probe(0), true);
  assert.equal(f.key("a"), true);
  assert.equal(f.probe(1), true);
  assert.deepEqual(f.keys(), [KEY(0), KEY(1)]);
  assert.equal(f.key(pair, "Unidentified"), true);
  assert.equal(f.probe(3), true);
  assert.equal(await f.settled(), "typed");
  assert.equal(f.input.value, `a${pair}`);
  assert.deepEqual(f.keys(), [KEY(0), KEY(1)]);
});
