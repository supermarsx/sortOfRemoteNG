import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  host,
  page,
  loginSteps,
  USER,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";

for (const id of ["activepieces", "activepieces-self-hosted"]) {
  const plan = JSON.parse(
    readFileSync(`src/data/loginSteps/business/${id}.json`, "utf8"),
  );
  const fixture = readFileSync(
    `tests/fixtures/logins/${id}/fixture.html`,
    "utf8",
  );
  const origin =
    id === "activepieces"
      ? "https://cloud.activepieces.com"
      : "http://127.0.0.1:8080";
  const configuration = (connection = origin) =>
    loginSteps(plan.loginSteps, {
      connection,
      origins: plan.credentialOrigins,
    });
  const fields = plan.loginSteps[0].selectors;
  const submit = plan.loginSteps[1].selectors.control;

  for (const autoSubmit of [true, false]) {
    test(`${id}: native password form respects submit consent (${autoSubmit})`, async (t) => {
      const h = host({ autoSubmit });
      const p = page(t, h, `${origin}/sign-in`, fixture, configuration());
      let clicks = 0;
      p.$(submit).addEventListener("click", () => clicks++);
      await h.advance(3000);
      assert.equal(p.$(fields.username).value, USER);
      assert.equal(p.$(fields.password).value, SECRET);
      assert.equal(clicks, autoSubmit ? 1 : 0);
      assert.equal(p.reason(), autoSubmit ? "completed" : "fill-only");
      assert.deepEqual(h.errors, []);
      assert.equal(plan.totpChallenges, undefined);
    });
  }

  for (const [name, html] of [
    ["signup", fixture.replaceAll("sign-in-", "sign-up-")],
    [
      "email code",
      '<form><input type="email"><input autocomplete="one-time-code"><button>Verify</button></form>',
    ],
    [
      "SSO",
      '<form><input type="text" name="domain"><button>Continue</button></form>',
    ],
    [
      "generic password form",
      '<form><input type="text"><input type="password"><button>Sign in</button></form>',
    ],
  ]) {
    test(`${id}: ${name} receives no credentials`, async (t) => {
      const h = host();
      const p = page(t, h, `${origin}/sign-in`, html, configuration());
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
    });
  }

  for (const path of [
    "/sign-up",
    "/forget-password",
    "/reset-password",
    "/flows",
    "/sign-in/other",
  ]) {
    test(`${id}: refuses controls on ${path}`, async (t) => {
      const h = host();
      const p = page(t, h, origin + path, fixture, configuration());
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
    });
  }

  test(`${id}: a denied native credential grant types nothing`, async (t) => {
    const h = host({ refuse: () => true });
    const p = page(t, h, `${origin}/sign-in`, fixture, configuration());
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });

  test(`${id}: preserves a manually selected account`, async (t) => {
    const h = host();
    const p = page(t, h, `${origin}/sign-in`, fixture, configuration());
    p.$(fields.username).value = "chosen@example.test";
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.equal(p.$(fields.password).value, "");
  });

  test(`${id}: refuses a document on another origin`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      "https://cloud.activepieces.com.evil.test/sign-in",
      fixture,
      configuration(),
    );
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });
}
