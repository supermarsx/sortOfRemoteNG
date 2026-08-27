/**
 * t67-e8 — Disposable mock Proxmox VE server for the desktop E2E suite.
 *
 * Proxmox VE cannot be containerised, so `e2e/specs/28-proxmox` runs against
 * this in-process HTTPS fixture instead of a Docker service. It mirrors the
 * Rust TLS mock in `src-tauri/crates/sorng-proxmox/tests/mock_pve.rs` so both
 * test layers assert the same wire contract:
 *
 *   - `POST /api2/json/access/ticket`
 *       * password login (wrong password -> 401)
 *       * PVE 7+ `NeedTFA` challenge + `tfa-challenge` completion
 *         (`totp:<code>` / `recovery:<code>`), PVE 6 inline `otp`
 *       * ticket-as-password renewal
 *   - `GET  /api2/json/version`, `/nodes`, `/nodes/{n}/qemu`, `/nodes/{n}/lxc`,
 *          `/nodes/{n}/storage`, `/nodes/{n}/network`, `/nodes/{n}/tasks`,
 *          `/cluster/status`, `/cluster/resources`
 *   - `GET  /api2/json/nodes/{n}/qemu/{vmid}/status/current`
 *   - `POST /api2/json/nodes/{n}/qemu/{vmid}/status/{start,stop,shutdown,reboot}`
 *   - `POST /api2/json/nodes/{n}[/{qemu|lxc}/{vmid}]/termproxy` and `/vncproxy`
 *   - `GET  /api2/json/nodes/{n}[/{qemu|lxc}/{vmid}]/vncwebsocket` (WS upgrade)
 *
 * API-token auth (`Authorization: PVEAPIToken=user@realm!name=secret`) and
 * ticket auth (`Cookie: PVEAuthCookie=…`) are both accepted, matching the Rust
 * mock's `is_authenticated`.
 *
 * The certificate is a freshly generated self-signed one, so the app's
 * TOFU/`proxmox_probe_certificate` path has a real fingerprint to show and pin.
 *
 * Two entry points:
 *   - imported:  `await startMockPve({ port: 0 })` -> handle with `.stop()`
 *   - forked:    `node server.mjs` -> `process.send({ type: "mock-pve-ready" })`
 *                and a `MOCK_PVE_READY <json>` line on stdout.
 *
 * Disposable local/CI testing only. The credentials and key material here are
 * throwaway by design and must never be reused anywhere else.
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..", "..", "..");

export const MOCK_PVE_NODE = "pve-mock";
export const MOCK_PVE_VMID = 100;
export const MOCK_PVE_VM_NAME = "test-vm";
export const MOCK_PVE_CT_VMID = 200;
export const MOCK_PVE_CT_NAME = "test-ct";
export const DEFAULT_MOCK_PVE_PORT = 18006;
export const DEFAULT_MOCK_PVE_HOST = "127.0.0.1";
export const DEFAULT_MOCK_PVE_USER = "root@pam";
export const DEFAULT_MOCK_PVE_PASSWORD = "pve";
export const DEFAULT_MOCK_PVE_TOKEN_ID = "root@pam!e2e";
export const DEFAULT_MOCK_PVE_TOKEN_SECRET =
  "00000000-1111-2222-3333-444444444444";
/** Base32, RFC 4648. Only used to exercise the auto-TOTP path. */
export const DEFAULT_MOCK_PVE_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

export const DEFAULT_MOCK_PVE_CERT_DIR = path.join(
  repoRoot,
  "e2e",
  ".generated",
  "mock-pve",
);

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Refuse to keep a cert that expires within this window. */
const CERT_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────── certificate ──

