// Fake Yealink T2x desk-phone web admin (dependency-free Node `http`).
//
// Emulates BOTH firmware generations described in .orchestration/plans/t66.md
// §Design (the `endpoints.rs` table):
//
//   legacy  (T20P/T21P/T22P/T26P/T28P, fw <= v7x)
//     GET  /                                     -> 401 Basic (realm "Yealink SIP-T20P") | 200 with creds
//     GET  /cgi-bin/ConfigManApp.com[?Id=1]      -> Basic-protected status page
//     GET  /cgi-bin/ConfigManApp.com?key=Reboot  -> 200 if ACTION_URI=1 else 403 (Basic required)
//     POST /cgi-bin/ConfigManApp.com  body Reboot=Reboot -> 200 (web-form fallback)
//
//   servlet (T21P E2, all v8x+)
//     GET  /                                                    -> 302 -> loginForm
//     GET  /servlet?m=mod_listener&p=login&q=loginForm          -> login form (+ `rsakey` when RSA=1)
//     POST /servlet?m=mod_listener&p=login&q=login  username/pwd/rsakey
//          success -> Set-Cookie: JSESSIONID + 302 -> /servlet?m=mod_data&p=status&q=load
//          failure -> 200 login form again (body contains "loginForm")
//     GET  /servlet?m=mod_data&p=status&q=load    -> status page (cookie) | 302 -> loginForm
//     GET  /servlet?key=Reboot                    -> 200 if ACTION_URI=1 else 403 (Basic or cookie; none -> 401)
//     POST /servlet?m=mod_data&p=settings-upgrade&q=reboot  -> 200 (cookie) | 302 -> loginForm
//
//   both generations
//     GET  /health                 -> 200 (docker healthcheck)
//     GET  /__fixture/state        -> JSON { mode, actionUri, rsa, reboots: [{method, at}] }
//     POST /__fixture/reset        -> clears reboot log + sessions
//
// Env: MODE=legacy|servlet|both  PORT (single mode)  PORT_LEGACY=8090  PORT_SERVLET=8091
//      HOST=0.0.0.0  ACTION_URI=0|1  RSA=0|1  PHONE_USERNAME=admin  PHONE_PASSWORD=admin

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
export const SESSION_COOKIE = "JSESSIONID";
export const LEGACY_REALM = "Yealink SIP-T20P";

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

/**
 * @param {object} [options]
 * @param {"legacy"|"servlet"} [options.mode]
 * @param {boolean} [options.actionUri]   allow `?key=Reboot` (Yealink default: disabled)
 * @param {boolean} [options.rsa]         servlet: serve an RSA public key + accept RSA-encrypted `pwd`
 * @param {string}  [options.username]
 * @param {string}  [options.password]
 */
