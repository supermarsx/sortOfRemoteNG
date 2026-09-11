import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configPath = new URL("../../next.config.js", import.meta.url);
const tauriConfig = JSON.parse(
  await readFile(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);

test("packaged parent allows only protected-proxy frame host namespace, not remote HTTPS", () => {
  const frame = tauriConfig.app.security.csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("frame-src "));
  assert.equal(frame, "frame-src http://*.localhost:*");
  // CSP is the portable baseline. Exact currently-live origins are checked
  // separately by Windows native navigation; this is not a claim about WebRTC.
  assert.match(tauriConfig.app.security.csp, /object-src 'none'/u);
  assert.match(tauriConfig.app.security.csp, /frame-ancestors 'none'/u);
});

test("Next development serves matching parent frame policy without static-export headers", async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const { default: development } = await import(
      `${configPath.href}?frame-policy=development`
    );
    assert.deepEqual(await development.headers(), [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-src http://*.localhost:*",
          },
        ],
      },
    ]);
    process.env.NODE_ENV = "production";
    const { default: production } = await import(
      `${configPath.href}?frame-policy=production`
    );
    assert.equal(production.output, "export");
    assert.equal(Object.hasOwn(production, "headers"), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
