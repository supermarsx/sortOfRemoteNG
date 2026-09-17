// Fake Yealink T2x desk-phone web admin (dependency-free Node `http`).
//
// Emulates BOTH firmware generations described in .orchestration/plans/t66.md
// §Design (the `endpoints.rs` table), and for the servlet generation all three
// login shapes described in `.orchestration/plans/t96.md` §2.1:
//
//   legacy  (T20P/T21P/T22P/T26P/T28P, fw <= v7x)
//     GET  /                                     -> 401 Basic (realm "Yealink SIP-T20P") | 200 with creds
//     GET  /cgi-bin/ConfigManApp.com[?Id=1]      -> Basic-protected status page
//     GET  /cgi-bin/ConfigManApp.com?key=Reboot  -> 200 if ACTION_URI=1 else 403 (Basic required)
//     POST /cgi-bin/ConfigManApp.com  body Reboot=Reboot -> 200 (web-form fallback)
//
//   servlet (T21P E2, all v8x+)
//     GET  /                                                    -> 302 -> loginForm
//     GET  /servlet?m=mod_listener&p=login&q=loginForm          -> login form
//     GET  /js/phone-page.js                                    -> the page's own script bundle
//     POST /servlet?m=mod_listener&p=login&q=login  username/pwd[/rsakey/rsaiv]
//     GET  /servlet?m=mod_data&p=status&q=load    -> status page (cookie) | 302 -> loginForm
//     GET  /servlet?key=Reboot                    -> 200 if ACTION_URI=1 else 403 (Basic or cookie; none -> 401)
//     POST /servlet?m=mod_data&p=settings-upgrade&q=reboot  -> 200 (cookie) | 302 -> loginForm
//
//   servlet login shapes (`authShape`)
//     "plain"    username + cleartext pwd; success -> Set-Cookie + 302 to status,
//                failure -> the login form again (body contains "loginForm").
//     "rsa"      as "plain" but the page carries `var rsakey = "<modulus>"` and
//                `pwd` is base64(RSA-PKCS1(password)). Older/simplified build.
//     "rsa-aes"  the attested T21P E2 contract: the form GET issues a
//                JSESSIONID and publishes `g_rsa_n` / `g_rsa_e`; the page posts
//                pwd=base64(AES-128-CBC-ZeroPad("<rand>;<JSESSIONID>;<password>"))
//                with the AES key and IV RSA-wrapped in rsakey / rsaiv, and the
//                answer is {"authstatus":"done"|"none"|"lock"} inside
//                <div id="_RES_INFO_">. Repeated failures lock the account.
//
//   both generations
//     GET  /health                 -> 200 (docker healthcheck)
//     GET  /__fixture/state        -> JSON { mode, actionUri, rsa, authShape, reboots, loginAttempts, ... }
//     POST /__fixture/reset        -> clears reboot log + sessions + lockout
//
// Every page here is synthetic: no vendor markup or script is copied, and no
// firmware was downloaded or decrypted.
//
// Env: MODE=legacy|servlet|both  PORT (single mode)  PORT_LEGACY=8090  PORT_SERVLET=8091
//      HOST=0.0.0.0  ACTION_URI=0|1  RSA=0|1  AUTH_SHAPE=plain|rsa|rsa-aes
//      LAYOUT=form|formless  PHONE_USERNAME=admin  PHONE_PASSWORD=admin

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LOGIN_FORM_PATH = "/servlet?m=mod_listener&p=login&q=loginForm";
export const LOGIN_POST_PATH = "/servlet?m=mod_listener&p=login&q=login";
export const STATUS_PATH = "/servlet?m=mod_data&p=status&q=load";
export const REBOOT_FORM_PATH =
  "/servlet?m=mod_data&p=settings-upgrade&q=reboot";
