import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTION_URI_LEGACY,
  ACTION_URI_SERVLET,
  LEGACY_APP_PATH,
  LEGACY_REALM,
  LOGIN_FORM_PATH,
  LOGIN_POST_PATH,
  REBOOT_FORM_PATH,
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
