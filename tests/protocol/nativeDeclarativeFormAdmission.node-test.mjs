import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  host,
  page,
  loginSteps,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";
const origin = "https://billing.time4vps.com";
const contract = JSON.parse(
  readFileSync("src/data/loginSteps/hosted/time4vps.json", "utf8"),
);
const fixture = readFileSync(
  "tests/fixtures/logins/time4vps/fixture.html",
  "utf8",
);
const setup = (steps = contract.loginSteps, connection = origin) =>
  loginSteps(steps, { connection, origins: contract.credentialOrigins });
const mutations = {
  malformedAction: (p) => p.$("form").setAttribute("action", "https://["),
  foreignBase: (p) => {
    const b = p.$("form").ownerDocument.createElement("base");
    b.href = "https://attacker.test/";
    p.$("form").ownerDocument.head.append(b);
    p.$("form").setAttribute("action", "/login");
  },
  foreignAction: (p) =>
    p.$("form").setAttribute("action", "https://attacker.test/"),
  getMethod: (p) => p.$("form").setAttribute("method", "get"),
  missingMethod: (p) => p.$("form").removeAttribute("method"),
  newContext: (p) => p.$("form").setAttribute("target", "_blank"),
  credentialUrl: (p) =>
    p
      .$("form")
      .setAttribute(
        "action",
        "https://user:pass@billing.time4vps.com/clientarea/",
      ),
  foreignOverride: (p) =>
    p.$("button").setAttribute("formaction", "https://attacker.test/"),
  getOverride: (p) => p.$("button").setAttribute("formmethod", "get"),
  emptyMethodOverride: (p) => p.$("button").setAttribute("formmethod", ""),
  invalidMethodOverride: (p) =>
    p.$("button").setAttribute("formmethod", "invalid"),
  contextOverride: (p) => p.$("button").setAttribute("formtarget", "_blank"),
};
for (const autoSubmit of [false, true])
  for (const [name, mutate] of Object.entries(mutations))
    test(`initial ${name}, autoSubmit=${autoSubmit}, refuses before account grant`, async (t) => {
      const h = host({ autoSubmit });
      const p = page(t, h, origin + "/clientarea/", fixture, setup());
      mutate(p);
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.equal(p.submits.length, 0);
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
      assert.equal(p.$("#login-widget-password").value, "");
    });
test("reviewed explicit SPA retains GET-shaped form and native fill-only delivery", async (t) => {
  const steps = structuredClone(contract.loginSteps);
  steps[1].submission = "spa";
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup(steps));
  p.$("form").method = "get";
  await h.advance(3000);
  assert.equal(p.$("#login-widget-password").value, SECRET);
  assert.equal(p.submits.length, 0);
});
test("explicit SPA does not waive foreign destination admission", async (t) => {
  const steps = structuredClone(contract.loginSteps);
  steps[1].submission = "spa";
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup(steps));
  mutations.foreignAction(p);
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.ok(!h.requests.some(([, stage]) => stage === "form"));
});
test("reviewed alternate credential origin retains safe local POST admission", async (t) => {
  const h = host({ autoSubmit: false });
  const p = page(
    t,
    h,
    origin + "/clientarea/",
    fixture,
    setup(contract.loginSteps, "https://original.example.test"),
  );
  await h.advance(3000);
  assert.equal(p.$("#login-widget-password").value, SECRET);
});
test("destination mutation after account grant stops before delivery", async (t) => {
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  const request = h.request.bind(h);
  h.request = (page, stage) => {
    request(page, stage);
    if (stage === "form") mutations.getMethod(p);
  };
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
});

test("reviewed formless SPA controls retain credential delivery", async (t) => {
  const steps = structuredClone(contract.loginSteps);
  steps[1].submission = "spa";
  steps[0].selectors = { username: "#user", password: "#pass" };
  steps[1].selectors = { control: "#submit" };
  const html =
    '<input id="user"><input id="pass" type="password"><button id="submit" type="button">Login</button>';
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", html, setup(steps));
  await h.advance(3000);
  assert.equal(p.$("#pass").value, SECRET);
  assert.equal(p.submits.length, 0);
});

test("missing method override inherits the safe POST owner", async (t) => {
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  p.$("button").removeAttribute("formmethod");
  await h.advance(3000);
  assert.equal(p.$("#login-widget-password").value, SECRET);
});
for (const method of ["", "invalid"])
  test(`explicit SPA retains present ${JSON.stringify(method)} override without native submission`, async (t) => {
    const steps = structuredClone(contract.loginSteps);
    steps[1].submission = "spa";
    const h = host({ autoSubmit: false });
    const p = page(t, h, origin + "/clientarea/", fixture, setup(steps));
    p.$("button").setAttribute("formmethod", method);
    await h.advance(3000);
    assert.equal(p.$("#login-widget-password").value, SECRET);
    assert.equal(p.submits.length, 0);
  });
test("present-empty action binds the document destination despite a fixed base and owner action", async (t) => {
  const steps = structuredClone(contract.loginSteps);
  steps[0].paths.push("/alternate/");
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup(steps));
  const base = p.doc.createElement("base");
  base.href = origin + "/fixed/";
  p.doc.head.append(base);
  p.$("form").action = origin + "/fixed-submit/";
  p.$("button").setAttribute("formaction", "");
  const original = h.request.bind(h);
  h.request = (owner, stage) => {
    original(owner, stage);
    if (stage === "form") p.win.history.replaceState(null, "", "/alternate/");
  };
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
  assert.equal(p.reason(), "changed");
});