function runOpenSsl(args) {
  const executable = process.env.OPENSSL_BIN || "openssl";
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(
      `[mock-pve] OpenSSL is required to generate the disposable TLS fixture: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const detail =
      (result.stderr || "").trim() || (result.stdout || "").trim() || "unknown";
    throw new Error(`[mock-pve] OpenSSL failed: ${detail}`);
  }
  return result.stdout;
}

function certificateIsUsable(certificatePath, keyPath) {
  if (!existsSync(certificatePath) || !existsSync(keyPath)) return false;
  try {
    const certificate = new crypto.X509Certificate(
      readFileSync(certificatePath),
    );
    return (
      Date.parse(certificate.validTo) - Date.now() > CERT_MIN_REMAINING_MS &&
      Date.parse(certificate.validFrom) <= Date.now()
    );
  } catch {
    return false;
  }
}

/**
 * Generate (or reuse) the disposable self-signed certificate.
 *
 * @param {{ certDir?: string, force?: boolean }} [options]
 * @returns {{ certificatePath: string, keyPath: string, certificate: string,
 *             privateKey: string, fingerprint: string, subject: string }}
 */
export function ensureMockPveCertificate({
  certDir = DEFAULT_MOCK_PVE_CERT_DIR,
  force = false,
} = {}) {
  const certificatePath = path.join(certDir, "server.crt");
  const keyPath = path.join(certDir, "server.key");

  if (force || !certificateIsUsable(certificatePath, keyPath)) {
    mkdirSync(certDir, { recursive: true });
    rmSync(certificatePath, { force: true });
    rmSync(keyPath, { force: true });
    runOpenSsl([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "30",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-subj",
      "/CN=pve-mock.test/O=sortOfRemoteNG disposable E2E fixture",
      "-addext",
      "subjectAltName=DNS:pve-mock.test,DNS:localhost,IP:127.0.0.1,IP:::1",
    ]);
  }

  const certificate = readFileSync(certificatePath, "utf8");
  const privateKey = readFileSync(keyPath, "utf8");
  const parsed = new crypto.X509Certificate(certificate);
  return {
    certificatePath,
    keyPath,
    certificate,
    privateKey,
    // `AA:BB:…` uppercase hex over the DER — the exact shape the app pins.
    fingerprint: parsed.fingerprint256,
    subject: parsed.subject,
  };
}

// ─────────────────────────────────────────────────────────────────── totp ──

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret) {
  const cleaned = secret.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error(`[mock-pve] invalid base32 character`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP, SHA-1, 6 digits, 30 s step — what `sorng-totp` generates. */
export function totpCode(
  secret,
  { step = 30, digits = 6, now = Date.now() } = {},
) {
  const counter = Math.floor(now / 1000 / step);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

// ────────────────────────────────────────────────────────── websocket bits ──

/** Encode one unmasked server frame. */
export function encodeFrame(payload, { opcode = 0x02 } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, body]);
}

/**
 * Incremental RFC 6455 frame reader. Handles masking, the three length forms
 * and fragmentation of the transport (not of frames — PVE never fragments).
 */
export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /** @returns {{ opcode: number, payload: Buffer }[]} */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const opcode = this.buffer[0] & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) break;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) break;
        const big = this.buffer.readBigUInt64BE(offset);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("[mock-pve] websocket frame too large");
        }
        length = Number(big);
        offset += 8;
      }
      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) break;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) break;
      const payload = Buffer.from(
        this.buffer.subarray(offset, offset + length),
      );
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      this.buffer = this.buffer.subarray(offset + length);
      frames.push({ opcode, payload });
    }
    return frames;
  }
}

export function websocketAccept(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}${WEBSOCKET_GUID}`)
    .digest("base64");
}

// ────────────────────────────────────────────────────────────────── state ──

const jsonBody = (data) => JSON.stringify({ data });
const errorBody = (message) =>
  JSON.stringify({ data: null, errors: { message } });

