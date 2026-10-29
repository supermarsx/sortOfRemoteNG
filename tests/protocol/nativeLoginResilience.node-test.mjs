// Resilience of the native login adapter on real-world page structures, run
// through the production bundle (shared form modules + native keyboard) in
// the deterministic JSDOM harness. Each stop names one fixed cause
// (`form-rejected|<cause>`, NativeLoginRejection in native_features.rs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  host,
  page,
  loginSteps,
  USER,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";

const brevo = readFileSync(
  "tests/fixtures/native-login-resilience/brevo-nextjs.html",
  "utf8",
);
// The reviewed Brevo profile (native_login_catalog.json).
const BREVO = {
  username: 'form input#email[name="email"]',
  password: 'form input#password[name="password"][type="password"]',
  submit:
    'form:has(input#email):has(input#password) button[data-testid="submit-button"][type="button"]',
};
const rejected = (signal) => signal.startsWith("form-rejected");
const causes = (p) =>
  p.signals.filter(rejected).map((signal) => signal.split("|")[1] ?? null);
const TURNSTILE =
  '<iframe id="turnstile" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/ov2/av0/synthetic" width="300" height="65"></iframe><input type="hidden" name="cf-turnstile-response" value="">';

function brevoPage(t, h, html = brevo) {
  const p = page(
    t,
    h,
    "https://login.brevo.com/",
    html,
    { selectors: BREVO },
    { adapter: "modular-form" },
  );
  const counts = { logins: 0, eyes: 0 };
  p.$('[data-testid="submit-button"]').onclick = () => counts.logins++;
  p.$("#eyeIcon").onclick = () => counts.eyes++;
  return { p, counts };
}

// Root cause of the reported Brevo failure: the page's load ends ~23 s in,
// with OneTrust's cookie banner holding keyboard focus. The keyboard refused
// to move focus from anything but the body, so the attempt stopped at its
// first field with no cause.
test("Brevo: a cookie banner holding focus at load end no longer stops the login", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h);
  p.$("#onetrust-banner-sdk").focus();
  assert.equal(p.doc.activeElement.id, "onetrust-banner-sdk");
  await h.advance(4000);
  assert.equal(p.$("#email").value, USER);
  assert.equal(p.$("#password").value, SECRET);
  assert.equal(counts.logins, 1);
  assert.equal(counts.eyes, 0);
  assert.ok(p.signals.includes("form-completed"), JSON.stringify(p.signals));
  // Invisible reCAPTCHA v3 scoring is not a verification for the user, and
  // a page that shows no refusal after the submit reports none.
  await h.advance(13000);
  assert.deepEqual(causes(p), []);
  assert.deepEqual(h.errors, []);
});

test("focus held by another text entry is never taken: nothing is typed and the cause is named", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(
    t,
    h,
    '<input id="search" type="search">' + brevo,
  );
  p.$("#search").focus();
  await h.advance(4000);
  assert.equal(p.typed.length, 0);
  assert.equal(p.doc.activeElement.id, "search");
  assert.equal(p.$("#email").value, "");
  assert.equal(p.$("#password").value, "");
  assert.equal(counts.logins, 0);
  assert.deepEqual(causes(p), ["focus-unavailable"]);
});

test("focus taken mid-typing by a late banner stops typing with focus-unavailable and erases what was typed", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h);
  let stolen = false;
  p.doc.addEventListener("input", () => {
    if (!stolen && p.$("#email").value.length === 3) {
      stolen = true;
      p.win.setTimeout(() => p.$("#onetrust-banner-sdk").focus(), 0);
    }
  });
  await h.advance(4000);
  assert.equal(stolen, true);
  assert.equal(p.$("#email").value, "");
  assert.equal(p.$("#password").value, "");
  assert.equal(counts.logins, 0);
  assert.deepEqual(causes(p), ["focus-unavailable"]);
});

test("a login form rendered late by a single-page application is waited for and signed in", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://login.brevo.com/",
    '<div id="root"></div>',
    { selectors: BREVO },
    { adapter: "modular-form" },
  );
  let logins = 0;
  h.schedule(() => {
    p.$("#root").innerHTML = brevo;
    p.$('[data-testid="submit-button"]').onclick = () => logins++;
  }, 3000);
  await h.advance(2500);
  assert.deepEqual(p.signals, []);
  await h.advance(5000);
  assert.equal(p.$("#email").value, USER);
  assert.equal(p.$("#password").value, SECRET);
  assert.equal(logins, 1);
});

