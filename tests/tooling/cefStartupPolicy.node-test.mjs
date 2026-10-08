import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const patchRoot = new URL("../../native/cef-patches/", import.meta.url);
const seriesRoot = new URL("154.0.8037.58-682c378/", patchRoot);
const sodaPatchName = "0004-chromium-soda-provisioning.patch";
const sodaBaselines = new Map([
  [
    "components/soda/soda_features.h",
    "8be1a4dd84686a1323cd00b620c3962ae0661e5460718e53034120d74fb15d15",
  ],
  [
    "components/soda/soda_features.cc",
    "2ee124b2ffb728c9cb3557e5da48a36a678e62035db1b75ce35b3a988374cb6c",
  ],
  [
    "components/soda/soda_installer.cc",
    "70abb62f396bf08ff581130062bdb31d403e8bc29d0c99a9e3a9491fdbebe417",
  ],
  [
    "components/soda/soda_util.cc",
    "7367c9fd8d90212188ba642924df40b89483f708d170ef5093e80f71e080d66f",
  ],
  [
    "chrome/browser/accessibility/soda_installer_impl.cc",
    "ccae4c401e2d97aab4bf8e2717150748eafc9ffc6485b3f9205fc6b23283a8c7",
  ],
]);

// Inspect maintained diffs offline; neither a Chromium checkout nor libcef is
// needed. These assertions cover source structure, not loaded-engine behavior.
async function sodaPatchFiles() {
  const patch = await readFile(new URL(sodaPatchName, seriesRoot), "utf8");
  const files = new Map();
  for (const block of patch.split(/(?=^diff --git )/m).filter(Boolean)) {
    const header = /^diff --git a\/(\S+) b\/(\S+)\r?$/m.exec(block);
    assert.ok(header, "each patch block must identify a source file");
    assert.equal(header[1], header[2], "no renames in the SODA patch");
    assert.ok(!files.has(header[1]), "each file appears exactly once");
    assert.doesNotMatch(
      block,
      /^-(?!--)/m,
      "the narrow patch only adds guards",
    );
    const after = block
      .split(/\r?\n/)
      .filter((line) => /^[ +]/.test(line) && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
    files.set(header[1], after);
  }
  assert.deepEqual([...files.keys()].sort(), [...sodaBaselines.keys()].sort());
  return files;
}

test("SODA-only patch stays in the pinned series, fetch inventory and separate export", async () => {
  await sodaPatchFiles();
  const series = await readFile(new URL("series", seriesRoot), "utf8");
  assert.equal(
    series.split(/\r?\n/).filter((line) => line === `chromium ${sodaPatchName}`)
      .length,
    1,
  );
  const inventory = JSON.parse(
    await readFile(new URL("upstream-sha256.json", seriesRoot), "utf8"),
  );
  const fetch = await readFile(new URL("fetch-sources.ps1", patchRoot), "utf8");
  const exporter = await readFile(
    new URL("export-series.mjs", patchRoot),
    "utf8",
  );
  const socketPatch = await readFile(
    new URL("0001-chromium-socket-admission.patch", seriesRoot),
    "utf8",
  );
  const exportPaths = /const sodaPaths = \[([\s\S]*?)\];/.exec(exporter);
  assert.ok(exportPaths, "export must name the five SODA-only paths");
  assert.deepEqual(
    [...exportPaths[1].matchAll(/["']([^"']+)["']/g)]
      .map((match) => match[1])
      .sort(),
    [...sodaBaselines.keys()].sort(),
  );
  for (const [sourcePath, sha256] of sodaBaselines) {
    assert.deepEqual(
      inventory.filter(
        (row) => row.project === "chromium" && row.path === sourcePath,
      ),
      [{ project: "chromium", path: sourcePath, sha256 }],
    );
    assert.ok(
      fetch.includes(`'${sourcePath}'`),
      `fetch must acquire ${sourcePath}`,
    );
    assert.ok(
      !socketPatch.includes(sourcePath),
      "SODA must not leak into the socket admission patch",
    );
  }
  assert.match(
    exporter,
    /\[\s*["']chromium["'],\s*["']0004-chromium-soda-provisioning\.patch["'],\s*sodaPaths,?\s*\]/,
  );
  assert.match(
    exporter,
    /\[\s*["']chromium["'],\s*["']0001-chromium-socket-admission\.patch["'],\s*\[\s*["']\.["'],\s*\.\.\.sodaPaths\.map\(\(?path\)?\s*=>\s*`:\(exclude\)\$\{path\}`\)/,
  );
});

test("app SODA flag matches an exported, default-enabled engine feature on all platforms", async () => {
  const files = await sodaPatchFiles();
  const declaration = files.get("components/soda/soda_features.h");
  const definition = files.get("components/soda/soda_features.cc");
  assert.match(
    declaration,
    /COMPONENT_EXPORT\(SODA_INSTALLER\)\s*BASE_DECLARE_FEATURE\(kSodaComponentUpdates\);\s*#if BUILDFLAG\(IS_CHROMEOS\)/,
  );
  assert.match(
    definition,
    /namespace speech \{\s*BASE_FEATURE\(kSodaComponentUpdates, base::FEATURE_ENABLED_BY_DEFAULT\);\s*#if BUILDFLAG\(IS_CHROMEOS\)/,
  );
  const policy = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_startup_features.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const disabled = /const DISABLED_FEATURES:.*?= &\[([\s\S]*?)\];/.exec(policy);
  assert.ok(disabled);
  assert.match(disabled[1], /"SodaComponentUpdates"/);
  assert.match(disabled[1], /"PreemptiveSodaDownload"/);
});

test("SODA provisioning and availability return before any profile or download side effects", async () => {
  const files = await sodaPatchFiles();
  const guard =
    "if\\s*\\(!base::FeatureList::IsEnabled\\(kSodaComponentUpdates\\)\\)\\s*\\{";
  for (const [sourcePath, functions] of [
    ["components/soda/soda_installer.cc", ["SodaInstaller::Init"]],
    [
      "chrome/browser/accessibility/soda_installer_impl.cc",
      ["SodaInstallerImpl::InstallSoda", "SodaInstallerImpl::InstallLanguage"],
    ],
  ]) {
    const after = files.get(sourcePath);
    assert.match(after, /#include "components\/soda\/soda_features\.h"/);
    for (const name of functions) {
      assert.match(
        after,
        new RegExp(
          `void ${name}\\([^)]*\\)\\s*\\{\\s*${guard}\\s*return;\\s*\\}`,
        ),
        `${name} must gate before existing statements`,
      );
    }
  }
  const availability = files.get("components/soda/soda_util.cc");
  assert.match(availability, /#include "components\/soda\/soda_features\.h"/);
  assert.match(
    availability,
    new RegExp(
      `bool IsOnDeviceSpeechRecognitionSupported\\(\\)\\s*\\{\\s*(?://[^\\n]*\\n\\s*)*${guard}\\s*return false;\\s*\\}`,
    ),
  );
  assert.equal(
    [...files.values()]
      .join("\n")
      .match(/if \(!base::FeatureList::IsEnabled\(kSodaComponentUpdates\)\)/g)
      ?.length,
    4,
  );
});

test("proxy-only route probe patch is opt-in, bypasses sockets and suppresses follow-up NAT64 probing", async () => {
  const filename = "0005-chromium-proxy-route-probe.patch";
  const patch = await readFile(new URL(filename, seriesRoot), "utf8");
  const expected = new Map([
    [
      "net/dns/host_resolver_manager.cc",
      "420850f98d4d3c2a0b5beb4a8fb7cd75ec3e3a5da1dc2aa7b894dad1e59d461b",
    ],
    [
      "net/dns/host_resolver_manager_unittest.cc",
      "9085612cd238e9abcbc12e22a7e9221e3f8a7162c74001606b21da2617080b5d",
    ],
  ]);
  assert.deepEqual(
    [...patch.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)]
      .map((match) => match[1])
      .sort(),
    [...expected.keys()].sort(),
  );
  const after = patch
    .split(/\r?\n/)
    .filter((line) => /^[ +]/.test(line) && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  assert.doesNotMatch(patch, /net\/base\/features\.(h|cc)|NET_EXPORT/);
  assert.match(
    after,
    /namespace \{[\s\S]*BASE_FEATURE\(kSkipIPv6ReachabilityProbe/,
  );
  assert.match(
    after,
    /BASE_FEATURE\(kSkipIPv6ReachabilityProbe, base::FEATURE_DISABLED_BY_DEFAULT\)/,
  );
  const guardStart = after.indexOf(
    "if (base::FeatureList::IsEnabled(kSkipIPv6ReachabilityProbe))",
  );
  const guardEnd = after.indexOf("return OK;", guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart);
  const guard = after.slice(guardStart, guardEnd);
  assert.match(guard, /SetLastIPv6ProbeResult\(false\)/);
  assert.match(guard, /params.Set\("skipped_for_proxy", true\)/);
  assert.doesNotMatch(
    guard,
    /StartGloballyReachableCheck|CreateDatagramClientSocket|ConnectAsync/,
  );
  assert.match(after, /return OK;\s*\}\s*\/\/ Don't bother checking/);
  assert.match(after, /SkipIPv6ReachabilityProbeForLoopbackProxy/);
  assert.match(after, /InitFromCommandLine\("SkipIPv6ReachabilityProbe", ""\)/);
  assert.match(after, /EXPECT_FALSE\(GetLastIpv6ProbeResult\(\)\)/);
  assert.match(after, /MockClientSocketFactory socket_factory;/);
  const series = await readFile(new URL("series", seriesRoot), "utf8");
  assert.equal(
    series.split(/\r?\n/).filter((line) => line === `chromium ${filename}`)
      .length,
    1,
  );
  const inventory = JSON.parse(
    await readFile(new URL("upstream-sha256.json", seriesRoot), "utf8"),
  );
  const fetch = await readFile(new URL("fetch-sources.ps1", patchRoot), "utf8");
  const exporter = await readFile(
    new URL("export-series.mjs", patchRoot),
    "utf8",
  );
  for (const [sourcePath, sha256] of expected) {
    assert.deepEqual(
      inventory.filter(
        (row) => row.project === "chromium" && row.path === sourcePath,
      ),
      [{ project: "chromium", path: sourcePath, sha256 }],
    );
    assert.ok(fetch.includes(`'${sourcePath}'`));
    assert.ok(
      exporter.includes(`'${sourcePath}'`) ||
        exporter.includes(JSON.stringify(sourcePath)),
    );
  }
  assert.match(
    exporter,
    /\[\s*["']chromium["'],\s*["']0005-chromium-proxy-route-probe\.patch["'],\s*probePaths,?\s*\]/,
  );
  assert.match(
    exporter,
    /\.\.\.probePaths\.map\(\(?path\)?\s*=>\s*`:\(exclude\)\$\{path\}`\)/,
  );
  const policy = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_startup_features.rs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    policy,
    /fn enabled_features\(existing: &str\) -> String \{\s*merge_features\(\s*existing,\s*&\["SkipIPv6ReachabilityProbe",\s*"WebContentsForceDark"\],?\s*\)/,
  );
});

test("pinned CEF startup policy preserves features and is idempotent (std-only rustc)", async (t) => {
  const moduleUrl = new URL(
    "../../src-tauri/crates/sorng-browser-host/src/cef_startup_features.rs",
    import.meta.url,
  );
  const runtime = await readFile(new URL("cef_runtime.rs", moduleUrl), "utf8");
  assert.match(
    runtime,
    /#\[path = "cef_startup_features\.rs"\]\s*mod startup_features;/,
  );
  const callback = runtime.slice(
    runtime.indexOf("fn on_before_command_line_processing("),
    runtime.indexOf("fn scheduler("),
  );
  assert.match(callback, /startup_features::disabled_features\(/);
  assert.match(callback, /startup_features::enabled_features\(/);
  assert.match(callback, /startup_features::DISABLE_DEFAULT_APPS/);
  // These switches would hide the diagnostic or disable unrelated facilities.
  // The native acceptance lane must still prove the companion SODA engine gate.
  const callbackStrings = new Set(
    [...callback.matchAll(/"([^"\r\n]*)"/g)].map((match) => match[1]),
  );
  for (const forbidden of [
    "disable-component-update",
    "disable-background-networking",
    "disable-extensions",
    "disable-gpu",
    "disable-gpu-compositing",
    "disable-software-rasterizer",
    "disable-webgl",
    "disable-webgl2",
    "disable-media-stream",
    "disable-webrtc",
    "disable-logging",
    "log-level",
    "no-sandbox",
    "disable-web-security",
    "ignore-certificate-errors",
  ]) {
    assert.ok(
      !callbackStrings.has(forbidden),
      `startup policy must not append --${forbidden}`,
    );
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-startup-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = path.join(
    root,
    process.platform === "win32" ? "policy.exe" : "policy",
  );
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--test",
      "-Dwarnings",
      fileURLToPath(moduleUrl),
      "-o",
      binary,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      encoding: "utf8",
      timeout: 60_000,
    }).trim(),
  );
});
