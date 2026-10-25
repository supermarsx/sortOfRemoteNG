import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(
  resolve(base, "native_login_profiles.rs"),
  "utf8",
);
const includes = [
  ...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g),
];
const modules = includes
  .map(([, path]) => readFileSync(resolve(base, path), "utf8"))
  .join("");
const source = readFileSync(
  resolve(base, "native_login_client.js"),
  "utf8",
).replace("/* REVIEWED_FORM_MODULES */", () => modules);
const selectors = {
  username: "#username",
  password: "#password",
  submit: "#login",
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("Brevo native modular form handles reviewed handler-only controls without GET or eye toggle", async (t) => {
  const html =
    '<form><input type="text" id="email" name="email"><input type="password" id="password" name="password"><button id="eyeIcon" type="button"></button><button type="button" data-testid="submit-button">Log In</button></form>';
  const selectors = {
    username: 'form input#email[name="email"]',
    password: 'form input#password[name="password"][type="password"]',
    submit:
      'form:has(input#email):has(input#password) button[data-testid="submit-button"][type="button"]',
  };
  const f = nativeFixture(
    t,
    html,
    "https://login.brevo.com/",
    { selectors },
    "modular-form",
  );
  let login = 0,
    eye = 0;
  f.field('[data-testid="submit-button"]').addEventListener(
    "click",
    () => login++,
  );
  f.field("#eyeIcon").addEventListener("click", () => eye++);
  const options = {
    version: 1,
    fillDelayMs: 0,
    submitDelayMs: 0,
    detectionTimeoutMs: 8000,
    submit: true,
    fields: [],
  };
  await f.advance(1000);
  assert.deepEqual(f.signals, ["form-prepare"]);
  assert.equal(f.send("form-prepare", true, 30000, options), true);
  await f.advance(1000);
  assert.equal(f.send("form", true, 30000, options), true);
  await f.advance(2000);
  assert.equal(f.field("#email").value, "alice@example.test");
  assert.equal(f.field("#password").value, "test-secret");
  assert.equal(f.send("form-submit", true, 30000, options), true);
  await f.advance(1000);
  assert.equal(login, 1);
  assert.equal(eye, 0);
  assert.equal(f.submits(), 0);
});

test("native profile snapshot exactly matches all reviewed legacy defaults", async () => {
  const result = await build({
    entryPoints: ["src/utils/connection/httpApplicationProfiles.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    packages: "external",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const expected = {
    profiles: Object.fromEntries(
      module.exports.HTTP_APPLICATION_PROFILES.map((profile) => [
        profile.id,
        {
          capability: profile.capability,
          loginFlow: profile.loginFlow,
          emailOnly: profile.emailOnly,
          selectors: profile.selectors,
          sameOriginLoginFrames: profile.sameOriginLoginFrames,
          scriptDefaults: profile.scriptDefaults,
          requestDefaults: profile.requestDefaults,
        },
      ]),
    ),
    joomla: Object.fromEntries(
      ["auto", "3", "4", "5", "6"].map((version) => [
        version,
        module.exports.getJoomlaLoginSelectors(version),
      ]),
    ),
  };
  const catalog = JSON.parse(
    readFileSync(resolve(base, "native_login_catalog.json"), "utf8"),
  );
  // Login steps are checked on their own below. The reviewed profile fields are
  // compared exactly as before, on a copy without the two steps keys.
  const reviewed = structuredClone(catalog);
  delete reviewed.declarativeLoginSupported;
  // Drone CI's provider table is generated from droneScmBridge.ts, not from
  // a profile; tests/tooling/nativeLoginCatalog.node-test.mjs pins it.
  delete reviewed.droneScm;
  for (const profile of Object.values(reviewed.profiles))
    delete profile.declarativeLogin;
  assert.deepEqual(reviewed, JSON.parse(JSON.stringify(expected)));

  // Steps reach the catalog only once declarative login is switched on. From
  // then on every steps file is there as it was written, and no other profile
  // carries the key; until then no profile does. A profile that already signs
  // in by form detection gets its steps as an addition, never a replacement.
  const supported = module.exports.DECLARATIVE_LOGIN_SUPPORTED === true;
  const { existsSync, readdirSync } = await import("node:fs");
  const stepsRoot = resolve("src/data/loginSteps");
  const declared = {};
  if (supported && existsSync(stepsRoot))
    for (const family of readdirSync(stepsRoot, { withFileTypes: true })) {
      if (!family.isDirectory()) continue;
      for (const name of readdirSync(resolve(stepsRoot, family.name))) {
        if (!name.endsWith(".json")) continue;
        const file = JSON.parse(
          readFileSync(resolve(stepsRoot, family.name, name), "utf8"),
        );
        const id = name.slice(0, -".json".length);
        declared[id] = {
          mode:
            expected.profiles[id]?.capability === "manual"
              ? "exclusive"
              : "additive",
          credentialOrigins: file.credentialOrigins,
          passwordOnly: file.passwordOnly === true,
          loginSteps: file.loginSteps,
        };
      }
    }
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(catalog.profiles)
        .filter(([, profile]) => "declarativeLogin" in profile)
        .map(([id, profile]) => [id, profile.declarativeLogin]),
    ),
    declared,
  );
  assert.equal(catalog.declarativeLoginSupported, supported ? true : undefined);
});
function fixture(
  t,
  configuration = { selectors },
  url = "https://device.test/login",
) {
  const dom = new JSDOM(
    '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>',
    {
      url,
      runScripts: "outside-only",
    },
  );
  let clock = 1_000_000;
  let readyState = "loading";
  let nextTimer = 0;
  const timers = new Map();
  Object.defineProperty(dom.window.document, "readyState", {
    get: () => readyState,
  });
  dom.window.Date.now = () => clock;
  dom.window.setTimeout = (callback, milliseconds = 0) => {
    assert.ok(timers.size < 32, "owned timer queue bound");
    const id = ++nextTimer;
    timers.set(id, {
      callback,
      due: clock + Math.max(0, Number(milliseconds)),
    });
    return id;
  };
  dom.window.clearTimeout = (id) => timers.delete(id);
  const advance = async (milliseconds) => {
    const end = clock + milliseconds;
    let callbacks = 0;
    for (;;) {
      await Promise.resolve();
      await Promise.resolve();
      const pending = [...timers].sort(
        ([a, x], [b, y]) => x.due - y.due || a - b,
      );
      const next = pending[0];
      if (!next || next[1].due > end) break;
      assert.ok(++callbacks <= 64, "owned callback bound");
      timers.delete(next[0]);
      clock = next[1].due;
      next[1].callback();
      await Promise.resolve();
    }
    clock = end;
  };
  t.after(() => {
    try {
      dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    } finally {
      timers.clear();
      dom.window.close();
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  const signals = [];
  let submits = 0;
  dom.window.document.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    submits++;
  });
  dom.window.fetch = () => {
    throw new Error("No proxy transport permitted");
  };
  const deliver = dom.window.eval(source)(
    (value) => signals.push(value),
    configuration,
  );
  return {
    window: dom.window,
    advance,
    now: () => clock,
    ready: async () => {
      readyState = "complete";
      dom.window.dispatchEvent(new dom.window.Event("load"));
      await advance(1);
    },
    navigate: (url) => dom.reconfigure({ url }),
    signals,
    deliver,
    submits: () => submits,
    field: (id) => dom.window.document.getElementById(id),
    send: (submit = false, deadline = clock + 2000, options) =>
      deliver(
        new URL(url).origin,
        "alice",
        "test-secret",
        submit,
        deadline,
        options,
      ),
  };
}

test("native bundle matches shared module manifest and excludes proxy coordinator", () => {
  const legacy = readFileSync(
    "src-tauri/crates/sorng-protocols/src/autologin_asset.rs",
    "utf8",
  )
    .split("pub const AUTOLOGIN_MODULES_JS")[1]
    .split(");")[0];
  assert.deepEqual(
    includes.map(([, path]) => path.split("/src/")[1]),
    [...legacy.matchAll(/include_str!\("([^"]+)"\)/g)].map(([, path]) => path),
  );
  assert.ok(!source.includes("/__sortofremoteng_autologin"));
});

test("selected form fills once without upgrading fill-only consent", async (t) => {
  const f = fixture(t);
  await f.advance(40);
  assert.deepEqual(f.signals, []);
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
  await f.ready();
  assert.deepEqual(f.signals, ["form"]);
  assert.equal(f.send(), true);
  await f.advance(10);
  assert.equal(f.field("username").value, "alice");
  assert.equal(f.field("password").value, "test-secret");
  assert.equal(f.submits(), 0);
  assert.equal(f.send(true), false);
  assert.equal(f.window.__sorng_autologin, undefined);
});

test("explicit native submit consent submits once", async (t) => {
  const f = fixture(t);
  await f.ready();
  assert.equal(f.send(true), true);
  await f.advance(10);
  assert.equal(f.submits(), 1);
});

for (const submit of [false, true]) {
  test(`HTTP custom-port selected form preserves submit consent (${submit})`, async (t) => {
    const f = fixture(t, { selectors }, "http://device.test:8080/login");
    await f.ready();
    assert.deepEqual(f.signals, ["form"]);
    assert.equal(f.send(submit), true);
    await f.advance(10);
    assert.equal(f.field("username").value, "alice");
    assert.equal(f.field("password").value, "test-secret");
    assert.equal(f.submits(), Number(submit));
  });
}

for (const origin of [
  "http://other.test:8080",
  "https://device.test:8080",
  "http://device.test:8081",
  "http://device.test",
]) {
  test(`HTTP selected form rejects wrong delivery origin ${origin}`, async (t) => {
    const f = fixture(t, { selectors }, "http://device.test:8080/login");
    await f.ready();
    assert.equal(
      f.deliver(origin, "alice", "secret", true, f.now() + 2000),
      false,
    );
    assert.equal(f.field("username").value, "");
    assert.equal(f.field("password").value, "");
    assert.equal(f.submits(), 0);
  });
  test(`HTTP selected form rejects wrong action origin ${origin}`, async (t) => {
    const f = fixture(t, { selectors }, "http://device.test:8080/login");
    f.window.document.querySelector("form").action = `${origin}/login`;
    await f.ready();
    assert.ok(!f.signals.includes("form"));
    assert.equal(f.send(true), false);
    assert.equal(f.field("password").value, "");
  });
}

test("HTTPS credentials cannot follow a redirect to the same HTTP host and port", async (t) => {
  const f = fixture(t, { selectors }, "https://device.test:8080/login");
  await f.ready();
  assert.deepEqual(f.signals, ["form"]);
  f.navigate("http://device.test:8080/login");
  assert.equal(f.send(true), false);
  assert.equal(
    f.deliver(
      "http://device.test:8080",
      "alice",
      "secret",
      true,
      f.now() + 2000,
    ),
    false,
  );
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

test("missing explicit selector never falls back to generic discovery", async (t) => {
  const f = fixture(t, { selectors: { ...selectors, password: "#missing" } });
  await f.ready();
  assert.deepEqual(f.signals, []);
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("wrong origin, expiry and pagehide cannot release credentials", async (t) => {
  const f = fixture(t);
  await f.ready();
  assert.equal(
    f.deliver("https://other.test", "alice", "secret", true, f.now() + 1000),
    false,
  );
  assert.equal(f.send(false, f.now() - 1), false);
  f.window.dispatchEvent(new f.window.Event("pagehide"));
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("external action is rejected before readiness or credential entry", async (t) => {
  const f = fixture(t);
  f.window.document.querySelector("form").action = "https://other.test/login";
  await f.ready();
  assert.ok(!f.signals.includes("form"));
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("saved options cannot override native consent and retain extra fields", async (t) => {
  const f = fixture(t);
  const realm = f.window.document.createElement("input");
  realm.id = "realm";
  f.window.document.querySelector("form").append(realm);
  await f.ready();
  assert.equal(
    f.send(false, f.now() + 2000, {
      version: 1,
      fillDelayMs: 0,
      submitDelayMs: 0,
      detectionTimeoutMs: 1000,
      submit: true,
      fields: [{ selector: "#realm", value: "local" }],
    }),
    true,
  );
  await f.advance(10);
  assert.equal(realm.value, "local");
  assert.equal(f.submits(), 0);
});

test("expiry cancels deferred filling before any value is written", async (t) => {
  const f = fixture(t);
  await f.ready();
  assert.equal(
    f.send(true, f.now() + 15, {
      version: 1,
      fillDelayMs: 100,
      submitDelayMs: 0,
      detectionTimeoutMs: 1000,
      submit: true,
      fields: [],
    }),
    true,
  );
  await f.advance(140);
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

test("action mutation during username input cannot release password", async (t) => {
  const f = fixture(t);
  await f.ready();
  f.field("username").addEventListener("input", () => {
    f.window.document.querySelector("form").action = "https://other.test/login";
  });
  assert.equal(f.send(true), true);
  await f.advance(10);
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

for (const [name, value] of [
  ["formtarget", "_blank"],
  ["formmethod", ""],
]) {
  test(`unsafe ${name} rejected before readiness`, async (t) => {
    const f = fixture(t);
    f.field("login").setAttribute(name, value);
    await f.ready();
    assert.ok(!f.signals.includes("form"));
    assert.equal(f.send(true), false);
    assert.equal(f.field("password").value, "");
  });
}
// A deterministic window clock runs the real bundled JS and real WebCrypto.
// The fixture has no network or page-global native transport.
function nativeFixture(
  t,
  html,
  url,
  configuration,
  adapter,
  instrumentedSource = source,
) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const w = dom.window;
  let clock = 1_000_000,
    nextId = 0;
  const jobs = new Map();
  const signals = [];
  const schedule = (callback, ms, interval) => {
    const id = ++nextId;
    jobs.set(id, { callback, at: clock + Math.max(1, ms || 0), interval });
    return id;
  };
  w.setTimeout = (callback, ms) => schedule(callback, ms, 0);
  w.setInterval = (callback, ms) =>
    schedule(callback, ms, Math.max(1, ms || 0));
  w.clearTimeout = w.clearInterval = (id) => jobs.delete(id);
  w.Date.now = () => clock;
  w.TextEncoder = TextEncoder;
  const digests = new Set();
  // Chromium exposes random bytes, but not SubtleCrypto, on ordinary HTTP.
  if (new URL(url).protocol === "https:")
    Object.defineProperty(w, "crypto", {
      value: {
        getRandomValues: (array) => webcrypto.getRandomValues(array),
        subtle: {
          async digest(...args) {
            const pending = webcrypto.subtle.digest(...args);
            digests.add(pending);
            try {
              return await pending;
            } finally {
              digests.delete(pending);
            }
          },
        },
      },
    });
  async function settle() {
    await delay(1);
    // Cancellation clears all simulated timers, but its real WebCrypto cleanup
    // may still be running. Drain it before asserting or advancing the clock.
    while (digests.size) {
      await Promise.all([...digests]);
      await delay(1);
    }
  }
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  w.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 100, height: 20 }] : [];
  };
  w.fetch = () => {
    throw new Error("No network transport in a native login adapter");
  };
  let submissions = 0;
  w.document.addEventListener("submit", (event) => {
    event.preventDefault();
    submissions++;
  });
  const deliver = w.eval(instrumentedSource)(
    (value) => signals.push(value),
    configuration,
    adapter,
  );
  t.after(() => {
    w.dispatchEvent(new w.Event("pagehide"));
    w.close();
  });
  return {
    w,
    navigate: (url) => dom.reconfigure({ url }),
    signals,
    deliver,
    field: (selector) => w.document.querySelector(selector),
    now: () => clock,
    submits: () => submissions,
    send(stage, autoSubmit = true, ttl = 2000, options) {
      const username = ["identifier", "form", "bound-password"].includes(stage)
        ? "alice@example.test"
        : "";
      const password = ["password", "form", "bound-password"].includes(stage)
        ? "test-secret"
        : "";
      return adapter === "modular-form"
        ? deliver(
            w.location.origin,
            username,
            password,
            autoSubmit,
            clock + ttl,
            options,
            stage,
          )
        : deliver(
            w.location.origin,
            username,
            password,
            autoSubmit,
            clock + ttl,
            stage,
          );
    },
    async advance(ms) {
      const end = clock + ms;
      for (let count = 0; count < 10000; count++) {
        const due = [...jobs]
          .filter(([, job]) => job.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due;
        clock = job.at;
        if (job.interval) job.at += job.interval;
        else jobs.delete(id);
        job.callback();
        await settle();
      }
      clock = end;
      await settle();
    },
  };
}

const semanticEmail =
  '<form method="post"><input type="email" name="email"><button type="submit">Continue</button></form>';
const semanticPassword =
  '<form method="post"><input type="hidden" name="username" value="alice@example.test"><input name="password" type="password" autocomplete="current-password"><button type="submit">Log in</button></form>';
const bitwardenMarkup =
  '<form><input id="email" type="email" data-testid="login-email-input"><input hidden id="masterPassword" type="password" data-testid="login-master-password-input"><button type="button" data-testid="login-continue-button">Continue</button><button hidden type="submit" data-testid="login-submit-button">Log in</button></form>';
function providerFixture(t, provider, html, url = "https://device.test/login") {
  return nativeFixture(t, html, url, { provider });
}

test("all dedicated catalog flows have explicit native adapter mappings", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(base, "native_login_catalog.json"), "utf8"),
  );
  const registry = readFileSync(resolve(base, "native_features.rs"), "utf8");
  const mapping = {
    bitwarden: "Bitwarden",
    synology: "Synology",
    cloudflare: "Cloudflare",
    yealink: "Yealink",
    adobe: "Adobe",
    chatgpt: "ChatGpt",
    claude: "Claude",
  };
  for (const [id, profile] of Object.entries(catalog.profiles)) {
    if (!mapping[profile.loginFlow]) continue;
    assert.match(
      registry,
      new RegExp(`"${id}"[^\\n]*=> Self::${mapping[profile.loginFlow]}`),
      id,
    );
  }
});

test("Bitwarden waits beyond the old TTL for the exact password panel, then requests a fresh secret once", async (t) => {
  const f = providerFixture(t, "bitwarden-self-hosted", bitwardenMarkup);
  let next = 0;
  f.field('[data-testid="login-continue-button"]').onclick = () => {
    next++;
  };
  await f.advance(700);
  assert.deepEqual(f.signals, ["identifier"]);
  assert.equal(f.send("password"), false);
  assert.equal(f.send("identifier"), true);
  await f.advance(3500);
  assert.equal(next, 1);
  assert.equal(f.field("#masterPassword").value, "");
  f.field("#email").hidden = true;
  f.field('[data-testid="login-continue-button"]').hidden = true;
  f.field("#masterPassword").hidden = false;
  f.field('[data-testid="login-submit-button"]').hidden = false;
  await f.advance(700);
  assert.deepEqual(f.signals, ["identifier", "password"]);
  assert.equal(f.send("password"), true);
  await f.advance(700);
  assert.equal(f.submits(), 1);
  assert.equal(f.send("password"), false);
  assert.deepEqual(f.signals, ["identifier", "password", "form-completed"]);
});

test("Bitwarden never acquires a replacement password input after Next", async (t) => {
  const f = providerFixture(t, "bitwarden-self-hosted", bitwardenMarkup);
  await f.advance(700);
  f.send("identifier");
  await f.advance(700);
  f.field("#masterPassword").replaceWith(
    f.field("#masterPassword").cloneNode(),
  );
  await f.advance(700);
  assert.deepEqual(f.signals, ["identifier", "form-rejected"]);
  assert.equal(f.field("#masterPassword").value, "");
});

test("Cloudflare combined form respects fill-only consent and stage minimization", async (t) => {
  const f = providerFixture(
    t,
    "cloudflare",
    semanticEmail.replace(
      "<button",
      '<input name="password" type="password"><button',
    ),
    "https://dash.cloudflare.com/login",
  );
  await f.advance(700);
  assert.equal(
    f.deliver(
      f.w.location.origin,
      "alice",
      "wrong-stage-secret",
      false,
      f.now() + 2000,
      "identifier",
    ),
    false,
  );
  assert.equal(f.send("identifier", false), true);
  await f.advance(1700);
  assert.deepEqual(f.signals, ["identifier", "password"]);
  assert.equal(f.send("password", false), true);
  await f.advance(1100);
  assert.equal(f.field('[type="password"]').value, "test-secret");
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.at(-1), "form-completed");
});

test("Cloudflare accepts only its reviewed cookie banner before requesting credentials", async (t) => {
  const f = providerFixture(
    t,
    "cloudflare",
    semanticEmail +
      '<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" role="dialog"><div id="onetrust-policy">Cookies</div><button id="onetrust-accept-btn-handler">Accept all</button></div></div>',
    "https://dash.cloudflare.com/login",
  );
  let clicks = 0;
  f.field("#onetrust-accept-btn-handler").onclick = () => {
    clicks++;
    assert.deepEqual(f.signals, []);
    f.field("#onetrust-consent-sdk").remove();
  };
  await f.advance(1200);
  assert.equal(clicks, 1);
  assert.deepEqual(f.signals, ["identifier"]);
});

test("Adobe resumes on a real form with hidden completed challenge markers and stale globals", async (t) => {
  const f = providerFixture(
    t,
    "adobe-admin-console",
    '<div id="challenge-stage" hidden>Completed</div><form id="EmailForm"><input id="EmailPage-EmailField" name="username" type="email"><button type="submit" data-id="EmailPage-ContinueButton">Continue</button></form>',
    "https://auth.services.adobe.com/en_US/index.html#/",
  );
  f.w._cf_chl_opt = { cType: "managed" };
  await f.advance(1200);
  assert.deepEqual(f.signals, ["identifier"]);
});

for (const [name, url, extra, button] of [
  ["other origin", "https://cloudflare.example.test/login", "", "button"],
  ["another route", "https://dash.cloudflare.com/settings", "", "button"],
  [
    "challenge",
    "https://dash.cloudflare.com/login",
    '<div id="challenge-stage">Verify</div>',
    "button",
  ],
  [
    "credential-bearing banner",
    "https://dash.cloudflare.com/login",
    '<input type="password">',
    "button",
  ],
  [
    "foreign form target",
    "https://dash.cloudflare.com/login",
    "",
    'button formtarget="_blank"',
  ],
])
  test(`Cloudflare cookie acceptance refuses ${name}`, async (t) => {
    const f = providerFixture(
      t,
      "cloudflare",
      semanticEmail +
        `<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" role="dialog"><div id="onetrust-policy">Cookies</div><${button} id="onetrust-accept-btn-handler">Accept all</button>${extra}</div></div>`,
      url,
    );
    let clicks = 0;
    f.field("#onetrust-accept-btn-handler").onclick = () => clicks++;
    await f.advance(1500);
    assert.equal(clicks, 0);
    assert.ok(!f.signals.includes("identifier"));
  });

test("Cloudflare cookie acceptance does not retry or bypass a remaining dialog", async (t) => {
  const f = providerFixture(
    t,
    "cloudflare",
    semanticEmail +
      '<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" role="dialog"><div id="onetrust-policy">Cookies</div><button id="onetrust-accept-btn-handler">Accept all</button></div></div>',
    "https://dash.cloudflare.com/login",
  );
  let clicks = 0;
  f.field("#onetrust-accept-btn-handler").onclick = () => clicks++;
  await f.advance(4000);
  assert.equal(clicks, 1);
  assert.deepEqual(f.signals, []);
});

for (const provider of ["chatgpt", "adobe-admin-console", "synology-dsm"]) {
  test(`${provider} requests fresh credentials only after its reviewed SPA transition`, async (t) => {
    const adobe = provider === "adobe-admin-console";
    const synology = provider === "synology-dsm";
    const email = adobe
      ? '<form id="EmailForm"><input id="EmailPage-EmailField" name="username" type="email"><button type="submit" data-id="EmailPage-ContinueButton">Continue</button></form>'
      : synology
        ? '<div id="sds-login-vue-inst"><div class="login-tabs-content-wrapper"><form id="dsm-user-fieldset"><input type="text" syno-id="username" name="username" autocomplete="username"></form><div role="button" syno-id="account-panel-next-btn">Next</div></div></div>'
        : semanticEmail;
    const url = adobe
      ? "https://auth.services.adobe.com/en_US/index.html#/"
      : synology
        ? "https://device.test/webman/index.cgi#/signin"
        : "https://auth.openai.com/log-in";
    const f = providerFixture(t, provider, email, url);
    await f.advance(700);
    assert.deepEqual(f.signals, ["identifier"]);
    f.send("identifier");
    await f.advance(3000);
    f.w.document.body.innerHTML = adobe
      ? '<form id="PasswordForm"><input hidden readonly name="username" autocomplete="username" value="alice@example.test"><input id="PasswordPage-PasswordField" name="password" type="password"><button type="submit" data-id="PasswordPage-ContinueButton">Continue</button></form>'
      : synology
        ? '<div id="sds-login-vue-inst"><div class="login-tabs-content-wrapper"><form id="dsm-pass-fieldset"><input type="password" syno-id="password" name="current-password" autocomplete="current-password"></form><div role="button" syno-id="password-panel-next-btn">Sign in</div></div></div>'
        : semanticPassword;
    f.w.history.replaceState(
      null,
      "",
      adobe
        ? "#/password"
        : synology
          ? "#/signin/password"
          : "/log-in/password",
    );
    let passwordClicks = 0;
    f.field(
      synology ? '[syno-id="password-panel-next-btn"]' : "button",
    ).onclick = () => {
      passwordClicks++;
    };
    await f.advance(700);
    assert.equal(f.signals.at(-1), "password");
    assert.equal(f.send("password"), true);
    await f.advance(700);
    assert.equal(passwordClicks, 1);
    assert.equal(f.signals.at(-1), "form-completed");
  });
}

test("Claude is identifier-only and hands email verification to the person", async (t) => {
  const f = providerFixture(
    t,
    "claude",
    semanticEmail,
    "https://claude.ai/login",
  );
  await f.advance(700);
  assert.equal(f.send("password"), false);
  f.send("identifier");
  await f.advance(700);
  assert.equal(f.submits(), 1);
  assert.deepEqual(f.signals, ["identifier", "form-completed"]);
  assert.equal(f.w.__sorng_claude_login, undefined);
});

test("ChatGPT redirect document requires a native-bound account before password disclosure", async (t) => {
  for (const identity of ["alice@example.test", "other@example.test"]) {
    const f = providerFixture(
      t,
      "chatgpt",
      semanticPassword.replace("alice@example.test", identity),
      "https://auth.openai.com/log-in/password",
    );
    await f.advance(700);
    assert.deepEqual(f.signals, ["bound-password"]);
    assert.equal(f.send("password"), false);
    assert.equal(f.send("bound-password"), true);
    await f.advance(700);
    assert.equal(
      f.field('[type="password"]').value,
      identity === "alice@example.test" ? "test-secret" : "",
    );
    assert.equal(f.submits(), identity === "alice@example.test" ? 1 : 0);
  }
});

test("Cloudflare waits for human Turnstile completion without requesting a secret", async (t) => {
  const f = providerFixture(
    t,
    "cloudflare",
    semanticEmail.replace(
      "</form>",
      '<div class="cf-turnstile"></div><input type="hidden" name="cf-turnstile-response"></form>',
    ),
    "https://dash.cloudflare.com/login",
  );
  await f.advance(3000);
  assert.deepEqual(f.signals, []);
  f.field('[name="cf-turnstile-response"]').value = "fixture-human-completion";
  await f.advance(700);
  assert.deepEqual(f.signals, ["identifier"]);
});

test("Yealink uses only the reviewed keyless phone handler once", async (t) => {
  const html =
    '<div id="loginPhoneModel">Enterprise IP phone SIP-T20P</div><form name="formInput" method="post" autocomplete="off" onsubmit="return false;" action="/servlet?p=login&q=login"><input type="text" name="username"><input type="password" name="pwd"><input type="hidden" name="jumpto" value="status"><input type="hidden" name="acc"><input id="idConfirm" type="button" onclick="OnConfirm()"><input id="idCancel" type="button" onclick="OnClear()"></form>';
  const f = providerFixture(t, "voip-phone", html);
  let clicks = 0;
  f.w.OnConfirm = () => {
    clicks++;
  };
  f.field("#idConfirm").onclick = f.w.OnConfirm;
  f.field("form").onsubmit = () => false;
  await f.advance(700);
  assert.deepEqual(f.signals, ["form"]);
  f.send("form");
  await f.advance(700);
  assert.equal(clicks, 1);
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.at(-1), "form-completed");
});

test("Yealink T21P HTTP form uses its reviewed table header and page handler", async (t) => {
  const html = readFileSync("tests/fixtures/yealink-t21p.html", "utf8");
  const f = providerFixture(
    t,
    "voip-phone",
    html,
    "http://phone.test/servlet?p=login&q=login",
  );
  let clicks = 0;
  f.w.OnConfirm = () => {
    clicks++;
  };
  f.field("#idConfirm").onclick = f.w.OnConfirm;
  f.field("form").onsubmit = () => false;
  await f.advance(700);
  assert.deepEqual(f.signals, ["form"]);
  f.send("form");
  await f.advance(700);
  assert.equal(clicks, 1);
  assert.equal(f.field('[name="username"]').value, "alice@example.test");
  assert.equal(f.field('[name="pwd"]').value, "test-secret");
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.at(-1), "form-completed");
});

for (const [label, mutate] of [
  [
    "unsupported model",
    (f) => {
      f.field("tr td:nth-child(2)").textContent =
        "Enterprise IP phone SIP-T31P";
    },
  ],
  [
    "T20P without its reviewed model id",
    (f) => {
      f.field("tr td:nth-child(2)").textContent =
        "Enterprise IP phone SIP-T20P";
    },
  ],
  [
    "outside-form model",
    (f) => {
      f.w.document.body.append(f.field("tr td:nth-child(2)"));
    },
  ],
  [
    "duplicate header",
    (f) => {
      f.field("form").append(f.field("table").cloneNode(true));
    },
  ],
  [
    "cross-origin action",
    (f) => {
      f.field("form").action = "https://other.invalid/servlet?p=login&q=login";
    },
  ],
  [
    "GET submission",
    (f) => {
      f.field("form").method = "get";
    },
  ],
  [
    "different autocomplete contract",
    (f) => {
      f.field("form").setAttribute("autocomplete", "on");
    },
  ],
  [
    "unsafe hidden destination",
    (f) => {
      f.field('[name="jumpto"]').value = "other";
    },
  ],
]) {
  test(`Yealink T21P rejects ${label} before requesting a native grant`, async (t) => {
    const f = providerFixture(
      t,
      "voip-phone",
      readFileSync("tests/fixtures/yealink-t21p.html", "utf8"),
      "http://phone.test/servlet?p=login&q=login",
    );
    f.w.OnConfirm = () => assert.fail("unsafe form must not submit");
    f.field("#idConfirm").onclick = f.w.OnConfirm;
    f.field("form").onsubmit = () => false;
    mutate(f);
    await f.advance(700);
    assert.equal(f.signals.includes("form"), false);
    assert.equal(f.field('[name="pwd"]').value, "");
    assert.equal(f.submits(), 0);
  });
}

test("Yealink T21P revalidates its header before native credential disclosure", async (t) => {
  const f = providerFixture(
    t,
    "voip-phone",
    readFileSync("tests/fixtures/yealink-t21p.html", "utf8"),
    "http://phone.test/servlet?p=login&q=login",
  );
  let clicks = 0;
  f.w.OnConfirm = () => {
    clicks++;
  };
  f.field("#idConfirm").onclick = f.w.OnConfirm;
  f.field("form").onsubmit = () => false;
  await f.advance(700);
  assert.deepEqual(f.signals, ["form"]);
  const model = f.field("tr td:nth-child(2)");
  model.replaceWith(model.cloneNode(true));
  f.send("form");
  await f.advance(700);
  assert.equal(f.field('[name="username"]').value, "");
  assert.equal(f.field('[name="pwd"]').value, "");
  assert.equal(clicks, 0);
});

for (const change of [
  "redirect",
  "pagehide",
  "action",
  "replacement",
  "captcha",
]) {
  test(`provider cancels ${change} after request, before disclosure`, async (t) => {
    const f = providerFixture(
      t,
      "claude",
      semanticEmail,
      "https://claude.ai/login",
    );
    await f.advance(700);
    if (change === "redirect") f.w.history.replaceState(null, "", "/other");
    if (change === "pagehide") f.w.dispatchEvent(new f.w.Event("pagehide"));
    if (change === "action")
      f.field("form").action = "https://other.test/login";
    if (change === "replacement")
      f.field("input").replaceWith(f.field("input").cloneNode());
    if (change === "captcha")
      f.field("form").insertAdjacentHTML(
        "beforeend",
        '<input autocomplete="one-time-code">',
      );
    f.send("identifier");
    await f.advance(700);
    assert.equal(f.field("input").value, "");
    assert.equal(f.submits(), 0);
    assert.ok(!f.signals.includes("form-completed"));
  });
}

test("provider expiry clears its owned password but preserves a manual replacement", async (t) => {
  for (const manual of [false, true]) {
    const f = providerFixture(
      t,
      "cloudflare",
      semanticEmail.replace(
        "<button",
        '<input type="password" name="password"><button',
      ),
      "https://dash.cloudflare.com/login",
    );
    await f.advance(700);
    f.send("identifier");
    await f.advance(1700);
    f.field("button").disabled = true;
    assert.equal(f.send("password", true, 1000), true);
    await f.advance(200);
    assert.equal(f.field('[type="password"]').value, "test-secret");
    if (manual) f.field('[type="password"]').value = "manual-value";
    await f.advance(1200);
    assert.equal(
      f.field('[type="password"]').value,
      manual ? "manual-value" : "",
    );
    assert.equal(f.submits(), 0);
  }
});

const formOptions = (overrides = {}) => ({
  version: 1,
  fillDelayMs: 3000,
  submitDelayMs: 3000,
  detectionTimeoutMs: 15000,
  submit: true,
  fields: [],
  ...overrides,
});
function deferredFixture(t, url = "https://device.test/login") {
  return nativeFixture(
    t,
    '<form method="post"><input id="username"><input id="password" type="password"><input id="realm"><button id="login" type="submit">Log in</button></form>',
    url,
    { selectors, readiness: { detectionTimeoutMs: 15000 } },
    "modular-form",
  );
}

test("deferred fill and submit get separate fresh grants without extending credential TTL", async (t) => {
  const f = deferredFixture(t);
  await f.advance(100);
  assert.deepEqual(f.signals, ["form-prepare"]);
  assert.equal(f.send("form", true, 2000, formOptions()), false);
  assert.equal(f.send("form-prepare", true, 2000, formOptions()), true);
  await f.advance(2500);
  assert.equal(f.field("#password").value, "");
  assert.deepEqual(f.signals, ["form-prepare"]);
  await f.advance(700);
  assert.equal(f.signals.at(-1), "form");
  const secretOptions = formOptions({
    fields: [{ selector: "#realm", value: "private-realm" }],
  });
  assert.equal(f.send("form", true, 2000, secretOptions), true);
  await f.advance(2500);
  assert.equal(secretOptions.fields[0].value, "");
  assert.equal(f.field("#password").value, "test-secret");
  assert.equal(f.field("#realm").value, "private-realm");
  assert.equal(f.submits(), 0);
  await f.advance(700);
  assert.equal(f.signals.at(-1), "form-submit");
  assert.equal(f.send("form-submit", true, 2000, formOptions()), true);
  await f.advance(100);
  assert.equal(f.submits(), 1);
  assert.equal(f.signals.at(-1), "form-completed");
  assert.equal(f.send("form-submit", true, 2000, formOptions()), false);
});

const delayedProviderCases = [
  [
    "google-account",
    "https://accounts.google.com/v3/signin/identifier",
    '<input id="identifierId" name="identifier" type="email"><button id="identifierNext" type="button">Next</button>',
  ],
  ["bitwarden-self-hosted", "https://vault.test/#/login", bitwardenMarkup],
  [
    "synology-dsm",
    "https://nas.test/#/signin",
    '<div id="sds-login-vue-inst"><div class="login-tabs-content-wrapper"><form id="dsm-user-fieldset"><input type="text" syno-id="username" name="username" autocomplete="username"></form><div role="button" syno-id="account-panel-next-btn">Next</div></div></div>',
  ],
  [
    "adobe-admin-console",
    "https://auth.services.adobe.com/en_US/index.html#/",
    '<form id="EmailForm"><input id="EmailPage-EmailField" name="username" type="email"><button type="submit" data-id="EmailPage-ContinueButton">Continue</button></form>',
  ],
  ["cloudflare", "https://dash.cloudflare.com/login", semanticEmail],
  ["chatgpt", "https://auth.openai.com/log-in", semanticEmail],
  ["claude", "https://claude.ai/login", semanticEmail],
  [
    "voip-phone",
    "https://phone.test/login",
    '<div id="loginPhoneModel">Enterprise IP phone SIP-T20P</div><form name="formInput" method="post" autocomplete="off" onsubmit="return false;" action="/servlet?p=login&q=login"><input type="text" name="username"><input type="password" name="pwd"><input type="hidden" name="jumpto" value="status"><input type="hidden" name="acc"><input id="idConfirm" type="button" onclick="OnConfirm()"><input id="idCancel" type="button" onclick="OnClear()"></form>',
  ],
];
for (const wrapped of [false, true]) {
  test(`Google accepts an implicit-submit Next button (${wrapped ? "wrapped" : "direct"}) through both stages`, async (t) => {
    const next = (id) =>
      wrapped
        ? `<div id="${id}"><button>Next</button></div>`
        : `<button name="action" id="${id}">Next</button>`;
    const f = providerFixture(
      t,
      "google-account",
      `<form method="POST" novalidate><input id="identifierId" name="identifier" type="text" autocomplete="username"><input name="hiddenPassword" type="password" aria-hidden="true" tabindex="-1">${next("identifierNext")}</form>`,
      "https://accounts.google.com/v3/signin/identifier",
    );
    let clicks = 0;
    f.field("button").onclick = (event) => {
      event.preventDefault();
      clicks++;
    };
    await f.advance(700);
    assert.deepEqual(f.signals, ["identifier"]);
    assert.equal(f.send("identifier"), true);
    await f.advance(700);
    assert.equal(f.field("#identifierId").value, "alice@example.test");
    assert.equal(f.field('[name="hiddenPassword"]').value, "");
    assert.equal(clicks, 1);
    f.w.history.replaceState(null, "", "/v3/signin/challenge/pwd");
    f.w.document.body.innerHTML = `<form method="POST"><input name="Passwd" type="password">${next("passwordNext")}</form>`;
    f.field("button").onclick = (event) => {
      event.preventDefault();
      clicks++;
    };
    await f.advance(700);
    assert.equal(f.signals.at(-1), "password");
    assert.equal(f.send("password"), true);
    await f.advance(700);
    assert.equal(f.field('[name="Passwd"]').value, "test-secret");
    assert.equal(clicks, 2);
    assert.equal(f.signals.at(-1), "form-completed");
    assert.equal(f.send("password"), false);
  });
}

for (const [name, form, button] of [
  ["GET", 'method="get"', ""],
  ["external action", 'method="post" action="https://other.test"', ""],
  ["form override", 'method="post"', 'formaction="https://other.test"'],
  ["reset button", 'method="post"', 'type="reset"'],
  ["other target", 'method="post" target="_blank"', ""],
]) {
  test(`Google implicit-button support keeps rejecting ${name}`, async (t) => {
    const f = providerFixture(
      t,
      "google-account",
      `<form ${form}><input id="identifierId" name="identifier" type="text"><button id="identifierNext" ${button}>Next</button></form>`,
      "https://accounts.google.com/v3/signin/identifier",
    );
    await f.advance(1000);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("identifier"), false);
    assert.equal(f.field("input").value, "");
  });
}

for (const [provider, url, html] of delayedProviderCases) {
  test(`${provider} honors >2s minima without cached cleartext while awaiting fresh submit consent`, async (t) => {
    // Assert the actual private packet/record lifetimes at the action request.
    // Instrumentation changes no control flow unless a secret is retained.
    assert.equal(source.split("notify(code);").length, 2);
    const probe = source.replace(
      "notify(code);",
      'if (packet !== null || owned.some(entry => entry.value !== null)) throw new Error("retained-cleartext"); notify(code);',
    );
    const f = nativeFixture(
      t,
      html,
      url,
      { provider, timing: { fillDelayMs: 3000, submitDelayMs: 3000 } },
      undefined,
      probe,
    );
    let clicks = 0;
    const isPhone = provider === "voip-phone";
    const button = f.field(
      isPhone
        ? "#idConfirm"
        : provider === "synology-dsm"
          ? '[syno-id="account-panel-next-btn"]'
          : "button",
    );
    button.onclick = () => {
      clicks++;
    };
    if (isPhone) {
      f.w.OnConfirm = button.onclick;
      f.field("form").onsubmit = () => false;
    }
    const stage = isPhone ? "form" : "identifier";
    const actionStage = isPhone ? "form-submit" : "id-submit";
    await f.advance(2900);
    assert.deepEqual(f.signals, []);
    assert.equal(f.field(isPhone ? '[name="pwd"]' : "input").value, "");
    await f.advance(400);
    assert.deepEqual(f.signals, [stage]);
    assert.equal(f.send(stage), true);
    await f.advance(2600);
    assert.equal(clicks, 0);
    assert.deepEqual(f.signals, [stage]);
    await f.advance(600);
    assert.equal(f.signals.at(-1), actionStage);
    assert.equal(f.send(actionStage, false), false);
    await f.advance(200);
    assert.equal(clicks, 0);
    assert.equal(f.field(isPhone ? '[name="pwd"]' : "input").value, "");
  });
}

const googlePasswordToggle =
  '<input type="checkbox" id="show-password" aria-labelledby="show-password-label"><label id="show-password-label" for="show-password">Show password</label>';
const googlePasswordForm = (toggle = googlePasswordToggle) =>
  `<form method="POST"><input name="Passwd" type="password">${toggle}<button id="passwordNext" type="button">Next</button></form>`;

for (const stage of ["identifier", "password"]) {
  for (const when of ["initially", "during input"]) {
    test(`Google ${stage} can fill with Next disabled ${when} and waits for readiness before clicking`, async (t) => {
      const f = providerFixture(
        t,
        "google-account",
        stage === "password"
          ? googlePasswordForm()
          : '<form method="POST"><input id="identifierId" name="identifier" type="email"><button id="identifierNext" type="button">Next</button></form>',
        `https://accounts.google.com/v3/signin/${stage === "password" ? "challenge/pwd" : "identifier"}`,
      );
      const button = f.field("button");
      const field = f.field(
        stage === "password" ? '[name="Passwd"]' : "#identifierId",
      );
      let clicks = 0;
      button.onclick = () => {
        assert.equal(button.disabled, false);
        clicks++;
      };
      button.disabled = when === "initially";
      field.addEventListener(
        "input",
        () => {
          button.disabled = true;
          f.w.setTimeout(() => {
            button.disabled = false;
          }, 600);
        },
        { once: true },
      );
      await f.advance(700);
      assert.deepEqual(f.signals, [stage]);
      assert.equal(f.send(stage), true);
      await f.advance(500);
      assert.equal(
        field.value,
        stage === "password" ? "test-secret" : "alice@example.test",
      );
      assert.equal(button.disabled, true);
      assert.equal(clicks, 0);
      await f.advance(400);
      assert.equal(clicks, 1);
      assert.equal(f.signals.filter((value) => value === stage).length, 1);
      assert.equal(f.signals.includes("form-rejected"), false);
    });
  }
}

for (const blocking of ["disabled", "aria-disabled", "aria-busy"]) {
  test(`Google password never clicks a persistently ${blocking} Next and clears its expired fill`, async (t) => {
    const f = providerFixture(
      t,
      "google-account",
      googlePasswordForm(),
      "https://accounts.google.com/v3/signin/challenge/pwd",
    );
    const button = f.field("button");
    if (blocking === "disabled") button.disabled = true;
    else button.setAttribute(blocking, "true");
    let clicks = 0;
    button.onclick = () => clicks++;
    await f.advance(700);
    assert.deepEqual(f.signals, ["password"]);
    assert.equal(f.send("password", true, 1000), true);
    await f.advance(700);
    assert.equal(f.field('[name="Passwd"]').value, "test-secret");
    assert.equal(clicks, 0);
    await f.advance(400);
    assert.equal(f.field('[name="Passwd"]').value, "");
    assert.deepEqual(f.signals, ["password", "form-rejected"]);
    assert.equal(clicks, 0);
    button.disabled = false;
    button.removeAttribute(blocking);
    await f.advance(700);
    assert.equal(clicks, 0);
    assert.equal(f.send("password"), false);
  });
}

for (const change of ["replacement", "form-action", "route", "pagehide"]) {
  test(`Google password revalidates ${change} before enabling a previously disabled Next`, async (t) => {
    const f = providerFixture(
      t,
      "google-account",
      googlePasswordForm(),
      "https://accounts.google.com/v3/signin/challenge/pwd",
    );
    const field = f.field('[name="Passwd"]');
    const button = f.field("button");
    button.disabled = true;
    let clicks = 0;
    f.w.document.addEventListener("click", () => clicks++);
    await f.advance(700);
    assert.equal(f.send("password"), true);
    await f.advance(200);
    assert.equal(field.value, "test-secret");
    if (change === "replacement") button.replaceWith(button.cloneNode(true));
    if (change === "form-action")
      f.field("form").action = "https://other.test/";
    if (change === "route")
      f.w.history.replaceState(null, "", "/v3/signin/challenge/otp");
    if (change === "pagehide") f.w.dispatchEvent(new f.w.Event("pagehide"));
    f.field("button").disabled = false;
    await f.advance(700);
    assert.equal(field.value, "");
    assert.equal(clicks, 0);
    assert.deepEqual(f.signals, ["password", "form-rejected"]);
    assert.equal(f.send("password"), false);
  });
}

test("Google disabled Next neither bypasses the origin grant nor upgrades fill-only consent", async (t) => {
  const f = providerFixture(
    t,
    "google-account",
    googlePasswordForm(),
    "https://accounts.google.com/v3/signin/challenge/pwd",
  );
  f.field("button").disabled = true;
  let clicks = 0;
  f.field("button").onclick = () => clicks++;
  await f.advance(700);
  assert.equal(
    f.deliver(
      "https://other.test",
      "",
      "test-secret",
      false,
      f.now() + 2000,
      "password",
    ),
    false,
  );
  assert.equal(f.send("password", false, 0), false);
  assert.equal(f.field('[name="Passwd"]').value, "");
  assert.equal(f.send("password", false), true);
  await f.advance(700);
  assert.equal(f.field('[name="Passwd"]').value, "test-secret");
  assert.deepEqual(f.signals, ["password", "form-completed"]);
  f.field("button").disabled = false;
  await f.advance(700);
  assert.equal(clicks, 0);
});

test("Google password stops after its readiness bound when native never delivers a grant", async (t) => {
  const f = providerFixture(
    t,
    "google-account",
    googlePasswordForm(),
    "https://accounts.google.com/v3/signin/challenge/pwd",
  );
  f.field("button").disabled = true;
  await f.advance(700);
  assert.deepEqual(f.signals, ["password"]);
  await f.advance(60000);
  assert.deepEqual(f.signals, ["password", "form-rejected"]);
  assert.equal(f.send("password"), false);
  assert.equal(f.field('[name="Passwd"]').value, "");
});

test("Google password stage tolerates its unchecked presentation-only visibility checkbox", async (t) => {
  const f = providerFixture(
    t,
    "google-account",
    googlePasswordForm(),
    "https://accounts.google.com/v3/signin/challenge/pwd",
  );
  let clicks = 0;
  f.field("button").onclick = () => clicks++;
  await f.advance(700);
  assert.deepEqual(f.signals, ["password"]);
  assert.equal(f.send("password"), true);
  await f.advance(700);
  assert.equal(f.field('[name="Passwd"]').value, "test-secret");
  assert.equal(f.field('[type="checkbox"]').checked, false);
  assert.equal(clicks, 1);
  assert.equal(f.signals.at(-1), "form-completed");
});

for (const [name, toggle] of [
  [
    "submitted checkbox",
    googlePasswordToggle.replace(
      'type="checkbox"',
      'type="checkbox" name="consent"',
    ),
  ],
  [
    "checked checkbox",
    googlePasswordToggle.replace('type="checkbox"', 'type="checkbox" checked'),
  ],
  [
    "required checkbox",
    googlePasswordToggle.replace('type="checkbox"', 'type="checkbox" required'),
  ],
  [
    "disabled checkbox",
    googlePasswordToggle.replace('type="checkbox"', 'type="checkbox" disabled'),
  ],
  ["unlabelled checkbox", '<input type="checkbox">'],
  ["ambiguous checkboxes", googlePasswordToggle + '<input type="checkbox">'],
  [
    "unrelated label",
    googlePasswordToggle.replace('for="show-password"', 'for="other"'),
  ],
  [
    "changed ARIA association",
    googlePasswordToggle.replace(
      'aria-labelledby="show-password-label"',
      'aria-labelledby="other"',
    ),
  ],
  ["additional text field", googlePasswordToggle + '<input name="account">'],
  [
    "OTP challenge",
    googlePasswordToggle + '<input autocomplete="one-time-code">',
  ],
  ["CAPTCHA challenge", googlePasswordToggle + '<input name="captcha">'],
]) {
  test(`Google password visibility support still rejects ${name}`, async (t) => {
    const f = providerFixture(
      t,
      "google-account",
      googlePasswordForm(toggle),
      "https://accounts.google.com/v3/signin/challenge/pwd",
    );
    await f.advance(700);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("password"), false);
    assert.equal(f.field('[name="Passwd"]').value, "");
  });
}

for (const change of ["checked", "named", "replaced", "label", "form-action"]) {
  test(`Google password visibility ${change} during focus prevents disclosure`, async (t) => {
    const f = providerFixture(
      t,
      "google-account",
      googlePasswordForm(),
      "https://accounts.google.com/v3/signin/challenge/pwd",
    );
    let clicks = 0;
    f.field("button").onclick = () => clicks++;
    await f.advance(700);
    assert.deepEqual(f.signals, ["password"]);
    f.field('[name="Passwd"]').addEventListener(
      "focus",
      () => {
        const toggle = f.field('[type="checkbox"]');
        if (change === "checked") toggle.checked = true;
        if (change === "named") toggle.name = "consent";
        if (change === "replaced") toggle.replaceWith(toggle.cloneNode(true));
        if (change === "label") f.field("label").htmlFor = "other";
        if (change === "form-action")
          f.field("form").action = "https://other.test/";
      },
      { once: true },
    );
    f.send("password");
    await f.advance(700);
    assert.equal(f.field('[name="Passwd"]').value, "");
    assert.equal(clicks, 0);
    assert.equal(f.signals.at(-1), "form-rejected");
  });
}

test("Google password stage honors delayed consent and submits once without retaining a password", async (t) => {
  const f = nativeFixture(
    t,
    '<input name="Passwd" type="password"><button id="passwordNext" type="button">Next</button>',
    "https://accounts.google.com/v3/signin/challenge/pwd",
    {
      provider: "google-account",
      timing: { fillDelayMs: 3000, submitDelayMs: 3000 },
    },
  );
  let clicks = 0;
  f.field("button").onclick = () => {
    clicks++;
  };
  await f.advance(3300);
  assert.deepEqual(f.signals, ["password"]);
  f.send("password");
  await f.advance(3300);
  assert.equal(f.signals.at(-1), "pw-submit");
  assert.equal(f.send("pw-submit"), true);
  await f.advance(200);
  assert.equal(clicks, 1);
  assert.equal(f.send("pw-submit"), false);
});

test("ordinary SPA can enable its submit button after the credential TTL without caching secrets", async (t) => {
  const f = deferredFixture(t);
  const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 0 });
  f.field("#login").disabled = true;
  f.field("#password").addEventListener("input", () => {
    f.w.setTimeout(() => {
      f.field("#login").disabled = false;
    }, 3500);
  });
  await f.advance(100);
  assert.deepEqual(f.signals, ["form-prepare"]);
  f.send("form-prepare", true, 2000, options());
  await f.advance(100);
  assert.equal(f.signals.at(-1), "form");
  f.send("form", true, 2000, options());
  await f.advance(2500);
  assert.equal(f.field("#password").value, "test-secret");
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.at(-1), "form");
  await f.advance(1200);
  assert.equal(f.signals.at(-1), "form-submit");
  f.send("form-submit", true, 2000, options());
  await f.advance(100);
  assert.equal(f.submits(), 1);
});

for (const submit of [false, true]) {
  test(`HTTP deferred login completes without SubtleCrypto (submit ${submit})`, async (t) => {
    const f = deferredFixture(t, "http://device.test:8080/login");
    assert.equal(f.w.crypto.subtle, undefined);
    const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 3000 });
    await f.advance(100);
    assert.equal(f.send("form-prepare", submit, 2000, options()), true);
    await f.advance(100);
    assert.equal(f.send("form", submit, 2000, options()), true);
    await f.advance(3200);
    assert.equal(f.field("#username").value, "alice@example.test");
    assert.equal(f.field("#password").value, "test-secret");
    assert.equal(f.submits(), 0);
    if (submit) {
      assert.equal(f.signals.at(-1), "form-submit");
      assert.equal(f.send("form-submit", true, 2000, options()), true);
      await f.advance(100);
    }
    assert.equal(f.submits(), Number(submit));
    assert.equal(f.signals.at(-1), "form-completed");
  });
}

