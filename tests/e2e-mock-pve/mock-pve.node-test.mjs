// t67-e8 — contract tests for the disposable mock Proxmox VE E2E fixture.
//
// Named `*.node-test.mjs` (like tests/tooling/*.node-test.mjs) so Vitest
// discovery skips it: it runs on `node --test` via `npm run e2e:mock-pve:test`.
//
// These run without the desktop binary (and without Docker), so CI can prove
// the fixture still speaks the PVE wire protocol the Rust client expects even
// when the WDIO suite is not executed. They mirror the assertions in
// `src-tauri/crates/sorng-proxmox/tests/auth_flows.rs`.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import test from "node:test";

import {
  DEFAULT_MOCK_PVE_PASSWORD,
  DEFAULT_MOCK_PVE_TOKEN_ID,
  DEFAULT_MOCK_PVE_TOKEN_SECRET,
  DEFAULT_MOCK_PVE_TOTP_SECRET,
  DEFAULT_MOCK_PVE_USER,
  FrameDecoder,
  MOCK_PVE_NODE,
  MOCK_PVE_VMID,
  MOCK_PVE_VM_NAME,
  ensureMockPveCertificate,
  startMockPve,
  totpCode,
} from "../../e2e/helpers/fixtures/mock-pve/server.mjs";

// Node's default https agent keeps sockets alive, which would keep the test
// runner's event loop busy after the fixture is stopped.
const agent = new https.Agent({ keepAlive: false });

/** Start a fixture on an ephemeral port, torn down with the test. */
async function mock(context, options = {}) {
  const handle = await startMockPve({ port: 0, ...options });
  context.after(() => handle.stop());
  return handle;
}

