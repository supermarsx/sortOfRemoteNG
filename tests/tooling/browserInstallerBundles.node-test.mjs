import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bundleArguments,
  bundleCliSelection,
  patchWindowsBundleType,
  prepareWindowsInstallerBundles,
  windowsInstallerChoices,
} from "../../scripts/lib/browser-installer-bundles.mjs";
import { parseArguments } from "../../scripts/browser-app-build.mjs";

const marker = "__TAURI_BUNDLE_TYPE_VAR_UNK";
const fixture = Buffer.from(
  `fixture-only\0__TAURI_BUNDLE_TYPE_VAR_MSI\0__TAURI_BUNDLE_TYPE_VAR_NSS\0${marker}\0tail`,
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("patch changes only the unique UNK initializer, never comparison literals or input", () => {
  const original = Buffer.from(fixture);
  for (const [installer, suffix] of [
    ["msi", "MSI"],
    ["nsis", "NSS"],
  ]) {
    const result = patchWindowsBundleType(fixture, installer);
    const offset = fixture.indexOf(marker);
    const expected = Buffer.from(fixture);
    expected.write(suffix, offset + marker.length - 3, 3, "ascii");
    assert.deepEqual(result.bytes, expected);
    assert.deepEqual(fixture, original);
    assert.equal(result.byteLength, original.length);
    assert.equal(result.markerOffset, offset);
    assert.equal(result.sourceSha256, hash(original));
    assert.equal(result.clientSha256, hash(expected));
    assert.equal(result.bytes.indexOf(marker), -1);
  }
  assert.notEqual(
    patchWindowsBundleType(fixture, "msi").clientSha256,
    patchWindowsBundleType(fixture, "nsis").clientSha256,
  );
});

test("missing, duplicate, already-patched markers and unsupported installers fail closed", () => {
  for (const bytes of [
    Buffer.from("no marker"),
    Buffer.from(marker + marker),
    patchWindowsBundleType(fixture, "msi").bytes,
  ])
    assert.throws(
      () => patchWindowsBundleType(bytes, "nsis"),
      /exactly one unpatched/,
    );
  for (const installer of ["exe", "all", "__proto__"])
    assert.throws(
      () => patchWindowsBundleType(fixture, installer),
      /Unsupported/,
    );
});

test("Windows choices preserve defaults, explicit overrides and no-bundle", () => {
  const all = { bundle: { targets: "all" } };
  assert.deepEqual(windowsInstallerChoices({}, all), ["msi", "nsis"]);
  assert.deepEqual(
    windowsInstallerChoices({}, { bundle: { targets: ["nsis"] } }),
    ["nsis"],
  );
  assert.deepEqual(
    windowsInstallerChoices({ tauriArgs: ["--bundles=nsis"] }, all),
    ["nsis"],
  );
  assert.deepEqual(
    windowsInstallerChoices({ tauriArgs: ["-b", "nsis", "msi", "--ci"] }, all),
    ["nsis", "msi"],
  );
  assert.deepEqual(
    windowsInstallerChoices(
      { tauriArgs: ["--bundles", "msi,nsis", "--bundles", "msi"] },
      all,
    ),
    ["msi", "nsis"],
  );
  assert.deepEqual(windowsInstallerChoices({ noBundle: true }, all), []);
  assert.throws(
    () => windowsInstallerChoices({ tauriArgs: ["-b", "dmg"] }, all),
    /Unsupported/,
  );
  assert.throws(() => bundleCliSelection(["--bundles"]), /requires/);
});

test("attached short bundle forms retain the explicit installer selection", () => {
  for (const arg of ["-bnsis", "-b=nsis"]) {
    const options = parseArguments(
      ["build", "--cef-runtime-kind=official", arg, "--ci"],
      {},
    );
    assert.deepEqual(bundleCliSelection(options.tauriArgs), {
      bundles: ["nsis"],
      flags: ["--ci"],
    });
    assert.deepEqual(
      windowsInstallerChoices(options, { bundle: { targets: "all" } }),
      ["nsis"],
    );
    const args = bundleArguments({
      plan: { target: "x86_64-pc-windows-msvc" },
      configFile: "prepared.json",
      options,
    });
    assert.deepEqual(args.slice(-3), ["--ci", "--bundles", "nsis"]);
  }
  assert.deepEqual(bundleCliSelection(["-b=nsis,msi", "--ci"]).bundles, [
    "nsis",
    "msi",
  ]);
  assert.deepEqual(bundleCliSelection(["-bnsis", "msi", "--ci"]).bundles, [
    "nsis",
    "msi",
  ]);
  assert.throws(() => bundleCliSelection(["-b=", "--ci"]), /requires/);
});

test("bundle phase preserves selected flags and never injects a signing opt-out", () => {
  const plan = { target: "x86_64-pc-windows-msvc" };
  const options = parseArguments(
    [
      "build",
      "--cef-runtime-kind=official",
      "--debug",
      "--features=full-windows-dynamic",
      "--bundles=msi,nsis",
      "--ci",
      "-vv",
      "--skip-stapling",
      "--no-sign",
    ],
    {},
  );
  const args = bundleArguments({
    plan,
    configFile: "prepared.json",
    options,
    installer: "nsis",
  });
  assert.deepEqual(args, [
    "bundle",
    "--config",
    "prepared.json",
    "--target",
    plan.target,
    "--features",
    "full-windows-dynamic,native-browser",
    "--debug",
    "--ci",
    "-vv",
    "--skip-stapling",
    "--no-sign",
    "--bundles",
    "nsis",
  ]);
  assert.ok(
    !bundleArguments({ plan, configFile: "x", options: {} }).includes(
      "--no-sign",
    ),
  );
  assert.deepEqual(
    bundleArguments({
      plan: { target: "aarch64-apple-darwin" },
      configFile: "mac.json",
      options: { tauriArgs: ["--bundles", "app", "dmg", "--verbose"] },
    }).slice(-4),
    ["--verbose", "--bundles", "app", "dmg"],
  );
});

async function prepareFixture(target) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-installer-copies-"));
  const payload = path.join(root, "payload");
  await mkdir(payload);
  const client = path.join(payload, "app.dll");
  await writeFile(client, fixture);
  await writeFile(path.join(payload, "app.exe"), "pinned bootstrap fixture");
  const raw = path.join(root, "raw.dll");
  const published = path.join(root, "unbundled.dll");
  await writeFile(raw, fixture);
  await writeFile(published, fixture);
  const plan = { root, payload, appName: "app", target };
  const bundleConfig = {
    mainBinaryName: "app",
    build: { beforeBundleCommand: "existing hook" },
    bundle: {
      targets: "all",
      windows: { wix: { upgradeCode: "preserved" } },
      resources: {
        [client]: "app.dll",
        locales: "locales",
        "native.dll": "native.dll",
      },
    },
  };
  return { root, plan, bundleConfig, client, raw, published };
}

