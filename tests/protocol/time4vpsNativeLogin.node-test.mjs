import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  host,
  page,
  loginSteps,
  USER,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";
const steps = JSON.parse(
  readFileSync("src/data/loginSteps/hosted/time4vps.json", "utf8"),
);
const fixture = readFileSync(
  "tests/fixtures/logins/time4vps/fixture.html",
  "utf8",
);
const origin = "https://billing.time4vps.com";
const setup = (connection = origin) =>
  loginSteps(steps.loginSteps, {
    connection,
    origins: steps.credentialOrigins,
  });
const stages = (h) =>
  h.requests
    .map(([, event]) => event)
    .filter((event) => !event.startsWith("type|"));
test("actual Time4 Client Area POST controls receive trusted native keys and one separately authorized submit", async (t) => {
  const h = host();
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  p.$("#login-widget-form").setAttribute("action", "?redirect=?cmd=clientarea");
  await h.advance(3000);
  assert.equal(p.$("#login-widget-user").value, USER);
  assert.equal(p.$("#login-widget-password").value, SECRET);
  assert.equal(p.submits.length, 1);
  assert.equal(p.reason(), "completed");
  assert.deepEqual(stages(h), ["form", "form-submit", "form-completed"]);
  assert.ok(p.typed.length > 0);
  assert.ok(
    !h.requests.some(
      ([, event]) => event.includes(USER) || event.includes(SECRET),
    ),
  );
  assert.deepEqual(h.errors, []);
  assert.equal(p.$("[name=security_token]").value, "");
  assert.equal(p.$("[name=action]").value, "");
});
test("fill-only consent never requests the Time4 submit grant", async (t) => {
  const h = host({ autoSubmit: false });
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  await h.advance(3000);
  assert.equal(p.$("#login-widget-password").value, SECRET);
  assert.equal(p.submits.length, 0);
  assert.equal(p.reason(), "fill-only");
  assert.ok(!stages(h).includes("form-submit"));
});
for (const url of [
  origin + "/signup/",
  origin + "/clientarea/recovery/",
  "https://billing.time4vps.com.evil.test/clientarea/",
])
  test(`no credential request on unreviewed authority or path ${url}`, async (t) => {
    const h = host();
    const p = page(t, h, url, fixture, setup());
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.equal(p.submits.length, 0);
    assert.ok(!stages(h).includes("form"));
  });
test("a missing native credential grant never types or submits", async (t) => {
  const h = host({ refuse: () => true });
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
  assert.equal(p.$("#login-widget-password").value, "");
});

test("a lookalike saved connection cannot reuse the hosted Time4 selectors", async (t) => {
  const lookalike = "https://billing.time4vps.com.evil.test";
  const h = host();
  const p = page(t, h, lookalike + "/clientarea/", fixture, setup(lookalike));
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
  assert.ok(!stages(h).includes("form"));
});

test("the catalog origin list cannot replace the owner's actual route and credential grant", async (t) => {
  const h = host({ refuse: () => true });
  const p = page(
    t,
    h,
    origin + "/clientarea/",
    fixture,
    setup("https://unrelated.example.test"),
  );
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
  assert.equal(p.$("#login-widget-password").value, "");
});
test("a changed form action before credential delivery is refused", async (t) => {
  const h = host();
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  const original = h.request.bind(h);
  h.request = (page, event) => {
    original(page, event);
    if (event === "form")
      p.$("#login-widget-form").action = "https://attacker.test/";
  };
  await h.advance(3000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
  assert.equal(p.reason(), "changed");
});
test("user input remains untouched and stops the saved-account attempt", async (t) => {
  const h = host();
  const p = page(t, h, origin + "/clientarea/", fixture, setup());
  p.$("#login-widget-user").value = "manually-chosen-account";
  await h.advance(3000);
  assert.equal(p.$("#login-widget-user").value, "manually-chosen-account");
  assert.equal(p.$("#login-widget-password").value, "");
  assert.equal(p.typed.length, 0);
  assert.equal(p.submits.length, 0);
});
test("no authenticator stage is fabricated from the account/password form", () => {
  assert.equal(steps.totpChallenges, undefined);
  assert.ok(
    steps.loginSteps.every((step) => ["form", "submit"].includes(step.kind)),
  );
});