export const ACTION_URI_SERVLET = "/servlet?key=Reboot";
export const LEGACY_APP_PATH = "/cgi-bin/ConfigManApp.com";
export const ACTION_URI_LEGACY = `${LEGACY_APP_PATH}?key=Reboot`;
export const PAGE_SCRIPT_PATH = "/js/phone-page.js";
export const SESSION_COOKIE = "JSESSIONID";
export const LEGACY_REALM = "Yealink SIP-T20P";
export const PHONE_TYPE = "T21P_E2";
export const PHONE_FIRMWARE = "52.84.0.125";

/** The field names the phone's login POST carries, in the attested order. */
export const RSA_AES_LOGIN_FIELDS = Object.freeze([
  "username",
  "pwd",
  "rsakey",
  "rsaiv",
]);

const readPage = (gen, name) =>
  fs.readFileSync(path.join(HERE, gen, `${name}.html`), "utf8");

const flag = (value, fallback = false) =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(String(value));

function parseBasic(header) {
  if (!header || !/^Basic\s+/i.test(header)) return null;
  const decoded = Buffer.from(
    header.replace(/^Basic\s+/i, ""),
    "base64",
  ).toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

function parseCookies(header) {
  const out = new Map();
  for (const part of String(header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) out.set(k, rest.join("="));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.from(body ?? "", "utf8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buf.length,
    Server: "Yealink Web Server",
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, status, value) {
  const buf = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

/** The answer body the servlet generation returns for an `authstatus`. */
export function authStatusBody(status) {
  return `<html><head><title>Yealink SIP-${PHONE_TYPE.replace("_", " ")}</title></head><body><div id="_RES_INFO_">{"authstatus":"${status}"}</div></body></html>`;
}

const HEX32 = /^[0-9a-fA-F]{32}$/;

/**
 * Decode one attested RSA+AES login body with the fixture's private key.
 *
 * @returns {{problems: string[], keyHex?: string, ivHex?: string,
 *   random?: string, sessionId?: string, password?: string,
 *   pwdBytes?: number, wrappedBytes?: number}}
 */
export function decodeRsaAesLogin(fields, privateKey, modulusBytes) {
  const problems = [];
  const detail = {};
  const unwrap = (name) => {
    const raw = fields[name];
    if (!raw) {
      problems.push(`${name} is missing`);
      return null;
    }
    const cipher = Buffer.from(raw, "base64");
    if (cipher.length !== modulusBytes)
      problems.push(
        `${name} is ${cipher.length} bytes, expected ${modulusBytes}`,
      );
    detail.wrappedBytes = cipher.length;
    try {
      const plain = crypto
        .privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          cipher,
        )
        .toString("utf8");
      if (!HEX32.test(plain))
        problems.push(`${name} did not unwrap to 32 hex characters`);
      return plain;
    } catch (error) {
      problems.push(`${name} could not be RSA-decrypted: ${error.message}`);
      return null;
    }
  };
  const keyHex = unwrap("rsakey");
  const ivHex = unwrap("rsaiv");
  if (keyHex) detail.keyHex = keyHex;
  if (ivHex) detail.ivHex = ivHex;
  const pwd = fields.pwd ? Buffer.from(fields.pwd, "base64") : null;
  if (!pwd || !pwd.length) problems.push("pwd is missing or not base64");
  else {
    detail.pwdBytes = pwd.length;
    if (pwd.length % 16) problems.push("pwd is not a whole number of blocks");
  }
  if (keyHex && ivHex && pwd && pwd.length && pwd.length % 16 === 0) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        Buffer.from(keyHex, "hex"),
        Buffer.from(ivHex, "hex"),
      );
      decipher.setAutoPadding(false);
      const plaintext = Buffer.concat([decipher.update(pwd), decipher.final()])
        .toString("utf8")
        .replace(/\0+$/u, "");
      const first = plaintext.indexOf(";");
      const second = plaintext.indexOf(";", first + 1);
      if (first < 0 || second < 0)
        problems.push('pwd is not "<random>;<JSESSIONID>;<password>"');
      else {
        detail.random = plaintext.slice(0, first);
        detail.sessionId = plaintext.slice(first + 1, second);
        detail.password = plaintext.slice(second + 1);
      }
    } catch (error) {
      problems.push(`pwd could not be AES-decrypted: ${error.message}`);
    }
  }
  return { ...detail, problems };
}