for (const change of [
  "manual-edit",
  "action",
  "navigation",
  "expiry",
  "pagehide",
]) {
  test(`HTTP deferred receipt cancels on ${change} without SubtleCrypto`, async (t) => {
    const f = deferredFixture(t, "http://device.test:8080/login");
    const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 3000 });
    await f.advance(100);
    f.send("form-prepare", true, 2000, options());
    await f.advance(100);
    f.send("form", true, 2000, options());
    await f.advance(100);
    assert.equal(f.field("#password").value, "test-secret");
    if (change === "manual-edit") f.field("#password").value = "manual-value";
    if (change === "action")
      f.field("form").action = "http://device.test:8081/login";
    if (change === "navigation") f.navigate("https://device.test:8080/login");
    if (change === "pagehide") f.w.dispatchEvent(new f.w.Event("pagehide"));
    await f.advance(change === "expiry" ? 16000 : 3200);
    assert.equal(f.send("form-submit", true, 2000, options()), false);
    assert.equal(
      f.field("#password").value,
      change === "manual-edit" ? "manual-value" : "",
    );
    assert.equal(f.submits(), 0);
    assert.equal(f.signals.at(-1), "form-rejected");
  });
}

for (const origin of [
  "http://other.test:8080",
  "https://device.test:8080",
  "http://device.test:8081",
  "http://device.test",
]) {
  test(`HTTP deferred stages require exact origin ${origin}`, async (t) => {
    const f = deferredFixture(t, "http://device.test:8080/login");
    const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 0 });
    for (const stage of ["form-prepare", "form", "form-submit"]) {
      await f.advance(200);
      assert.equal(f.signals.at(-1), stage);
      assert.equal(
        f.deliver(
          origin,
          stage === "form" ? "alice" : "",
          stage === "form" ? "secret" : "",
          true,
          f.now() + 2000,
          options(),
          stage,
        ),
        false,
      );
      assert.equal(f.send(stage, true, 2000, options()), true);
    }
    await f.advance(100);
    assert.equal(f.submits(), 1);
  });
}

