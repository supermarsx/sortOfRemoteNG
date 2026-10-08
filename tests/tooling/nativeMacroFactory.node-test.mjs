// Runs the actual native renderer factory in a DOM fixture. No CEF/app launch,
// network, native authority grants, or live-acceptance claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = await readFile(new URL(
  "../../src-tauri/crates/sorng-browser-host/src/native_automation.rs",
  import.meta.url,
), "utf8");
const rustString = (name) => {
  const match = source.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  assert.ok(match, `native ${name} fixture must exist`);
  return match[1];
};
const factory = rustString("AUTOMATION_FACTORY");

function fixture(t, html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "https://fixture.invalid/page", runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window, recorded = [], listeners = {}, changes = [];
  w.HTMLElement.prototype.getClientRects = () => [{}];
  const add = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (kind, callback, ...rest) => {
    listeners[kind] = callback;
    add(kind, callback, ...rest);
  };
  const dispatch = w.eval(`(${factory})`)((...args) => recorded.push(args));
  add("input", event => changes.push(event.type));
  add("change", event => changes.push(event.type));
  function selector(element) {
    const parts = [];
    for (let node = element; node !== w.document.body; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter(e => e.localName === node.localName);
      parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return `html > body > ${parts.join(" > ")}`;
  }
  return {
    w, recorded, changes,
    get: css => w.document.querySelector(css),
    replay: (element, kind, value = "", checked = false) =>
      dispatch("fixture-request", "step", selector(element), kind, value, checked),
    start: () => assert.equal(dispatch("record", "recordStart", "", "", "", false), true),
    record: (element, type = "change", isTrusted = true) =>
      listeners[type]({ target: element, type, isTrusted }),
  };
}

test("readonly inputs and textareas neither record nor replay fills", t => {
  const f = fixture(t, '<input readonly value="original"><textarea readonly>original</textarea>');
  f.start();
  for (const e of f.w.document.querySelectorAll("input,textarea")) {
    f.record(e);
    assert.equal(f.replay(e, "fill", "replacement"), false);
    assert.equal(e.value, "original");
  }
  assert.deepEqual(f.recorded, []);
  assert.deepEqual(f.changes, []);
});

test("disabled controls and inherited fieldsets are rejected without changing state", t => {
  const f = fixture(t, '<input disabled value="original"><fieldset disabled><input value="original"><input type="checkbox"><textarea>original</textarea><select><option value="original">A</option><option value="replacement">B</option></select><button>Run</button></fieldset>');
  f.start();
  for (const e of f.w.document.querySelectorAll("input,textarea,select,button")) {
    assert.equal(e.matches(":disabled"), true);
    const kind = e.type === "checkbox" ? "check" : e.localName === "button" ? "click" : "fill";
    let clicks = 0;
    e.addEventListener("click", () => clicks++);
    f.record(e, kind === "click" ? "click" : "change");
    assert.equal(f.replay(e, kind, "replacement", true), false);
    if (kind === "fill") assert.equal(e.value, "original");
    if (kind === "check") assert.equal(e.checked, false);
    assert.equal(clicks, 0);
  }
  assert.deepEqual(f.recorded, []);
  assert.deepEqual(f.changes, []);
});

test("the native first-legend fieldset exception remains usable", t => {
  const f = fixture(t, '<fieldset disabled><legend><input value="original"></legend></fieldset>');
  const input = f.get("input");
  assert.equal(input.matches(":disabled"), false);
  f.start();
  f.record(input);
  assert.equal(f.recorded.length, 1);
  assert.equal(f.replay(input, "fill", "replacement"), true);
  assert.equal(input.value, "replacement");
});

test("invalid and disabled select options fail before changing the original selection", t => {
  const f = fixture(t, '<select><option value="original">A</option><option value="">Empty</option><option value="replacement">B</option><option value="disabled" disabled>C</option><optgroup disabled><option value="group">D</option></optgroup></select>');
  const select = f.get("select");
  for (const value of ["missing", "disabled", "group"]) {
    assert.equal(f.replay(select, "fill", value), false);
    assert.equal(select.value, "original");
    assert.deepEqual(f.changes, []);
  }
  assert.equal(f.replay(select, "fill", "replacement"), true);
  assert.equal(select.value, "replacement");
  assert.deepEqual(f.changes, ["input", "change"]);
  assert.equal(f.replay(select, "fill", ""), true);
  assert.equal(select.value, "");
  select.querySelector('option[value=""]').remove();
  select.value = "original";
  assert.equal(f.replay(select, "fill", ""), false);
  assert.equal(select.value, "original");
});

test("invalid dates fail without clearing the field; valid and empty dates replay", t => {
  const f = fixture(t, '<input type="date" value="2026-10-08">');
  const date = f.get("input");
  for (const value of ["invalid", "2026-02-30", "2026-1-2"]) {
    assert.equal(f.replay(date, "fill", value), false);
    assert.equal(date.value, "2026-10-08");
    assert.deepEqual(f.changes, []);
  }
  assert.equal(f.replay(date, "fill", "2028-02-29"), true);
  assert.equal(date.value, "2028-02-29");
  assert.equal(f.replay(date, "fill", ""), true);
  assert.equal(date.value, "");
});

test("fill normalization cannot falsely acknowledge a clamped range", t => {
  const f = fixture(t, '<input type="range" min="1" max="10" value="3">');
  const range = f.get("input");
  assert.equal(f.replay(range, "fill", "50"), false);
  assert.equal(range.value, "3");
  assert.deepEqual(f.changes, []);
  assert.equal(f.replay(range, "fill", "7"), true);
  assert.equal(range.value, "7");
});

test("record and replay accept only the same supported same-origin links", t => {
  const f = fixture(t, '<a href="/next">Same</a><a href="https://other.invalid/">Other</a><a href="javascript:void(0)">Script</a><a href="blob:https://fixture.invalid/id">Blob</a><a href="https://user:pass@fixture.invalid/">Credentials</a><a>No href</a>');
  f.start();
  const links = [...f.w.document.querySelectorAll("a")];
  for (const [index, link] of links.entries()) {
    let clicked = 0;
    link.addEventListener("click", event => { event.preventDefault(); clicked++; });
    f.record(link, "click");
    assert.equal(f.replay(link, "click"), index === 0);
    assert.equal(clicked, index === 0 ? 1 : 0);
  }
  assert.equal(f.recorded.length, 1);
  assert.equal(f.recorded[0][2], "click");
});

test("recording still never reads field values or admits untrusted events", t => {
  const f = fixture(t, "<input>");
  const input = f.get("input");
  Object.defineProperty(input, "value", { get() { throw new Error("recording read a value"); } });
  f.start();
  f.record(input, "change", false);
  assert.deepEqual(f.recorded, []);
  f.record(input);
  assert.equal(f.recorded.length, 1);
  assert.deepEqual(f.recorded[0], ["", "step", "fill", "html > body > input:nth-of-type(1)", false]);
});

test("existing native factory DOM contract still passes without native execution", () => {
  const script = rustString("AUTOMATION_DOM_TEST").replaceAll("__FACTORY__", factory);
  const output = execFileSync(process.execPath, ["-e", script], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  assert.match(output, /native automation DOM contract: passed/);
});