/**
 * @param {object} [options]
 * @param {"legacy"|"servlet"} [options.mode]
 * @param {boolean} [options.actionUri]   allow `?key=Reboot` (Yealink default: disabled)
 * @param {boolean} [options.rsa]         servlet shorthand for authShape "rsa"
 * @param {"plain"|"rsa"|"rsa-aes"} [options.authShape]
 * @param {"form"|"formless"} [options.layout]  login markup: real <form> or a JS-only box
 * @param {number} [options.lockAfter]    failed rsa-aes logins before "lock" (0 disables)
 * @param {boolean} [options.crossSiteCookie]  send SameSite=None; Secure (embedded frames)
 * @param {(html: string, context: {kind: string, req: object, url: URL}) => string} [options.transformHtml]
 * @param {string}  [options.username]
 * @param {string}  [options.password]
 */
export function createPhoneHandler(options = {}) {
  const mode = options.mode ?? "servlet";
  if (mode !== "legacy" && mode !== "servlet")
    throw new Error(`unknown MODE: ${mode}`);
  const actionUri = options.actionUri ?? false;
  const authShape =
    mode === "servlet"
      ? (options.authShape ?? (options.rsa ? "rsa" : "plain"))
      : "plain";
  if (!["plain", "rsa", "rsa-aes"].includes(authShape))
    throw new Error(`unknown AUTH_SHAPE: ${authShape}`);
  const rsa = authShape !== "plain";
  const layout = options.layout ?? "form";
  if (layout !== "form" && layout !== "formless")
    throw new Error(`unknown LAYOUT: ${layout}`);
  const lockAfter = options.lockAfter ?? 3;
  const crossSiteCookie = options.crossSiteCookie ?? false;
  const transformHtml = options.transformHtml ?? ((html) => html);
  const username = options.username ?? "admin";
  const password = options.password ?? "admin";

  const state = {
    reboots: [],
    sessions: new Set(),
    pending: new Set(),
    loginAttempts: [],
    failures: 0,
    locked: false,
  };
  // A fresh keypair per fixture server: the private half never leaves this
  // process, so nothing resembling a key is committed to the repository.
  const keyPair = rsa
    ? crypto.generateKeyPairSync("rsa", {
        modulusLength: 1024,
        publicExponent: 0x10001,
      })
    : null;
  const modulusHex = keyPair
    ? Buffer.from(
        keyPair.publicKey.export({ format: "jwk" }).n,
        "base64url",
      ).toString("hex")
    : "";
  const exponentHex = keyPair ? "010001" : "";
  const modulusBytes = modulusHex.length >> 1;

  const credsOk = (c) =>
    !!c && c.username === username && c.password === password;
  const recordReboot = (method) =>
    state.reboots.push({ method, at: new Date().toISOString() });

  const decryptPwd = (pwd, rsakey) => {
    if (!keyPair || !rsakey) return pwd;
    try {
      return crypto
        .privateDecrypt(
          {
            key: keyPair.privateKey,
            padding: crypto.constants.RSA_PKCS1_PADDING,
          },
          Buffer.from(pwd, "base64"),
        )
        .toString("utf8");
    } catch {
      return pwd; // older v7x/v80 builds accept plaintext pwd even when a key is served
    }
  };

  const fixtureRoutes = (req, res, url) => {
    if (url.pathname === "/health")
      return send(res, 200, "ok", { "Content-Type": "text/plain" });
    if (url.pathname === "/__fixture/state") {
      return sendJson(res, 200, {
        mode,
        actionUri,
        rsa,
        authShape,
        layout,
        locked: state.locked,
        failures: state.failures,
        reboots: state.reboots,
        loginAttempts: state.loginAttempts,
        activeSessions: state.sessions.size,
      });
    }
    if (url.pathname === "/__fixture/reset" && req.method === "POST") {
      state.reboots.length = 0;
      state.loginAttempts.length = 0;
      state.sessions.clear();
      state.pending.clear();
      state.failures = 0;
      state.locked = false;
      return sendJson(res, 200, { ok: true });
    }
    return false;
  };

  const legacy = async (req, res, url) => {
    const creds = parseBasic(req.headers.authorization);
    const page = (status, name, headers) =>
      send(
        res,
        status,
        transformHtml(readPage("legacy", name), {
          kind: `legacy-${name}`,
          req,
          url,
        }),
        headers,
      );
    if (!credsOk(creds))
      return page(401, "unauthorized", {
        "WWW-Authenticate": `Basic realm="${LEGACY_REALM}"`,
      });
    if (url.pathname === "/") return page(200, "index");
    if (url.pathname !== LEGACY_APP_PATH) return send(res, 404, "Not Found");

    if (req.method === "GET" && url.searchParams.get("key") !== null) {
      if (url.searchParams.get("key") !== "Reboot")
        return send(res, 400, "Unknown key");
      if (!actionUri) return page(403, "forbidden");
      recordReboot("action-uri");
      return page(200, "reboot");
    }
    if (req.method === "POST") {
      const body = new URLSearchParams(await readBody(req));
      if (body.get("Reboot") !== null) {
        recordReboot("web-form");
        return page(200, "reboot");
      }
      return send(res, 400, "Unsupported form");
    }
    // `?Id=1` (status) and the bare app path both render the status page.
    return page(200, "status");
  };

  const pageVars = (sessionId) => {
    const lines = [
      `var g_phonetype="${PHONE_TYPE}";`,
      `var g_strFirmware="${PHONE_FIRMWARE}";`,
    ];
    if (authShape === "rsa") lines.unshift(`var rsakey = "${modulusHex}";`);
    if (authShape === "rsa-aes")
      lines.unshift(
        `var g_rsa_n="${modulusHex}";`,
        `var g_rsa_e="${exponentHex}";`,
        // Cross-site frames may not get the cookie; the page falls back to this.
        `var g_jsessionid="${sessionId}";`,
      );
    return `<script>${lines.join("")}</script>`;
  };

  const newSessionId = () =>
    crypto.randomBytes(16).toString("hex").toUpperCase();

  const setCookie = (id) =>
    `${SESSION_COOKIE}=${id}; Path=/${
      crossSiteCookie ? "; SameSite=None; Secure" : "; HttpOnly"
    }`;

  const servlet = async (req, res, url) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookieId = cookies.get(SESSION_COOKIE) ?? "";
    const sessionOk = state.sessions.has(cookieId);
    const redirectToLogin = () =>
      send(res, 302, "", { Location: LOGIN_FORM_PATH });
    const page = (status, name, headers) =>
      send(
        res,
        status,
        transformHtml(readPage("servlet", name), {
          kind: `servlet-${name}`,
          req,
          url,
        }),
        headers,
      );
    const loginForm = (error = false, sessionId = "") =>
      transformHtml(
        readPage("servlet", "login")
          .replaceAll("{{PAGE_VARS}}", pageVars(sessionId))
          .replaceAll(
            "{{LOGIN_OPEN}}",
            layout === "form"
              ? `<form id="loginForm" name="loginForm" method="post" action="${LOGIN_POST_PATH.replace(/&/gu, "&amp;")}">`
              : '<div id="loginForm">',
          )
          .replaceAll(
            "{{LOGIN_CLOSE}}",
            layout === "form" ? "</form>" : "</div>",
          )
          .replaceAll(
            "{{ERROR}}",
            error
              ? '<div id="loginError">Invalid username or password.</div>'
              : "",
          ),
        { kind: "servlet-login", req, url },
      );

    if (url.pathname === "/") return redirectToLogin();
    if (url.pathname === PAGE_SCRIPT_PATH) {
      const script = fs.readFileSync(
        path.join(HERE, "servlet", "phone-page.js"),
        "utf8",
      );
      return send(res, 200, script, {
        "Content-Type": "text/javascript; charset=utf-8",
      });
    }
    if (url.pathname !== "/servlet") return send(res, 404, "Not Found");

    const key = url.searchParams.get("key");
    if (key !== null) {
      if (key !== "Reboot") return send(res, 400, "Unknown key");
      const basic = parseBasic(req.headers.authorization);
      if (!sessionOk && !credsOk(basic)) {
        return send(res, 401, "Unauthorized", {
          "WWW-Authenticate": 'Basic realm="Yealink"',
        });
      }
      if (!actionUri) return page(403, "forbidden");
      recordReboot("action-uri");
      return page(200, "reboot");
    }

    const m = url.searchParams.get("m");
    const p = url.searchParams.get("p");
    const q = url.searchParams.get("q");

    if (m === "mod_listener" && p === "login") {
      if (q === "loginForm" && req.method === "GET") {
        if (authShape !== "rsa-aes") return send(res, 200, loginForm());
        // The attested flow hands out the session before authenticating: the
        // page's own script needs the id to build the encrypted password.
        const id = newSessionId();
        state.pending.add(id);
        return send(res, 200, loginForm(false, id), {
          "Set-Cookie": setCookie(id),
        });
      }
      if (q === "login" && req.method === "POST") {
        const body = new URLSearchParams(await readBody(req));
        if (authShape === "rsa-aes")
          return rsaAesLogin(res, url, body, cookieId);
        const user = body.get("username") ?? "";
        const pwd = decryptPwd(body.get("pwd") ?? "", body.get("rsakey"));
        const shape = body.get("rsakey") ? "form-rsa" : "form-plain";
        const ok = credsOk({ username: user, password: pwd });
        state.loginAttempts.push({ username: user, shape, ok });
        if (!ok) return send(res, 200, loginForm(true));
        const id = newSessionId();
        state.sessions.add(id);
        return send(res, 302, "", {
          Location: STATUS_PATH,
          "Set-Cookie": setCookie(id),
        });
      }
      if (q === "logout") {
        state.sessions.delete(cookieId);
        return redirectToLogin();
      }
      return send(res, 404, "Not Found");
    }

    if (m === "mod_data") {
      if (!sessionOk) return redirectToLogin();
      if (p === "status" && q === "load") return page(200, "status");
      if (p === "settings-upgrade" && q === "reboot" && req.method === "POST") {
        await readBody(req);
        recordReboot("web-form");
        return page(200, "reboot");
      }
      if (p === "settings-upgrade" && q === "load")
        return page(200, "settings-upgrade");
      return send(res, 404, "Not Found");
    }
    return send(res, 404, "Not Found");

    function rsaAesLogin(response, requestUrl, body, presentedCookie) {
      const fields = {};
      for (const [name, value] of body) fields[name] = value;
      const decoded = decodeRsaAesLogin(
        fields,
        keyPair.privateKey,
        modulusBytes,
      );
      const unexpected = Object.keys(fields).filter(
        (name) => !RSA_AES_LOGIN_FIELDS.includes(name),
      );
      const seen = new Set(decoded.problems);
      if (unexpected.length)
        seen.add(`unexpected fields: ${unexpected.join(", ")}`);
      for (const name of RSA_AES_LOGIN_FIELDS)
        if (!(name in fields)) seen.add(`${name} is missing`);
      if (!requestUrl.searchParams.get("Rajax"))
        seen.add("the login POST carried no Rajax cache buster");
      const problems = [...seen];
      const known =
        !!decoded.sessionId &&
        (state.pending.has(decoded.sessionId) ||
          state.sessions.has(decoded.sessionId));
      const detail = {
        fields: Object.keys(fields),
        pwdBytes: decoded.pwdBytes ?? 0,
        wrappedBytes: decoded.wrappedBytes ?? 0,
        keyLooksHex: HEX32.test(decoded.keyHex ?? ""),
        ivLooksHex: HEX32.test(decoded.ivHex ?? ""),
        session: !decoded.sessionId ? "missing" : known ? "matched" : "unknown",
        cookieSeen: presentedCookie === decoded.sessionId && !!presentedCookie,
        randomPrefix: !!decoded.random,
        problems,
      };
      const user = fields.username ?? "";
      const record = (ok, authstatus) => {
        state.loginAttempts.push({
          username: user,
          shape: "form-rsa-aes",
          ok,
          authstatus,
          detail,
        });
      };
      // The page's session is gone: the phone answers with the login form
      // again, which the client detects by the `idUsername` marker.
      if (!known && !problems.length) {
        record(false, null);
        return send(response, 200, loginForm(false, ""));
      }
      if (state.locked || (lockAfter > 0 && state.failures >= lockAfter)) {
        state.locked = true;
        record(false, "lock");
        return send(response, 200, authStatusBody("lock"));
      }
      const ok =
        !problems.length &&
        known &&
        credsOk({ username: user, password: decoded.password ?? "" });
      if (!ok) {
        state.failures++;
        if (lockAfter > 0 && state.failures >= lockAfter) state.locked = true;
        record(false, "none");
        return send(response, 200, authStatusBody("none"));
      }
      state.failures = 0;
      state.pending.delete(decoded.sessionId);
      state.sessions.add(decoded.sessionId);
      record(true, "done");
      return send(response, 200, authStatusBody("done"), {
        "Set-Cookie": setCookie(decoded.sessionId),
      });
    }
  };

  const handle = (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    if (fixtureRoutes(req, res, url) !== false) return;
    const handler = mode === "legacy" ? legacy : servlet;
    handler(req, res, url).catch((err) => send(res, 500, String(err)));
  };

  return {
    handle,
    state,
    mode,
    authShape,
    layout,
    rsaModulusHex: modulusHex,
    rsaExponentHex: exponentHex,
    privateKey: keyPair?.privateKey ?? null,
  };
}