test("both Windows targets get independent installer DLL maps/digest records; original files stay unchanged", async () => {
  for (const target of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
    const original = await prepareFixture(target);
    const configBefore = structuredClone(original.bundleConfig);
    const report = await prepareWindowsInstallerBundles({
      ...original,
      options: { features: ["native-browser"], tauriArgs: ["--ci"] },
    });
    assert.equal(report.installers.length, 2);
    assert.equal(report.bundleExecution, "not-run");
    assert.equal(report.runtimeBundleType, "not-executed");
    assert.equal(report.stage, "before-signing");
    assert.deepEqual(original.bundleConfig, configBefore);
    const serialized = JSON.parse(await readFile(report.reportPath, "utf8"));
    assert.equal(serialized.sourceClient.sha256, hash(fixture));
    for (const installer of report.installers) {
      const config = JSON.parse(await readFile(installer.configFile, "utf8"));
      assert.deepEqual(config.bundle.targets, [installer.installer]);
      assert.equal(config.bundle.resources[installer.clientFile], "app.dll");
      assert.equal(config.bundle.resources[original.client], undefined);
      assert.equal(config.bundle.resources["locales"], "locales");
      assert.equal(config.bundle.resources["native.dll"], "native.dll");
      assert.deepEqual(config.bundle.windows, configBefore.bundle.windows);
      assert.deepEqual(config.build, configBefore.build);
      assert.equal(
        hash(await readFile(installer.clientFile)),
        installer.clientSha256,
      );
      assert.equal(installer.args.at(-1), installer.installer);
      assert.equal(
        installer.args[installer.args.indexOf("--target") + 1],
        target,
      );
      assert.equal(
        installer.args[installer.args.indexOf("--config") + 1],
        installer.configFile,
      );
    }
    assert.notEqual(
      report.installers[0].clientSha256,
      report.installers[1].clientSha256,
    );
    for (const file of [original.client, original.raw, original.published])
      assert.deepEqual(await readFile(file), fixture);
    assert.equal(
      await readFile(path.join(original.plan.payload, "app.exe"), "utf8"),
      "pinned bootstrap fixture",
    );
  }
});

test("preparation honors explicit NSIS and noBundle without starting any build", async () => {
  assert.deepEqual(
    await prepareWindowsInstallerBundles({ options: { noBundle: true } }),
    { skipped: true, installers: [] },
  );
  const original = await prepareFixture("x86_64-pc-windows-msvc");
  const outputDirectory = path.join(original.root, "new-output");
  const report = await prepareWindowsInstallerBundles({
    ...original,
    outputDirectory,
    options: { tauriArgs: ["--bundles", "nsis"] },
  });
  assert.deepEqual(
    report.installers.map((i) => i.installer),
    ["nsis"],
  );
  await assert.rejects(
    prepareWindowsInstallerBundles({ ...original, outputDirectory }),
    { code: "EEXIST" },
  );
  await writeFile(original.client, "invalid marker");
  const invalidOutput = path.join(original.root, "must-not-exist");
  await assert.rejects(
    prepareWindowsInstallerBundles({
      ...original,
      outputDirectory: invalidOutput,
    }),
    /exactly one/,
  );
  await assert.rejects(stat(invalidOutput), { code: "ENOENT" });
});

test("preparation rejects ambiguous client resource destinations", async () => {
  const original = await prepareFixture("x86_64-pc-windows-msvc");
  original.bundleConfig.bundle.resources["duplicate.dll"] = "./APP.DLL";
  await assert.rejects(
    prepareWindowsInstallerBundles(original),
    /exactly one client DLL/,
  );
});