test("a submit control the page enables only once the fields hold values is waited for", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h);
  const submit = p.$('[data-testid="submit-button"]');
  submit.disabled = true;
  let enabledAt = null;
  p.doc.addEventListener("input", () => {
    if (p.$("#password").value === SECRET && enabledAt === null) {
      enabledAt = h.now();
      p.win.setTimeout(() => {
        submit.disabled = false;
      }, 1500);
    }
  });
  await h.advance(8000);
  assert.ok(enabledAt !== null);
  assert.equal(counts.logins, 1);
  assert.ok(p.signals.includes("form-completed"));
  assert.deepEqual(causes(p), []);
});

test("a submit control that never becomes usable ends with submit-unavailable and erases the typed values", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h);
  p.$('[data-testid="submit-button"]').disabled = true;
  await h.advance(15000);
  assert.ok(p.typed.length > 0);
  assert.equal(counts.logins, 0);
  assert.equal(p.$("#email").value, "");
  assert.equal(p.$("#password").value, "");
  assert.deepEqual(causes(p), ["submit-unavailable"]);
});

test("an unanswered Turnstile holds the submit and ends with verification-required, leaving the typed values for the user", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h, brevo + TURNSTILE);
  await h.advance(15000);
  assert.equal(counts.logins, 0);
  assert.equal(p.$("#email").value, USER);
  assert.equal(p.$("#password").value, SECRET);
  assert.deepEqual(causes(p), ["verification-required"]);
  // Detection only: the widget is never clicked or answered.
  assert.equal(p.$('[name="cf-turnstile-response"]').value, "");
});

test("a verification answered while the submit waits lets the login go on", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h, brevo + TURNSTILE);
  h.schedule(() => {
    p.$('[name="cf-turnstile-response"]').value = "synthetic-token";
  }, 3000);
  await h.advance(8000);
  assert.equal(counts.logins, 1);
  assert.deepEqual(causes(p), []);
});

for (const [name, widget] of [
  [
    "hCaptcha",
    '<iframe src="https://newassets.hcaptcha.com/captcha/v1/synthetic/static/hcaptcha.html#frame=checkbox&id=x" width="303" height="78"></iframe>',
  ],
  [
    "reCAPTCHA v2",
    '<div class="g-recaptcha" data-sitekey="synthetic"><iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1&k=synthetic&size=normal" width="304" height="78"></iframe></div>',
  ],
])
  test(`an unanswered ${name} checkbox is reported as verification-required`, async (t) => {
    const h = host();
    const { p, counts } = brevoPage(t, h, brevo + widget);
    await h.advance(15000);
    assert.equal(counts.logins, 0);
    assert.deepEqual(causes(p), ["verification-required"]);
  });

test("a hidden verification widget does not hold the login", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(
    t,
    h,
    brevo + TURNSTILE.replace("<iframe ", '<iframe style="display:none" '),
  );
  await h.advance(8000);
  assert.equal(counts.logins, 1);
  assert.deepEqual(causes(p), []);
});

for (const [name, refuse] of [
  [
    "an alert banner",
    (p) =>
      p
        .$(".LoginForm_form__block")
        .insertAdjacentHTML(
          "afterbegin",
          '<div role="alert">Your email or password is incorrect.</div>',
        ),
  ],
  [
    "text in an empty live region",
    (p) => {
      p.$("#refusal").textContent = "Invalid credentials";
    },
  ],
  [
    "an error element next to the form",
    (p) =>
      p
        .$(".LoginForm_form__wrapper")
        .insertAdjacentHTML(
          "beforeend",
          '<p class="sib-form-error">Wrong password</p>',
        ),
  ],
  [
    "the field marked invalid",
    (p) => p.$("#password").setAttribute("aria-invalid", "true"),
  ],
])
  test(`${name} after the submit reports credentials-rejected`, async (t) => {
    const h = host();
    const { p, counts } = brevoPage(
      t,
      h,
      brevo.replace(
        '<div class="LoginForm_form__wrapper">',
        '<div id="refusal" role="alert"></div><div class="LoginForm_form__wrapper">',
      ),
    );
    p.$('[data-testid="submit-button"]').addEventListener("click", () =>
      p.win.setTimeout(() => refuse(p), 800),
    );
    await h.advance(4000);
    assert.equal(counts.logins, 1);
    assert.deepEqual(
      p.signals.filter((s) => s === "form-completed" || rejected(s)),
      ["form-completed", "form-rejected|credentials-rejected"],
    );
    // One report: the watch ends with it.
    await h.advance(15000);
    assert.deepEqual(causes(p), ["credentials-rejected"]);
  });

