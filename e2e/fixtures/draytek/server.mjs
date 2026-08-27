// Fake DrayTek Vigor (DrayOS) web admin — dependency-free Node `http` (t68-e4).
//
// Emulates the two DrayOS login generations described in
// .orchestration/plans/t68.md §1 so the `sorng-draytek` crate can be driven
// end-to-end without hardware:
//
//   classic  (fw < 4.4)
//     GET  /  and  /weblogin.htm            -> login page (form action wlogin.cgi, no token)
//     POST /cgi-bin/wlogin.cgi  aa=b64(user)&ab=b64(pass)
//     GET  /cgi-bin/wlogin.cgi?aa=..&ab=..  (the Home-Assistant / "Open Web UI"
//                                            pre-auth GET form of the same login)
//          success -> 200 dashboard + Set-Cookie: SESSION_ID_VIGOR
//          failure -> 200 login page again (body still contains the form)
//
//   token    (fw >= 4.4) — same as classic, plus a hidden `sFormAuthStr`
//            on the login page that MUST be echoed in every POST
//            (wlogin.cgi and reboot.cgi); a stale/missing token = login page.
//
//   rsa      (some 4.4+ models) — login page also emits an RSAKey/setPublic()
//            script. The crate refuses this scheme (UnsupportedFirmwareLogin,
//            "use Open Web UI") without POSTing credentials; the fixture still
//            accepts a plain base64 login so the pre-auth URL keeps working.
//
//   all schemes
//     GET  /doc/status.sht | /doc/online.sht | /doc/index.sht
//          -> status page (cookie) | login page (no/expired cookie)
//     POST /cgi-bin/reboot.cgi  sReboot=Current[&sFormAuthStr=..]
//          -> 200 "rebooting" page, session dropped (cookie) | login page
//     GET  /cgi-bin/wlogout.cgi  -> drops the session, login page
//     GET  /health               -> 200 (docker healthcheck)
//     GET  /__fixture/state      -> JSON { scheme, model, firmware, reboots, loginAttempts, activeSessions }
//     POST /__fixture/reset      -> clears reboots / login attempts / sessions
//
// Env (CLI): MODE=classic|token|rsa|both  PORT (single mode)
//            PORT_CLASSIC=8092  PORT_TOKEN=8093  HOST=0.0.0.0
//            ROUTER_USERNAME=admin  ROUTER_PASSWORD=admin
//            ROUTER_MODEL=Vigor2862ac  ROUTER_FIRMWARE=3.9.7.1  ROUTER_NAME=vigor-e2e

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOGIN_PAGE_PATH = "/weblogin.htm";
export const LOGIN_CGI_PATH = "/cgi-bin/wlogin.cgi";
export const LOGOUT_CGI_PATH = "/cgi-bin/wlogout.cgi";
export const REBOOT_CGI_PATH = "/cgi-bin/reboot.cgi";
export const STATUS_PAGE_PATHS = [
  "/doc/status.sht",
  "/doc/online.sht",
  "/doc/index.sht",
];
export const SESSION_COOKIE = "SESSION_ID_VIGOR";
export const TOKEN_FIELD = "sFormAuthStr";

export const DEFAULT_MODEL = "Vigor2862ac";
export const DEFAULT_FIRMWARE = "3.9.7.1";
export const DEFAULT_BUILD = "Feb 17 2022 12:21:04";
export const DEFAULT_ROUTER_NAME = "vigor-e2e";
export const DEFAULT_UPTIME = "3d 04:12:55";
export const DEFAULT_WAN = [
  {
    name: "WAN1",
    status: "Up",
    ip: "203.0.113.5",
    gateway: "203.0.113.1",
  },
  { name: "WAN2", status: "Down", ip: "---", gateway: "---" },
];

