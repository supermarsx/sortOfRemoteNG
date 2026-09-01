import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);

function directiveSources(csp, directive) {
  const entry = csp
    .split(";")
    .map((value) => value.trim())
    .find((value) => value === directive || value.startsWith(`${directive} `));

  assert.ok(entry, `Tauri CSP must define ${directive}`);
  return new Set(entry.split(/\s+/).slice(1));
}

test("production CSP keeps Tauri binary IPC on the custom-protocol transport", () => {
  const csp = tauriConfig?.app?.security?.csp;
  assert.equal(
    typeof csp,
    "string",
    "tauri.conf.json must define a string CSP",
  );

  const connectSources = directiveSources(csp, "connect-src");
  assert.ok(
    connectSources.has("ipc:"),
    "connect-src must allow ipc: on platforms that expose Tauri IPC as a scheme",
  );
  assert.ok(
    connectSources.has("http://ipc.localhost"),
    "connect-src must allow the WebView2 Tauri IPC origin",
  );
});