for (const edited of [false, true]) {
  test(`HTTP Bitwarden custom port checks identity receipts without SubtleCrypto (edited ${edited})`, async (t) => {
    const f = providerFixture(
      t,
      "bitwarden-self-hosted",
      bitwardenMarkup,
      "http://device.test:8080/login",
    );
    assert.equal(f.w.crypto.subtle, undefined);
    f.field('[data-testid="login-continue-button"]').onclick = () => {
      f.field("#email").hidden = true;
      f.field("#masterPassword").hidden = false;
      f.field('[data-testid="login-continue-button"]').hidden = true;
      f.field('[data-testid="login-submit-button"]').hidden = false;
    };
    await f.advance(600);
    assert.equal(f.signals.at(-1), "identifier");
    assert.equal(f.send("identifier"), true);
    await f.advance(1200);
    assert.equal(f.signals.at(-1), "password");
    if (edited) f.field("#email").value = "manual-user@example.test";
    assert.equal(f.send("password"), true);
    await f.advance(600);
    assert.equal(f.field("#masterPassword").value, edited ? "" : "test-secret");
    assert.equal(f.submits(), Number(!edited));
    assert.equal(f.signals.at(-1), edited ? "form-rejected" : "form-completed");
  });
}

for (const [provider, url, markup] of delayedProviderCases.filter(
  ([provider]) =>
    [
      "google-account",
      "cloudflare",
      "adobe-admin-console",
      "chatgpt",
      "claude",
    ].includes(provider),
)) {
  for (const changedUrl of [
    url.replace("https:", "http:"),
    url.replace(new URL(url).host, `${new URL(url).host}:8443`),
  ]) {
    test(`${provider} keeps its fixed HTTPS origin: rejects ${changedUrl}`, async (t) => {
      const html = markup.includes("<form")
        ? markup
        : `<form method="post">${markup}</form>`;
      const f = providerFixture(t, provider, html, changedUrl);
      await f.advance(1000);
      assert.ok(!f.signals.includes("identifier"));
      assert.equal(f.send("identifier"), false);
      assert.equal(f.submits(), 0);
      assert.ok(
        [...f.w.document.querySelectorAll('input:not([type="hidden"])')].every(
          (field) => !field.value,
        ),
      );
    });
  }
}

