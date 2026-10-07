import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import YAML from "yaml";
import { packageManifest } from "../../scripts/browser-runtime-package.mjs";

const source = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const workflow = YAML.parse(source);
const steps = workflow.jobs.build.steps;
const step = (name) => {
  const result = steps.find((entry) => entry.name === name);
  assert.ok(result, name);
  return result;
};
const script = (name) => step(name).run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];

test("all six release targets acquire the reviewed patched engine before build", () => {
  const targets = workflow.jobs.build.strategy.matrix.include.map(
    (entry) => entry.rust_target,
  );
  assert.equal(new Set(targets).size, 6);
  for (const target of targets) {
    const manifest = packageManifest(target);
    assert.match(manifest.artifact.sha1, /^[a-f0-9]{40}$/);
    assert.ok(manifest.artifact.size > 0);
  }
  const acquire = script("Acquire reviewed patched CEF runtime");
  assert.match(acquire, /validateBuildHost\(acquisition\)/);
  assert.match(acquire, /await ensurePublishedRuntime\(acquisition\)/);
  assert.match(acquire, /resolveLocalRuntime\(acquisition\)/);
  assert.doesNotMatch(
    acquire,
    /downloadArchive|SORNG_CEF_ARCHIVE=|runtimeKind: ['"]official/,
  );
  assert.match(acquire, /SORNG_CEF_OUTPUT=/);
  assert.match(acquire, /SORNG_CEF_PUBLIC_TARGET_DIR=/);
  assert.match(acquire, /SORNG_CEF_NATIVE_PREPARED=1/);
  assert.ok(
    steps.indexOf(step("Acquire reviewed patched CEF runtime")) <
      steps.indexOf(step("Build native bundles")),
  );
});

for (const { rust_target: target } of workflow.jobs.build.strategy.matrix
  .include) {
  test(`collector copies complete ${target} output and rejects stale or mismatched outputs`, async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "cef-release-test-"));
    try {
      // Import the real manifest implementation without executing a build/download.
      await cp(
        new URL("../../scripts", import.meta.url),
        path.join(temp, "scripts"),
        { recursive: true },
      );
      const root = path.join(temp, ".artifacts/cef-release", target);
      const output = path.join(root, "target", target, "release");
      const manifest = packageManifest(
        target,
        target.includes("linux") ? "com.sortofremote.ng" : "sortofremoteng",
      );
      const plan = {
        target,
        publicTarget: path.join(root, "target"),
        platform: manifest.platform,
        appName: manifest.appName,
      };
      const files =
        manifest.platform === "macos"
          ? [
              ...manifest.applicationFiles,
              ...manifest.runtimeFiles.map(
                (file) => manifest.bundlePrefix + file,
              ),
            ].map((file) => `bundle/macos/Test.app/${file}`)
          : [
              ...manifest.applicationFiles,
              ...manifest.runtimeFiles,
              "bundle/installer",
              "locales/en-US.pak",
              "cef-LICENSE.txt",
            ];
      for (const file of files) {
        await mkdir(path.dirname(path.join(output, file)), { recursive: true });
        await writeFile(path.join(output, file), `fixture:${file}`);
      }
      await writeFile(path.join(root, "plan.json"), JSON.stringify(plan));
      await writeFile(
        path.join(root, "build.json"),
        JSON.stringify({ target, output }),
      );
      const run = () =>
        spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            script("Collect isolated CEF release output"),
          ],
          {
            cwd: temp,
            env: {
              ...process.env,
              RUST_TARGET: target,
              SORNG_CEF_OUTPUT: root,
            },
            encoding: "utf8",
          },
        );
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      for (const file of files)
        assert.equal(
          await readFile(
            path.join(temp, "src-tauri/target", target, "release", file),
            "utf8",
          ),
          `fixture:${file}`,
        );
      assert.notEqual(run().status, 0, "must reject a stale destination");
      await writeFile(
        path.join(root, "build.json"),
        JSON.stringify({ target, output: temp }),
      );
      assert.match(run().stderr, /CEF output contract mismatch/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}

