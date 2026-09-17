import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTION_URI_LEGACY,
  ACTION_URI_SERVLET,
  LEGACY_APP_PATH,
  LEGACY_REALM,
  LOGIN_FORM_PATH,
  LOGIN_POST_PATH,
  PAGE_SCRIPT_PATH,
  PHONE_FIRMWARE,
  PHONE_TYPE,
  REBOOT_FORM_PATH,
  RSA_AES_LOGIN_FIELDS,
  SESSION_COOKIE,
  STATUS_PATH,
  createPhoneServer,
  listen,
  type PhoneServer,
  type PhoneServerOptions,
} from "./server.mjs";

const HOST = "127.0.0.1";
const open: PhoneServer[] = [];

afterEach(async () => {
  await Promise.all(
    open
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function start(options: PhoneServerOptions): Promise<string> {
  const server = createPhoneServer(options);
  open.push(server);
  const port = await listen(server, 0, HOST);
  return `http://${HOST}:${port}`;
}

const lastServer = (): PhoneServer => open[open.length - 1];

type LoginFields = {
  username: string;
  pwd: string;
  rsakey: string;
  rsaiv: string;
};

interface YealinkPage {
  md5Hex(input: string): string;
  buildLoginBody(options: {
    username: string;
    password: string;
    jsessionid: string;
    rsaModulusHex: string;
    rsaExponentHex: string;
  }): Promise<LoginFields>;
}

/**
 * The page's own bundle, evaluated the way the browser evaluates it. Nothing
 * here needs a DOM: `buildLoginBody` is the part the phone's contract lives in.
 */
function loadPageScript(): YealinkPage {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.join(here, "servlet", "phone-page.js"),
    "utf8",
  );
  const sandbox: Record<string, unknown> = {
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    TextEncoder,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.__yealinkPage as YealinkPage;
}

/** What the login form GET publishes to the page before any credential. */
function readLoginFacts(html: string) {
  const value = (name: string) =>
    new RegExp(`var ${name}\\s*=\\s*"([^"]*)"`).exec(html)?.[1] ?? null;
  return {
    modulus: value("g_rsa_n"),
    exponent: value("g_rsa_e"),
    sessionId: value("g_jsessionid"),
    phoneType: value("g_phonetype"),
    firmware: value("g_strFirmware"),
  };
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString();

const get = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { headers, redirect: "manual" });

const post = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  fetch(url, {
    method: "POST",
    body,
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });

async function servletLogin(
  base: string,
  user = "admin",
  pass = "admin",
): Promise<string> {
  const res = await post(
    base + LOGIN_POST_PATH,
    form({ username: user, pwd: pass }),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(STATUS_PATH);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(
    new RegExp(`^${SESSION_COOKIE}=[0-9A-F]+; Path=/; HttpOnly$`),
  );
  return cookie.split(";")[0];
}

describe("fake Yealink phone fixture — legacy (HTTP Basic)", () => {
  it("challenges with Basic on / and on ConfigManApp.com; 401 on bad creds", async () => {
    const base = await start({ mode: "legacy" });
    const root = await get(base + "/");
    expect(root.status).toBe(401);
    expect(root.headers.get("www-authenticate")).toBe(
      `Basic realm="${LEGACY_REALM}"`,
    );

    const bad = await get(base + LEGACY_APP_PATH, {
      Authorization: basic("admin", "wrong"),
    });
    expect(bad.status).toBe(401);
  });

  it("serves the status page with valid Basic creds (?Id=1 and bare path)", async () => {
    const base = await start({ mode: "legacy" });
    const auth = { Authorization: basic("admin", "admin") };
    const root = await get(base + "/", auth);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("ConfigManApp.com");

    for (const path of [LEGACY_APP_PATH, `${LEGACY_APP_PATH}?Id=1`]) {
      const res = await get(base + path, auth);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Firmware Version");
      expect(body).toContain("SIP-T20P");
      expect(body).toContain("00:15:65:11:22:33");
      expect(body).toContain("Registered");
    }
  });

  it("gates ?key=Reboot on ACTION_URI and records the web-form fallback", async () => {
    const base = await start({ mode: "legacy", actionUri: false });
    const auth = { Authorization: basic("admin", "admin") };

    expect((await get(base + ACTION_URI_LEGACY)).status).toBe(401);
    expect((await get(base + ACTION_URI_LEGACY, auth)).status).toBe(403);
    expect(lastServer().phoneState.reboots).toEqual([]);

    const fallback = await post(
      base + LEGACY_APP_PATH,
      form({ Reboot: "Reboot" }),
      auth,
    );
    expect(fallback.status).toBe(200);
    expect(lastServer().phoneState.reboots.map((r) => r.method)).toEqual([
      "web-form",
    ]);

    const enabled = await start({ mode: "legacy", actionUri: true });
    const ok = await get(enabled + ACTION_URI_LEGACY, auth);
    expect(ok.status).toBe(200);
    expect(lastServer().phoneState.reboots.map((r) => r.method)).toEqual([
      "action-uri",
    ]);
  });
});

describe("fake Yealink phone fixture — servlet (form + JSESSIONID)", () => {
  it("redirects / to the login form; the form carries username/pwd/rsakey fields", async () => {
    const base = await start({ mode: "servlet" });
    const root = await get(base + "/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe(LOGIN_FORM_PATH);

    const page = await get(base + LOGIN_FORM_PATH);
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('name="username"');
    expect(body).toContain('name="pwd"');
    expect(body).toContain('name="rsakey"');
    expect(body).not.toMatch(/rsakey\s*=\s*"/);
  });

  it("form-plain login: sets JSESSIONID and 302s to the status page; status needs the cookie", async () => {
    const base = await start({ mode: "servlet" });
    const anon = await get(base + STATUS_PATH);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe(LOGIN_FORM_PATH);

    const cookie = await servletLogin(base);
    const status = await get(base + STATUS_PATH, { Cookie: cookie });
    expect(status.status).toBe(200);
    const body = await status.text();
    expect(body).toContain("52.84.0.125");
    expect(body).toContain("SIP-T21P_E2");
    expect(body).toContain("80:5E:C0:AA:BB:CC");
    expect(body).toContain("Account 1");
    expect(lastServer().phoneState.loginAttempts).toEqual([
      { username: "admin", shape: "form-plain", ok: true },
    ]);
  });

  it("rejects wrong credentials with the login form again (no cookie, body has loginForm)", async () => {
    const base = await start({ mode: "servlet" });
    const res = await post(
      base + LOGIN_POST_PATH,
      form({ username: "admin", pwd: "nope" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.text();
    expect(body).toContain("loginForm");
    expect(body).toContain("Invalid username or password");
  });

  it("form-rsa login: page exposes the modulus, PKCS1v1.5+base64 pwd is accepted", async () => {
    const base = await start({ mode: "servlet", rsa: true });
    const page = await (await get(base + LOGIN_FORM_PATH)).text();
    const match = /rsakey\s*=\s*"([0-9a-f]+)"/.exec(page);
    expect(match).not.toBeNull();
    const modulusHex = match![1];
    expect(modulusHex).toBe(lastServer().rsaModulusHex);

    const publicKey = crypto.createPublicKey({
      key: {
        kty: "RSA",
        n: Buffer.from(modulusHex, "hex").toString("base64url"),
        e: "AQAB",
      },
      format: "jwk",
    });
    const encrypted = crypto
      .publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from("admin"),
      )
      .toString("base64");

    const res = await post(
      base + LOGIN_POST_PATH,
      form({ username: "admin", pwd: encrypted, rsakey: modulusHex }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(lastServer().phoneState.loginAttempts).toEqual([
      { username: "admin", shape: "form-rsa", ok: true },
    ]);
  });

  it("gates /servlet?key=Reboot on ACTION_URI (401 anon, 403 disabled, 200 enabled)", async () => {
    const base = await start({ mode: "servlet", actionUri: false });
    const auth = { Authorization: basic("admin", "admin") };
    expect((await get(base + ACTION_URI_SERVLET)).status).toBe(401);
    expect((await get(base + ACTION_URI_SERVLET, auth)).status).toBe(403);
    const cookie = await servletLogin(base);
    expect(
      (await get(base + ACTION_URI_SERVLET, { Cookie: cookie })).status,
    ).toBe(403);
    expect(lastServer().phoneState.reboots).toEqual([]);

    const enabled = await start({ mode: "servlet", actionUri: true });
    expect((await get(enabled + ACTION_URI_SERVLET, auth)).status).toBe(200);
    expect(lastServer().phoneState.reboots.map((r) => r.method)).toEqual([
      "action-uri",
    ]);
  });

  it("reboot web-form fallback needs the session cookie", async () => {
    const base = await start({ mode: "servlet" });
    const anon = await post(base + REBOOT_FORM_PATH, "");
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe(LOGIN_FORM_PATH);

    const cookie = await servletLogin(base);
    const res = await post(base + REBOOT_FORM_PATH, "", { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(lastServer().phoneState.reboots.map((r) => r.method)).toEqual([
      "web-form",
    ]);
  });

  it("serves the page's own script bundle at the path the login form references", async () => {
    const base = await start({ mode: "servlet" });
    const page = await get(base + PAGE_SCRIPT_PATH);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/javascript");
    expect(await page.text()).toContain("__yealinkPage");
    expect(await (await get(base + LOGIN_FORM_PATH)).text()).toContain(
      `src="${PAGE_SCRIPT_PATH}"`,
    );
  });

  it("exposes /health and /__fixture/state|reset for the docker healthcheck and specs", async () => {
    const base = await start({ mode: "servlet", actionUri: true });
    expect((await get(base + "/health")).status).toBe(200);
    await get(base + ACTION_URI_SERVLET, {
      Authorization: basic("admin", "admin"),
    });
    const state = await (await get(base + "/__fixture/state")).json();
    expect(state).toMatchObject({
      mode: "servlet",
      actionUri: true,
      rsa: false,
    });
    expect(state.reboots).toHaveLength(1);
    await post(base + "/__fixture/reset", "");
    const reset = await (await get(base + "/__fixture/state")).json();
    expect(reset.reboots).toEqual([]);
  });
});

// The attested T21P E2 contract (.orchestration/plans/t96.md §2.1): the login
// form hands the page a session and an RSA public key, the page encrypts the
// password itself, and the phone answers `authstatus`. Nothing here is copied
// from firmware — the markup, the script and the answers are all synthetic.
describe("fake Yealink phone fixture — servlet (attested RSA+AES contract)", () => {
  const rsaAes = async (options: PhoneServerOptions = {}) => {
    const base = await start({
      mode: "servlet",
      authShape: "rsa-aes",
      ...options,
    });
    const response = await get(base + LOGIN_FORM_PATH);
    const html = await response.text();
    return { base, response, html, facts: readLoginFacts(html) };
  };

  const login = (base: string, fields: Record<string, string>) =>
    post(base + LOGIN_POST_PATH + "&Rajax=0.4242", form(fields));

  const buildBody = (
    page: YealinkPage,
    facts: ReturnType<typeof readLoginFacts>,
    password: string,
    sessionId = facts.sessionId,
  ) =>
    page.buildLoginBody({
      username: "admin",
      password,
      jsessionid: sessionId ?? "",
      rsaModulusHex: facts.modulus ?? "",
      rsaExponentHex: facts.exponent ?? "010001",
    });

  it("publishes g_rsa_n/g_rsa_e and the model, and hands out a session before authenticating", async () => {
    const { response, html, facts } = await rsaAes();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^${SESSION_COOKIE}=[0-9A-F]{32}; Path=/`),
    );
    expect(facts.modulus).toBe(lastServer().rsaModulusHex);
    expect(facts.exponent).toBe("010001");
    expect(facts.sessionId).toMatch(/^[0-9A-F]{32}$/);
    expect(facts.phoneType).toBe(PHONE_TYPE);
    expect(facts.firmware).toBe(PHONE_FIRMWARE);
    // The model and firmware are readable before signing in; the wrapped
    // secrets are not in the page at all.
    expect(html).not.toContain("privateKey");
  });

  it("carries the attested ids, and a confirm anchor instead of a submit button", async () => {
    const { html } = await rsaAes();
    for (const id of ["idUsername", "idPassword", "idConfirm"]) {
      const matches = html.match(new RegExp(`id="${id}"`, "g")) ?? [];
      expect(matches).toHaveLength(1);
    }
    expect(html).toContain('<a id="idConfirm"');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="pwd"');
  });

  it("renders the form-less layout with no form element at all", async () => {
    const { html } = await rsaAes({ layout: "formless" });
    expect(html).toContain('<div id="loginForm">');
    expect(html).not.toContain("<form");
    expect(html).toContain('<a id="idConfirm"');
  });

  it("derives the AES key and IV with a MD5 that matches Node's", () => {
    const page = loadPageScript();
    for (const sample of ["", "admin", "0123456789abcdef".repeat(4)])
      expect(page.md5Hex(sample)).toBe(
        crypto.createHash("md5").update(sample, "utf8").digest("hex"),
      );
  });

  it("accepts the body the page's own script builds and answers authstatus done", async () => {
    const page = loadPageScript();
    const { base, facts } = await rsaAes();
    const fields = await buildBody(page, facts, "admin");
    expect(Object.keys(fields)).toEqual([...RSA_AES_LOGIN_FIELDS]);
    expect(Buffer.from(fields.rsakey, "base64")).toHaveLength(128);
    expect(Buffer.from(fields.rsaiv, "base64")).toHaveLength(128);
    expect(Buffer.from(fields.pwd, "base64").length % 16).toBe(0);

    const response = await login(base, fields);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('{"authstatus":"done"}');
    const attempt = lastServer().phoneState.loginAttempts[0];
    expect(attempt).toMatchObject({
      username: "admin",
      shape: "form-rsa-aes",
      ok: true,
      authstatus: "done",
    });
    expect(attempt.detail).toMatchObject({
      fields: [...RSA_AES_LOGIN_FIELDS],
      wrappedBytes: 128,
      keyLooksHex: true,
      ivLooksHex: true,
      session: "matched",
      randomPrefix: true,
      problems: [],
    });

    // The session the page encrypted is the one the status page now accepts.
    const status = await get(base + STATUS_PATH, {
      Cookie: `${SESSION_COOKIE}=${facts.sessionId}`,
    });
    expect(status.status).toBe(200);
    expect(await status.text()).toContain(PHONE_FIRMWARE);
  });

  it("answers none for a wrong password, then lock once the phone locks out", async () => {
    const page = loadPageScript();
    const { base, facts } = await rsaAes({ lockAfter: 2 });
    for (const attempt of [1, 2]) {
      const response = await login(
        base,
        await buildBody(page, facts, `wrong-${attempt}`),
      );
      expect(await response.text()).toContain('{"authstatus":"none"}');
    }
    // Even the right password now answers lock: a retry loop only makes this
    // worse, which is why nothing in the product may retry.
    const locked = await login(base, await buildBody(page, facts, "admin"));
    expect(await locked.text()).toContain('{"authstatus":"lock"}');
    expect(lastServer().phoneState.sessions.size).toBe(0);
    expect(
      lastServer().phoneState.loginAttempts.map((item) => item.authstatus),
    ).toEqual(["none", "none", "lock"]);
  });

  it("answers with the login form again when the encrypted session is unknown", async () => {
    const page = loadPageScript();
    const { base, facts } = await rsaAes();
    const stale = crypto.randomBytes(16).toString("hex").toUpperCase();
    const response = await login(
      base,
      await buildBody(page, facts, "admin", stale),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="idUsername"');
    expect(body).not.toContain("authstatus");
    expect(lastServer().phoneState.sessions.size).toBe(0);
  });

  it("refuses a plaintext password, the way today's native driver posts it", async () => {
    const { base } = await rsaAes();
    const response = await login(base, { username: "admin", pwd: "admin" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('{"authstatus":"none"}');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(lastServer().phoneState.sessions.size).toBe(0);
    const attempt = lastServer().phoneState.loginAttempts[0];
    expect(attempt.ok).toBe(false);
    expect(attempt.detail?.problems.length).toBeGreaterThan(0);
  });
});