test("native provider refuses same-origin child frames", async (t) => {
  const f = providerFixture(
    t,
    "claude",
    "<iframe></iframe>",
    "https://claude.ai/login",
  );
  const child = f.field("iframe").contentWindow;
  child.document.body.innerHTML = semanticEmail;
  const signals = [];
  const deliver = child.eval(source)((value) => signals.push(value), {
    provider: "claude",
  });
  assert.equal(
    deliver(
      "https://claude.ai",
      "alice@example.test",
      "",
      true,
      Date.now() + 2000,
      "identifier",
    ),
    false,
  );
  assert.equal(child.document.querySelector("input").value, "");
  assert.deepEqual(signals, []);
});

test("cPanel waits for its page/controls before obtaining credentials and drops values before deferred submission", async (t) => {
  const probe = source.replace(
    'phase = phase === "waiting-fill" ? "form" : "form-submit";',
    'phase = phase === "waiting-fill" ? "form" : "form-submit"; if (phase === "form-submit" && records.some(entry => entry.value !== null)) throw new Error("retained-cleartext");',
  );
  const f = nativeFixture(
    t,
    '<form method="post"><input id="username"><input id="password" type="password"><button id="login" type="submit">Log in</button></form>',
    "https://device.test/login",
    {
      selectors,
      readiness: { detectionTimeoutMs: 15000 },
      readinessProfile: "cpanel",
    },
    "modular-form",
    probe,
  );
  f.field("form").onsubmit = () => false;
  await f.advance(100);
  const options = () => formOptions({ fillDelayMs: 0 });
  assert.equal(f.send("form-prepare", true, 2000, options()), true);
  await f.advance(2500);
  assert.deepEqual(f.signals, ["form-prepare"]);
  await f.advance(1000);
  assert.equal(f.signals.at(-1), "form");
  assert.equal(f.send("form", true, 2000, options()), true);
  await f.advance(3500);
  assert.equal(f.signals.at(-1), "form-submit");
  assert.equal(f.submits(), 0);
  f.send("form-submit", false, 2000, options());
  await f.advance(100);
  assert.equal(f.field("#password").value, "");
});