test("a refusal shown before the submit, or after the page moved on, is not reported", async (t) => {
  const h = host();
  const { p } = brevoPage(
    t,
    h,
    '<div role="alert">Session expired, please sign in again.</div>' + brevo,
  );
  p.$('[data-testid="submit-button"]').addEventListener("click", () =>
    p.win.setTimeout(() => {
      p.win.history.pushState(null, "", "/dashboard");
      p.doc.body.insertAdjacentHTML(
        "beforeend",
        '<div role="alert">Welcome back</div>',
      );
    }, 500),
  );
  await h.advance(17000);
  assert.ok(p.signals.includes("form-completed"));
  assert.deepEqual(causes(p), []);
});

test("a verification the page shows after the submit reports verification-required", async (t) => {
  const h = host();
  const { p } = brevoPage(t, h);
  p.$('[data-testid="submit-button"]').addEventListener("click", () =>
    p.win.setTimeout(
      () =>
        p.doc.body.insertAdjacentHTML(
          "beforeend",
          '<iframe src="https://www.google.com/recaptcha/api2/bframe?hl=en&k=synthetic" width="400" height="580"></iframe>',
        ),
      700,
    ),
  );
  await h.advance(5000);
  assert.deepEqual(
    p.signals.filter((s) => s === "form-completed" || rejected(s)),
    ["form-completed", "form-rejected|verification-required"],
  );
});

// React tracks a controlled input's value through the instance setter and
// commits state only when an input event shows a value the setter did not
// write. Everything this adapter erases goes through the prototype setter
// with input and change events, so the framework's state empties too.
test("an erased field reaches a React-controlled state", async (t) => {
  const h = host();
  const { p, counts } = brevoPage(t, h);
  const email = p.$("#email");
  const native = Object.getOwnPropertyDescriptor(
    p.win.HTMLInputElement.prototype,
    "value",
  );
  let tracker = "";
  const state = { email: "" };
  Object.defineProperty(email, "value", {
    configurable: true,
    get() {
      return native.get.call(this);
    },
    set(value) {
      tracker = String(value);
      native.set.call(this, value);
    },
  });
  p.doc.addEventListener(
    "input",
    (event) => {
      const target = event.composedPath?.()[0] ?? event.target;
      if (target !== email) return;
      const value = native.get.call(email);
      if (value !== tracker) {
        tracker = value;
        state.email = value;
      }
    },
    true,
  );
  // The page changes the form's destination while the password is typed.
  p.doc.addEventListener("input", () => {
    if (p.$("#password").value.length === 2)
      p.win.setTimeout(
        () =>
          p
            .$("form")
            .setAttribute("action", "https://elsewhere.example/collect"),
        0,
      );
  });
  await h.advance(4000);
  assert.equal(counts.logins, 0);
  assert.equal(email.value, "");
  assert.equal(state.email, "", "React state saw the erase");
  assert.deepEqual(causes(p), ["page-changed"]);
});

// Web-component login forms: fields inside an OPEN shadow root are found by
// the generic detection and typed through the shadow boundary.
function shadowPage(t, h, mode) {
  const p = page(
    t,
    h,
    "https://portal.example/login",
    '<login-card id="card"></login-card>',
    {},
    { adapter: "modular-form" },
  );
  const root = p.$("#card").attachShadow({ mode });
  root.innerHTML =
    '<div><form method="post" action="/login"><div><input id="user" type="email" name="email" autocomplete="username"></div><div><input id="pass" type="password" name="password"></div><button id="go">Sign in</button></form></div>';
  let clicks = 0;
  root.querySelector("#go").addEventListener("click", () => clicks++);
  root
    .querySelector("form")
    .addEventListener("submit", (event) => event.preventDefault());
  return { p, root, clicks: () => clicks };
}

