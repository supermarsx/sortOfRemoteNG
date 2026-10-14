import test from "node:test";
import assert from "node:assert/strict";
import {
  host,
  page,
  loginSteps,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";

const html =
  '<form id="login" method="post" action="/login"><input id="user"><input id="password" type="password"><button id="submit" type="submit">Login</button></form><form id="other" method="post" action="/login"></form>';
const setup = loginSteps([
  { kind: "form", selectors: { username: "#user", password: "#password" } },
  { kind: "submit", submission: "click", selectors: { control: "#submit" } },
]);
const mutations = {
  "foreign action": (p) => (p.$("#login").action = "https://attacker.test/"),
  "same-origin action": (p) => (p.$("#login").action = "/other"),
  method: (p) => (p.$("#login").method = "get"),
  target: (p) => (p.$("#login").target = "_blank"),
  "field reassociation": (p) => p.$("#password").setAttribute("form", "other"),
  "submitter action": (p) =>
    p.$("#submit").setAttribute("formaction", "https://attacker.test/"),
  "submitter method": (p) => p.$("#submit").setAttribute("formmethod", "get"),
  "submitter target": (p) =>
    p.$("#submit").setAttribute("formtarget", "_blank"),
  base: (p) => {
    const base = p.doc.createElement("base");
    base.href = "https://attacker.test/";
    p.doc.head.append(base);
  },
};
for (const autoSubmit of [true, false])
  for (const [name, mutate] of Object.entries(mutations)) {
    test(`destination ${name} drift before delivery stops ${autoSubmit ? "submit" : "fill-only"} consent before keys`, async (t) => {
      const h = host({ autoSubmit });
      const p = page(t, h, "https://portal.example/login", html, setup);
      const original = h.request.bind(h);
      h.request = (owner, event) => {
        original(owner, event);
        if (event === "form") mutate(p);
      };
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.equal(p.submits.length, 0);
      assert.equal(p.reason(), "changed");
      assert.deepEqual(h.errors, []);
    });
  }
test("destination drift during native receipts stops remaining credential units", async (t) => {
  const h = host();
  const p = page(t, h, "https://portal.example/login", html, setup);
  const original = h.request.bind(h);
  let units = 0;
  h.request = (owner, event) => {
    original(owner, event);
    if (event.startsWith("type|") && ++units === 3)
      p.$("#login").action = "/changed";
  };
  await h.advance(3000);
  assert.ok(p.typed.length > 0 && p.typed.length <= 3);
  assert.equal(p.$("#password").value, "");
  assert.equal(p.submits.length, 0);
  assert.equal(p.reason(), "changed");
  assert.deepEqual(h.errors, []);
});