for (const change of [
  "pagehide",
  "redirect",
  "action",
  "manual",
  "revoked",
  "expiry",
]) {
  test(`deferred action ${change} cancels without replay or stale cleartext`, async (t) => {
    const f = deferredFixture(t);
    const options = () => formOptions({ fillDelayMs: 0 });
    await f.advance(100);
    f.send("form-prepare", true, 2000, options());
    await f.advance(100);
    assert.equal(f.send("form", true, 2000, options()), true);
    await f.advance(100);
    assert.equal(f.field("#password").value, "test-secret");
    if (change === "pagehide") f.w.dispatchEvent(new f.w.Event("pagehide"));
    if (change === "redirect") f.w.history.replaceState(null, "", "/elsewhere");
    if (change === "action")
      f.field("form").action = "https://other.test/login";
    if (change === "manual") f.field("#password").value = "manual-value";
    await f.advance(3500);
    if (change === "revoked") f.send("form-submit", false, 2000, options());
    if (change === "expiry") await f.advance(15000);
    await f.advance(100);
    assert.equal(f.submits(), 0);
    assert.equal(
      f.field("#password").value,
      change === "manual" ? "manual-value" : "",
    );
  });
}

// ---------------------------------------------------------------------------
// K5 page half: budgets, timer independence, cancellation and concurrency.
// The production assembly (keyboard helper included) runs against a MODEL of
// the native host on one virtual clock shared by every document of a test.
// Page timers can be throttled; the host's own delays never are. A model is
// not evidence of live CEF input.
// ---------------------------------------------------------------------------
const production = source.replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
  readFileSync(resolve(base, "native_login_typing.js"), "utf8"),
);
// Trusted keys reached a hidden native view every 35-38 ms (t101-e1r).
const KEY_MS = 36;
const plainLogin =
  '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>';
