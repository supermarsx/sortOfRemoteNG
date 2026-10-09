import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const crates = [
  "sorng-commands-core",
  "sorng-commands-nas",
  "sorng-commands-vpn",
  "sorng-app-startup-state",
];
const rerun = "cargo:rerun-if-changed=build.rs";
const manifest = [
  "cargo:rustc-link-arg=/MANIFEST:EMBED",
  "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'",
];

// Execute the real std-only build scripts, without Cargo or app dependencies.
// Cargo's target environment, not the host running this test, selects linking.
for (const crate of crates) {
  test(`${crate}: narrow invalidation retains target-specific manifest output`, async (t) => {
    const parent = await realpath(os.tmpdir());
    const root = await mkdtemp(path.join(parent, "sorng-build-invalidation-"));
    t.after(async () => {
      assert.equal(path.dirname(root), parent);
      assert.ok(path.basename(root).startsWith("sorng-build-invalidation-"));
      await rm(root, { recursive: true, force: true });
    });
    const binary = path.join(
      root,
      process.platform === "win32" ? "build-script.exe" : "build-script",
    );
    execFileSync(
      "rustc",
      [
        "--edition=2021",
        "-Dwarnings",
        path.join(repo, "src-tauri", "crates", crate, "build.rs"),
        "-o",
        binary,
      ],
      { cwd: repo, timeout: 60_000, windowsHide: true },
    );

    for (const [targetOs, targetEnv, expected] of [
      ["windows", "msvc", [rerun, ...manifest]],
      ["windows", "gnu", [rerun]],
      ["linux", "msvc", [rerun]],
      ["macos", "", [rerun]],
      [undefined, undefined, [rerun]],
    ]) {
      const env = { ...process.env };
      delete env.CARGO_CFG_TARGET_OS;
      delete env.CARGO_CFG_TARGET_ENV;
      if (targetOs !== undefined) env.CARGO_CFG_TARGET_OS = targetOs;
      if (targetEnv !== undefined) env.CARGO_CFG_TARGET_ENV = targetEnv;
      const output = execFileSync(binary, [], {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      });
      assert.deepEqual(
        output.trim().split(/\r?\n/u),
        expected,
        `Unexpected Cargo directives for ${targetOs ?? "unset"}/${targetEnv ?? "unset"}`,
      );
    }
  });
}