function createState(options) {
  return {
    user: options.user ?? DEFAULT_MOCK_PVE_USER,
    password: options.password ?? DEFAULT_MOCK_PVE_PASSWORD,
    apiTokens: new Map(
      options.apiTokens ?? [
        [DEFAULT_MOCK_PVE_TOKEN_ID, DEFAULT_MOCK_PVE_TOKEN_SECRET],
      ],
    ),
    requireTfa: options.requireTfa ?? false,
    totpSecret:
      options.totpSecret === undefined
        ? DEFAULT_MOCK_PVE_TOTP_SECRET
        : options.totpSecret,
    recoveryCodes: [...(options.recoveryCodes ?? ["recovery-one"])],
    inlineOtp: options.inlineOtp ?? null,
    validTickets: new Set(),
    ticketSerial: 0,
    vmStatus: new Map([
      [MOCK_PVE_VMID, options.initialVmStatus ?? "running"],
      [MOCK_PVE_CT_VMID, "stopped"],
    ]),
    termTickets: new Map(),
    vncTickets: new Map(),
    /** Every request seen, so tests can assert what was (not) sent. */
    requests: [],
    /** `{ cols, rows }` recorded from termproxy `1:` frames. */
    resizes: [],
    /** Count of termproxy `2` keepalive frames. */
    pings: 0,
    consoleInput: [],
  };
}

function issueTicket(state, username) {
  state.ticketSerial += 1;
  const ticket = `PVE:${username}:MOCK${state.ticketSerial}`;
  state.validTickets.add(ticket);
  return { ticket, csrf: `${state.ticketSerial}:mockcsrf` };
}

function isAuthenticated(state, headers) {
  const authorization = headers.authorization;
  if (authorization) {
    const token = authorization.startsWith("PVEAPIToken=")
      ? authorization.slice("PVEAPIToken=".length)
      : null;
    if (!token) return false;
    const separator = token.lastIndexOf("=");
    if (separator < 0) return false;
    const tokenId = token.slice(0, separator);
    const secret = token.slice(separator + 1);
    return state.apiTokens.get(tokenId) === secret;
  }
  const cookie = headers.cookie;
  if (!cookie) return false;
  return cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith("PVEAuthCookie="))
    .some((pair) =>
      state.validTickets.has(pair.slice("PVEAuthCookie=".length)),
    );
}

// ───────────────────────────────────────────────────────── ticket endpoint ──

function accessTicket(state, form) {
  const username = form.get("username") ?? "";
  const password = form.get("password") ?? "";
  const challenge = form.get("tfa-challenge");

  if (challenge) {
    if (!challenge.startsWith("PVE:!tfa!")) {
      return [401, errorBody("invalid challenge")];
    }
    const separator = password.indexOf(":");
    const kind = separator < 0 ? "" : password.slice(0, separator);
    const code = separator < 0 ? "" : password.slice(separator + 1);
    let accepted = false;
    if (kind === "totp" && state.totpSecret) {
      accepted = totpCode(state.totpSecret) === code;
    } else if (kind === "recovery") {
      const index = state.recoveryCodes.indexOf(code);
      if (index >= 0) {
        state.recoveryCodes.splice(index, 1);
        accepted = true;
      }
    }
    if (!accepted) return [401, errorBody("authentication failure")];
    const { ticket, csrf } = issueTicket(state, username);
    return [200, jsonBody({ username, ticket, CSRFPreventionToken: csrf })];
  }

  // Ticket-as-password renewal (PVE accepts a live ticket, no TFA re-check).
  if (password.startsWith("PVE:")) {
    if (!state.validTickets.has(password)) {
      return [401, errorBody("invalid ticket")];
    }
    const { ticket, csrf } = issueTicket(state, username);
    return [200, jsonBody({ username, ticket, CSRFPreventionToken: csrf })];
  }

  if (password !== state.password) {
    return [401, errorBody("authentication failure")];
  }

  // PVE 6 style inline OTP.
  if (state.inlineOtp && form.get("otp") !== state.inlineOtp) {
    return [401, errorBody("authentication failure")];
  }

  if (state.requireTfa) {
    const kinds = {
      totp: Boolean(state.totpSecret),
      recovery: state.recoveryCodes.length > 0,
      webauthn: null,
    };
    const payload = encodeURIComponent(JSON.stringify(kinds));
    return [
      200,
      jsonBody({
        username,
        ticket: `PVE:!tfa!${payload}:6667ABCD::mocksig`,
        CSRFPreventionToken: "tfa-pending:csrf",
        NeedTFA: 1,
      }),
    ];
  }

  const { ticket, csrf } = issueTicket(state, username);
  return [200, jsonBody({ username, ticket, CSRFPreventionToken: csrf })];
}