const savedOptions = () => ({
  version: 1,
  fillDelayMs: 0,
  submitDelayMs: 0,
  detectionTimeoutMs: 8000,
  submit: true,
  fields: [],
});

function virtualClock() {
  let now = 1_000_000,
    nextId = 0,
    frozen = false;
  const jobs = new Map(),
    digests = new Set();
  const due = (from, ms, throttle) => {
    const at = from + Math.max(1, ms || 0);
    return throttle ? Math.ceil(at / throttle) * throttle : at;
  };
  const schedule = (callback, ms, interval, throttle, page) => {
    const id = ++nextId;
    const at = due(now, ms, throttle);
    jobs.set(id, { callback, at, interval, throttle, page });
    return id;
  };
  // Every microtask runs before the next turn; real WebCrypto needs more turns.
  async function settle() {
    for (;;) {
      await new Promise((done) => setImmediate(done));
      if (!digests.size) return;
      await Promise.all([...digests]);
    }
  }
  return {
    now: () => now,
    digests,
    // The host is another process: nothing throttles its delays.
    host: (callback, ms) => schedule(callback, ms, 0, 0, false),
    page: (throttle) => ({
      setTimeout: (callback, ms) => schedule(callback, ms, 0, throttle, true),
      setInterval: (callback, ms) =>
        schedule(callback, ms, Math.max(1, ms || 0), throttle, true),
      clear: (id) => jobs.delete(id),
    }),
    // From here on no page timer or interval ever fires again.
    freezePageTimers() {
      frozen = true;
    },
    // Page timers and intervals that are still scheduled.
    pagePending: () => [...jobs.values()].filter((job) => job.page).length,
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 100000; count++) {
        let next = null;
        for (const entry of jobs)
          if (
            !(frozen && entry[1].page) &&
            entry[1].at <= end &&
            (!next || entry[1].at < next[1].at)
          )
            next = entry;
        if (!next) break;
        const [id, job] = next;
        now = Math.max(now, job.at);
        if (job.interval) job.at = due(job.at, job.interval, job.throttle);
        else jobs.delete(id);
        job.callback();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

// One release per stage for the attempt; a release whose typing stopped before
// its first key is re-armed once (LoginBudget in native_features.rs).
const hostBudget = () => ({
  released: new Set(),
  typed: false,
  rearmed: false,
});

function loginDocument(t, clock, options = {}) {
  const url = options.url ?? "https://device.test/login";
  const origin = new URL(url).origin;
  const dom = new JSDOM(options.html ?? plainLogin, {
    url,
    runScripts: "outside-only",
  });
  const w = dom.window,
    doc = w.document;
  const timers = clock.page(options.throttleMs ?? 0);
  w.setTimeout = timers.setTimeout;
  w.setInterval = timers.setInterval;
  w.clearTimeout = w.clearInterval = timers.clear;
  w.Date.now = clock.now;
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w, "crypto", {
    value: {
      getRandomValues: (array) => webcrypto.getRandomValues(array),
      subtle: {
        async digest(...args) {
          const pending = webcrypto.subtle.digest(...args);
          clock.digests.add(pending);
          try {
            return await pending;
          } finally {
            clock.digests.delete(pending);
          }
        },
      },
    },
  });
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  w.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 100, height: 20 }] : [];
  };
  // The main document is still loading until the host reports load end.
  let readyState = options.loadAt === undefined ? "complete" : "interactive";
  Object.defineProperty(doc, "readyState", {
    configurable: true,
    get: () => readyState,
  });
  const listeners = new Map(),
    add = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...rest) => {
    if (["keydown", "beforeinput", "input", "keyup"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return add(type, callback, ...rest);
  };
  let submits = 0,
    closed = false,
    deliver;
  doc.addEventListener("submit", (event) => {
    event.preventDefault();
    submits++;
  });
  const values = options.values ?? {
    username: "operator-account",
    password: "pA55@word-16char",
  };
  const element = options.element ?? ((field) => doc.getElementById(field));
  const budget = options.budget ?? hostBudget();
  const host = {
    loaded: options.loadAt === undefined,
    // A manual-input slot owns the keyboard: a start waits, a key is held.
    manual: false,
    used: new Set(),
    pending: null,
    keys: [],
    deliveries: [],
  };
  const fire = (type, event) => {
    for (const callback of listeners.get(type) ?? []) callback(event);
  };
  const trusted = (input, unit, inputType) => ({
    target: input,
    isTrusted: true,
    key: unit,
    data: unit,
    inputType,
    preventDefault() {
      this.prevented = true;
    },
  });
  // Only this model writes characters; production sends CEF key events.
  function press(field, unit) {
    const input = element(field),
      event = trusted(input, unit, "insertText");
    fire("keydown", event);
    if (!event.prevented) fire("beforeinput", event);
    if (event.prevented) return false;
    input.value += unit;
    // An email field has no selection API.
    if (input.selectionStart !== null)
      input.setSelectionRange(input.value.length, input.value.length);
    fire("input", event);
    fire("keyup", event);
    return true;
  }
  // A person replaces the field's content without any key event.
  function paste(field, text) {
    const input = element(field);
    input.value = text;
    fire("input", trusted(input, text, "insertFromPaste"));
  }
  function stopped() {
    if (budget.typed || budget.rearmed || budget.released.has("form-submit"))
      return;
    budget.rearmed = true;
    for (const stage of ["form-prepare", "form", "identifier", "password"])
      budget.released.delete(stage);
  }
  function stage(name) {
    if (closed || budget.released.has(name)) return;
    const previous = { form: "form-prepare", "form-submit": "form" }[name];
    if (previous && !budget.released.has(previous)) return;
    budget.released.add(name);
    const username = ["form", "identifier"].includes(name)
      ? values.username
      : "";
    const password = ["form", "password"].includes(name) ? values.password : "";
    // As native: 30 s for a credential stage, 2 s for a metadata or action one.
    const deadline = clock.now() + (username || password ? 30000 : 2000);
    host.deliveries.push([
      name,
      options.provider
        ? deliver(origin, username, password, true, deadline, name)
        : deliver(
            origin,
            username,
            password,
            true,
            deadline,
            { ...savedOptions(), ...options.saved },
            name,
          ),
    ]);
  }
  function typing(event) {
    const [, action, stageName, field, index] = event.split("|");
    const role = `type|${stageName}|${field}`;
    const reply = (command, value = 0, deadline = 0) =>
      deliver.nativeTyping(command, value, deadline, false, role);
    // As native: a start waits for manual entry or load end without spending
    // anything, and before load end nothing else is recorded either.
    if (action === "start" && host.manual) return reply("wait", 200);
    if (!host.loaded)
      return reply(...(action === "start" ? ["wait", 200] : ["cancel"]));
    if (action === "cancel") {
      host.pending = null;
      stopped();
      return reply("cancel");
    }
    if (action === "start") {
      if (host.pending || host.used.has(role) || options.refuseStart?.(role)) {
        host.pending = null;
        stopped();
        return reply("cancel");
      }
      host.used.add(role);
      host.pending = {
        role,
        field,
        next: 0,
        readyAt: clock.now(),
        deadline: clock.now() + 30000,
      };
      return reply("probe", 0, host.pending.deadline);
    }
    const pending = host.pending;
    if (!pending || pending.role !== role || pending.next !== Number(index)) {
      host.pending = null;
      stopped();
      return reply("cancel");
    }
    const send = () => {
      if (closed || host.pending !== pending) return;
      if (host.manual) return void clock.host(send, 200);
      if (options.cancelKey?.(field, pending.next)) {
        host.pending = null;
        stopped();
        return void reply("cancel");
      }
      if (!press(field, values[field][pending.next])) return;
      budget.typed = true;
      host.keys.push([field, pending.next]);
      pending.next += 1;
      pending.readyAt = clock.now() + KEY_MS;
      if (pending.next === values[field].length) host.pending = null;
      reply("probe", pending.next, pending.deadline);
    };
    clock.host(send, Math.max(0, pending.readyAt - clock.now()));
  }
  const signals = [];
  const signal = (event) => {
    signals.push(event);
    if (event === "form-completed" || event === "form-rejected") return;
    clock.host(() => {
      if (closed) return;
      if (event.startsWith("type|")) return typing(event);
      // Held under manual entry and run again, or abandoned without a reply.
      const hold = options.holdStage?.[event];
      if (hold === Infinity) return;
      if (hold) clock.host(() => stage(event), hold);
      else stage(event);
    }, 1);
  };
  function load() {
    readyState = "complete";
    host.loaded = true;
    doc.dispatchEvent(new w.Event("readystatechange"));
    w.dispatchEvent(new w.Event("load"));
  }
  if (options.loadAt !== undefined) clock.host(load, options.loadAt);
  options.beforeInstall?.(w);
  deliver = w.eval(production)(
    signal,
    options.provider
      ? { provider: options.provider }
      : {
          selectors: options.selectors ?? selectors,
          readiness: { detectionTimeoutMs: 8000 },
          ...(options.readinessProfile
            ? { readinessProfile: options.readinessProfile }
            : {}),
        },
    options.provider ?? "modular-form",
    true,
  );
  t.after(() => {
    closed = true;
    w.dispatchEvent(new w.Event("pagehide"));
    w.close();
  });
  return {
    w,
    doc,
    origin,
    clock,
    signals,
    host,
    values,
    deliver,
    press,
    paste,
    load,
    // `document.open()`: interactive again until the next load end.
    reopen() {
      readyState = "interactive";
    },
    field: element,
    submits: () => submits,
  };
}

async function loggedIn(f, within) {
  await f.clock.advance(within);
  assert.equal(f.signals.at(-1), "form-completed", JSON.stringify(f.signals));
  assert.equal(f.submits(), 1);
  assert.equal(f.field("username").value, f.values.username);
  assert.equal(f.field("password").value, f.values.password);
  assert.equal(
    f.host.keys.length,
    f.values.username.length + f.values.password.length,
  );
  for (const stage of ["form-prepare", "form", "form-submit"])
    assert.equal(f.signals.filter((value) => value === stage).length, 1);
  assert.equal(
    f.signals.some((value) =>
      [f.values.username, f.values.password].some((secret) =>
        value.includes(secret),
      ),
    ),
    false,
  );
}

for (const [label, readinessProfile] of [
  ["a plain form", undefined],
  ["a cPanel form", "cpanel"],
]) {
  test(`with page timers at 1 Hz a 16+16 character login completes on ${label}`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, { throttleMs: 1000, readinessProfile });
    assert.equal(f.values.username.length, 16);
    assert.equal(f.values.password.length, 16);
    if (readinessProfile) f.doc.querySelector("form").onsubmit = () => false;
    await loggedIn(f, 20000);
  });
}

test("a main document whose load ends at 7 s is still typed into and submitted", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { loadAt: 7000 });
  await loggedIn(f, 10000);
});

test("once the form is found, a login completes with every page timer frozen", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock);
  // The first notification needs one task: the renderer registers the
  // document record only after the factory has returned.
  await clock.advance(1);
  assert.deepEqual(f.signals, ["form-prepare"]);
  clock.freezePageTimers();
  await loggedIn(f, 3000);
});

test("nothing is requested from the host before load end, and load end itself starts the requests", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { loadAt: 7000 });
  await clock.advance(6900);
  // The wait is spent before any release is used or any credential delivered.
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.host.deliveries, []);
  clock.freezePageTimers();
  await loggedIn(f, 3000);
});

test("an attempt the user ended while the document was loading asks for nothing when load ends", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { loadAt: 2000 });
  await clock.advance(1000);
  assert.deepEqual(f.signals, []);
  f.press("username", "x");
  assert.deepEqual(f.signals, ["form-rejected"]);
  await clock.advance(5000);
  assert.deepEqual(f.signals, ["form-rejected"]);
  assert.deepEqual(f.host.deliveries, []);
  assert.equal(f.field("username").value, "x");
});

test("a document replaced while it loads uses no release, so its successor logs in", async (t) => {
  const clock = virtualClock();
  const budget = hostBudget();
  const first = loginDocument(t, clock, { budget, loadAt: Infinity });
  await clock.advance(3000);
  first.w.dispatchEvent(new first.w.Event("pagehide"));
  await clock.advance(100);
  assert.deepEqual(first.host.deliveries, []);
  assert.deepEqual(first.host.keys, []);
  const second = loginDocument(t, clock, { budget });
  await loggedIn(second, 5000);
});

