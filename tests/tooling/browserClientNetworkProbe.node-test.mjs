import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNetworkProbeSupported,
  probeBrowserClientNetwork,
} from "../../scripts/browser-client-network-probe.mjs";

const marker = "browser-network-probe: loopback/auth/shutdown passed";
const bytes = Buffer.from(`--sorng-browser-network-probe\0${marker}`);
test("old app clients are refused before a diagnostic can accidentally start them", () => {
  for (const value of ["", marker, "--sorng-browser-network-probe"])
    assert.throws(
      () => assertNetworkProbeSupported(Buffer.from(value)),
      /App was not launched/,
    );
  assert.doesNotThrow(() => assertNetworkProbeSupported(bytes));
});

test("network probe branches before profiles and app services, never before child dispatch", async () => {
  const entry = await readFile(
    new URL("../../src-tauri/src/origin_browser_entry.rs", import.meta.url),
    "utf8",
  );
  const branch = entry.slice(
    entry.indexOf('pub unsafe extern "C" fn RunWinMain'),
  );
  assert.ok(
    branch.indexOf("Ok(ProcessDispatch::Exit(code))") <
      branch.indexOf("origin_browser_network_probe::FLAG"),
  );
  assert.ok(
    branch.indexOf("return super::origin_browser_network_probe::run()") <
      branch.indexOf("crate::run()"),
  );
});

test(
  "runner accepts only success plus the probe completion marker",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sorng-network-probe-test-"),
    );
    t.after(() => rm(root, { force: true, recursive: true }));
    await writeFile(path.join(root, "sortofremoteng.dll"), bytes);
    const run = (command, args, options) => {
      assert.equal(command, path.join(root, "sortofremoteng.exe"));
      assert.deepEqual(args, ["--sorng-browser-network-probe"]);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 20000);
      return { status: 0, stderr: marker };
    };
    assert.equal((await probeBrowserClientNetwork(root, { run })).ok, true);
    for (const result of [
      { status: 0 },
      { status: 3221225477, stderr: marker },
      { error: { code: "ETIMEDOUT" } },
    ])
      await assert.rejects(
        probeBrowserClientNetwork(root, { run: () => result }),
        /probe failed/,
      );
  },
);
