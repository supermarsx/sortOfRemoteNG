import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundleConfiguration,
  mergeConfig,
} from "../../scripts/browser-app-build.mjs";
import {
  helperPlist,
  packageManifest,
} from "../../scripts/browser-runtime-package.mjs";

// Cross-platform declaration/generation tests only. No codesign, TCC prompt,
// media device access, or CEF execution is performed or implied by these tests.
const repo = fileURLToPath(new URL("../../", import.meta.url));
const tauri = path.join(repo, "src-tauri");
const python = process.platform === "win32" ? "python" : "python3";
const camera =
  "sortOfRemoteNG uses your camera for video on websites when you approve a camera request.";
const microphone =
  "sortOfRemoteNG uses your microphone for audio on websites when you approve a microphone request.";

function runPython(args, input) {
  const result = spawnSync(python, args, {
    input,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function parsePlist(contents) {
  return JSON.parse(
    runPython(
      [
        "-c",
        "import json, plistlib, sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))",
      ],
      contents,
    ),
  );
}

async function config() {
  return mergeConfig(
    JSON.parse(await readFile(path.join(tauri, "tauri.conf.json"), "utf8")),
    JSON.parse(
      await readFile(path.join(tauri, "tauri.macos.conf.json"), "utf8"),
    ),
  );
}

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sorng-mac-media-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("sorng-mac-media-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function assertUsage(plist) {
  assert.equal(plist.NSCameraUsageDescription, camera);
  assert.equal(plist.NSMicrophoneUsageDescription, microphone);
  assert.equal(plist.NSAppTransportSecurity, undefined);
}

test("macOS-only overlay wires real app usage strings and minimal signing entitlements", async () => {
  const overlay = JSON.parse(
    await readFile(path.join(tauri, "tauri.macos.conf.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(overlay).sort(), ["$schema", "bundle"]);
  assert.deepEqual(Object.keys(overlay.bundle), ["macOS"]);
  const mac = (await config()).bundle.macOS;
  assert.equal(mac.hardenedRuntime, true);
  assertUsage(parsePlist(await readFile(path.join(tauri, mac.infoPlist))));
  assert.deepEqual(
    parsePlist(await readFile(path.join(tauri, mac.entitlements))),
    {
      "com.apple.security.device.camera": true,
      "com.apple.security.device.audio-input": true,
    },
    "No global media grant, app sandbox toggle, JIT or signature-validation exception",
  );
});

test("development app generator carries the configured usage descriptions into the actual app plist", async (t) => {
  const root = await temporary(t);
  const merged = await config();
  merged.mainBinaryName = "sortofremoteng";
  const input = path.join(root, "config.json");
  const output = path.join(root, "Info.plist");
  await writeFile(input, JSON.stringify(merged));
  runPython([
    path.join(repo, "scripts/native/browser-app-plist.py"),
    input,
    output,
    tauri,
  ]);
  const plist = parsePlist(await readFile(output));
  assertUsage(plist);
  assert.equal(plist.CFBundleExecutable, "sortofremoteng");
  assert.equal(plist.CFBundleIdentifier, merged.identifier);
  assert.equal(plist.CFBundlePackageType, "APPL");
  assert.equal(plist.LSMinimumSystemVersion, "14.0");
  // Exercise the same native pre-staging validator as normal/custom packages.
  const validated = JSON.parse(
    runPython([
      path.join(tauri, "crates/sorng-browser-host/native/extract_runtime.py"),
      "plist",
      output,
      merged.mainBinaryName,
    ]),
  );
  assert.equal(validated.identifier, merged.identifier);
});

for (const target of ["x86_64-apple-darwin", "aarch64-apple-darwin"])
  test(`final bundle configuration preserves media declarations and every helper: ${target}`, async () => {
    const base = await config();
    const snapshot = structuredClone(base);
    const plan = {
      platform: "macos",
      target,
      appName: "sortofremoteng",
      payload: path.resolve("synthetic-not-executed.app"),
    };
    const final = bundleConfiguration(base, plan, []);
    assert.deepEqual(base, snapshot, "Packaging must not mutate the input");
    const mac = final.bundle.macOS;
    assert.equal(mac.infoPlist, base.bundle.macOS.infoPlist);
    assert.equal(mac.entitlements, base.bundle.macOS.entitlements);
    assert.equal(mac.hardenedRuntime, true);
    const helpers = packageManifest(
      target,
      plan.appName,
    ).applicationFiles.filter(
      (name) =>
        name.startsWith("Contents/Frameworks/") && name.endsWith("/Info.plist"),
    );
    assert.equal(helpers.length, 5);
    for (const filename of helpers) {
      const bundle = path.posix.dirname(path.posix.dirname(filename));
      assert.equal(
        mac.files[bundle.slice("Contents/".length)],
        path.join(plan.payload, bundle),
      );
    }
    // Tauri custom-file membership alone does NOT prove helper signing.
  });

test("all generated CEF helper roles have matching usage strings and distinct bundle identities", async () => {
  const app = parsePlist(
    await readFile(path.join(tauri, (await config()).bundle.macOS.infoPlist)),
  );
  const identities = new Set();
  for (const suffix of [
    "",
    " (Alerts)",
    " (GPU)",
    " (Plugin)",
    " (Renderer)",
  ]) {
    const helper = parsePlist(helperPlist("sortofremoteng", suffix));
    assertUsage(helper);
    assert.equal(helper.NSCameraUsageDescription, app.NSCameraUsageDescription);
    assert.equal(
      helper.NSMicrophoneUsageDescription,
      app.NSMicrophoneUsageDescription,
    );
    assert.equal(helper.CFBundleExecutable, `sortofremoteng Helper${suffix}`);
    assert.equal(helper.LSUIElement, true);
    assert.equal(helper.LSMinimumSystemVersion, "14.0");
    identities.add(helper.CFBundleIdentifier);
    assert.ok(
      !Object.keys(helper).some((key) => key.startsWith("com.apple.security.")),
      "Entitlements belong in code signatures, never in helper Info.plist",
    );
  }
  assert.equal(identities.size, 5);
});