test("three documents whose loads end one after another log in concurrently with their own credentials", async (t) => {
  const clock = virtualClock();
  const tabs = [2500, 5000, 7500].map((loadAt, index) =>
    loginDocument(t, clock, {
      loadAt,
      url: `https://device${index}.test/login`,
      values: {
        username: `tab${index}-operator-id`,
        password: `pw${index}-S3cret-chars`,
      },
    }),
  );
  for (const f of tabs) {
    assert.equal(f.values.username.length, 16);
    assert.equal(f.values.password.length, 16);
  }
  await clock.advance(12000);
  for (const f of tabs) {
    await loggedIn(f, 0);
    // Nothing is shared: no other document's value or key reached this one.
    for (const other of tabs.filter((tab) => tab !== f)) {
      assert.notEqual(f.field("username").value, other.values.username);
      assert.notEqual(f.field("password").value, other.values.password);
    }
    assert.deepEqual(f.host.deliveries, [
      ["form-prepare", true],
      ["form", true],
      ["form-submit", true],
    ]);
  }
});

test("a key the host holds for 10 s under manual entry is resumed, not timed out", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock);
  await clock.advance(300);
  const typed = f.host.keys.length;
  assert.ok(typed > 0 && typed < 16, String(typed));
  f.host.manual = true;
  await clock.advance(10000);
  assert.equal(f.host.keys.length, typed);
  assert.equal(f.signals.includes("form-rejected"), false);
  f.host.manual = false;
  await loggedIn(f, 3000);
});

test("a stage request the host held for 20 s is still accepted when it is delivered", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { holdStage: { form: 20000 } });
  await clock.advance(19000);
  assert.deepEqual(f.signals, ["form-prepare", "form"]);
  await loggedIn(f, 4000);
});

test("a credential that arrives after a held request keeps its whole validity for typing", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { holdStage: { form: 20000 } });
  await clock.advance(20300);
  const typed = f.host.keys.length;
  assert.ok(typed > 0 && typed < 16, String(typed));
  // 36 s after the request, 16 s after the credential was delivered.
  f.host.manual = true;
  await clock.advance(16000);
  assert.equal(f.signals.includes("form-rejected"), false);
  f.host.manual = false;
  await loggedIn(f, 3000);
});

test("a stage request the host abandons ends the attempt at its own bound without typing", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { holdStage: { form: Infinity } });
  await clock.advance(34000);
  assert.deepEqual(f.signals, ["form-prepare", "form"]);
  await clock.advance(2000);
  assert.deepEqual(f.signals, ["form-prepare", "form", "form-rejected"]);
  assert.equal(
    f.deliver(
      f.origin,
      f.values.username,
      f.values.password,
      true,
      clock.now() + 30000,
      savedOptions(),
      "form",
    ),
    false,
  );
  await clock.advance(1000);
  assert.deepEqual(f.host.keys, []);
  assert.equal(f.field("username").value, "");
  assert.equal(f.submits(), 0);
});

test("a host cancel in the middle of the password erases everything typed and nothing is requested again", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    cancelKey: (field, index) => field === "password" && index === 5,
  });
  await clock.advance(5000);
  assert.equal(f.host.keys.length, 16 + 5);
  assert.equal(f.signals.at(-1), "form-rejected", JSON.stringify(f.signals));
  assert.equal(f.field("username").value, "");
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
  const seen = f.signals.length;
  await clock.advance(60000);
  assert.equal(f.signals.length, seen);
  assert.equal(f.signals.includes("form-submit"), false);
  assert.equal(
    f.signals.filter((value) => value.startsWith("type|start|")).length,
    2,
  );
  assert.equal(
    f.deliver(
      f.origin,
      "",
      "",
      true,
      clock.now() + 2000,
      savedOptions(),
      "form-submit",
    ),
    false,
  );
  assert.equal(f.submits(), 0);
});

test("a staged provider erases a partly typed identifier when the host cancels", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    provider: "claude",
    url: "https://claude.ai/login",
    html: semanticEmail,
    values: { username: "alice@example.test", password: "" },
    element: () => f.doc.querySelector('input[type="email"]'),
    cancelKey: (field, index) => index === 5,
  });
  await clock.advance(5000);
  assert.equal(f.host.keys.length, 5);
  assert.equal(f.signals.at(-1), "form-rejected", JSON.stringify(f.signals));
  assert.equal(f.field("username").value, "");
  assert.equal(f.submits(), 0);
});

test("with page timers at 1 Hz a staged provider still types and submits", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    throttleMs: 1000,
    provider: "claude",
    url: "https://claude.ai/login",
    html: semanticEmail,
    values: { username: "alice@example.test", password: "" },
    element: () => f.doc.querySelector('input[type="email"]'),
  });
  await clock.advance(10000);
  assert.deepEqual(
    f.signals.filter((value) => !value.startsWith("type|")),
    ["identifier", "form-completed"],
  );
  assert.equal(f.field("username").value, f.values.username);
  assert.equal(f.host.keys.length, f.values.username.length);
  assert.equal(f.submits(), 1);
});

test("a value the user put in the field is never erased, even when it is a prefix of the saved credential", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock);
  for (let i = 0; i < 50 && f.host.keys.length < 4; i++)
    await clock.advance(20);
  assert.ok(f.host.keys.length >= 4 && f.host.keys.length < 16);
  f.host.manual = true;
  await clock.advance(200);
  const prefix = f.values.username.slice(0, 2);
  f.paste("username", prefix);
  await clock.advance(1000);
  assert.equal(f.signals.at(-1), "form-rejected", JSON.stringify(f.signals));
  assert.equal(f.field("username").value, prefix);
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

test("typing the host stops before its first key is reported, and only the next document logs in again", async (t) => {
  const clock = virtualClock();
  const budget = hostBudget();
  let refuse = true;
  const first = loginDocument(t, clock, { budget, refuseStart: () => refuse });
  await clock.advance(1000);
  assert.deepEqual(first.signals, [
    "form-prepare",
    "form",
    "type|start|form|username|0",
    "type|cancel|form|username|0",
    "form-rejected",
  ]);
  assert.equal(budget.rearmed, true);
  // The same document asks for nothing more, so nothing can be typed twice.
  await clock.advance(60000);
  assert.equal(first.signals.length, 5);
  assert.deepEqual(first.host.keys, []);
  assert.equal(first.field("username").value, "");
  assert.equal(first.submits(), 0);
  refuse = false;
  const second = loginDocument(t, clock, { budget });
  await loggedIn(second, 5000);
  // Re-armed once: a third document of this attempt is given nothing.
  const third = loginDocument(t, clock, { budget });
  await clock.advance(40000);
  assert.deepEqual(third.signals, ["form-prepare", "form-rejected"]);
  assert.deepEqual(third.host.keys, []);
  assert.equal(third.submits(), 0);
});

test("a staged provider asks for credentials only after the main document has loaded", async (t) => {
  const f = providerFixture(
    t,
    "claude",
    semanticEmail,
    "https://claude.ai/login",
  );
  let readyState = "interactive";
  Object.defineProperty(f.w.document, "readyState", {
    configurable: true,
    get: () => readyState,
  });
  await f.advance(3000);
  assert.deepEqual(f.signals, []);
  readyState = "complete";
  f.w.dispatchEvent(new f.w.Event("load"));
  await f.advance(700);
  assert.deepEqual(f.signals, ["identifier"]);
});

test("a provider credential delivered just before the 60 s detection limit keeps its own validity", async (t) => {
  const f = providerFixture(t, "claude", "", "https://claude.ai/login");
  await f.advance(59300);
  f.w.document.body.innerHTML = semanticEmail;
  await f.advance(600);
  assert.deepEqual(f.signals, ["identifier"]);
  assert.equal(f.send("identifier", true, 30000), true);
  await f.advance(1000);
  assert.equal(f.submits(), 1);
  assert.deepEqual(f.signals, ["identifier", "form-completed"]);
});

// Finding 2.2 "Enter-key submit": a login without a submit control.
const buttonless = { username: "#username", password: "#password" };
async function fillButtonless(t, html) {
  const f = nativeFixture(
    t,
    html,
    "https://device.test/login",
    { selectors: buttonless, readiness: { detectionTimeoutMs: 15000 } },
    "modular-form",
  );
  const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 0 });
  for (const stage of ["form-prepare", "form", "form-submit"]) {
    await f.advance(200);
    assert.equal(f.signals.at(-1), stage);
    assert.equal(f.send(stage, true, 2000, options()), true);
  }
  await f.advance(100);
  assert.equal(f.field("#password").value, "test-secret");
  assert.equal(f.signals.at(-1), "form-completed");
  return f;
}

test("a form without a submit control is submitted through the form itself, once", async (t) => {
  const f = await fillButtonless(
    t,
    '<form method="post" action="/login"><input id="username"><input id="password" type="password"></form>',
  );
  assert.equal(f.submits(), 1);
});

for (const prevented of [false, true]) {
  test(`a login without a form or button gets one Enter key sequence on the password field (keydown prevented: ${prevented})`, async (t) => {
    const keys = [];
    const f = nativeFixture(
      t,
      '<div><input id="username"><input id="password" type="password"></div>',
      "https://device.test/login",
      { selectors: buttonless, readiness: { detectionTimeoutMs: 15000 } },
      "modular-form",
    );
    for (const type of ["keydown", "keypress", "keyup"])
      f.field("#password").addEventListener(type, (event) => {
        keys.push([type, event.key, event.keyCode, event.charCode]);
        if (prevented && type === "keydown") event.preventDefault();
      });
    const options = () => formOptions({ fillDelayMs: 0, submitDelayMs: 0 });
    for (const stage of ["form-prepare", "form", "form-submit"]) {
      await f.advance(200);
      assert.equal(f.signals.at(-1), stage);
      assert.equal(f.send(stage, true, 2000, options()), true);
    }
    await f.advance(100);
    assert.equal(f.signals.at(-1), "form-completed");
    // As a real Enter: a prevented keydown produces no keypress.
    assert.deepEqual(
      keys,
      prevented
        ? [
            ["keydown", "Enter", 13, 0],
            ["keyup", "Enter", 13, 0],
          ]
        : [
            ["keydown", "Enter", 13, 0],
            ["keypress", "Enter", 13, 13],
            ["keyup", "Enter", 13, 0],
          ],
    );
    assert.equal(f.submits(), 0);
  });
}

// ---------------------------------------------------------------------------
// The address an attempt is bound to. A single-page application opened at its
// root routes itself to its login view inside the same document before it
// renders the form (Portainer: "/" becomes "/#!/auth"). Until the form is
// found that only moves the address the attempt will be bound to; from then on
// any change of address ends the attempt.
// ---------------------------------------------------------------------------
const ROOT = "https://device.test/";
const shell = '<div id="view">Loading...</div>';
// As such applications render it: a form with neither action nor method.
const routedLogin =
  '<form><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>';
// The page's own script, on the same clock as everything else.
const pageAt = (f, ms, task) => f.clock.host(task, ms);
const render = (f) => {
  f.doc.getElementById("view").innerHTML = routedLogin;
};
const routes = {
  hash: (f, to = "#!/auth") => {
    f.w.location.hash = to;
  },
  history: (f, to = "/login") => f.w.history.pushState(null, "", to),
};
const stages = (f) => f.signals.filter((value) => !value.startsWith("type|"));

for (const kind of ["hash", "history"]) {
  test(`a page opened at its root that routes itself to its login view (${kind}) before it renders the form is signed in`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, { url: ROOT, html: shell });
    pageAt(f, 30, () => routes[kind](f));
    pageAt(f, 200, () => render(f));
    await clock.advance(190);
    assert.notEqual(f.w.location.href, ROOT);
    // Nothing is asked of the host while the page is still routing.
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.host.deliveries, []);
    await loggedIn(f, 3000);
  });
}

test("events that arrive late, for a route change made before the form was found, do not end the attempt", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 1000 });
  // The address changes at once; its `popstate` and `hashchange` can be
  // delivered after load end, when the form has been found and bound.
  pageAt(f, 30, () => f.w.history.replaceState(null, "", "/#!/auth"));
  pageAt(f, 200, () => render(f));
  pageAt(f, 1001, () => f.w.dispatchEvent(new f.w.PopStateEvent("popstate")));
  pageAt(f, 1002, () =>
    f.w.dispatchEvent(
      new f.w.HashChangeEvent("hashchange", {
        oldURL: ROOT,
        newURL: `${ROOT}#!/auth`,
      }),
    ),
  );
  await clock.advance(900);
  assert.deepEqual(f.signals, []);
  await loggedIn(f, 3000);
});

