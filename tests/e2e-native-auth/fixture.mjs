// Disposable loopback-only acceptance target. Never imports application code,
// launches a browser, installs trust, or records submitted credential values.
import { createServer } from "node:https";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// PUBLIC TEST VECTORS ONLY. These must never be replaced with real credentials.
export const SYNTHETIC = Object.freeze({
  email: "synthetic@example.test",
  password: "local-only-not-a-real-password",
  totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
});
const lifetimeMs = 15 * 60_000;
const runFile = promisify(execFile);
const stages = {
  staged: ["email", "password", "totp"],
  modular: ["credentials", "totp"],
  gitea: ["credentials", "totp"],
};
const starts = {
  "/staged": "staged",
  "/modular": "modular",
  "/user/login": "gitea",
};
const fieldNames = {
  email: ["email"],
  password: ["password"],
  credentials: ["email", "password"],
  totp: ["totp"],
};

export function totpAt(timeMs = Date.now()) {
  // RFC 6238's public SHA-1 test seed, six digits, 30-second period.
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const digest = createHmac("sha1", Buffer.from("12345678901234567890"))
    .update(counter)
    .digest();
  const offset = digest.at(-1) & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}

function equal(a, b) {
  return (
    typeof a === "string" &&
    a.length <= 256 &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

export function inputVerdict(raw, length) {
  const counts = {};
  for (const key of [
    "keydown",
    "keyup",
    "beforeinput",
    "input",
    "untrusted",
    "nonInsertText",
    "unfocused",
  ])
    counts[key] =
      Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 && raw[key] <= 10_000
        ? raw[key]
        : -1;
  return {
    counts,
    trustedTyping:
      length > 0 &&
      Object.values(counts).every((n) => n >= 0) &&
      ["keydown", "keyup", "beforeinput", "input"].every(
        (k) => counts[k] >= length,
      ) &&
      counts.untrusted === 0 &&
      counts.nonInsertText === 0 &&
      counts.unfocused === 0,
  };
}

export function connectionConfigurations(origin) {
  const url = new URL(origin);
  const base = {
    protocol: "https",
    hostname: url.hostname,
    port: Number(url.port || 443),
    username: SYNTHETIC.email,
    password: SYNTHETIC.password,
    httpVerifySsl: true,
    httpsTrustPolicy: "always-ask",
    browserSession: {
      version: 1,
      websiteExtensionsEnabled: true,
      cookiesEnabled: true,
      manualFormSubmit: false,
    },
    httpFormAutomation: {
      version: 1,
      fillDelayMs: 750,
      submitDelayMs: 750,
      detectionTimeoutMs: 30000,
      submit: true,
      fields: [],
    },
  };
  return {
    note: "Saved-connection field fragments, not database import documents. PUBLIC synthetic values only.",
    stagedManual: {
      ...base,
      hostname: `${origin}/staged`,
      httpAutoLogin: false,
      httpApplication: { version: 1, id: "custom", loginMode: "manual" },
    },
    modular: {
      ...base,
      hostname: `${origin}/modular`,
      httpAutoLogin: true,
      httpApplication: { version: 1, id: "custom", loginMode: "form" },
      httpAutoLoginSelectors: {
        usernameSelector: "#user_name",
        passwordSelector: "#password",
        submitSelector: "#continue",
      },
      httpFormAutomation: {
        ...base.httpFormAutomation,
        formSelector: "#login",
      },
    },
    giteaTotp: {
      ...base,
      httpAutoLogin: true,
      httpApplication: { version: 1, id: "gitea", loginMode: "form" },
      totpConfigs: [
        {
          id: "local-auth-fixture",
          issuer: "Disposable local acceptance",
          account: SYNTHETIC.email,
          secret: SYNTHETIC.totpSecret,
          algorithm: "sha1",
          digits: 6,
          period: 30,
        },
      ],
      httpAutoMfa: {
        version: 1,
        enabled: true,
        totpConfigId: "local-auth-fixture",
        challengeId: "gitea-totp",
        origin,
      },
    },
  };
}

async function certificate(openssl) {
  const directory = await mkdtemp(join(tmpdir(), "sorng-native-auth-"));
  const keyFile = join(directory, "key.pem"),
    certificateFile = join(directory, "certificate.pem");
  try {
    await runFile(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-keyout",
        keyFile,
        "-out",
        certificateFile,
        "-days",
        "1",
        "-subj",
        "/CN=SORNG disposable loopback acceptance",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:FALSE",
        "-addext",
        "extendedKeyUsage=serverAuth",
      ],
      { timeout: 30_000, windowsHide: true },
    );
    const [key, cert] = await Promise.all([
      readFile(keyFile),
      readFile(certificateFile),
    ]);
    return {
      directory,
      key,
      cert,
      certificateFile,
      fingerprint: new X509Certificate(cert).fingerprint256,
    };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error(
      "Disposable certificate generation failed; supply an OpenSSL executable with --openssl.",
    );
  }
}

function nextPath(run) {
  const stage = stages[run.mode][run.index];
  if (!stage) return "/result";
  if (stage === "totp")
    return run.mode === "gitea" ? "/user/two_factor" : "/totp";
  return stage === "password"
    ? "/staged/password"
    : Object.keys(starts).find((path) => starts[path] === run.mode);
}

function report(run) {
  const complete = run.index === stages[run.mode].length;
  return {
    run: run.number,
    mode: run.mode,
    complete,
    steps: run.steps,
    functionalAcceptance:
      complete && run.steps.every((s) => s.credentialsValid),
    trustedInputAcceptance:
      complete &&
      run.steps.every(
        (s) =>
          s.credentialsValid &&
          s.secureContext &&
          s.topLevel &&
          s.tauriAbsent &&
          s.fields.every((f) => f.trustedTyping),
      ),
    evidence:
      "page-observed; hands-off native execution must be independently witnessed",
  };
}

function page(run, origin) {
  const stage = stages[run.mode][run.index];
  const fields = (fieldNames[stage] || [])
    .map((name) =>
      name === "email"
        ? '<label>Email <input id="user_name" name="user_name" type="email" autocomplete="username" required data-field="email"></label>'
        : name === "password"
          ? '<label>Password <input id="password" name="password" type="password" autocomplete="current-password" required data-field="password"></label>'
          : '<label>Authenticator code <input id="passcode" name="passcode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required data-field="totp"></label>',
    )
    .join("");
  const config = JSON.stringify({ stage, nonce: run.nonce, origin });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LOCAL synthetic authentication fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body>
<h1>LOCAL synthetic authentication fixture</h1><p>Not a real service. Use only the public test values in the fixture README. Flow: ${run.mode} / ${stage || "result"}.</p>
${stage ? `<form id="login" method="post" action="${nextPath(run)}">${fields}<button id="continue" class="ui primary" type="submit">${stage === "totp" ? "Verify authenticator" : "Continue"}</button></form>` : ""}
<pre id="result" role="status">${stage ? "Waiting for input; no acceptance evidence yet." : "Loading sanitized result…"}</pre>
<script type="application/json" id="fixture-config">${config}</script><script src="/client.js" defer></script></body></html>`;
}

async function jsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("body-limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startFixture({ port = 18443, openssl = "openssl" } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid fixture port");
  const tls = await certificate(openssl);
  const client = await readFile(
    new URL("./client.js", import.meta.url),
    "utf8",
  );
  const runs = new Map();
  let sequence = 0,
    origin,
    closed = false;
  const server = createServer(
    { key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" },
    (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      const send = (status, body, type = "application/json") => {
        response.writeHead(status, {
          "Content-Type": `${type}; charset=utf-8`,
        });
        response.end(type === "application/json" ? JSON.stringify(body) : body);
      };
      void (async () => {
        if (request.headers.host !== new URL(origin).host)
          return send(421, { error: "loopback-host-required" });
        if (request.url.includes("?"))
          return send(400, { error: "query-not-supported" });
        const path = request.url;
        for (const [id, run] of runs)
          if (Date.now() - run.created > lifetimeMs) runs.delete(id);
        const id = /(?:^|; )fixture_run=([a-f0-9]{32})(?:;|$)/.exec(
          request.headers.cookie || "",
        )?.[1];
        let run = runs.get(id);
        if (request.method === "GET" && path === "/client.js")
          return send(200, client, "application/javascript");
        if (request.method === "GET" && path === "/fixture.css")
          return send(
            200,
            "body{font:18px system-ui;background:#111827;color:#f3f4f6;max-width:760px;margin:40px auto;padding:24px}label{display:block;margin:20px 0}input,button{display:block;font:inherit;padding:10px;margin-top:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}",
            "text/css",
          );
        if (request.method === "GET" && path === "/report")
          return send(200, { runs: [...runs.values()].map(report) });
        if (request.method === "GET" && path === "/health")
          return send(200, { fixture: "local-synthetic-auth", https: true });
        if (request.method === "GET" && path === "/")
          return send(200, {
            startPaths: Object.keys(starts),
            report: "/report",
          });
        if (request.method === "GET" && Object.hasOwn(starts, path)) {
          if (runs.size >= 32)
            return send(429, { error: "run-limit-restart-fixture" });
          const freshId = randomBytes(16).toString("hex");
          run = {
            number: ++sequence,
            mode: starts[path],
            created: Date.now(),
            index: 0,
            steps: [],
            nonce: "",
          };
          runs.set(freshId, run);
          response.setHeader(
            "Set-Cookie",
            `fixture_run=${freshId}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`,
          );
        }
        if (!run) return send(409, { error: "start-a-new-fixture-run" });
        if (request.method === "GET" && path === nextPath(run)) {
          run.nonce = randomBytes(16).toString("hex");
          return send(200, page(run, origin), "text/html");
        }
        if (request.method !== "POST" || path !== "/step")
          return send(404, { error: "not-found" });
        if (
          request.headers.origin !== origin ||
          request.headers["content-type"] !== "application/json"
        )
          return send(403, { error: "same-origin-json-required" });
        const body = await jsonBody(request);
        const stage = stages[run.mode][run.index];
        if (!stage || !equal(body?.nonce, run.nonce) || body.stage !== stage)
          return send(409, { error: "stale-stage" });
        const names = fieldNames[stage];
        const credentialsValid = names.every((name) =>
          name === "totp"
            ? [-30_000, 0, 30_000].some((delta) =>
                equal(body.values?.totp, totpAt(Date.now() + delta)),
              )
            : equal(body.values?.[name], SYNTHETIC[name]),
        );
        const fields = names.map((name) => ({
          field: name,
          ...inputVerdict(
            body.events?.[name],
            name === "totp" ? 6 : SYNTHETIC[name].length,
          ),
        }));
        // Only explicitly selected booleans/counts survive. Never retain body,
        // values, input event data, URLs, headers, or unknown client metadata.
        const step = {
          stage,
          credentialsValid,
          fields,
          secureContext: body.secureContext === true,
          topLevel: body.topLevel === true,
          tauriAbsent: body.tauriAbsent === true,
          trustedSubmit: body.trustedSubmit === true,
        };
        run.nonce = ""; // Consume the document receipt once, including failures.
        if (!credentialsValid)
          return send(422, { error: "synthetic-values-required-restart-run" });
        run.steps.push(step);
        run.index++;
        return send(200, { nextPath: nextPath(run), report: report(run) });
      })().catch(() => {
        if (!response.headersSent)
          send(400, { error: "invalid-fixture-request" });
        else response.end();
      });
    },
  );
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;
  try {
    await new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", accept);
    });
    origin = `https://127.0.0.1:${server.address().port}`;
    const configurationFile = join(tls.directory, "connection-configs.json");
    await writeFile(
      configurationFile,
      JSON.stringify(connectionConfigurations(origin), null, 2),
      { mode: 0o600 },
    );
    return {
      origin,
      certificate: tls.cert,
      certificateFile: tls.certificateFile,
      fingerprint: tls.fingerprint,
      configurationFile,
      async close() {
        if (closed) return;
        closed = true;
        server.closeAllConnections();
        await new Promise((accept) => server.close(accept));
        runs.clear();
        tls.key.fill(0);
        // Exact directory generated by mkdtemp above; never a user-supplied path.
        await rm(tls.directory, { recursive: true, force: true });
      },
    };
  } catch {
    server.closeAllConnections();
    server.close();
    await rm(tls.directory, { recursive: true, force: true });
    throw new Error(
      "Could not start the loopback fixture; check the port and OpenSSL.",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = {};
  try {
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i],
        value = process.argv[i + 1];
      if (key === "--port" && /^\d+$/.test(value || ""))
        options.port = Number(value);
      else if (key === "--openssl" && value) options.openssl = value;
      else
        throw new Error(
          "Use: node fixture.mjs [--port 18443] [--openssl path-to-openssl]",
        );
    }
    const fixture = await startFixture(options);
    console.log(
      JSON.stringify(
        {
          origin: fixture.origin,
          certificateFile: fixture.certificateFile,
          sha256: fixture.fingerprint,
          configurationFile: fixture.configurationFile,
          report: `${fixture.origin}/report`,
          expiresInMinutes: 15,
        },
        null,
        2,
      ),
    );
    const timeout = setTimeout(stop, lifetimeMs);
    async function stop() {
      clearTimeout(timeout);
      await fixture.close();
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
