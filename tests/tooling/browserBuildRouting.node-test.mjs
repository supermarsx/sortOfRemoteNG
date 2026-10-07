import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { requiresBrowserBuildDriver } from "../../scripts/lib/browser-build-route.mjs";
import { main as launchTauri } from "../../scripts/tauri.mjs";

for (const [args, expected] of [
  [[], true],
  [["--features", "lean"], true], // Cargo defaults still include full.
  [["--features", "lean", "--", "--no-default-features"], false],
  [["--", "--no-default-features"], false],
  [["--", "--no-default-features", "-F", "native-browser"], true],
  [["--", "--", "--no-default-features", "--help"], true],
  [
    ["--", "--no-default-features", "--", "--features", "native-browser"],
    false,
  ],
  [["--features=lean,native-browser", "--", "--no-default-features"], true],
  [["-f", "full-linux-system", "--", "--no-default-features"], true],
  [["--features", "full-unix-dynamic", "--", "--no-default-features"], true],
  [["--features", "full-windows-dynamic", "--", "--no-default-features"], true],
  [["--all-features", "--no-default-features"], true],
  [["--help"], false],
])
  test(`CEF route selection preserves explicit feature intent: ${args.join(" ") || "default"}`, () => {
    assert.equal(requiresBrowserBuildDriver(args), expected);
  });

for (const [args, script] of [
  [["build"], "browser-app-build.mjs"],
  [
    [
      "build",
      "--features",
      "full-windows-dynamic",
      "--",
      "--no-default-features",
    ],
    "browser-app-build.mjs",
  ],
  [["build", "--features", "lean", "--", "--no-default-features"], "tauri.js"],
  [["build", "--help"], "tauri.js"],
  [["info"], "tauri.js"],
])
  test(`public Tauri launcher routes ${args.join(" ")} to ${script}`, async () => {
    const host = new EventEmitter();
    host.execPath = process.execPath;
    host.pid = 123;
    let exit;
    host.exit = (value) => {
      exit = value;
    };
    host.kill = () => assert.fail("Unexpected parent kill");
    const child = new EventEmitter();
    child.killed = false;
    child.kill = (signal) => {
      child.killed = signal;
    };
    const environment = { ROUTING_TEST: "isolated" };
    const result = await launchTauri(args, {
      process: host,
      env: environment,
      spawn(executable, received, options) {
        assert.equal(executable, process.execPath);
        assert.ok(received[0].endsWith(script));
        assert.deepEqual(received.slice(1), args);
        assert.equal(options.env, environment);
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        return child;
      },
    });
    assert.equal(result, child);
    host.emit("SIGTERM");
    assert.equal(child.killed, "SIGTERM");
    child.emit("exit", 17, null);
    assert.equal(exit, 17);
  });

test("dynamic native wrapper retains its staged config while routing through the browser-aware launcher", () => {
  const source = readFileSync(
    new URL("../../scripts/native-build-env.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /new URL\("\.\/tauri\.mjs", import\.meta\.url\)/u);
  assert.match(source, /env\.SORNG_CEF_NATIVE_PREPARED = "1"/u);
  assert.match(
    source,
    /executableArguments = \[managedTauri, \.\.\.executableArguments\]/u,
  );
});
