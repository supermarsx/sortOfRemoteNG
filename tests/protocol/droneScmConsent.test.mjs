import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// The consent-page check of Drone CI's bridged sign-in (r1-drone). The page
// is go-gitea/gitea release/v1.24 templates/user/auth/grant.tmpl, rendered.
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin/apps/drone_scm_consent.js",
  "utf8",
);
const droneScmConsentTarget = new Function(
  `${source}; return droneScmConsentTarget;`,
)();

const GITEA = "https://git.example.test";
const DRONE = "https://ci.example.test";
const CLIENT = "3f0c2a8e-1b7d-4c55-9a0e-6d2b1f8e7c41";
const bridge = {
  origin: GITEA,
  paths: ["/login/oauth/authorize"],
  formAction: "/login/oauth/grant",
  formSelector: 'form[method="post" i][action$="/login/oauth/grant"]',
  buttonSelector:
    'button#authorize-app[type="submit"][name="granted"][value="true"]',
  clientId: CLIENT,
  redirectUri: `${DRONE}/login`,
};
const address = (overrides = {}) => {
  const url = new URL("/login/oauth/authorize", GITEA);
  for (const [key, value] of Object.entries({
    client_id: CLIENT,
    redirect_uri: `${DRONE}/login`,
    response_type: "code",
    state: "s",
    ...overrides,
  }))
    url.searchParams.set(key, value);
  return url.href;
};
const grant = ({
  action = "/login/oauth/grant",
  client = CLIENT,
  redirect = `${DRONE}/login`,
  extra = "",
} = {}) => `<!doctype html><div class="page-content oauth2-authorize-application-box">
  <form method="post" action="${action}">
    <input type="hidden" name="_csrf" value="c">
    <input type="hidden" name="client_id" value="${client}">
    <input type="hidden" name="state" value="s">
    <input type="hidden" name="scope" value="">
    <input type="hidden" name="nonce" value="">
    <input type="hidden" name="redirect_uri" value="${redirect}">
    <button type="submit" id="authorize-app" name="granted" value="true" class="ui red inline button">Authorize Application</button>
    <button type="submit" name="granted" value="false" class="ui basic primary inline button">Cancel</button>
  </form>${extra}</div>`;
const page = (html, url = address()) =>
  new JSDOM(html, { url }).window.document;

test("native consent asks for a fresh action grant, clicks once, and rejects missing consent", () => {
  const client = readFileSync(
    "src-tauri/crates/sorng-browser-host/src/native_login_client.js",
    "utf8",
  );
  for (const allowed of [true, false]) {
    const dom = new JSDOM(grant(), {
      url: address(),
      runScripts: "outside-only",
    });
    const { window } = dom;
    const timers = new Map();
    let clock = 1_000_000,
      nextTimer = 0,
      readiness = "loading";
    Object.defineProperty(window.document, "readyState", {
      configurable: true,
      get: () => readiness,
    });
    window.Date.now = () => clock;
    window.setTimeout = (callback, milliseconds = 0) => {
      assert.equal(typeof callback, "function");
      assert(Number.isFinite(milliseconds) && milliseconds >= 0);
      assert(timers.size < 32, "owned timer queue bound");
      const id = ++nextTimer;
      timers.set(id, { at: clock + Math.max(1, milliseconds), callback });
      return id;
    };
    window.clearTimeout = (id) => timers.delete(id);
    const advance = (milliseconds) => {
      const until = clock + milliseconds;
      let callbacks = 0;
      while (true) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        assert(++callbacks <= 64, "owned timer callback bound");
        const [id, timer] = due;
        timers.delete(id);
        clock = timer.at;
        timer.callback();
      }
      clock = until;
    };
    try {
      window.HTMLElement.prototype.getClientRects = () => [
        { width: 100, height: 20 },
      ];
      const signals = [],
        button = window.document.querySelector("#authorize-app");
      let clicks = 0;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        clicks++;
      });
      const deliver = window.eval(client)(
        (signal) => signals.push(signal),
        { droneScmConsent: bridge },
        "modular-form",
      );
      advance(30);
      // Thirty elapsed milliseconds do not establish document readiness.
      assert.deepEqual(signals, []);
      assert.equal(clicks, 0);
      const args = [GITEA, "", "", allowed, clock + 2000, {}, "scm-consent"];
      assert.equal(deliver(...args), false);
      readiness = "complete";
      window.dispatchEvent(new window.Event("load"));
      advance(1);
      assert.deepEqual(signals, ["scm-consent"]);
      assert.equal(clicks, 0);
      assert.equal(deliver(...args), allowed);
      assert.equal(deliver(...args), false);
      assert.equal(clicks, Number(allowed));
      assert.deepEqual(signals, ["scm-consent"]);
      assert.equal(timers.size, 0);
    } finally {
      timers.clear();
      dom.window.close();
    }
  }
});