/** @param {Parameters<typeof createPhoneHandler>[0]} [options] */
export function createPhoneServer(options = {}) {
  const phone = createPhoneHandler(options);
  const server = http.createServer(phone.handle);
  server.phoneState = phone.state;
  server.phoneMode = phone.mode;
  server.phoneAuthShape = phone.authShape;
  server.rsaModulusHex = phone.rsaModulusHex;
  server.rsaExponentHex = phone.rsaExponentHex;
  server.phonePrivateKey = phone.privateKey;
  return server;
}

export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host }, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;
  const host = env.HOST ?? "0.0.0.0";
  const common = {
    actionUri: flag(env.ACTION_URI),
    rsa: flag(env.RSA),
    authShape: env.AUTH_SHAPE,
    layout: env.LAYOUT,
    username: env.PHONE_USERNAME ?? "admin",
    password: env.PHONE_PASSWORD ?? "admin",
  };
  if (!common.authShape) delete common.authShape;
  if (!common.layout) delete common.layout;
  const mode = env.MODE ?? "both";
  const plan =
    mode === "both"
      ? [
          ["legacy", Number(env.PORT_LEGACY ?? 8090)],
          ["servlet", Number(env.PORT_SERVLET ?? 8091)],
        ]
      : [[mode, Number(env.PORT ?? (mode === "legacy" ? 8090 : 8091))]];
  for (const [m, port] of plan) {
    const srv = createPhoneServer({ ...common, mode: m });
    await listen(srv, port, host);
    console.log(
      `[voip-phone fixture] ${m} listening on http://${host}:${port} actionUri=${common.actionUri} authShape=${srv.phoneAuthShape}`,
    );
  }
}