export function createPhoneServer(options = {}) {
  const mode = options.mode ?? "servlet";
  if (mode !== "legacy" && mode !== "servlet")
    throw new Error(`unknown MODE: ${mode}`);
  const actionUri = options.actionUri ?? false;
  const rsa = mode === "servlet" && (options.rsa ?? false);
  const username = options.username ?? "admin";
  const password = options.password ?? "admin";

  const state = { reboots: [], sessions: new Set(), loginAttempts: [] };
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
        reboots: state.reboots,
        loginAttempts: state.loginAttempts,
        activeSessions: state.sessions.size,
      });
    }
    if (url.pathname === "/__fixture/reset" && req.method === "POST") {
      state.reboots.length = 0;
      state.loginAttempts.length = 0;
      state.sessions.clear();
      return sendJson(res, 200, { ok: true });
    }
    return false;
  };

  const legacy = async (req, res, url) => {
    const creds = parseBasic(req.headers.authorization);
    if (!credsOk(creds)) {
      return send(res, 401, readPage("legacy", "unauthorized"), {
        "WWW-Authenticate": `Basic realm="${LEGACY_REALM}"`,
      });
    }
    if (url.pathname === "/")
      return send(res, 200, readPage("legacy", "index"));
    if (url.pathname !== LEGACY_APP_PATH) return send(res, 404, "Not Found");

    if (req.method === "GET" && url.searchParams.get("key") !== null) {
      if (url.searchParams.get("key") !== "Reboot")
        return send(res, 400, "Unknown key");
      if (!actionUri) return send(res, 403, readPage("legacy", "forbidden"));
      recordReboot("action-uri");
      return send(res, 200, readPage("legacy", "reboot"));
    }
    if (req.method === "POST") {
      const body = new URLSearchParams(await readBody(req));
      if (body.get("Reboot") !== null) {
        recordReboot("web-form");
        return send(res, 200, readPage("legacy", "reboot"));
      }
      return send(res, 400, "Unsupported form");
    }
    // `?Id=1` (status) and the bare app path both render the status page.
    return send(res, 200, readPage("legacy", "status"));
  };

  const servlet = async (req, res, url) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionOk = state.sessions.has(cookies.get(SESSION_COOKIE) ?? "");
    const redirectToLogin = () =>
      send(res, 302, "", { Location: LOGIN_FORM_PATH });
    const loginForm = (error = false) =>
      readPage("servlet", "login")
        .replaceAll(
          "<!-- {{RSAKEY_SCRIPT}} -->",
          rsa ? `<script>var rsakey = "${modulusHex}";</script>` : "",
        )
        .replaceAll(
          "{{ERROR}}",
          error
            ? '<div id="loginError">Invalid username or password.</div>'
            : "",
        );

    if (url.pathname === "/") return redirectToLogin();
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
      if (!actionUri) return send(res, 403, readPage("servlet", "forbidden"));
      recordReboot("action-uri");
      return send(res, 200, readPage("servlet", "reboot"));
    }

    const m = url.searchParams.get("m");
    const p = url.searchParams.get("p");
    const q = url.searchParams.get("q");

    if (m === "mod_listener" && p === "login") {
      if (q === "loginForm" && req.method === "GET")
        return send(res, 200, loginForm());
      if (q === "login" && req.method === "POST") {
        const body = new URLSearchParams(await readBody(req));
        const user = body.get("username") ?? "";
        const pwd = decryptPwd(body.get("pwd") ?? "", body.get("rsakey"));
        const shape = body.get("rsakey") ? "form-rsa" : "form-plain";
        const ok = credsOk({ username: user, password: pwd });
        state.loginAttempts.push({ username: user, shape, ok });
        if (!ok) return send(res, 200, loginForm(true));
        const id = crypto.randomBytes(16).toString("hex").toUpperCase();
        state.sessions.add(id);
        return send(res, 302, "", {
          Location: STATUS_PATH,
          "Set-Cookie": `${SESSION_COOKIE}=${id}; Path=/; HttpOnly`,
        });
      }
      if (q === "logout") {
        state.sessions.delete(cookies.get(SESSION_COOKIE) ?? "");
        return redirectToLogin();
      }
      return send(res, 404, "Not Found");
    }

    if (m === "mod_data") {
      if (!sessionOk) return redirectToLogin();
      if (p === "status" && q === "load")
        return send(res, 200, readPage("servlet", "status"));
      if (p === "settings-upgrade" && q === "reboot" && req.method === "POST") {
        await readBody(req);
        recordReboot("web-form");
        return send(res, 200, readPage("servlet", "reboot"));
      }
      if (p === "settings-upgrade" && q === "load") {
        return send(res, 200, readPage("servlet", "settings-upgrade"));
      }
      return send(res, 404, "Not Found");
    }
    return send(res, 404, "Not Found");
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    if (fixtureRoutes(req, res, url) !== false) return;
    const handler = mode === "legacy" ? legacy : servlet;
    handler(req, res, url).catch((err) => send(res, 500, String(err)));
  });
  server.phoneState = state;
  server.phoneMode = mode;
  server.rsaModulusHex = modulusHex;
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
    username: env.PHONE_USERNAME ?? "admin",
    password: env.PHONE_PASSWORD ?? "admin",
  };
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
      `[voip-phone fixture] ${m} listening on http://${host}:${port} actionUri=${common.actionUri} rsa=${common.rsa}`,
    );
  }
}
