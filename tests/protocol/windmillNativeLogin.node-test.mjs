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
  const closedFixture = readFileSync(
    `tests/fixtures/logins/${id}/fixture.closed.html`,
    "utf8",
  );
  const origin =
    id === "windmill"
      ? "https://app.windmill.dev"
      : "https://windmill.example.test:8443";
  const configuration = (connection = origin) => ({
    ...loginSteps(plan.loginSteps, {
      connection,
      origins: plan.credentialOrigins,
    }),
    preparation: "windmill-password-form",
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
    ["SSO-only", '<button type="button">Continue with SSO</button>'],
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

  test(`${id}: opens only the password entry point before requesting a grant`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      origin + "/user/login",
      closedFixture,
      configuration(),
    );
    let opens = 0,
      sso = 0;
    p.$("#sso").onclick = () => sso++;
    p.$("#password-entry").onclick = () => {
      opens++;
      assert.ok(!h.requests.some(([, stage]) => stage === "form"));
      p.doc.body.innerHTML = fixture;
      p.$(selectors.password).addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });
    };
    await h.advance(3000);
    assert.equal(opens, 1);
    assert.equal(sso, 0);
    assert.equal(p.$(selectors.username).value, USER);
    assert.equal(p.$(selectors.password).value, SECRET);
    assert.equal(p.reason(), "completed");
  });

  for (const [name, url, extra, options] of [
    ["off route", origin + "/user/signup", "", configuration()],
    [
      "off origin",
      "https://identity.example.test/user/login",
      "",
      configuration(),
    ],
    [
      "challenge dialog",
      origin + "/user/login",
      '<div role="dialog">Verify identity</div>',
      configuration(),
    ],
    [
      "no native preparation",
      origin + "/user/login",
      "",
      loginSteps(plan.loginSteps, {
        connection: origin,
        origins: plan.credentialOrigins,
      }),
    ],
  ])
    test(`${id}: password entry never clicks for ${name}`, async (t) => {
      const h = host();
      const p = page(
        t,
        h,
        url,
        '<button type="button">Log in without third-party</button>' + extra,
        options,
      );
      let clicks = 0;
      p.doc.addEventListener("click", () => clicks++);
      await h.advance(3000);
      assert.equal(clicks, 0);
      assert.equal(p.typed.length, 0);
    });

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