test("an event that names the bound address as the one left ends the attempt, even with the page back on it", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    holdStage: { "form-prepare": 5000 },
  });
  const bound = f.w.location.href;
  pageAt(f, 500, () => {
    f.w.history.replaceState(null, "", "#elsewhere");
    f.w.history.replaceState(null, "", bound);
    f.w.dispatchEvent(
      new f.w.HashChangeEvent("hashchange", {
        oldURL: bound,
        newURL: `${bound}#elsewhere`,
      }),
    );
  });
  await clock.advance(600);
  assert.deepEqual(f.signals, ["form-prepare", "form-rejected"]);
  await clock.advance(6000);
  assert.deepEqual(f.signals, ["form-prepare", "form-rejected"]);
  assert.deepEqual(f.host.keys, []);
});

test("a popstate that follows a move to another address ends the attempt at once", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    holdStage: { "form-prepare": 5000 },
  });
  pageAt(f, 500, () => {
    f.w.history.replaceState(null, "", "/elsewhere");
    f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  });
  await clock.advance(600);
  assert.deepEqual(f.signals, ["form-prepare", "form-rejected"]);
  await clock.advance(6000);
  assert.deepEqual(f.signals, ["form-prepare", "form-rejected"]);
  assert.deepEqual(f.host.keys, []);
});

// Once the form is found the fence is what it always was, at every stage.
const afterFound = [
  [
    "while the prepare grant is held",
    { holdStage: { "form-prepare": 5000 } },
    500,
    ["form-prepare", "form-rejected"],
  ],
  [
    "while the saved fill delay runs",
    { saved: { fillDelayMs: 3000 } },
    500,
    ["form-prepare", "form-rejected"],
  ],
  [
    "while the credential grant is held",
    { holdStage: { form: 5000 } },
    500,
    ["form-prepare", "form", "form-rejected"],
  ],
  ["during typing", {}, 300, ["form-prepare", "form", "form-rejected"]],
  [
    "while the submit grant is held",
    { holdStage: { "form-submit": 5000 } },
    3000,
    ["form-prepare", "form", "form-submit", "form-rejected"],
  ],
];
for (const kind of ["hash", "history"]) {
  for (const [label, options, at, expected] of afterFound) {
    test(`an address change (${kind}) ${label} ends the attempt`, async (t) => {
      const clock = virtualClock();
      const f = loginDocument(t, clock, options);
      pageAt(f, at, () =>
        routes[kind](f, kind === "hash" ? "#elsewhere" : "/elsewhere"),
      );
      await clock.advance(12000);
      assert.deepEqual(stages(f), expected);
      assert.equal(f.field("username").value, "");
      assert.equal(f.field("password").value, "");
      assert.equal(f.submits(), 0);
    });
  }
}

test("a page that rewrites its address forever without showing a form ends at the detection bound, with nothing requested", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell });
  let turn = 0;
  const rewrite = () => {
    f.w.location.hash = `#!/step-${++turn}`;
    pageAt(f, 250, rewrite);
  };
  pageAt(f, 30, rewrite);
  await clock.advance(7900);
  assert.deepEqual(f.signals, []);
  await clock.advance(400);
  assert.ok(f.signals.length > 0);
  // The window closed with the attempt: a form that shows up now is ignored.
  render(f);
  await clock.advance(5000);
  assert.ok(f.signals.every((value) => value === "form-rejected"));
  assert.deepEqual(f.host.deliveries, []);
  assert.deepEqual(f.host.keys, []);
});

test("a page that keeps rewriting its address after its form is found is not signed in", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell });
  let turn = 0;
  const rewrite = () => {
    f.w.location.hash = `#!/step-${++turn}`;
    pageAt(f, 250, rewrite);
  };
  pageAt(f, 30, rewrite);
  pageAt(f, 300, () => render(f));
  await clock.advance(10000);
  assert.equal(stages(f).at(-1), "form-rejected", JSON.stringify(f.signals));
  assert.equal(f.signals.includes("form-completed"), false);
  assert.equal(f.field("username").value, "");
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

// A document whose load ends several seconds after navigation (seen in the
// field at 5.5 to 6.5 s): the load gate and the routing window together.
for (const kind of ["hash", "history"]) {
  test(`a route change (${kind}) before a load end at 6 s is followed, and the form found after load end is signed in`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 6000 });
    pageAt(f, 30, () => routes[kind](f));
    pageAt(f, 6300, () => render(f));
    await clock.advance(6290);
    assert.deepEqual(f.signals, []);
    await loggedIn(f, 3000);
  });

  test(`a route change (${kind}) after a load end at 5 s is followed too: load end does not close the routing window`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 5000 });
    pageAt(f, 5500, () => routes[kind](f));
    pageAt(f, 6000, () => render(f));
    await clock.advance(5990);
    assert.notEqual(f.w.location.href, ROOT);
    assert.deepEqual(f.signals, []);
    await loggedIn(f, 3000);
  });
}

test("with the form rendered before a load end at 6 s, events from the earlier route change that follow load end are ignored", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 6000 });
  pageAt(f, 30, () => f.w.history.replaceState(null, "", "/#!/auth"));
  pageAt(f, 200, () => render(f));
  pageAt(f, 6001, () => f.w.dispatchEvent(new f.w.PopStateEvent("popstate")));
  pageAt(f, 6002, () =>
    f.w.dispatchEvent(
      new f.w.HashChangeEvent("hashchange", {
        oldURL: ROOT,
        newURL: `${ROOT}#!/auth`,
      }),
    ),
  );
  await clock.advance(5900);
  // Nothing is bound or asked before load end.
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.host.deliveries, []);
  await loggedIn(f, 3000);
});

test("a page that loads late and never shows a form is given up on, whatever it does to its address", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 6000 });
  pageAt(f, 7000, () => routes.hash(f, "#!/first"));
  pageAt(f, 9000, () => routes.hash(f, "#!/second"));
  await clock.advance(14500);
  assert.ok(f.signals.length > 0);
  // The window closed with the attempt: a form that shows up now is ignored.
  render(f);
  routes.hash(f, "#!/third");
  await clock.advance(10000);
  assert.ok(f.signals.every((value) => value === "form-rejected"));
  assert.deepEqual(f.host.deliveries, []);
  assert.deepEqual(f.host.keys, []);
});

// The saved detection time runs from load end, and no form is bound before
// it: a slow load uses none of that time, and an address change before load
// end is still routing.
for (const kind of ["hash", "history"]) {
  test(`an address change (${kind}) before load end is routing even when the form is already rendered`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, { loadAt: 3000 });
    pageAt(f, 500, () =>
      routes[kind](f, kind === "hash" ? "#elsewhere" : "/elsewhere"),
    );
    await clock.advance(2900);
    assert.deepEqual(f.signals, []);
    await loggedIn(f, 3000);
  });
}

test("a form that appears 3 s after a load end at 6.5 s is still found and signed in", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 6500 });
  pageAt(f, 30, () => routes.hash(f));
  pageAt(f, 9500, () => render(f));
  await clock.advance(9490);
  assert.deepEqual(f.signals, []);
  await loggedIn(f, 3000);
});

// A ten-second load, as seen in the field: one case on each side of the
// detection time (8 s here), which also ends the routing window.
test("after a load end at 10 s the address may still change 7 s later, and a form that appears 7.5 s later is signed in", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 10000 });
  pageAt(f, 17000, () => routes.hash(f));
  pageAt(f, 17500, () => render(f));
  await clock.advance(17490);
  assert.deepEqual(f.signals, []);
  await loggedIn(f, 3000);
});

test("after a load end at 10 s a form that appears 8.5 s later is not signed in, and nothing is asked", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 10000 });
  pageAt(f, 30, () => routes.hash(f));
  pageAt(f, 18500, () => render(f));
  await clock.advance(17900);
  assert.deepEqual(f.signals, []);
  await clock.advance(5000);
  assert.ok(f.signals.length > 0);
  assert.ok(f.signals.every((value) => value === "form-rejected"));
  assert.deepEqual(f.host.deliveries, []);
  assert.equal(f.field("username").value, "");
});

// One case on each side of the bound of the wait for load end (60 s).
test("a load end at 58 s followed by the form 3 s later is still in time", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell, loadAt: 58000 });
  pageAt(f, 61000, () => render(f));
  await clock.advance(60990);
  assert.deepEqual(f.signals, []);
  await loggedIn(f, 3000);
});

test("a document that never finishes loading is given up on at the load bound, with nothing requested", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    url: ROOT,
    html: shell,
    loadAt: Infinity,
  });
  pageAt(f, 200, () => render(f));
  await clock.advance(59000);
  assert.deepEqual(f.signals, []);
  await clock.advance(2000);
  assert.deepEqual(f.signals, ["form-rejected"]);
  assert.deepEqual(f.host.deliveries, []);
  assert.deepEqual(f.host.keys, []);
});

// The longer wait never fights the user: any input in the page ends the
// attempt, during the load and while the form is still awaited after it.
test("a user who types during a ten-second load ends the attempt: nothing is asked at load end and the field is left alone", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { loadAt: 10000 });
  await clock.advance(9000);
  assert.deepEqual(f.signals, []);
  f.press("username", "x");
  assert.deepEqual(f.signals, ["form-rejected"]);
  await clock.advance(20000);
  assert.deepEqual(f.signals, ["form-rejected"]);
  assert.deepEqual(f.host.deliveries, []);
  assert.equal(f.field("username").value, "x");
  assert.equal(f.field("password").value, "");
});

test("a user who types elsewhere in the page while the form is still awaited after load end ends the attempt", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    url: ROOT,
    html: `<input id="search">${shell}`,
    loadAt: 10000,
  });
  pageAt(f, 12000, () => render(f));
  await clock.advance(11000);
  assert.deepEqual(f.signals, []);
  f.press("search", "q");
  await clock.advance(10000);
  assert.ok(f.signals.length > 0);
  assert.ok(f.signals.every((value) => value === "form-rejected"));
  assert.deepEqual(f.host.deliveries, []);
  assert.equal(f.field("username").value, "");
  assert.equal(f.field("search").value, "q");
});

test("a hidden tab that takes ten seconds to load is signed in the same way, with no frame ever painted", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, {
    url: ROOT,
    html: shell,
    loadAt: 10000,
    beforeInstall(w) {
      Object.defineProperty(w.document, "visibilityState", {
        get: () => "hidden",
      });
      Object.defineProperty(w.document, "hidden", { get: () => true });
      w.document.hasFocus = () => false;
      w.requestAnimationFrame = () => 0;
    },
  });
  pageAt(f, 30, () => routes.hash(f));
  pageAt(f, 11000, () => render(f));
  await clock.advance(10990);
  assert.deepEqual(f.signals, []);
  await loggedIn(f, 3000);
});

// However an attempt ends, nothing of it keeps running.
for (const [label, options, within] of [
  ["a completed login", {}, 5000],
  ["a load that never ended", { loadAt: Infinity }, 61000],
  [
    "a form that never appeared",
    { url: ROOT, html: shell, loadAt: 10000 },
    19000,
  ],
]) {
  test(`after ${label} no page timer is left and later events do nothing`, async (t) => {
    const clock = virtualClock();
    const f = loginDocument(t, clock, options);
    await clock.advance(within);
    const said = f.signals.length;
    assert.ok(
      ["form-completed", "form-rejected"].includes(f.signals.at(-1)),
      JSON.stringify(f.signals),
    );
    await clock.advance(300);
    assert.equal(clock.pagePending(), 0);
    f.load();
    f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
    f.w.dispatchEvent(new f.w.HashChangeEvent("hashchange"));
    await clock.advance(120000);
    assert.equal(f.signals.length, said);
    assert.equal(clock.pagePending(), 0);
  });
}

test("a document that was reopened and is completing again asks for nothing once its address has changed", async (t) => {
  const clock = virtualClock();
  const f = loginDocument(t, clock, { url: ROOT, html: shell });
  // `document.open()`, the form written, `document.close()`: found, but
  // interactive again until the second load end.
  pageAt(f, 300, () => {
    f.reopen();
    render(f);
  });
  pageAt(f, 600, () => routes.history(f, "/elsewhere"));
  pageAt(f, 1000, () => f.load());
  await clock.advance(5000);
  assert.ok(f.signals.length > 0);
  assert.ok(f.signals.every((value) => value === "form-rejected"));
  assert.deepEqual(f.host.deliveries, []);
});