test("a login form inside an open shadow root is signed in", async (t) => {
  const h = host();
  const { p, root, clicks } = shadowPage(t, h, "open");
  await h.advance(4000);
  assert.equal(root.querySelector("#user").value, USER);
  assert.equal(root.querySelector("#pass").value, SECRET);
  assert.equal(clicks(), 1);
  assert.ok(p.signals.includes("form-completed"), JSON.stringify(p.signals));
  assert.deepEqual(h.errors, []);
});

test("a closed shadow root is never forced open", async (t) => {
  const h = host();
  const { p, root, clicks } = shadowPage(t, h, "closed");
  await h.advance(10000);
  assert.equal(p.typed.length, 0);
  assert.equal(root.querySelector("#user").value, "");
  assert.equal(clicks(), 0);
  assert.ok(!h.requests.some(([, stage]) => stage === "form"));
});

// Identifier-first (email, next, then password) in one document, with the
// password step rendered late by the page.
const identifierFirst = [
  { kind: "identifier", paths: ["/login"], selectors: { username: "#user" } },
  { kind: "submit", submission: "spa", selectors: { control: "#next" } },
  { kind: "password", paths: ["/login"], selectors: { password: "#pass" } },
  { kind: "submit", submission: "spa", selectors: { control: "#go" } },
];
function identifierPage(t, h, renderPassword) {
  const p = page(
    t,
    h,
    "https://portal.example/login",
    '<div id="step"><input id="user" type="email"><button id="next" type="button">Next</button></div>',
    loginSteps(identifierFirst),
  );
  const seen = { next: 0, go: 0 };
  p.$("#next").addEventListener("click", () => {
    seen.next++;
    if (renderPassword)
      p.win.setTimeout(() => {
        p.$("#step").innerHTML =
          '<input id="pass" type="password"><button id="go" type="button">Sign in</button>';
        p.$("#go").addEventListener("click", () => seen.go++);
      }, 1500);
  });
  return { p, seen };
}

test("identifier-first: the late password step is waited for and each step gets only its field", async (t) => {
  const h = host();
  const { p, seen } = identifierPage(t, h, true);
  await h.advance(8000);
  assert.equal(seen.next, 1);
  assert.equal(seen.go, 1);
  assert.equal(p.$("#pass").value, SECRET);
  assert.deepEqual(
    p.typed.map(([, field]) => field).filter((f, i, a) => a.indexOf(f) === i),
    ["username", "password"],
  );
  assert.equal(p.reason(), "completed");
});

test("identifier-first: a password step that never appears ends with step-not-found", async (t) => {
  const h = host();
  const { p, seen } = identifierPage(t, h, false);
  await h.advance(60000);
  assert.equal(seen.next, 1);
  assert.equal(p.reason(), "layout-mismatch");
  assert.deepEqual(causes(p), ["step-not-found"]);
  assert.ok(!h.requests.some(([, stage]) => stage === "password"));
});

test("declarative steps: an unanswered verification at the submit keeps the values and names the cause", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    '<form method="post" action="/login"><input id="user" type="email"><input id="pass" type="password"><button id="go">Sign in</button></form>' +
      TURNSTILE,
    loginSteps([
      {
        kind: "form",
        paths: ["/login"],
        selectors: { username: "#user", password: "#pass" },
      },
      { kind: "submit", submission: "click", selectors: { control: "#go" } },
    ]),
  );
  let clicks = 0;
  p.$("#go").addEventListener("click", () => clicks++);
  await h.advance(20000);
  assert.equal(clicks, 0);
  assert.equal(p.$("#user").value, USER);
  assert.equal(p.$("#pass").value, SECRET);
  assert.equal(p.reason(), "verification-required");
  assert.deepEqual(causes(p), ["verification-required"]);
});

test("declarative steps: the user's own input names user-input", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    '<form method="post" action="/login"><input id="user" type="email"><input id="pass" type="password"><button id="go">Sign in</button></form>',
    loginSteps([
      {
        kind: "form",
        paths: ["/login"],
        selectors: { username: "#user", password: "#pass" },
      },
      { kind: "submit", submission: "click", selectors: { control: "#go" } },
    ]),
  );
  await h.advance(300);
  p.userTypes(p.$("#user"), "someone-else@example.test");
  await h.advance(5000);
  assert.equal(p.reason(), "user-input");
  assert.deepEqual(causes(p), ["user-input"]);
  assert.equal(p.$("#user").value, "someone-else@example.test");
});
