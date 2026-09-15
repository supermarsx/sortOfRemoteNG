// Synthetic Synology DSM 7.2 website for the t85 web view auto-fill e2e.
//
// Compose service `test-dsm-web` runs this with Node 24 (type stripping) on
// HTTPS 8446, using the disposable certificate from
// scripts/ci/e2e-http-fixtures.mjs. It is not a real or Virtual DSM: the page is
// e1's DSM simulator (`tests/fixtures/synology/dsmLoginTimeline.ts`) replaying a
// named boot timeline, and the login API answers with DSM 7 shapes.
//
// Page and API (what the proxied web view sees):
//   GET  /  and  /webman/index.cgi   static index.html (records a document hit)
//   GET  /webman/fixture-config.js   timeline for the selected variant
//   GET  /webman/dsm-runtime.js      createDsmMarkup + createDsmPage source
//   GET  /webman/modules/boot.js     chained parser-blocking chunks (slow in `slow`)
//   POST /webapi/entry.cgi           SYNO.API.Auth.Type get / SYNO.API.Auth login
//   POST /webman/fixture-event.cgi   page milestones from app.js
//
// Control (the spec calls these directly, not through the app):
//   GET  /__fixture/health
//   POST /__fixture/reset?variant=standard|slow|otp   clears hits, returns scenario
//   GET  /__fixture/hits                              recorded hits (no secrets)
//
// Env: PORT (8446), HOST (127.0.0.1), TLS_CERT, TLS_KEY, DSM_TIMELINE_MODULE,
// DSM_WEB_VARIANT. Run on the host with `node e2e/fixtures/synology-dsm-web/server.mjs`
// after `node scripts/ci/e2e-http-fixtures.mjs prepare`; PORT=0 picks a free port
// and a forked parent receives `{ type: "dsm-web-ready", port }`.
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDsmWebState, isDsmWebVariant } from "./fixture.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const BODY_LIMIT = 64 * 1024;
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/webman/index.cgi": ["index.html", "text/html; charset=utf-8"],
  "/webman/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/webman/style.css": ["style.css", "text/css; charset=utf-8"],
};

const env = (name, fallback) => process.env[name] || fallback;
const timelineModule = await import(
  pathToFileURL(
    env(
      "DSM_TIMELINE_MODULE",
      path.join(
        repoRoot,
        "tests",
        "fixtures",
        "synology",
        "dsmLoginTimeline.ts",
      ),
    ),
  ).href
);
const runtimeSource = timelineModule.dsmPageRuntimeSource();
const initialVariant = env("DSM_WEB_VARIANT", "standard");
if (!isDsmWebVariant(initialVariant))
  throw new Error(`Unknown DSM_WEB_VARIANT ${initialVariant}`);
const state = createDsmWebState({
  timelines: timelineModule.DSM_LOGIN_TIMELINES,
  account: timelineModule.DSM_SYNTHETIC_ACCOUNT,
  variant: initialVariant,
});

function send(response, status, type, body) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}
const sendJson = (response, status, value) =>
  send(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(value),
  );

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

// Delayed replies are dropped if the client goes away first.
function later(response, delayMs, action) {
  if (delayMs <= 0) return action();
  const timer = setTimeout(action, delayMs);
  response.on("close", () => clearTimeout(timer));
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "https://dsm.invalid");
  const method = request.method ?? "GET";
  const route = `${method} ${url.pathname}`;

  // Node omits the body for HEAD, so a probe sees DSM's normal 200.
  if ((method === "GET" || method === "HEAD") && STATIC_FILES[url.pathname]) {
    const [file, type] = STATIC_FILES[url.pathname];
    if (file === "index.html")
      state.recordDocument(
        url.pathname,
        method,
        request.headers["sec-fetch-dest"]?.toString(),
      );
    return send(response, 200, type, fs.readFileSync(path.join(here, file)));
  }
  switch (route) {
    case "GET /webman/fixture-config.js":
      return send(
        response,
        200,
        "text/javascript; charset=utf-8",
        `window.__DSM_FIXTURE__ = ${JSON.stringify(state.pageConfig())};\n`,
      );
    case "GET /webman/dsm-runtime.js":
      return send(
        response,
        200,
        "text/javascript; charset=utf-8",
        runtimeSource,
      );
    case "GET /webman/modules/boot.js": {
      const chunk = state.bootChunk(url.searchParams.get("chunk") ?? "");
      const body = chunk.next
        ? `document.write('<script src="/webman/modules/boot.js?chunk=${chunk.next}"><\\/script>');\n`
        : "/* synthetic DSM boot chunk */\n";
      return later(response, chunk.delayMs, () =>
        send(response, 200, "text/javascript; charset=utf-8", body),
      );
    }
    case "GET /webapi/entry.cgi":
    case "POST /webapi/entry.cgi": {
      const params = new URLSearchParams(url.search);
      if (method === "POST")
        for (const [key, value] of new URLSearchParams(await readBody(request)))
          params.append(key, value);
      const result = state.handleEntryCgi(params, method);
      return later(response, result.delayMs, () =>
        sendJson(response, result.status, result.body),
      );
    }
    case "POST /webman/fixture-event.cgi": {
      let value = null;
      try {
        value = JSON.parse(await readBody(request));
      } catch {
        // Recorded as refused below.
      }
      const recorded = state.recordPageEvent(value);
      return sendJson(response, recorded ? 200 : 400, { success: recorded });
    }
    case "GET /__fixture/health":
      return sendJson(response, 200, { status: "ok", variant: state.variant });
    case "POST /__fixture/reset": {
      const variant = url.searchParams.get("variant") ?? state.variant;
      if (!isDsmWebVariant(variant))
        return sendJson(response, 400, { error: `unknown variant ${variant}` });
      return sendJson(response, 200, state.reset(variant));
    }
    case "GET /__fixture/hits":
      return sendJson(response, 200, state.snapshot());
    case "GET /favicon.ico":
      return send(response, 204, "text/plain", "");
    default:
      return sendJson(response, 404, { success: false, error: { code: 404 } });
  }
}

const server = https.createServer(
  {
    cert: fs.readFileSync(
      env(
        "TLS_CERT",
        path.join(repoRoot, "e2e", ".generated", "http", "ssl", "server.crt"),
      ),
    ),
    key: fs.readFileSync(
      env(
        "TLS_KEY",
        path.join(repoRoot, "e2e", ".generated", "http", "ssl", "server.key"),
      ),
    ),
  },
  (request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent)
        sendJson(response, 500, { success: false, error: String(error) });
      else response.destroy();
    });
  },
);

server.listen(Number(env("PORT", "8446")), env("HOST", "127.0.0.1"), () => {
  const { port } = server.address();
  console.log(`[dsm-web] synthetic DSM website on https://127.0.0.1:${port}/`);
  process.send?.({ type: "dsm-web-ready", port });
});

// A forked fixture exits with its parent.
process.on("disconnect", () => process.exit(0));
// PID 1 in the container gets no default signal handling.
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
