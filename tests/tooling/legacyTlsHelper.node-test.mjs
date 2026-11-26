import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EventEmitter, once } from "node:events";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = join(root, "native/legacy-tls/build");
const suffix = process.platform === "win32" ? ".exe" : "";
const helper = join(root, `native/legacy-tls/bundle/sorng-legacy-tls${suffix}`);
const fixture = join(build, `tls-fixture${suffix}`);
const available = existsSync(helper) && existsSync(fixture);
const cert = join(build, "test-cert.pem"),
  key = join(build, "test-key.pem");
test("native helper and server fixture are built", () => {
  assert.ok(
    available,
    "Run npm run native:legacy-tls:build -- --test-fixture first",
  );
});
if (available) {
  mkdirSync(build, { recursive: true });
  execFileSync(
    process.env.OPENSSL ?? "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  execFileSync(process.env.OPENSSL ?? "openssl", ["req", "-x509", "-newkey", "rsa:1024", "-sha1", "-nodes", "-subj", "/CN=localhost", "-days", "1", "-keyout", join(build, "weak-key.pem"), "-out", join(build, "weak-cert.pem")],
    { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}
function frame(tag, data = Buffer.alloc(0)) {
  const h = Buffer.alloc(5);
  h[0] = tag.charCodeAt(0);
  h.writeUInt32BE(data.length, 1);
  return Buffer.concat([h, data]);
}
function engine(exe, args = []) {
  const child = spawn(exe, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const events = new EventEmitter();
  let buffer = Buffer.alloc(0),
    failure;
  child.stderr.resume();
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const n = buffer.readUInt32BE(1);
      assert.ok(n <= 1024 * 1024);
      if (buffer.length < 5 + n) break;
      const tag = String.fromCharCode(buffer[0]),
        data = Buffer.from(buffer.subarray(5, 5 + n));
      buffer = buffer.subarray(5 + n);
      if (tag === "E") {
        failure = data;
        console.error(
          "Legacy engine error",
          exe === helper ? "client" : "server",
          data.toString("hex"),
        );
      }
      events.emit(tag, data);
    }
  });
  child.on("error", (err) => events.emit("failed", err));
  return {
    child,
    events,
    send: (tag, data) => child.stdin.write(frame(tag, data)),
    get failure() {
      return failure;
    },
  };
}
async function exchange(from, to, bytes) {
  const received = [];
  let count = 0;
  const completed = new Promise((resolve) => {
    const receive = (data) => {
      received.push(data);
      count += data.length;
      if (count >= bytes.length) {
        to.events.off("P", receive);
        resolve();
      }
    };
    to.events.on("P", receive);
  });
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    const ack = once(from.events, "A");
    from.send("P", bytes.subarray(offset, offset + 16384));
    await ack;
  }
  await completed;
  assert.deepEqual(Buffer.concat(received), bytes);
}
for (const profile of ["ssl2", "ssl3", "tls10", "tls11", "legacy"]) {
  test(
    `real ${profile} handshake and bidirectional records`,
    { skip: !available, timeout: 20000 },
    async (t) => {
      const client = engine(helper),
        server = engine(fixture, [cert, key]);
      t.after(() => {
        client.child.kill();
        server.child.kill();
      });
      client.events.on("N", (bytes) => server.send("N", bytes));
      server.events.on("N", (bytes) => client.send("N", bytes));
      const ready = Promise.all([
        once(client.events, "H"),
        once(server.events, "H"),
      ]);
      server.send("C", Buffer.from(`${profile}\0localhost\0`));
      client.send("C", Buffer.from(`${profile}\0localhost\0`));
      const [[evidence]] = await Promise.race([
        ready,
        once(client.events, "E").then(([error]) => {
          throw new Error(`Client TLS error ${error.toString("hex")}`);
        }),
        once(server.events, "E").then(([error]) => {
          throw new Error(`Fixture TLS error ${error.toString("hex")}`);
        }),
      ]);
      assert.ok(evidence.length > 100, "actual peer certificate evidence");
      assert.equal(client.failure, undefined);
      assert.equal(server.failure, undefined);
      await exchange(
        client,
        server,
        Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
      );
      const payload = Buffer.alloc(128 * 1024, 0x5a);
      await exchange(server, client, payload);
    },
  );
}
test(
  "helper reports a real version mismatch alert without guessing ciphers",
  { skip: !available, timeout: 20000 },
  async (t) => {
    const client = engine(helper),
      server = engine(fixture, [cert, key]);
    t.after(() => {
      client.child.kill();
      server.child.kill();
    });
    client.events.on("N", (bytes) => server.send("N", bytes));
    server.events.on("N", (bytes) => client.send("N", bytes));
    const failed = once(client.events, "E");
    server.send("C", Buffer.from("tls11\0localhost\0"));
    client.send("C", Buffer.from("tls10\0localhost\0"));
    const [error] = await failed;
    assert.equal(error.length, 8);
    assert.ok([1, 8, 10].includes(error.readUInt32BE(0)));
  },
);