// ──────────────────────────────────────────────────────────────── routing ──

function qemuList(state) {
  return [
    {
      vmid: MOCK_PVE_VMID,
      name: MOCK_PVE_VM_NAME,
      status: state.vmStatus.get(MOCK_PVE_VMID) ?? "stopped",
      cpus: 2,
      maxmem: 2147483648,
      maxdisk: 34359738368,
      uptime: 4321,
    },
  ];
}

function lxcList(state) {
  return [
    {
      vmid: MOCK_PVE_CT_VMID,
      name: MOCK_PVE_CT_NAME,
      status: state.vmStatus.get(MOCK_PVE_CT_VMID) ?? "stopped",
      cpus: 1,
      maxmem: 536870912,
      maxdisk: 8589934592,
      uptime: 0,
    },
  ];
}

function nodeList() {
  return [
    {
      node: MOCK_PVE_NODE,
      status: "online",
      cpu: 0.05,
      maxcpu: 8,
      mem: 4000000000,
      maxmem: 16000000000,
      disk: 12000000000,
      maxdisk: 100000000000,
      uptime: 12345,
      type: "node",
      id: `node/${MOCK_PVE_NODE}`,
    },
  ];
}

function issueConsoleTicket(state, map, kind) {
  state.ticketSerial += 1;
  const ticket = `${kind.toUpperCase()}:${MOCK_PVE_NODE}:${state.ticketSerial}::mock`;
  const port = String(5900 + state.ticketSerial);
  map.set(ticket, { port, user: state.user });
  return { ticket, port, user: state.user, upid: `UPID:${MOCK_PVE_NODE}:mock` };
}

/**
 * @returns {[number, string] | null} `null` when the path is not handled.
 */