test("finds the approving control on the saved provider's consent page for Drone's own application", () => {
  const target = droneScmConsentTarget(page(grant()), bridge);
  assert.ok(target);
  assert.equal(target.id, "authorize-app");
  assert.equal(target.value, "true");
});

test("never the Cancel control, and nothing on another origin, path or application", () => {
  for (const [label, doc] of [
    [
      "other origin",
      page(grant(), address().replace(GITEA, "https://git.evil.test")),
    ],
    ["plaintext", page(grant(), address().replace("https://", "http://"))],
    [
      "other path",
      page(grant(), address().replace("/login/oauth/authorize", "/user/login")),
    ],
    [
      "other client in the address",
      page(grant(), address({ client_id: "other" })),
    ],
    [
      "other callback in the address",
      page(
        grant(),
        address({ redirect_uri: "https://evil.example.test/login" }),
      ),
    ],
    ["other client in the form", page(grant({ client: "other" }))],
    [
      "other callback in the form",
      page(grant({ redirect: "https://evil.example.test/login" })),
    ],
    [
      "form posts elsewhere",
      page(grant({ action: "https://evil.example.test/login/oauth/grant" })),
    ],
    [
      "form posts with a query",
      page(grant({ action: "/login/oauth/grant?x=1" })),
    ],
    ["two forms", page(grant({ extra: grant() }))],
    // Each check stands on its own, not only through a relative action.
    [
      "other origin posting to the saved provider",
      page(
        grant({ action: `${GITEA}/login/oauth/grant` }),
        address().replace(GITEA, "https://git.evil.test"),
      ),
    ],
    [
      "plaintext posting to the saved provider",
      page(
        grant({ action: `${GITEA}/login/oauth/grant` }),
        address().replace("https://", "http://"),
      ),
    ],
    [
      "a second consent form without its own button",
      page(
        grant({
          extra:
            '<form method="post" action="/login/oauth/grant"><input type="hidden" name="client_id" value="other"></form>',
        }),
      ),
    ],
    [
      "a second approving button",
      page(
        grant({
          extra:
            '<button type="submit" id="authorize-app" name="granted" value="true">x</button>',
        }),
      ),
    ],
  ])
    assert.equal(droneScmConsentTarget(doc, bridge), null, label);
});

test("refuses a bridge without a saved client id or a malformed bridge", () => {
  const doc = page(grant());
  assert.equal(droneScmConsentTarget(doc, { ...bridge, clientId: "" }), null);
  assert.equal(droneScmConsentTarget(doc, { ...bridge, paths: "x" }), null);
  assert.equal(droneScmConsentTarget(doc, null), null);
  assert.equal(
    droneScmConsentTarget(doc, { ...bridge, buttonSelector: "[[" }),
    null,
  );
});

test("refuses a disabled or retargeted button", () => {
  for (const patch of [
    [
      "Authorize Application</button>",
      "Authorize Application</button>",
      'id="authorize-app"',
      'id="authorize-app" disabled',
    ],
    [
      "",
      "",
      'id="authorize-app"',
      'id="authorize-app" formaction="https://evil.example.test/"',
    ],
    ["", "", 'id="authorize-app"', 'id="authorize-app" aria-disabled="true"'],
  ]) {
    const html = grant().replace(patch[2], patch[3]);
    assert.equal(droneScmConsentTarget(page(html), bridge), null, patch[3]);
  }
});
