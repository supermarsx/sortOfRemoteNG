import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  README_SCREENSHOT_HEIGHT,
  README_SCREENSHOT_WIDTH,
  validateReadmeScreenshot,
} from "../../scripts/readme-screenshot-validation.mjs";
import {
  assertLoopbackOnlySshFixturePorts,
  pinDriverPorts,
} from "../../scripts/readme-screenshot.mjs";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngHeader(
  width = README_SCREENSHOT_WIDTH,
  height = README_SCREENSHOT_HEIGHT,
) {
  const bytes = Buffer.alloc(24);
  PNG_SIGNATURE.copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function withTempFile(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sorng-readme-shot-"));
  const filePath = path.join(directory, "capture.png");
  try {
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("accepts a fresh 1280x720 PNG", async () => {
  await withTempFile(async (filePath) => {
    const freshSinceMs = Date.now() - 1_000;
    await writeFile(filePath, pngHeader());

    const result = await validateReadmeScreenshot({ filePath, freshSinceMs });

    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
  });
});

test("rejects a file without the PNG signature", async () => {
  await withTempFile(async (filePath) => {
    const bytes = pngHeader();
    bytes[0] = 0;
    await writeFile(filePath, bytes);

    await assert.rejects(
      validateReadmeScreenshot({ filePath }),
      /invalid signature/,
    );
  });
});

test("rejects the wrong image dimensions", async () => {
  await withTempFile(async (filePath) => {
    await writeFile(filePath, pngHeader(1279, 720));

    await assert.rejects(
      validateReadmeScreenshot({ filePath }),
      /1279x720; expected 1280x720/,
    );
  });
});

test("rejects a stale capture", async () => {
  await withTempFile(async (filePath) => {
    await writeFile(filePath, pngHeader());
    const oldTimestamp = new Date(Date.now() - 60_000);
    await utimes(filePath, oldTimestamp, oldTimestamp);

    await assert.rejects(
      validateReadmeScreenshot({
        filePath,
        freshSinceMs: Date.now() - 1_000,
      }),
      /is stale/,
    );
  });
});

test("capture config uses an isolated fixed-size Tauri application", async () => {
  const configPath = path.resolve(
    "src-tauri/tauri.readme-screenshot.conf.json",
  );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const [window] = config.app.windows;

  assert.equal(config.identifier, "com.sortofremote.ng.readme-capture");
  assert.notEqual(config.identifier, "com.sortofremote.ng");
  assert.equal(config.bundle.active, false);
  assert.equal(window.width, 1280);
  assert.equal(window.height, 720);
  assert.equal(window.minWidth, 1280);
  assert.equal(window.minHeight, 720);
  assert.equal(window.maxWidth, 1280);
  assert.equal(window.maxHeight, 720);
  assert.equal(window.resizable, false);
  assert.equal(window.decorations, false);
});

test("shared SSH fixture is interoperable and the capture image is pinned", async () => {
  const baseCompose = await readFile(
    path.resolve("e2e/docker-compose.yml"),
    "utf8",
  );
  const composeOverride = await readFile(
    path.resolve("e2e/docker-compose.readme-screenshot.yml"),
    "utf8",
  );
  const fixtureInit = await readFile(
    path.resolve("e2e/fixtures/ssh-server-init.sh"),
    "utf8",
  );

  assert.match(composeOverride, /openssh-server@sha256:[a-f0-9]{64}/);
  assert.match(baseCompose, /ssh-server-init\.sh/);
  assert.match(baseCompose, /\/custom-cont-init\.d\/10-ssh-server:ro/);
  assert.match(fixtureInit, /diffie-hellman-group16-sha512/);
  assert.match(fixtureInit, /sshd\.pam -t/);
});

test("accepts only the loopback README SSH fixture port binding", () => {
  assert.doesNotThrow(() =>
    assertLoopbackOnlySshFixturePorts({
      services: {
        "test-ssh": {
          ports: [
            {
              host_ip: "127.0.0.1",
              target: 2222,
              published: "2222",
              protocol: "tcp",
            },
          ],
        },
      },
    }),
  );

  assert.throws(
    () =>
      assertLoopbackOnlySshFixturePorts({
        services: {
          "test-ssh": {
            ports: [
              {
                host_ip: "0.0.0.0",
                target: 2222,
                published: "2222",
                protocol: "tcp",
              },
            ],
          },
        },
      }),
    /must publish exactly 127\.0\.0\.1:2222:2222\/tcp/,
  );
});

async function withDriverPortEnv(run) {
  const saved = {
    driver: process.env.TAURI_DRIVER_PORT,
    native: process.env.TAURI_NATIVE_DRIVER_PORT,
  };

  try {
    return await run();
  } finally {
    for (const [name, value] of [
      ["TAURI_DRIVER_PORT", saved.driver],
      ["TAURI_NATIVE_DRIVER_PORT", saved.native],
    ]) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

test("pins a distinct, free driver port pair for both capture phases", async () => {
  await withDriverPortEnv(async () => {
    delete process.env.TAURI_DRIVER_PORT;
    delete process.env.TAURI_NATIVE_DRIVER_PORT;

    const driverPort = await pinDriverPorts();
    const nativePort = Number.parseInt(
      process.env.TAURI_NATIVE_DRIVER_PORT,
      10,
    );

    // Both phases are separate wdio invocations that must agree on the port,
    // so the values have to be published to the environment they inherit.
    assert.equal(String(driverPort), process.env.TAURI_DRIVER_PORT);
    assert.ok(Number.isInteger(driverPort) && driverPort > 0);
    assert.ok(Number.isInteger(nativePort) && nativePort > 0);
    assert.notEqual(driverPort, nativePort);

    // Released, not still held by the allocator.
    assert.equal(await canBind(driverPort), true);
    assert.equal(await canBind(nativePort), true);
  });
});

test("keeps an explicitly pinned driver port pair", async () => {
  await withDriverPortEnv(async () => {
    process.env.TAURI_DRIVER_PORT = "4444";
    process.env.TAURI_NATIVE_DRIVER_PORT = "4445";

    assert.equal(await pinDriverPorts(), 4444);
    assert.equal(process.env.TAURI_DRIVER_PORT, "4444");
    assert.equal(process.env.TAURI_NATIVE_DRIVER_PORT, "4445");
  });
});
