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
  assert.deepEqual(
    JSON.parse(
      readFileSync(resolve(base, "native_login_catalog.json"), "utf8"),
    ),
    JSON.parse(JSON.stringify(expected)),
  );
});
function fixture(t, configuration = { selectors }) {
  const dom = new JSDOM(
    '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>',
    {
      url: "https://device.test/login",
      runScripts: "outside-only",
    },
  );
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.close();
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
    signals,
    deliver,
    submits: () => submits,
    field: (id) => dom.window.document.getElementById(id),
    send: (submit = false, deadline = Date.now() + 2000, options) =>
      deliver(
        "https://device.test",
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
  await delay(40);
  assert.deepEqual(f.signals, ["form"]);
  assert.equal(f.send(), true);
  await delay(10);
  assert.equal(f.field("username").value, "alice");
  assert.equal(f.field("password").value, "test-secret");
  assert.equal(f.submits(), 0);
  assert.equal(f.send(true), false);
  assert.equal(f.window.__sorng_autologin, undefined);
});

test("explicit native submit consent submits once", async (t) => {
  const f = fixture(t);
  await delay(40);
  assert.equal(f.send(true), true);
  await delay(10);
  assert.equal(f.submits(), 1);
});

test("missing explicit selector never falls back to generic discovery", async (t) => {
  const f = fixture(t, { selectors: { ...selectors, password: "#missing" } });
  await delay(40);
  assert.deepEqual(f.signals, []);
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("wrong origin, expiry and pagehide cannot release credentials", async (t) => {
  const f = fixture(t);
  await delay(40);
  assert.equal(
    f.deliver("https://other.test", "alice", "secret", true, Date.now() + 1000),
    false,
  );
  assert.equal(f.send(false, Date.now() - 1), false);
  f.window.dispatchEvent(new f.window.Event("pagehide"));
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("external action is rejected before readiness or credential entry", async (t) => {
  const f = fixture(t);
  f.window.document.querySelector("form").action = "https://other.test/login";
  await delay(40);
  assert.ok(!f.signals.includes("form"));
  assert.equal(f.send(), false);
  assert.equal(f.field("password").value, "");
});

test("saved options cannot override native consent and retain extra fields", async (t) => {
  const f = fixture(t);
  const realm = f.window.document.createElement("input");
  realm.id = "realm";
  f.window.document.querySelector("form").append(realm);
  await delay(40);
  assert.equal(
    f.send(false, Date.now() + 2000, {
      version: 1,
      fillDelayMs: 0,
      submitDelayMs: 0,
      detectionTimeoutMs: 1000,
      submit: true,
      fields: [{ selector: "#realm", value: "local" }],
    }),
    true,
  );
  await delay(10);
  assert.equal(realm.value, "local");
  assert.equal(f.submits(), 0);
});

test("expiry cancels deferred filling before any value is written", async (t) => {
  const f = fixture(t);
  await delay(40);
  assert.equal(
    f.send(true, Date.now() + 15, {
      version: 1,
      fillDelayMs: 100,
      submitDelayMs: 0,
      detectionTimeoutMs: 1000,
      submit: true,
      fields: [],
    }),
    true,
  );
  await delay(140);
  assert.equal(f.field("password").value, "");
  assert.equal(f.submits(), 0);
});

test("action mutation during username input cannot release password", async (t) => {
  const f = fixture(t);
  await delay(40);
  f.field("username").addEventListener("input", () => {
    f.window.document.querySelector("form").action = "https://other.test/login";
  });
  assert.equal(f.send(true), true);
  await delay(10);
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
    await delay(40);
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
  Object.defineProperty(w, "crypto", { value: webcrypto });
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
        await delay(1);
      }
      clock = end;
      await delay(1);
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
function deferredFixture(t) {
  return nativeFixture(
    t,
    '<form method="post"><input id="username"><input id="password" type="password"><input id="realm"><button id="login" type="submit">Log in</button></form>',
    "https://device.test/login",
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

test("native provider refuses cleartext origins and same-origin child frames", async (t) => {
  const insecure = providerFixture(
    t,
    "bitwarden-self-hosted",
    bitwardenMarkup,
    "http://device.test/login",
  );
  await insecure.advance(1000);
  assert.deepEqual(insecure.signals, []);
  assert.equal(insecure.send("identifier"), false);
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
