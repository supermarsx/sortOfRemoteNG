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

for (const id of [
  "standard-notes",
  "standard-notes-self-hosted",
  "standard-red-notes",
]) {
  const plan = JSON.parse(
    readFileSync(`src/data/loginSteps/self-hosted/${id}.json`, "utf8"),
  );
  const fixture = readFileSync(
    `tests/fixtures/logins/${id}/fixture.html`,
    "utf8",
  );
  const origin =
    id === "standard-notes"
      ? "https://app.standardnotes.com"
      : "http://127.0.0.1:3001";
  const configuration = (connection = origin) =>
    loginSteps(plan.loginSteps, {
      connection,
      origins: plan.credentialOrigins,
    });
  const selectors = plan.loginSteps[0].selectors;
  const submitSelector = plan.loginSteps[1].selectors.control;

  test(`${id}: native keys fill the formless account pane and click once`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      `${origin}/?settings=account`,
      fixture,
      configuration(),
    );
    let clicks = 0;
    p.$(submitSelector).addEventListener("click", () => clicks++);
    await h.advance(3000);
    assert.equal(p.$(selectors.username).value, USER);
    assert.equal(p.$(selectors.password).value, SECRET);
    assert.equal(clicks, 1);
    assert.equal(p.reason(), "completed");
    assert.deepEqual(h.errors, []);
    assert.equal(plan.totpChallenges, undefined);
    if (id === "standard-red-notes")
      assert.equal(p.$('input[type="text"]').value, "");
  });

  test(`${id}: fill-only consent fills without clicking`, async (t) => {
    const h = host({ autoSubmit: false });
    const p = page(
      t,
      h,
      `${origin}/?settings=account`,
      fixture,
      configuration(),
    );
    let clicks = 0;
    p.$(submitSelector).addEventListener("click", () => clicks++);
    await h.advance(3000);
    assert.equal(p.$(selectors.password).value, SECRET);
    assert.equal(clicks, 0);
    assert.equal(p.reason(), "fill-only");
  });

  for (const [name, html] of [
    [
      "recovery-code sign-in",
      fixture.replace('name="is-ephemeral"', 'name="is-ephemeral" disabled'),
    ],
    [
      "registration",
      '<div id="account-menu"><form><div><input type="email"></div><div><input type="password"></div><button type="button">Create</button></form></div>',
    ],
    [
      "local unlock",
      '<div id="account-menu"><div><div><input type="password"></div><button type="button">Unlock</button></div></div>',
    ],
    [
      "recovery",
      '<div id="account-menu"><div><div><input type="text"></div><div><input type="password"></div><button type="button">Recover</button></div></div>',
    ],
  ])
    test(`${id}: ${name} receives no credentials`, async (t) => {
      const h = host();
      const p = page(t, h, origin + "/", html, configuration());
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
    });

  test(`${id}: unrelated paths do not receive a credential grant`, async (t) => {
    const h = host();
    const p = page(t, h, origin + "/recovery", fixture, configuration());
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });

  test(`${id}: a manually chosen account is preserved`, async (t) => {
    const h = host();
    const p = page(t, h, origin + "/", fixture, configuration());
    p.$(selectors.username).value = "chosen@example.test";
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.equal(p.$(selectors.username).value, "chosen@example.test");
    assert.equal(p.$(selectors.password).value, "");
  });

  test(`${id}: unavailable native grant types nothing`, async (t) => {
    const h = host({ refuse: () => true });
    const p = page(t, h, origin + "/", fixture, configuration());
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });

  if (id === "standard-notes")
    test("hosted Standard Notes selectors cannot type on a lookalike saved host", async (t) => {
      const lookalike = "https://app.standardnotes.com.evil.test";
      const h = host();
      const p = page(t, h, lookalike + "/", fixture, configuration(lookalike));
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
    });
}
