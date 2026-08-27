import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL,
  DEFAULT_ROUTER_NAME,
  LOGIN_CGI_PATH,
  LOGIN_PAGE_PATH,
  LOGOUT_CGI_PATH,
  REBOOT_CGI_PATH,
  SESSION_COOKIE,
  STATUS_PAGE_PATHS,
  TOKEN_FIELD,
  createDraytekServer,
  decodeCredential,
  encodeCredential,
  listen,
  type DraytekServer,
  type DraytekServerOptions,
} from "./server.mjs";

const HOST = "127.0.0.1";
const open: DraytekServer[] = [];

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

async function start(options: DraytekServerOptions = {}): Promise<string> {
  const server = createDraytekServer(options);
  open.push(server);
  const port = await listen(server, 0, HOST);
  return `http://${HOST}:${port}`;
}

const lastServer = (): DraytekServer => open[open.length - 1];

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

// Mirrors the crate's `contains_login_form` regex so the fixture's pages are
// classified exactly the way `sorng-draytek` classifies them.
const LOGIN_FORM_RE =
  /<form[^>]*wlogin\.cgi|<input[^>]*\bname\s*=\s*["']?a[ab]["']?[\s>]|id\s*=\s*["']?(?:sUsername|sPassword|tUsername|tPassword)["']?/is;
const TOKEN_RE =
  /<input[^>]*\bname\s*=\s*["']?sFormAuthStr["']?[^>]*\bvalue\s*=\s*["']([^"'>]+)["']?/is;
const RSA_RE = /\bRSAKey\b|\bsetPublic\s*\(/i;

async function scrapeToken(base: string): Promise<string> {
  const page = await (await get(base + LOGIN_PAGE_PATH)).text();
  const match = TOKEN_RE.exec(page);
  expect(match).not.toBeNull();
  return match![1];
}

async function login(
  base: string,
  fields: Record<string, string>,
): Promise<{ cookie: string | null; body: string; status: number }> {
  const res = await post(base + LOGIN_CGI_PATH, form(fields));
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    body: await res.text(),
    cookie: setCookie ? setCookie.split(";")[0] : null,
  };
}

describe("fake DrayTek fixture — credential encoding", () => {
  it("round-trips base64 and tolerates URL-encoded / space-mangled input", () => {
    expect(encodeCredential("admin")).toBe("YWRtaW4=");
    expect(decodeCredential("YWRtaW4=")).toBe("admin");
    expect(decodeCredential("YWRtaW4%3D")).toBe("admin");
    expect(decodeCredential(encodeCredential("s3cret!"))).toBe("s3cret!");
    expect(decodeCredential(null)).toBe("");
  });
});

describe("fake DrayTek fixture — classic login (fw < 4.4)", () => {
  it("serves the login form on / and /weblogin.htm without a token or RSA", async () => {
    const base = await start({ scheme: "classic" });
    for (const path of ["/", LOGIN_PAGE_PATH]) {
      const res = await get(base + path);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(LOGIN_FORM_RE);
      expect(body).not.toMatch(TOKEN_RE);
      expect(body).not.toMatch(RSA_RE);
      expect(body).toContain(DEFAULT_MODEL);
    }
  });

  it("accepts aa/ab base64 and sets SESSION_ID_VIGOR; dashboard has no login form", async () => {
    const base = await start({ scheme: "classic" });
    const { status, body, cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    expect(status).toBe(200);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[0-9A-F]{32}$`));
    expect(body).not.toMatch(LOGIN_FORM_RE);
    expect(body).toContain(DEFAULT_ROUTER_NAME);
    expect(lastServer().routerState.loginAttempts).toEqual([
      {
        username: "admin",
        method: "post",
        tokenPresent: false,
        tokenAccepted: true,
        ok: true,
      },
    ]);
  });

  it("rejects wrong credentials with the login form again and no cookie", async () => {
    const base = await start({ scheme: "classic", password: "right" });
    const { body, cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("wrong"),
    });
    expect(cookie).toBeNull();
    expect(body).toMatch(LOGIN_FORM_RE);
    expect(body).toContain("Login failed");
    expect(lastServer().routerState.sessions.size).toBe(0);
  });

  it("honours the GET ?aa=&ab= pre-auth URL used by Open Web UI", async () => {
    const base = await start({ scheme: "classic" });
    const url = `${base}${LOGIN_CGI_PATH}?aa=${encodeURIComponent(
      encodeCredential("admin"),
    )}&ab=${encodeURIComponent(encodeCredential("admin"))}`;
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(lastServer().routerState.loginAttempts[0]).toMatchObject({
      method: "get",
      ok: true,
    });
  });

  it("serves every /doc/*.sht status candidate with the cookie, login form without", async () => {
    const base = await start({ scheme: "classic" });
    for (const path of STATUS_PAGE_PATHS) {
      const anon = await (await get(base + path)).text();
      expect(anon).toMatch(LOGIN_FORM_RE);
    }
    const { cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    for (const path of STATUS_PAGE_PATHS) {
      const res = await get(base + path, { Cookie: cookie! });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toMatch(LOGIN_FORM_RE);
      expect(body).toContain("Model Name");
      expect(body).toContain(DEFAULT_MODEL);
      expect(body).toContain("Firmware Version");
      expect(body).toContain(DEFAULT_FIRMWARE);
      expect(body).toContain("Router Name");
      expect(body).toContain("WAN1");
      expect(body).toContain("203.0.113.5");
    }
  });

  it("records reboot.cgi (sReboot=Current) and drops the session afterwards", async () => {
    const base = await start({ scheme: "classic" });
    const anon = await post(
      base + REBOOT_CGI_PATH,
      form({ sReboot: "Current" }),
    );
    expect(await anon.text()).toMatch(LOGIN_FORM_RE);
    expect(lastServer().routerState.reboots).toEqual([]);

    const { cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    const res = await post(
      base + REBOOT_CGI_PATH,
      form({ sReboot: "Current" }),
      {
        Cookie: cookie!,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(LOGIN_FORM_RE);
    expect(body).toContain("rebooting");
    expect(lastServer().routerState.reboots).toHaveLength(1);
    expect(lastServer().routerState.reboots[0]).toMatchObject({
      method: "post",
      mode: "Current",
      tokenPresent: false,
    });

    const after = await (
      await get(base + STATUS_PAGE_PATHS[0], { Cookie: cookie! })
    ).text();
    expect(after).toMatch(LOGIN_FORM_RE);
  });

  it("logout drops the session", async () => {
    const base = await start({ scheme: "classic" });
    const { cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    await get(base + LOGOUT_CGI_PATH, { Cookie: cookie! });
    expect(lastServer().routerState.sessions.size).toBe(0);
  });
});

describe("fake DrayTek fixture — sFormAuthStr login (fw >= 4.4)", () => {
  it("emits a hidden sFormAuthStr on the login page (no RSA)", async () => {
    const base = await start({ scheme: "token" });
    const page = await (await get(base + LOGIN_PAGE_PATH)).text();
    expect(page).toMatch(TOKEN_RE);
    expect(page).not.toMatch(RSA_RE);
  });

  it("requires the scraped token on the POST and consumes it", async () => {
    const base = await start({ scheme: "token" });
    const missing = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    expect(missing.cookie).toBeNull();
    expect(missing.body).toMatch(LOGIN_FORM_RE);

    const stale = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
      [TOKEN_FIELD]: "not-issued",
    });
    expect(stale.cookie).toBeNull();

    const token = await scrapeToken(base);
    const ok = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
      [TOKEN_FIELD]: token,
    });
    expect(ok.cookie).toContain(`${SESSION_COOKIE}=`);
    expect(ok.body).not.toMatch(LOGIN_FORM_RE);

    const replay = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
      [TOKEN_FIELD]: token,
    });
    expect(replay.cookie).toBeNull();
    expect(
      lastServer().routerState.loginAttempts.map((a) => [
        a.tokenPresent,
        a.tokenAccepted,
        a.ok,
      ]),
    ).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, true],
      [true, false, false],
    ]);
  });

  it("reboot.cgi needs the token too, and records that it was present", async () => {
    const base = await start({ scheme: "token" });
    const token = await scrapeToken(base);
    const { cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
      [TOKEN_FIELD]: token,
    });
    const noToken = await post(
      base + REBOOT_CGI_PATH,
      form({ sReboot: "Current" }),
      { Cookie: cookie! },
    );
    expect(await noToken.text()).toMatch(LOGIN_FORM_RE);
    expect(lastServer().routerState.reboots).toEqual([]);

    const fresh = await scrapeToken(base);
    const res = await post(
      base + REBOOT_CGI_PATH,
      form({ sReboot: "Current", [TOKEN_FIELD]: fresh }),
      { Cookie: cookie! },
    );
    expect(res.status).toBe(200);
    expect(lastServer().routerState.reboots[0]).toMatchObject({
      mode: "Current",
      tokenPresent: true,
    });
  });
});

describe("fake DrayTek fixture — RSA scheme + fixture endpoints", () => {
  it("rsa: login page carries RSAKey/setPublic markers the crate refuses", async () => {
    const base = await start({ scheme: "rsa" });
    const page = await (await get(base + LOGIN_PAGE_PATH)).text();
    expect(page).toMatch(RSA_RE);
    expect(page).toMatch(TOKEN_RE);
  });

  it("exposes /health and /__fixture/state|reset", async () => {
    const base = await start({
      scheme: "classic",
      model: "Vigor2927",
      firmware: "4.4.3.1",
    });
    expect((await get(base + "/health")).status).toBe(200);
    const { cookie } = await login(base, {
      aa: encodeCredential("admin"),
      ab: encodeCredential("admin"),
    });
    await post(base + REBOOT_CGI_PATH, form({ sReboot: "Current" }), {
      Cookie: cookie!,
    });
    const state = await (await get(base + "/__fixture/state")).json();
    expect(state).toMatchObject({
      scheme: "classic",
      model: "Vigor2927",
      firmware: "4.4.3.1",
      activeSessions: 0,
    });
    expect(state.reboots).toHaveLength(1);
    expect(state.loginAttempts).toHaveLength(1);
    await post(base + "/__fixture/reset", "");
    const reset = await (await get(base + "/__fixture/state")).json();
    expect(reset.reboots).toEqual([]);
    expect(reset.loginAttempts).toEqual([]);
  });

  it("rejects an unknown scheme", () => {
    expect(() => createDraytekServer({ scheme: "bogus" as never })).toThrow(
      /unknown login scheme/,
    );
  });
});