function request(handle, { method = "GET", path, headers = {}, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  return new Promise((resolve, reject) => {
    const outgoing = https.request(
      {
        host: handle.host,
        port: handle.port,
        method,
        path,
        agent,
        rejectUnauthorized: false,
        headers: {
          ...headers,
          ...(body
            ? {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        // Captured up front: Node detaches `response.socket` before `end`.
        const peerCertificate = response.socket.getPeerCertificate();
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* non-JSON bodies are a failure the assertions will surface */
          }
          resolve({
            status: response.statusCode,
            text,
            json,
            peerCertificate,
          });
        });
      },
    );
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

async function login(handle, overrides = {}) {
  return request(handle, {
    method: "POST",
    path: "/api2/json/access/ticket",
    form: {
      username: DEFAULT_MOCK_PVE_USER,
      password: DEFAULT_MOCK_PVE_PASSWORD,
      ...overrides,
    },
  });
}

const ticketHeaders = (ticket, csrf) => ({
  cookie: `PVEAuthCookie=${ticket}`,
  ...(csrf ? { CSRFPreventionToken: csrf } : {}),
});

/** Client-side (masked) RFC 6455 frame, as a browser/pve-xtermjs sends. */
function maskedFrame(payload, opcode = 0x01) {
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(body);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | body.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  }
  return Buffer.concat([header, mask, masked]);
}

/** Open the `vncwebsocket` upgrade over TLS and return a tiny frame client. */
async function openWebSocket(handle, { path, ticket, cookie }) {
  const socket = tls.connect({
    host: handle.host,
    port: handle.port,
    rejectUnauthorized: false,
  });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  const key = crypto.randomBytes(16).toString("base64");
  socket.write(
    [
      `GET ${path}?port=5901&vncticket=${encodeURIComponent(ticket)} HTTP/1.1`,
      `Host: ${handle.host}:${handle.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      `Cookie: ${cookie}`,
      "\r\n",
    ].join("\r\n"),
  );

  const decoder = new FrameDecoder();
  const frames = [];
  let waiter = null;
  let pending = Buffer.alloc(0);
  let upgraded = false;
  let resolveUpgrade;
  let rejectUpgrade;
  const upgradePromise = new Promise((resolve, reject) => {
    resolveUpgrade = resolve;
    rejectUpgrade = reject;
  });

  socket.on("data", (chunk) => {
    if (!upgraded) {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf("\r\n\r\n", 0, "latin1");
      if (end < 0) return;
      upgraded = true;
      resolveUpgrade(pending.subarray(0, end).toString("latin1"));
      chunk = pending.subarray(end + 4);
      pending = Buffer.alloc(0);
      if (chunk.length === 0) return;
    }
    for (const frame of decoder.push(chunk)) {
      frames.push(frame);
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve();
      }
    }
  });
  socket.on("error", (error) => rejectUpgrade(error));

  const statusLine = await upgradePromise;

  return {
    socket,
    statusLine,
    send: (payload, opcode) => socket.write(maskedFrame(payload, opcode)),
    async next(timeoutMs = 5_000) {
      if (frames.length > 0) return frames.shift();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for a websocket frame")),
          timeoutMs,
        );
        waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      return frames.shift();
    },
    close: () =>
      new Promise((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.once("close", resolve);
        socket.destroy();
      }),
  };
}

// ─────────────────────────────────────────────────────────── certificate ──

test("serves a self-signed certificate whose fingerprint is reported verbatim", async (context) => {
  const handle = await mock(context);
  const response = await request(handle, { path: "/api2/json/version" });

  assert.equal(response.status, 401, "unauthenticated requests are refused");
  assert.match(handle.fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
  assert.equal(
    response.peerCertificate.fingerprint256,
    handle.fingerprint,
    "the advertised fingerprint is the one the TLS handshake presents",
  );
  assert.equal(
    response.peerCertificate.subject.CN,
    response.peerCertificate.issuer.CN,
    "self-signed, so the app's TOFU prompt has something to pin",
  );
});

test("a bare TLS handshake needs no credentials and hits no endpoint", async (context) => {
  const handle = await mock(context);
  const socket = tls.connect({
    host: handle.host,
    port: handle.port,
    rejectUnauthorized: false,
  });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  const fingerprint = socket.getPeerCertificate().fingerprint256;
  socket.destroy();

  assert.equal(fingerprint, handle.fingerprint);
  assert.deepEqual(
    handle.state.requests,
    [],
    "probing the certificate must not send an HTTP request",
  );
});

test("ensureMockPveCertificate reuses a live certificate", () => {
  const first = ensureMockPveCertificate();
  const second = ensureMockPveCertificate();
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.certificate, /BEGIN CERTIFICATE/u);
  assert.match(first.privateKey, /PRIVATE KEY/u);
});

// ───────────────────────────────────────────────────────────────── login ──

test("password login issues a ticket and a CSRF token", async (context) => {
  const handle = await mock(context);
  const response = await login(handle);

  assert.equal(response.status, 200);
  assert.equal(response.json.data.username, DEFAULT_MOCK_PVE_USER);
  assert.match(response.json.data.ticket, /^PVE:/u);
  assert.ok(response.json.data.CSRFPreventionToken);
  assert.equal(response.json.data.NeedTFA, undefined);
});

test("a wrong password is a 401, not a 500", async (context) => {
  const handle = await mock(context);
  const response = await login(handle, { password: "nope" });

  assert.equal(response.status, 401);
  assert.equal(response.json.data, null);
  assert.match(response.json.errors.message, /authentication failure/u);
});

test("an API token authenticates without a ticket", async (context) => {
  const handle = await mock(context);
  const response = await request(handle, {
    path: "/api2/json/version",
    headers: {
      authorization: `PVEAPIToken=${DEFAULT_MOCK_PVE_TOKEN_ID}=${DEFAULT_MOCK_PVE_TOKEN_SECRET}`,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.data.version, "8.2.4");

  const wrong = await request(handle, {
    path: "/api2/json/version",
    headers: {
      authorization: `PVEAPIToken=${DEFAULT_MOCK_PVE_TOKEN_ID}=wrong-secret`,
    },
  });
  assert.equal(wrong.status, 401);
});

// ─────────────────────────────────────────────────────────────────── TFA ──

test("NeedTFA challenge is completed with a TOTP code", async (context) => {
  const handle = await mock(context, { requireTfa: true });

  const first = await login(handle);
  assert.equal(first.status, 200);
  assert.equal(first.json.data.NeedTFA, 1);
  assert.match(first.json.data.ticket, /^PVE:!tfa!/u);

  const kinds = JSON.parse(
    decodeURIComponent(
      first.json.data.ticket.slice("PVE:!tfa!".length).split(":")[0],
    ),
  );
  assert.equal(kinds.totp, true);
  assert.equal(kinds.recovery, true);

  const rejected = await request(handle, {
    method: "POST",
    path: "/api2/json/access/ticket",
    form: {
      username: DEFAULT_MOCK_PVE_USER,
      "tfa-challenge": first.json.data.ticket,
      password: "totp:000000",
    },
  });
  assert.equal(rejected.status, 401, "a wrong second factor is refused");

  const completed = await request(handle, {
    method: "POST",
    path: "/api2/json/access/ticket",
    form: {
      username: DEFAULT_MOCK_PVE_USER,
      "tfa-challenge": first.json.data.ticket,
      password: `totp:${totpCode(DEFAULT_MOCK_PVE_TOTP_SECRET)}`,
    },
  });
  assert.equal(completed.status, 200);
  assert.match(completed.json.data.ticket, /^PVE:/u);
  assert.equal(completed.json.data.NeedTFA, undefined);
});

test("a recovery code completes the challenge exactly once", async (context) => {
  const handle = await mock(context, {
    requireTfa: true,
    recoveryCodes: ["single-use"],
  });
  const challenge = (await login(handle)).json.data.ticket;

  const form = {
    username: DEFAULT_MOCK_PVE_USER,
    "tfa-challenge": challenge,
    password: "recovery:single-use",
  };
  const first = await request(handle, {
    method: "POST",
    path: "/api2/json/access/ticket",
    form,
  });
  const replay = await request(handle, {
    method: "POST",
    path: "/api2/json/access/ticket",
    form,
  });

  assert.equal(first.status, 200);
  assert.equal(replay.status, 401, "recovery codes are consumed");
});

test("PVE 6 inline OTP is enforced when configured", async (context) => {
  const handle = await mock(context, { inlineOtp: "424242" });

  assert.equal((await login(handle)).status, 401);
  assert.equal((await login(handle, { otp: "111111" })).status, 401);
  assert.equal((await login(handle, { otp: "424242" })).status, 200);
});

// ─────────────────────────────────────────────────────────────── renewal ──

test("a live ticket can be used as the renewal password", async (context) => {
  const handle = await mock(context);
  const { ticket } = (await login(handle)).json.data;

  const renewed = await login(handle, { password: ticket });
  assert.equal(renewed.status, 200);
  assert.notEqual(
    renewed.json.data.ticket,
    ticket,
    "renewal issues a new ticket",
  );

  const stale = await login(handle, { password: "PVE:root@pam:NOTISSUED" });
  assert.equal(stale.status, 401, "an unknown ticket cannot renew");

  // Both tickets stay usable, like PVE's overlap window.
  const withOld = await request(handle, {
    path: "/api2/json/version",
    headers: ticketHeaders(ticket),
  });
  assert.equal(withOld.status, 200);
});

// ───────────────────────────────────────────────────────── inventory/power ──

test("inventory endpoints describe the mock node and its guests", async (context) => {
  const handle = await mock(context);
  const { ticket, CSRFPreventionToken: csrf } = (await login(handle)).json.data;
  const headers = ticketHeaders(ticket, csrf);

  const nodes = await request(handle, { path: "/api2/json/nodes", headers });
  assert.equal(nodes.status, 200);
  assert.equal(nodes.json.data[0].node, MOCK_PVE_NODE);
  assert.equal(nodes.json.data[0].status, "online");

  const vms = await request(handle, {
    path: `/api2/json/nodes/${MOCK_PVE_NODE}/qemu`,
    headers,
  });
  assert.equal(vms.json.data[0].vmid, MOCK_PVE_VMID);
  assert.equal(vms.json.data[0].name, MOCK_PVE_VM_NAME);
  assert.equal(vms.json.data[0].status, "running");

  const containers = await request(handle, {
    path: `/api2/json/nodes/${MOCK_PVE_NODE}/lxc`,
    headers,
  });
  assert.equal(containers.json.data[0].status, "stopped");

  const unknownNode = await request(handle, {
    path: "/api2/json/nodes/not-a-node/qemu",
    headers,
  });
  assert.equal(unknownNode.status, 404);
});

test("power actions flip the reported VM status", async (context) => {
  const handle = await mock(context);
  const { ticket, CSRFPreventionToken: csrf } = (await login(handle)).json.data;
  const headers = ticketHeaders(ticket, csrf);
  const statusPath = `/api2/json/nodes/${MOCK_PVE_NODE}/qemu/${MOCK_PVE_VMID}/status`;

  const stop = await request(handle, {
    method: "POST",
    path: `${statusPath}/stop`,
    headers,
    form: {},
  });
  assert.equal(stop.status, 200);
  assert.match(stop.json.data, /^UPID:/u);

  let current = await request(handle, {
    path: `${statusPath}/current`,
    headers,
  });
  assert.equal(current.json.data.status, "stopped");

  await request(handle, {
    method: "POST",
    path: `${statusPath}/start`,
    headers,
    form: {},
  });
  current = await request(handle, { path: `${statusPath}/current`, headers });
  assert.equal(current.json.data.status, "running");

  const bogus = await request(handle, {
    method: "POST",
    path: `${statusPath}/self-destruct`,
    headers,
    form: {},
  });
  assert.equal(bogus.status, 404);
});

// ───────────────────────────────────────────────────────────── websocket ──

test("termproxy issues a ticket and the vncwebsocket speaks the pve-xtermjs protocol", async (context) => {
  const handle = await mock(context);
  const { ticket, CSRFPreventionToken: csrf } = (await login(handle)).json.data;
  const headers = ticketHeaders(ticket, csrf);
  const basePath = `/api2/json/nodes/${MOCK_PVE_NODE}/qemu/${MOCK_PVE_VMID}`;

  const term = await request(handle, {
    method: "POST",
    path: `${basePath}/termproxy`,
    headers,
    form: {},
  });
  assert.equal(term.status, 200);
  assert.ok(term.json.data.ticket);
  assert.equal(typeof term.json.data.port, "string");
  assert.equal(term.json.data.user, DEFAULT_MOCK_PVE_USER);

  const ws = await openWebSocket(handle, {
    path: `${basePath}/vncwebsocket`,
    ticket: term.json.data.ticket,
    cookie: `PVEAuthCookie=${ticket}`,
  });
  context.after(() => ws.close());
  assert.match(ws.statusLine, /^HTTP\/1\.1 101 /u);

  // Handshake: "<user>:<ticket>\n" -> "OK".
  ws.send(`${DEFAULT_MOCK_PVE_USER}:${term.json.data.ticket}\n`);
  assert.equal((await ws.next()).payload.toString("utf8"), "OK");

  // Input framing `0:<len>:<data>` echoes back as raw bytes.
  ws.send("0:5:hello");
  assert.equal((await ws.next()).payload.toString("utf8"), "hello");

  // Resize `1:<cols>:<rows>:` and keepalive `2` are recorded, not echoed.
  ws.send("1:120:40:");
  ws.send("2");
  ws.send("0:2:ok");
  assert.equal((await ws.next()).payload.toString("utf8"), "ok");

  assert.deepEqual(handle.state.resizes, [{ cols: 120, rows: 40 }]);
  assert.equal(handle.state.pings, 1);
  assert.deepEqual(handle.state.consoleInput, ["hello", "ok"]);
});

test("the websocket refuses an unknown ticket and an unauthenticated upgrade", async (context) => {
  const handle = await mock(context);
  const { ticket } = (await login(handle)).json.data;
  const basePath = `/api2/json/nodes/${MOCK_PVE_NODE}/qemu/${MOCK_PVE_VMID}`;

  const unknownTicket = await openWebSocket(handle, {
    path: `${basePath}/vncwebsocket`,
    ticket: "TERM:not-issued",
    cookie: `PVEAuthCookie=${ticket}`,
  });
  context.after(() => unknownTicket.close());
  assert.match(unknownTicket.statusLine, /^HTTP\/1\.1 401 /u);

  const term = await request(handle, {
    method: "POST",
    path: `${basePath}/termproxy`,
    headers: ticketHeaders(ticket),
    form: {},
  });
  const noCookie = await openWebSocket(handle, {
    path: `${basePath}/vncwebsocket`,
    ticket: term.json.data.ticket,
    cookie: "PVEAuthCookie=bogus",
  });
  context.after(() => noCookie.close());
  assert.match(noCookie.statusLine, /^HTTP\/1\.1 401 /u);
});

test("a wrong handshake ticket closes the termproxy socket", async (context) => {
  const handle = await mock(context);
  const { ticket } = (await login(handle)).json.data;
  const basePath = `/api2/json/nodes/${MOCK_PVE_NODE}/qemu/${MOCK_PVE_VMID}`;
  const term = await request(handle, {
    method: "POST",
    path: `${basePath}/termproxy`,
    headers: ticketHeaders(ticket),
    form: {},
  });

  const ws = await openWebSocket(handle, {
    path: `${basePath}/vncwebsocket`,
    ticket: term.json.data.ticket,
    cookie: `PVEAuthCookie=${ticket}`,
  });
  context.after(() => ws.close());

  ws.send(`${DEFAULT_MOCK_PVE_USER}:TERM:wrong\n`);
  assert.equal((await ws.next()).payload.toString("utf8"), "ERR");
});

test("vncproxy puts a fake RFB server behind the websocket", async (context) => {
  const handle = await mock(context);
  const { ticket } = (await login(handle)).json.data;
  const basePath = `/api2/json/nodes/${MOCK_PVE_NODE}/qemu/${MOCK_PVE_VMID}`;

  const vnc = await request(handle, {
    method: "POST",
    path: `${basePath}/vncproxy`,
    headers: ticketHeaders(ticket),
    form: { websocket: "1" },
  });
  assert.equal(vnc.status, 200);

  const ws = await openWebSocket(handle, {
    path: `${basePath}/vncwebsocket`,
    ticket: vnc.json.data.ticket,
    cookie: `PVEAuthCookie=${ticket}`,
  });
  context.after(() => ws.close());
  assert.equal((await ws.next()).payload.toString("ascii"), "RFB 003.008\n");
});

// ──────────────────────────────────────────────────────────────── plumbing ──

test("unhandled API paths are reported, not silently faked", async (context) => {
  const handle = await mock(context);
  const { ticket } = (await login(handle)).json.data;

  const response = await request(handle, {
    method: "POST",
    path: "/api2/json/nodes/pve-mock/qemu/100/nonsense",
    headers: ticketHeaders(ticket),
    form: {},
  });
  assert.equal(response.status, 501);
  assert.match(response.json.errors.message, /unhandled POST/u);

  const outside = await request(handle, { path: "/not-the-api" });
  assert.equal(outside.status, 404);
});

test("every request is recorded for spec-side assertions", async (context) => {
  const handle = await mock(context);
  await login(handle);

  assert.equal(handle.state.requests.length, 1);
  assert.equal(handle.state.requests[0].method, "POST");
  assert.equal(handle.state.requests[0].path, "/api2/json/access/ticket");
});