function route(state, method, segments, query) {
  const [head, ...rest] = segments;

  if (head === "version" && rest.length === 0 && method === "GET") {
    return [
      200,
      jsonBody({
        version: "8.2.4",
        release: "8.2",
        repoid: "mock0001",
        console: "xtermjs",
      }),
    ];
  }

  if (head === "cluster") {
    if (method === "GET" && rest[0] === "status") {
      return [
        200,
        jsonBody([
          { id: "cluster", type: "cluster", name: "mock-cluster", quorate: 1 },
          {
            id: `node/${MOCK_PVE_NODE}`,
            type: "node",
            name: MOCK_PVE_NODE,
            online: 1,
            local: 1,
          },
        ]),
      ];
    }
    if (method === "GET" && rest[0] === "resources") {
      return [
        200,
        jsonBody([
          {
            id: `node/${MOCK_PVE_NODE}`,
            type: "node",
            node: MOCK_PVE_NODE,
            status: "online",
          },
          {
            id: `qemu/${MOCK_PVE_VMID}`,
            type: "qemu",
            node: MOCK_PVE_NODE,
            vmid: MOCK_PVE_VMID,
            name: MOCK_PVE_VM_NAME,
            status: state.vmStatus.get(MOCK_PVE_VMID) ?? "stopped",
          },
        ]),
      ];
    }
    if (method === "GET") return [200, jsonBody([])];
  }

  if (head !== "nodes") return null;
  if (rest.length === 0) {
    return method === "GET" ? [200, jsonBody(nodeList())] : null;
  }

  const [node, ...nodeRest] = rest;
  if (node !== MOCK_PVE_NODE) return [404, errorBody("no such node")];

  if (method === "GET" && nodeRest.length === 1) {
    switch (nodeRest[0]) {
      case "qemu":
        return [200, jsonBody(qemuList(state))];
      case "lxc":
        return [200, jsonBody(lxcList(state))];
      case "storage":
        return [
          200,
          jsonBody([
            {
              storage: "local",
              type: "dir",
              active: 1,
              enabled: 1,
              content: "images,iso",
              total: 100000000000,
              used: 25000000000,
              avail: 75000000000,
            },
          ]),
        ];
      case "network":
        return [
          200,
          jsonBody([
            {
              iface: "vmbr0",
              type: "bridge",
              active: 1,
              autostart: 1,
              method: "static",
              address: "127.0.0.1",
            },
          ]),
        ];
      case "tasks":
        return [200, jsonBody([])];
      default:
        return [200, jsonBody([])];
    }
  }

  // Node shell console tickets.
  if (method === "POST" && nodeRest.length === 1) {
    if (nodeRest[0] === "termproxy") {
      return [
        200,
        jsonBody(issueConsoleTicket(state, state.termTickets, "term")),
      ];
    }
    if (nodeRest[0] === "vncproxy") {
      return [
        200,
        jsonBody(issueConsoleTicket(state, state.vncTickets, "vnc")),
      ];
    }
  }

  const [guestType, rawVmid, ...guestRest] = nodeRest;
  if (guestType !== "qemu" && guestType !== "lxc") {
    return method === "GET" ? [200, jsonBody([])] : null;
  }
  const vmid = Number.parseInt(rawVmid ?? "", 10);
  if (!Number.isInteger(vmid)) return [400, errorBody("vmid")];
  if (!state.vmStatus.has(vmid)) return [404, errorBody("no such vm")];

  if (
    method === "GET" &&
    guestRest[0] === "status" &&
    guestRest[1] === "current"
  ) {
    return [
      200,
      jsonBody({
        vmid,
        name: vmid === MOCK_PVE_VMID ? MOCK_PVE_VM_NAME : MOCK_PVE_CT_NAME,
        status: state.vmStatus.get(vmid),
        uptime: state.vmStatus.get(vmid) === "running" ? 4321 : 0,
        cpus: 2,
        maxmem: 2147483648,
      }),
    ];
  }

  if (method === "POST" && guestRest[0] === "status") {
    const next = {
      start: "running",
      reboot: "running",
      resume: "running",
      stop: "stopped",
      shutdown: "stopped",
      suspend: "paused",
    }[guestRest[1] ?? ""];
    if (!next) return [404, errorBody("no such action")];
    state.vmStatus.set(vmid, next);
    return [200, jsonBody(`UPID:${MOCK_PVE_NODE}:mock:${guestRest[1]}`)];
  }

  if (method === "POST" && guestRest[0] === "termproxy") {
    return [
      200,
      jsonBody(issueConsoleTicket(state, state.termTickets, "term")),
    ];
  }
  if (method === "POST" && guestRest[0] === "vncproxy") {
    void query;
    return [200, jsonBody(issueConsoleTicket(state, state.vncTickets, "vnc"))];
  }
  if (method === "GET" && guestRest[0] === "snapshot") {
    return [200, jsonBody([])];
  }
  if (method === "GET" && guestRest[0] === "config") {
    return [200, jsonBody({ name: MOCK_PVE_VM_NAME, cores: 2, memory: 2048 })];
  }

  return method === "GET" ? [200, jsonBody([])] : null;
}

// ──────────────────────────────────────────────────────── websocket relay ──