test("Windows signing precedes collection and portable ZIP hashes the entire CEF closure", () => {
  const signing = step("Sign complete Windows CEF payload and rebundle");
  assert.match(signing.run, /@\(\$plan.payload, \$build.output\)/);
  assert.match(signing.run, /signtool verify/);
  assert.match(signing.run, /CARGO_TARGET_DIR = \$plan.publicTarget/);
  assert.match(signing.run, /bundle --config \$build.bundleConfig/);
  assert.ok(
    steps.indexOf(signing) <
      steps.indexOf(step("Collect isolated CEF release output")),
  );
  const portable = step("Package portable Windows archive").run;
  assert.match(portable, /Get-ChildItem -LiteralPath \$cefPlan.payload/);
  assert.match(portable, /Get-ChildItem -LiteralPath \$portableRoot -Force/);
  assert.match(portable, /expectedPortableHashes/);
  assert.match(portable, /Get-RelativeFileHashes -Root \$verificationRoot/);
  assert.match(portable, /Get-PeMachine -Path \$verifiedNativeDll.FullName/);
  assert.match(
    portable,
    /\[string\]::Equals\(\$cefPlan.appName, "sortOfRemoteNG", \[StringComparison\]::OrdinalIgnoreCase\)/,
  );
  // Every post-build EXE consumer must use Tauri's final name, not Cargo's
  // temporary app.exe. Collector fixtures above deliberately omit app.exe.
  assert.doesNotMatch(source, /release\/app\.exe/);
  assert.equal(
    source.match(/release\/\$\(\$cefPlan\.appName\)\.exe/g)?.length,
    3,
  );
});

test("portable bootstrap stem guard accepts casing only and rejects app.dll mismatch", () => {
  const portable = step("Package portable Windows archive").run;
  const guard = portable.match(/if \(-not \[string\]::Equals[\s\S]*?\n}/)?.[0];
  assert.ok(guard);
  for (const [appName, accepted] of [
    ["sortofremoteng", true],
    ["sortOfRemoteNG", true],
    ["app", false],
  ]) {
    const result = spawnSync(
      process.platform === "win32" ? "powershell.exe" : "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; " +
          "$cefPlan = @{ appName = '" +
          appName +
          "' }; " +
          guard,
      ],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status === 0, accepted, result.stderr);
  }
});

test("Linux retains ELF/helper/runtime layout and macOS retains framework/helper closure", () => {
  const preserve = step(
    "Preserve native Linux outputs and prune build intermediates",
  ).run;
  assert.match(
    preserve,
    /executable="\$release_root\/\$LINUX_PACKAGE_MAIN_BINARY.bin"/,
  );
  assert.match(preserve, /cp -a "\$cef_payload\/\." "\$payload\/lib\/"/);
  const flatpak = step("Build and verify native Flatpak bundle").run;
  assert.match(flatpak, /cp -a lib\/\. \/app\/lib\/sortOfRemoteNG\//);
  assert.match(
    flatpak,
    /ldd \/app\/lib\/sortOfRemoteNG\/com.sortofremote.ng.bin/,
  );
  assert.match(
    script("Collect isolated CEF release output"),
    /manifest.applicationFiles/,
  );
  assert.match(
    script("Collect isolated CEF release output"),
    /verbatimSymlinks: true/,
  );
  const verifier = source.match(
    /verify_linux_openh264_payload\(\) \{[\s\S]*?\n\s+}/,
  )?.[0];
  assert.ok(verifier);
  assert.doesNotMatch(verifier, /library_path|required_runpath/);
  assert.match(verifier, /local library="\$root\$expected_openh264_path"/);
  assert.match(verifier, /local executable="[^"]+\.bin"/);
  assert.match(
    source,
    /"\$appimage_root\$appimage_runtime_openh264_path" \\\s+"AppImage linuxdeploy copy"/,
  );
});

test("generated Flatpak recipe preserves existing commands and resolves sources before adding CEF", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cef-flatpak-test-"));
  try {
    const canonical = path.join(temp, "resolved.json");
    const recipe = path.join(temp, "packaging/flatpak/app.yml");
    const original = {
      modules: [
        {
          name: "sortofremoteng",
          "build-commands": ["install existing"],
          sources: [{ type: "dir", path: "../../.ci/flatpak-payload" }],
        },
      ],
    };
    await writeFile(canonical, JSON.stringify(original));
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script("Build and verify native Flatpak bundle"),
      ],
      {
        env: {
          ...process.env,
          CANONICAL_MANIFEST: canonical,
          FLATPAK_MANIFEST: recipe,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(await readFile(canonical, "utf8"));
    assert.deepEqual(actual.modules[0]["build-commands"], [
      "install existing",
      "cp -a lib/. /app/lib/sortOfRemoteNG/",
    ]);
    assert.equal(
      actual.modules[0].sources[0].path,
      path.join(temp, ".ci/flatpak-payload"),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
