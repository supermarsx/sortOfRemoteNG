import assert from "node:assert/strict";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { readFile, access } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  connectionConfigurations,
  inputVerdict,
  startFixture,
  SYNTHETIC,
  totpAt,
} from "./fixture.mjs";

let fixture;
before(async () => {
  fixture = await startFixture({ port: 0 });
});
after(async () => {
  await fixture?.close();
});

function send(
  path,
  { body, cookie, ca = fixture.certificate, headers = {} } = {},
) {
  return new Promise((accept, reject) => {
    const req = request(
      `${fixture.origin}${path}`,
      {
        ca,
        // Verify the actual numeric loopback target even when a negative test
        // deliberately changes the HTTP Host header. Certificate checks stay on.
        checkServerIdentity: (_hostname, cert) =>
          checkServerIdentity("127.0.0.1", cert),
        method: body ? "POST" : "GET",
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body
            ? { Origin: fixture.origin, "Content-Type": "application/json" }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () =>
          accept({
            status: response.statusCode,
            headers: response.headers,
            text: data,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function start(path) {
  const response = await send(path);
  assert.equal(response.status, 200);
  return {
    cookie: response.headers["set-cookie"][0].split(";")[0],
    config: configOf(response.text),
  };
}
function configOf(html) {
  return JSON.parse(html.match(/id="fixture-config">([^<]+)<\/script>/)[1]);
}
function modelCounts(length) {
  // MODEL ONLY: a hand-authored receipt cannot prove live browser trust.
  return {
    keydown: length,
    keyup: length,
    beforeinput: length,
    input: length,
    untrusted: 0,
    nonInsertText: 0,
    unfocused: 0,
  };
}
function bodyFor(config, { trusted = true } = {}) {
  const names =
    config.stage === "credentials" ? ["email", "password"] : [config.stage];
  const values = Object.fromEntries(
    names.map((name) => [name, name === "totp" ? totpAt() : SYNTHETIC[name]]),
  );
  return {
    ...config,
    values,
    events: Object.fromEntries(
      names.map((name) => [
        name,
        {
          ...modelCounts(values[name].length),
          ...(!trusted ? { untrusted: 1 } : {}),
        },
      ]),
    ),
    secureContext: true,
    topLevel: true,
    tauriAbsent: true,
    trustedSubmit: true,
  };
}

test("TLS validates the disposable SAN and rejects the certificate without explicit CA trust", async () => {
  const cert = new X509Certificate(fixture.certificate);
  assert.equal(cert.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(cert.ca, false);
  assert.equal(cert.fingerprint256, fixture.fingerprint);
  assert.equal((await send("/health")).status, 200);
  await assert.rejects(
    send("/health", { ca: null }),
    /self-signed|certificate/i,
  );
});

test("host/CSRF/query guards and cookie/CSP boundaries stay local", async () => {
  assert.equal(
    (await send("/health", { headers: { Host: "production.invalid" } })).status,
    421,
  );
  assert.equal((await send("/health?password=do-not-record")).status, 400);
  const page = await send("/staged");
  assert.match(
    page.headers["set-cookie"][0],
    /Secure; HttpOnly; SameSite=Strict/,
  );
  assert.match(page.headers["content-security-policy"], /connect-src 'self'/);
  const cookie = page.headers["set-cookie"][0].split(";")[0];
  assert.equal(
    (
      await send("/step", {
        cookie,
        body: bodyFor(configOf(page.text)),
        headers: { Origin: "https://production.invalid" },
      })
    ).status,
    403,
  );
  assert.equal((await send("/staged/password")).status, 409);
});

test("trusted typing verdict rejects assignment, forged events, paste, missing fields and focus loss", () => {
  assert.equal(inputVerdict(modelCounts(6), 6).trustedTyping, true);
  for (const change of [
    { input: 0 },
    { keydown: 0 },
    { beforeinput: 0 },
    { keyup: 0 },
    { untrusted: 1 },
    { nonInsertText: 1 },
    { unfocused: 1 },
    { input: 10_001 },
  ])
    assert.equal(
      inputVerdict({ ...modelCounts(6), ...change }, 6).trustedTyping,
      false,
    );
  assert.equal(inputVerdict({}, 6).trustedTyping, false);
  assert.equal(inputVerdict(null, 6).trustedTyping, false);
});

test("staged receipt model enforces order, one-shot documents and sanitized terminal evidence", async () => {
  let { cookie, config } = await start("/staged");
  for (const stage of ["email", "password", "totp"]) {
    assert.equal(config.stage, stage);
    const body = bodyFor(config);
    body.unrecognizedSecret = "must-not-persist";
    const response = await send("/step", { cookie, body });
    assert.equal(response.status, 200);
    assert.equal((await send("/step", { cookie, body })).status, 409);
    const result = JSON.parse(response.text);
    assert.equal(result.report.trustedInputAcceptance, stage === "totp");
    if (stage !== "totp")
      config = configOf((await send(result.nextPath, { cookie })).text);
  }
  const report = (await send("/report")).text;
  for (const value of [
    ...Object.values(SYNTHETIC),
    "must-not-persist",
    cookie,
    config.nonce,
  ])
    assert.equal(
      report.includes(value),
      false,
      "report must not retain submitted values or receipts",
    );
});

test("functional success with synthetic input events cannot pass trusted-input acceptance", async () => {
  let { cookie, config } = await start("/modular");
  let result;
  for (const _stage of ["credentials", "totp"]) {
    const response = await send("/step", {
      cookie,
      body: bodyFor(config, { trusted: false }),
    });
    assert.equal(response.status, 200);
    result = JSON.parse(response.text);
    if (!result.report.complete)
      config = configOf((await send(result.nextPath, { cookie })).text);
  }
  assert.equal(result.report.functionalAcceptance, true);
  assert.equal(result.report.trustedInputAcceptance, false);
});

test("DOM-dispatched untrusted events are counted without copying event data", async () => {
  const page = await send("/modular");
  const dom = new JSDOM(page.text, {
    url: `${fixture.origin}/modular`,
    runScripts: "outside-only",
  });
  try {
    let submitted;
    dom.window.fetch = async (_path, options) => {
      submitted = JSON.parse(options.body);
      return { ok: false };
    };
    Object.defineProperty(dom.window, "isSecureContext", { value: true });
    dom.window.eval(
      await readFile(new URL("./client.js", import.meta.url), "utf8"),
    );
    for (const field of ["email", "password"]) {
      const input = dom.window.document.querySelector(
        `[data-field="${field}"]`,
      );
      input.focus();
      input.value = SYNTHETIC[field];
      input.dispatchEvent(
        new dom.window.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: SYNTHETIC[field],
        }),
      );
    }
    dom.window.document
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await new Promise((accept) => setImmediate(accept));
    assert.equal(submitted.events.email.untrusted, 1);
    assert.equal(submitted.events.email.input, 0);
    assert.equal(
      inputVerdict(submitted.events.email, SYNTHETIC.email.length)
        .trustedTyping,
      false,
    );
    assert.equal(
      JSON.stringify(submitted.events).includes(SYNTHETIC.password),
      false,
    );
  } finally {
    dom.window.close();
  }
});

test("Gitea fixture matches current reviewed login and TOTP selectors, not a made-up generic OTP grant", async () => {
  const loginCatalog = JSON.parse(
    await readFile(
      new URL(
        "../../src-tauri/crates/sorng-browser-host/src/native_login_catalog.json",
        import.meta.url,
      ),
    ),
  );
  const otpCatalog = JSON.parse(
    await readFile(
      new URL(
        "../../src-tauri/src/origin_browser_totp_catalog.json",
        import.meta.url,
      ),
    ),
  );
  const page = await send("/user/login");
  const dom = new JSDOM(page.text, { url: `${fixture.origin}/user/login` });
  for (const selector of Object.values(loginCatalog.profiles.gitea.selectors))
    assert.equal(dom.window.document.querySelectorAll(selector).length, 1);
  dom.window.close();
  const cookie = page.headers["set-cookie"][0].split(";")[0];
  const response = await send("/step", {
    cookie,
    body: bodyFor(configOf(page.text)),
  });
  assert.equal(response.status, 200);
  const next = JSON.parse(response.text).nextPath;
  assert.equal(otpCatalog.gitea[0].paths.includes(next), true);
  const otp = new JSDOM((await send(next, { cookie })).text, {
    url: `${fixture.origin}${next}`,
  });
  for (const selector of [
    otpCatalog.gitea[0].codeSelector,
    otpCatalog.gitea[0].submitSelector,
  ])
    assert.equal(otp.window.document.querySelectorAll(selector).length, 1);
  otp.window.close();
  const configs = connectionConfigurations(fixture.origin);
  assert.equal(
    configs.giteaTotp.httpAutoMfa.challengeId,
    otpCatalog.gitea[0].id,
  );
  assert.equal(configs.modular.httpAutoMfa, undefined);
  assert.equal(configs.modular.httpVerifySsl, true);
});

test("TOTP uses RFC 6238 public seed and rejects an incorrect code", async () => {
  assert.equal(totpAt(59_000), "287082");
  const { cookie, config } = await start("/modular");
  await send("/step", { cookie, body: bodyFor(config) });
  const otp = configOf((await send("/totp", { cookie })).text);
  const body = bodyFor(otp);
  body.values.totp = "not-a-code";
  const response = await send("/step", { cookie, body });
  assert.equal(response.status, 422);
  assert.equal(response.text.includes("not-a-code"), false);
});

test("closing the fixture removes only its generated certificate/configuration directory", async () => {
  const disposable = await startFixture({ port: 0 });
  await access(disposable.certificateFile);
  await access(disposable.configurationFile);
  await disposable.close();
  await disposable.close();
  await assert.rejects(access(disposable.certificateFile), { code: "ENOENT" });
  await assert.rejects(access(disposable.configurationFile), {
    code: "ENOENT",
  });
});
