import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  host,
  page,
  loginSteps,
  USER,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";
const origin = "https://login.telecom.pt";
for (const [id, entry] of [
  ["meo-particulares", "https://my.meo.pt"],
  ["meo-empresas", "https://cliente-empresas.meo.pt"],
]) {
  const contract = JSON.parse(
    readFileSync(`src/data/loginSteps/portuguese-portals/${id}.json`, "utf8"),
  );
  const fixture = readFileSync(
    `tests/fixtures/logins/${id}/fixture.html`,
    "utf8",
  );
  const setup = loginSteps(contract.loginSteps, {
    connection: entry,
    origins: contract.credentialOrigins,
  });
  const selectors = contract.loginSteps[0].selectors;
  test(`${id} observed identity controls receive trusted keys only in the top document and one explicit submit`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      origin + "/AuthorizeService/authorize.aspx",
      fixture,
      setup,
    );
    const untouched = new Map(
      [...p.$("form").querySelectorAll("input[type=hidden],textarea")].map(
        (control) => [control, control.value],
      ),
    );
    await h.advance(3000);
    assert.equal(p.$(selectors.username).value, USER);
    assert.equal(p.$(selectors.password).value, SECRET);
    assert.equal(p.submits.length, 1);
    assert.deepEqual(
      new Set(p.typed.map(([id]) => id)),
      new Set([p.$(selectors.username).id, p.$(selectors.password).id]),
    );
    for (const [control, value] of untouched)
      assert.equal(control.value, value);
    assert.deepEqual(h.errors, []);
  });
  test(`${id} fill-only consent leaves submit and human CAPTCHA untouched`, async (t) => {
    const h = host({ autoSubmit: false });
    const p = page(
      t,
      h,
      origin + "/AuthorizeService/authorize.aspx",
      fixture,
      setup,
    );
    await h.advance(3000);
    assert.equal(p.$(selectors.password).value, SECRET);
    assert.equal(p.submits.length, 0);
    assert.ok(!h.requests.some(([, stage]) => stage === "form-submit"));
    assert.ok(p.typed.every(([id]) => !id.includes("captcha")));
  });
  for (const url of [
    entry + "/",
    "https://id.services.telecom.pt/oic",
    origin + "/Public/PwdRecovery.aspx",
    origin + "/AuthorizeService/Login",
    "https://login.telecom.pt.evil.test/AuthorizeService/authorize.aspx",
    "https://newassets.hcaptcha.com/captcha/v1/public/static/hcaptcha.html",
  ])
    test(`${id} refuses credentials on unreviewed page ${url}`, async (t) => {
      const h = host();
      const p = page(t, h, url, fixture, setup);
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.equal(p.submits.length, 0);
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
    });
  test(`${id} requires the actual native selected-account grant`, async (t) => {
    const h = host({ refuse: () => true });
    const p = page(
      t,
      h,
      origin + "/AuthorizeService/authorize.aspx",
      fixture,
      setup,
    );
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.equal(p.submits.length, 0);
  });
  test(`${id} refuses initial foreign form destination before a fill-only grant`, async (t) => {
    const h = host({ autoSubmit: false });
    const p = page(
      t,
      h,
      origin + "/AuthorizeService/authorize.aspx",
      fixture,
      setup,
    );
    p.$("form").action = "https://attacker.test/";
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.ok(!h.requests.some(([, stage]) => stage === "form"));
  });
  test(`${id} does not fabricate TOTP or saved-code metadata`, () => {
    assert.equal(contract.totpChallenges, undefined);
    assert.equal(contract.loginSteps[0].frame, undefined);
    assert.deepEqual(contract.credentialOrigins, [origin]);
  });
}
