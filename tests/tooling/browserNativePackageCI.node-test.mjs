import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  nativeBuildPlan,
  nativeAcquisitionPlan,
  probeWindowsAppEntry,
} from "../../scripts/browser-runtime-native-ci.mjs";
import { TARGETS } from "../../scripts/browser-runtime-package.mjs";

test("local native builds neither acquire archives nor fetch Cargo dependencies", () => {
  for (const target of TARGETS) {
    const local = nativeAcquisitionPlan(target, ".artifacts/test-plan", {
      offline: true,
      archivePath: ".artifacts/cached-cef.tar.bz2",
    });
    assert.equal(local.downloadArchive, false);
    assert.equal(local.fetchCargo, false);
    assert.throws(
      () =>
        nativeAcquisitionPlan(target, ".artifacts/test-plan", {
          offline: true,
        }),
      /explicit local archive/,
    );
    const acquired = nativeAcquisitionPlan(target, ".artifacts/test-plan");
    assert.equal(acquired.downloadArchive, true);
    assert.equal(acquired.fetchCargo, true);
  }
});

test("entry probe refuses production identity before any package launch", async () => {
  await assert.rejects(
    probeWindowsAppEntry({
      bundle: "must-not-launch",
      runtime: "absent",
      target: "x86_64-pc-windows-msvc",
      output: "must-not-create",
      identifier: "com.sortofremote.ng",
    }),
  );
});

test("six native plans build actual app, helper and fixture from locked offline inputs", () => {
  for (const target of TARGETS) {
    const plan = nativeBuildPlan(target, ".artifacts/synthetic-ci-plan");
    assert.equal(plan.arch, target.startsWith("aarch64") ? "arm64" : "x64");
    for (const args of [plan.app, plan.helper, plan.fixture]) {
      assert.ok(args.includes("--locked"));
      assert.ok(args.includes("--offline"));
      assert.equal(args[args.indexOf("--target") + 1], target);
    }
    assert.ok(plan.app.includes("native-browser"));
    assert.ok(plan.app.includes("--no-default-features"));
    assert.ok(plan.helper.includes("sorng-cef-helper"));
    if (plan.platform === "win32") {
      assert.ok(plan.app.includes("cdylib"));
      assert.ok(plan.fixture.includes("--lib"));
    } else {
      assert.ok(plan.app.includes("--bin"));
      assert.ok(plan.fixture.includes("sorng-cef-acceptance"));
    }
  }
  assert.throws(() =>
    nativeBuildPlan("latest", ".artifacts/synthetic-ci-plan"),
  );
});

test("native workflow remains opt-in and all six real launches are mandatory", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/browser-native-packages.yml",
      import.meta.url,
    ),
    "utf8",
  );
  for (const target of TARGETS) assert.ok(workflow.includes(target));
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(
    workflow,
    /continue-on-error|--no-sandbox|disable-web-security|pull_request:|push:/,
  );
  assert.match(workflow, /dbus-run-session -- xvfb-run/);
  assert.match(workflow, /needs: native/);
  assert.match(workflow, /test "\$NATIVE_RESULT" = success/);
  assert.equal(
    (workflow.match(/browser-runtime-native-ci\.mjs run /g) ?? []).length,
    3,
  );
});