const flag = (value, fallback = false) =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(String(value));

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** base64 → utf8, tolerant of URL-encoding and missing padding. */
export function decodeCredential(value) {
  if (value === null || value === undefined) return "";
  let raw = String(value);
  try {
    raw = decodeURIComponent(raw.replaceAll("+", " "));
  } catch {
    // already decoded
  }
  raw = raw.trim().replaceAll(" ", "+");
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** utf8 → base64 (the `aa`/`ab` wire encoding). */
export function encodeCredential(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
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
    Server: "DrayTek/DrayOS",
    "Cache-Control": "no-cache",
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

// ── Page templates ──────────────────────────────────────────────────────────
// The crate's `contains_login_form` matches `<form … wlogin.cgi`, inputs
// named `aa`/`ab`, or the `sUsername`/`sPassword` ids. Only the login page may
// contain any of those markers; every post-login page must stay clean.

function loginPage({ scheme, token, model, error }) {
  const tokenInput =
    scheme === "classic"
      ? ""
      : `      <input type="hidden" name="${TOKEN_FIELD}" value="${escapeHtml(token)}">\n`;
  const rsaScript =
    scheme === "rsa"
      ? `  <script src="/js/rsa.js"></script>
  <script>
    var rsa = new RSAKey();
    rsa.setPublic("b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2", "10001");
    function encPass(p) { return hex2b64(rsa.encrypt(p)); }
  </script>
`
      : "";
  const errorBlock = error
    ? `    <div id="loginError" class="error">Login failed: invalid username or password.</div>\n`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(model)} Login</title>
${rsaScript}  <script>
    function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
    function doLogin() {
      var f = document.forms.LoginForm;
      f.aa.value = b64(document.getElementById("sUsername").value);
      f.ab.value = b64(document.getElementById("sPassword").value);
      f.submit();
      return false;
    }
  </script>
</head>
<body class="draytek-login">
  <div class="logo">DrayTek</div>
  <h1>${escapeHtml(model)}</h1>
${errorBlock}  <form name="LoginForm" method="post" action="${LOGIN_CGI_PATH}" onsubmit="return doLogin()">
      <label>Username <input type="text" id="sUsername" autocomplete="off"></label>
      <label>Password <input type="password" id="sPassword" autocomplete="off"></label>
      <input type="hidden" name="aa" value="">
      <input type="hidden" name="ab" value="">
${tokenInput}      <input type="submit" value="Login">
  </form>
</body>
</html>
`;
}

function dashboardPage({ model, routerName, token }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(model)}</title>
<meta http-equiv="refresh" content="0; url=/doc/status.sht"></head>
<body class="draytek-dashboard">
  <div id="banner">Welcome to ${escapeHtml(routerName)} (${escapeHtml(model)})</div>
  <p>Login successful. Loading <a href="/doc/status.sht">Online Status</a>...</p>
  ${token ? `<script>var ${TOKEN_FIELD}="${escapeHtml(token)}";</script>` : ""}
</body>
</html>
`;
}

function statusPage({ model, firmware, build, routerName, uptime, wan }) {
  const rows = wan
    .map(
      (w) =>
        `      <tr><td>${escapeHtml(w.name)}</td><td>${escapeHtml(w.status)}</td><td>${escapeHtml(w.ip)}</td><td>${escapeHtml(w.gateway)}</td></tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(model)}</title></head>
<body class="draytek-status">
  <h1>Online Status : Physical Connection</h1>
  <table id="sysinfo">
    <tr><td>Model Name</td><td>${escapeHtml(model)}</td></tr>
    <tr><td>Firmware Version</td><td>${escapeHtml(firmware)}</td></tr>
    <tr><td>Build Date/Time</td><td>${escapeHtml(build)}</td></tr>
    <tr><td>Router Name</td><td>${escapeHtml(routerName)}</td></tr>
    <tr><td>System Up Time</td><td>${escapeHtml(uptime)}</td></tr>
  </table>
  <h2>WAN Status</h2>
  <table id="wan">
    <tr><th>Interface</th><th>Status</th><th>IP Address</th><th>Gateway</th></tr>
${rows}
  </table>
</body>
</html>
`;
}

function rebootPage({ model }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(model)}</title></head>
<body class="draytek-reboot">
  <h1>System Maintenance : Reboot System</h1>
  <p>The router is rebooting with the current configuration. Please wait...</p>
</body>
</html>
`;
}

/**
 * @param {object} [options]
 * @param {"classic"|"token"|"rsa"} [options.scheme]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.model]
 * @param {string} [options.firmware]
 * @param {string} [options.build]
 * @param {string} [options.routerName]
 * @param {string} [options.uptime]
 * @param {Array<{name:string,status:string,ip:string,gateway:string}>} [options.wan]
 */
export function createDraytekServer(options = {}) {
  const scheme = options.scheme ?? "classic";
  if (scheme !== "classic" && scheme !== "token" && scheme !== "rsa")
    throw new Error(`unknown login scheme: ${scheme}`);
  const username = options.username ?? "admin";
  const password = options.password ?? "admin";
  const device = {
    model: options.model ?? DEFAULT_MODEL,
    firmware: options.firmware ?? DEFAULT_FIRMWARE,
    build: options.build ?? DEFAULT_BUILD,
    routerName: options.routerName ?? DEFAULT_ROUTER_NAME,
    uptime: options.uptime ?? DEFAULT_UPTIME,
    wan: options.wan ?? DEFAULT_WAN,
  };

  const state = {
    reboots: [],
    loginAttempts: [],
    sessions: new Set(),
    tokens: new Set(),
  };
  const usesToken = scheme !== "classic";

  const issueToken = () => {
    const token = crypto.randomBytes(8).toString("hex");
    state.tokens.add(token);
    return token;
  };
  const tokenOk = (token) =>
    !usesToken || (typeof token === "string" && state.tokens.has(token));
  const credsOk = (user, pass) => user === username && pass === password;

  const loginHtml = (error = false) =>
    loginPage({
      scheme,
      token: usesToken ? issueToken() : "",
      model: device.model,
      error,
    });

  const fixtureRoutes = (req, res, url) => {
    if (url.pathname === "/health")
      return send(res, 200, "ok", { "Content-Type": "text/plain" });
    if (url.pathname === "/__fixture/state") {
      return sendJson(res, 200, {
        scheme,
        model: device.model,
        firmware: device.firmware,
        routerName: device.routerName,
        reboots: state.reboots,
        loginAttempts: state.loginAttempts,
        activeSessions: state.sessions.size,
      });
    }
    if (url.pathname === "/__fixture/reset" && req.method === "POST") {
      state.reboots.length = 0;
      state.loginAttempts.length = 0;
      state.sessions.clear();
      state.tokens.clear();
      return sendJson(res, 200, { ok: true });
    }
    return false;
  };

  const handle = async (req, res, url) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.get(SESSION_COOKIE) ?? "";
    const sessionOk = state.sessions.has(sessionId);

    if (url.pathname === "/" || url.pathname === LOGIN_PAGE_PATH) {
      return send(res, 200, loginHtml());
    }

    if (url.pathname === LOGIN_CGI_PATH) {
      let fields;
      let method;
      if (req.method === "POST") {
        fields = new URLSearchParams(await readBody(req));
        method = "post";
      } else {
        fields = url.searchParams;
        method = "get";
      }
      const user = decodeCredential(fields.get("aa"));
      const pass = decodeCredential(fields.get("ab"));
      const token = fields.get(TOKEN_FIELD);
      // Real DrayOS only enforces the token on the POST form; the GET
      // pre-auth URL (Open Web UI) has nowhere to carry one.
      const tokenAccepted = method === "get" ? true : tokenOk(token);
      const ok = credsOk(user, pass) && tokenAccepted;
      state.loginAttempts.push({
        username: user,
        method,
        tokenPresent: typeof token === "string" && token.length > 0,
        tokenAccepted,
        ok,
      });
      if (!ok) return send(res, 200, loginHtml(true));
      if (typeof token === "string") state.tokens.delete(token);
      const id = crypto.randomBytes(16).toString("hex").toUpperCase();
      state.sessions.add(id);
      return send(
        res,
        200,
        dashboardPage({
          model: device.model,
          routerName: device.routerName,
          token: usesToken ? issueToken() : "",
        }),
        { "Set-Cookie": `${SESSION_COOKIE}=${id}; Path=/; HttpOnly` },
      );
    }

    if (url.pathname === LOGOUT_CGI_PATH) {
      state.sessions.delete(sessionId);
      return send(res, 200, loginHtml(), {
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0`,
      });
    }

    if (STATUS_PAGE_PATHS.includes(url.pathname)) {
      if (!sessionOk) return send(res, 200, loginHtml());
      return send(res, 200, statusPage(device));
    }

    if (url.pathname === REBOOT_CGI_PATH) {
      if (!sessionOk) return send(res, 200, loginHtml());
      const fields =
        req.method === "POST"
          ? new URLSearchParams(await readBody(req))
          : url.searchParams;
      const token = fields.get(TOKEN_FIELD);
      if (!tokenOk(token)) return send(res, 200, loginHtml(true));
      state.reboots.push({
        at: new Date().toISOString(),
        method: req.method === "POST" ? "post" : "get",
        mode: fields.get("sReboot") ?? "",
        tokenPresent: typeof token === "string" && token.length > 0,
      });
      // A rebooting router forgets every session.
      state.sessions.clear();
      state.tokens.clear();
      return send(res, 200, rebootPage(device));
    }

    if (url.pathname.startsWith("/js/")) {
      return send(res, 200, "/* stub */", {
        "Content-Type": "application/javascript",
      });
    }

    return send(res, 404, "<html><body>404 Not Found</body></html>");
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    if (fixtureRoutes(req, res, url) !== false) return;
    handle(req, res, url).catch((err) => send(res, 500, String(err)));
  });
  server.routerState = state;
  server.routerScheme = scheme;
  server.routerDevice = device;
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
    username: env.ROUTER_USERNAME ?? "admin",
    password: env.ROUTER_PASSWORD ?? "admin",
    model: env.ROUTER_MODEL ?? DEFAULT_MODEL,
    firmware: env.ROUTER_FIRMWARE ?? DEFAULT_FIRMWARE,
    routerName: env.ROUTER_NAME ?? DEFAULT_ROUTER_NAME,
  };
  const mode = env.MODE ?? "both";
  const plan =
    mode === "both"
      ? [
          ["classic", Number(env.PORT_CLASSIC ?? 8092)],
          [flag(env.RSA) ? "rsa" : "token", Number(env.PORT_TOKEN ?? 8093)],
        ]
      : [[mode, Number(env.PORT ?? (mode === "classic" ? 8092 : 8093))]];
  for (const [scheme, port] of plan) {
    const srv = createDraytekServer({ ...common, scheme });
    await listen(srv, port, host);
    console.log(
      `[draytek fixture] ${scheme} listening on http://${host}:${port} model=${common.model} fw=${common.firmware}`,
    );
  }
}
