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

for (const id of ["windmill", "windmill-self-hosted"]) {
  const family = id === "windmill" ? "hosted" : "self-hosted";
  const plan = JSON.parse(
    readFileSync(`src/data/loginSteps/${family}/${id}.json`, "utf8"),
  );
  const fixture = readFileSync(
    `tests/fixtures/logins/${id}/fixture.html`,
    "utf8",
  );
  const origin =
    id === "windmill"
      ? "https://app.windmill.dev"
      : "https://windmill.example.test:8443";
  const configuration = (connection = origin) =>
    loginSteps(plan.loginSteps, {
      connection,
      origins: plan.credentialOrigins,
    });
  const selectors = plan.loginSteps[0].selectors;

  for (const autoSubmit of [true, false]) {
    test(`${id}: native typing respects ${autoSubmit ? "submit" : "fill-only"} consent`, async (t) => {
      const h = host({ autoSubmit });
      const p = page(
        t,
        h,
        `${origin}/user/login?rd=%2Fuser%2Fworkspaces`,
        fixture,
        configuration(),
      );
      let entries = 0;
      p.$(selectors.password).addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          entries++;
        }
      });
      await h.advance(3000);
      assert.equal(p.$(selectors.username).value, USER);
      assert.equal(p.$(selectors.password).value, SECRET);
      assert.equal(entries, autoSubmit ? 1 : 0);
      assert.equal(p.reason(), autoSubmit ? "completed" : "fill-only");
      await h.advance(10000);
      assert.equal(entries, autoSubmit ? 1 : 0);
      assert.deepEqual(h.errors, []);
      assert.equal(plan.totpChallenges, undefined);
    });
  }

  for (const path of [
    "/",
    "/user/signup",
    "/user/forgot-password",
    "/user/first-time",
    "/apps/get/example",
    "/prefix/user/login",
  ]) {
    test(`${id}: ${path} cannot receive credentials`, async (t) => {
      const h = host();
      const p = page(t, h, origin + path, fixture, configuration());
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
    });
  }

  for (const [name, html] of [
    [
      "SSO-only or unopened password pane",
      '<button type="button">Continue with SSO</button><button type="button">Log in without third-party</button>',
    ],
    [
      "password reset",
      fixture.replace(
        'autocomplete="current-password"',
        'autocomplete="new-password"',
      ),
    ],
    [
      "unrelated generic login",
      fixture
        .replaceAll('id="synthetic-', 'id="unrelated-')
        .replaceAll('-email"', '-account"'),
    ],
  ]) {
    test(`${id}: ${name} stays interactive`, async (t) => {
      const h = host();
      const p = page(t, h, origin + "/user/login", html, configuration());
      let clicks = 0;
      p.doc.addEventListener("click", () => clicks++);
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
      assert.equal(clicks, 0);
    });
  }

  test(`${id}: user-entered account is preserved`, async (t) => {
    const h = host();
    const p = page(t, h, origin + "/user/login", fixture, configuration());
    p.$(selectors.username).value = "chosen@example.test";
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
    assert.equal(p.$(selectors.username).value, "chosen@example.test");
    assert.equal(p.$(selectors.password).value, "");
  });

  test(`${id}: denied native grant never types`, async (t) => {
    const h = host({ refuse: () => true });
    const p = page(t, h, origin + "/user/login", fixture, configuration());
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });

  test(`${id}: off-origin provider receives no password`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      "https://identity.example.test/user/login",
      fixture,
      configuration(),
    );
    await h.advance(3000);
    assert.equal(p.typed.length, 0);
  });

  if (id === "windmill")
    test("Windmill Cloud: a lookalike saved host is not authorized", async (t) => {
      const lookalike = "https://app.windmill.dev.evil.test";
      const h = host();
      const p = page(
        t,
        h,
        lookalike + "/user/login",
        fixture,
        configuration(lookalike),
      );
      await h.advance(3000);
      assert.equal(p.typed.length, 0);
    });
}