function handleTermproxySocket(state, socket, ticket) {
  const decoder = new FrameDecoder();
  let handshakeDone = false;

  socket.on("data", (chunk) => {
    let frames;
    try {
      frames = decoder.push(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const { opcode, payload } of frames) {
      if (opcode === 0x08) {
        socket.end(encodeFrame(Buffer.alloc(0), { opcode: 0x08 }));
        return;
      }
      if (opcode === 0x09) {
        socket.write(encodeFrame(payload, { opcode: 0x0a }));
        continue;
      }
      const text = payload.toString("utf8");
      if (!handshakeDone) {
        // pve-xtermjs handshake: "<user>:<ticket>\n" -> "OK".
        // Split on the FIRST colon: PVE tickets contain colons, usernames do not.
        const trimmed = text.replace(/\n$/u, "");
        const separator = trimmed.indexOf(":");
        const sentTicket = separator < 0 ? "" : trimmed.slice(separator + 1);
        if (sentTicket !== ticket) {
          socket.end(encodeFrame("ERR", { opcode: 0x01 }));
          return;
        }
        handshakeDone = true;
        socket.write(encodeFrame("OK", { opcode: 0x01 }));
        continue;
      }
      if (text === "2" || text.startsWith("2:")) {
        state.pings += 1;
        continue;
      }
      if (text.startsWith("1:")) {
        const [, cols, rows] = text.split(":");
        state.resizes.push({
          cols: Number.parseInt(cols, 10),
          rows: Number.parseInt(rows, 10),
        });
        continue;
      }
      if (text.startsWith("0:")) {
        // `0:<len>:<data>` — echo the payload back as raw bytes, like a shell.
        const first = text.indexOf(":");
        const second = text.indexOf(":", first + 1);
        const data = second < 0 ? "" : text.slice(second + 1);
        state.consoleInput.push(data);
        socket.write(encodeFrame(Buffer.from(data, "utf8")));
      }
    }
  });

  // The relay half-closes when the console tab goes away; mirror it so the
  // peer's `close` fires instead of hanging on an open half-duplex socket.
  socket.on("end", () => socket.end());
  socket.on("error", () => socket.destroy());
}

function handleVncSocket(socket) {
  // A fake RFB server behind the WS, enough for the loopback bridge test.
  socket.write(encodeFrame(Buffer.from("RFB 003.008\n", "ascii")));
  const decoder = new FrameDecoder();
  socket.on("data", (chunk) => {
    try {
      decoder.push(chunk);
    } catch {
      socket.destroy();
    }
  });
  socket.on("end", () => socket.end());
  socket.on("error", () => socket.destroy());
}

// ─────────────────────────────────────────────────────────────────── server ──

/**
 * Start the mock PVE server.
 *
 * @param {{
 *   port?: number, host?: string, certDir?: string,
 *   user?: string, password?: string, requireTfa?: boolean,
 *   totpSecret?: string | null, recoveryCodes?: string[],
 *   inlineOtp?: string | null, apiTokens?: [string, string][],
 *   initialVmStatus?: string,
 * }} [options]
 */
export async function startMockPve(options = {}) {
  const state = createState(options);
  const tls = ensureMockPveCertificate({ certDir: options.certDir });
  const host = options.host ?? DEFAULT_MOCK_PVE_HOST;
  const port = options.port ?? DEFAULT_MOCK_PVE_PORT;

  const server = https.createServer(
    { cert: tls.certificate, key: tls.privateKey },
    (request, response) => {
      const chunks = [];
      request.on("data", (chunk) => {
        chunks.push(chunk);
        if (chunks.reduce((sum, part) => sum + part.length, 0) > 1_000_000) {
          request.destroy();
        }
      });
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const url = new URL(request.url ?? "/", `https://${host}:${port}`);
        state.requests.push({
          method: request.method ?? "GET",
          path: url.pathname,
          query: url.search,
          headers: request.headers,
          body,
        });

        const send = (status, payload) => {
          response.writeHead(status, {
            "content-type": "application/json;charset=UTF-8",
            "cache-control": "no-store",
          });
          response.end(payload);
        };

        if (!url.pathname.startsWith("/api2/json/")) {
          send(404, errorBody("not found"));
          return;
        }

        if (url.pathname === "/api2/json/access/ticket") {
          if (request.method !== "POST") {
            send(400, errorBody("method"));
            return;
          }
          const [status, payload] = accessTicket(
            state,
            new URLSearchParams(body),
          );
          send(status, payload);
          return;
        }

        if (!isAuthenticated(state, request.headers)) {
          send(401, errorBody("No ticket"));
          return;
        }

        const segments = url.pathname
          .slice("/api2/json/".length)
          .split("/")
          .filter(Boolean);
        const handled = route(
          state,
          request.method ?? "GET",
          segments,
          url.searchParams,
        );
        if (!handled) {
          send(501, errorBody(`unhandled ${request.method} ${url.pathname}`));
          return;
        }
        send(handled[0], handled[1]);
      });
    },
  );

  // Sockets handed to the `upgrade` handler are detached from the server's own
  // connection tracking, so `server.close()` would wait on them forever.
  const upgradedSockets = new Set();

  server.on("upgrade", (request, socket) => {
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    const url = new URL(request.url ?? "/", `https://${host}:${port}`);
    state.requests.push({
      method: "UPGRADE",
      path: url.pathname,
      query: url.search,
      headers: request.headers,
      body: "",
    });
    const key = request.headers["sec-websocket-key"];
    const ticket = url.searchParams.get("vncticket") ?? "";
    const isTerm = state.termTickets.has(ticket);
    const isVnc = state.vncTickets.has(ticket);

    if (
      !key ||
      !url.pathname.endsWith("/vncwebsocket") ||
      !isAuthenticated(state, request.headers) ||
      (!isTerm && !isVnc)
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
        "Sec-WebSocket-Protocol: binary",
        "\r\n",
      ].join("\r\n"),
    );
    socket.setNoDelay(true);
    if (isTerm) handleTermproxySocket(state, socket, ticket);
    else handleVncSocket(socket);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;

  return {
    server,
    state,
    host,
    port: boundPort,
    url: `https://${host}:${boundPort}`,
    fingerprint: tls.fingerprint,
    certificate: tls.certificate,
    certificatePath: tls.certificatePath,
    subject: tls.subject,
    user: state.user,
    password: state.password,
    node: MOCK_PVE_NODE,
    vmid: MOCK_PVE_VMID,
    vmName: MOCK_PVE_VM_NAME,
    async stop() {
      for (const socket of upgradedSockets) socket.destroy();
      upgradedSockets.clear();
      await new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

// ────────────────────────────────────────────────────────────── forked CLI ──

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);

if (invokedDirectly) {
  const handle = await startMockPve({
    port: Number.parseInt(
      process.env.MOCK_PVE_PORT ?? String(DEFAULT_MOCK_PVE_PORT),
      10,
    ),
    host: process.env.MOCK_PVE_HOST ?? DEFAULT_MOCK_PVE_HOST,
    password: process.env.MOCK_PVE_PASSWORD ?? DEFAULT_MOCK_PVE_PASSWORD,
    requireTfa: process.env.MOCK_PVE_REQUIRE_TFA === "1",
  });
  const ready = {
    type: "mock-pve-ready",
    url: handle.url,
    host: handle.host,
    port: handle.port,
    fingerprint: handle.fingerprint,
    node: handle.node,
    vmid: handle.vmid,
    vmName: handle.vmName,
    user: handle.user,
    password: handle.password,
  };
  process.stdout.write(`MOCK_PVE_READY ${JSON.stringify(ready)}\n`);
  process.send?.(ready);

  const shutdown = () => {
    void handle.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("message", (message) => {
    if (message === "stop" || message?.type === "stop") shutdown();
  });
}
