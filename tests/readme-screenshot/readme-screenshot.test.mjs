import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  README_SCREENSHOT_HEIGHT,
  README_SCREENSHOT_WIDTH,
  validateReadmeScreenshot,
} from "../../scripts/readme-screenshot-validation.mjs";
import { assertLoopbackOnlySshFixturePorts } from "../../scripts/readme-screenshot.mjs";

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

test("capture SSH fixture is pinned and enables the application's key exchange", async () => {
  const composeOverride = await readFile(
    path.resolve("e2e/docker-compose.readme-screenshot.yml"),
    "utf8",
  );
  const fixtureInit = await readFile(
    path.resolve("e2e/fixtures/readme-ssh-server-init.sh"),
    "utf8",
  );

  assert.match(composeOverride, /openssh-server@sha256:[a-f0-9]{64}/);
  assert.match(composeOverride, /readme-ssh-server-init\.sh/);
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
