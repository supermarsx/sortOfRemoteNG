import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inventoryMacSdks,
  MAC_REQUIRED_MODULEMAPS,
} from "../../scripts/lib/cef-mac-sdk-inventory.mjs";

async function fixture(t, count = 1) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef SDK inventory ")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const applications = path.join(root, "Applications");
  await mkdir(applications);
  const items = [];
  for (let index = 0; index < count; index++) {
    const application = path.join(applications, `Xcode_${index}.app`);
    const developer = path.join(application, "Contents", "Developer");
    const sdk = path.join(
      developer,
      "Platforms",
      "MacOSX.platform",
      "Developer",
      "SDKs",
      "MacOSX26.5.sdk",
    );
    const clang = path.join(
      developer,
      "Toolchains",
      "XcodeDefault.xctoolchain",
      "usr",
      "bin",
      "clang",
    );
    await mkdir(path.dirname(clang), { recursive: true });
    await mkdir(path.join(sdk, "usr", "include"), { recursive: true });
    await writeFile(clang, "owned inert clang fixture; never executed");
    await writeFile(path.join(sdk, "SDKSettings.json"), '{"Version":"26.5"}');
    for (const name of MAC_REQUIRED_MODULEMAPS)
      await writeFile(
        path.join(sdk, "usr", "include", name),
        `fixture ${name}`,
      );
    items.push({ application, developer, sdk, clang });
  }
  const calls = [];
  const execute = async (executable, args, options) => {
    calls.push({ executable, args, options });
    const item = items.find(
      (entry) => entry.developer === options.env.DEVELOPER_DIR,
    );
    assert.ok(item, "only a fixture-owned developer directory may be queried");
    if (executable === "/usr/bin/xcodebuild") {
      assert.deepEqual(args, ["-version"]);
      return { stdout: "Xcode 26.5\nBuild version 17F70\n" };
    }
    assert.equal(executable, "/usr/bin/xcrun");
    if (args[0] === "--sdk") {
      if (args[2] === "--show-sdk-version") {
        assert.deepEqual(args, ["--sdk", "macosx", "--show-sdk-version"]);
        return { stdout: "26.5\n" };
      }
      assert.deepEqual(args, ["--sdk", "macosx", "--show-sdk-path"]);
      return { stdout: `${item.sdk}\n` };
    }
    assert.deepEqual(args, ["--find", "clang"]);
    return { stdout: `${item.clang}\n` };
  };
  return { root, applications, items, calls, execute };
}

test("installed SDK observations hash actual required bytes without selecting or accepting a runtime", async (t) => {
  const f = await fixture(t);
  const environment = {
    GH_TOKEN: "credential",
    ACTIONS_RUNTIME_TOKEN: "credential",
    SDKROOT: "foreign",
    DEVELOPER_DIR: "foreign",
    HOME: f.root,
  };
  const result = await inventoryMacSdks(
    { applications: f.applications, environment },
    { execute: f.execute },
  );
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "required-inputs-present");
  assert.equal(candidate.requiredInputsPresent, true);
  assert.equal(candidate.buildCompatibilityVerified, false);
  assert.equal(candidate.xcodeVersion, "26.5");
  assert.equal(candidate.xcodeBuild, "17F70");
  assert.equal(candidate.sdkVersion, "26.5");
  assert.equal(result.engineBuildAttempted, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.truncated, false);
  assert.equal(f.calls.length, 4);
  for (const call of f.calls) {
    assert.equal(call.options.timeout, 10_000);
    assert.deepEqual(Object.keys(call.options.env).sort(), [
      "DEVELOPER_DIR",
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
    ]);
    assert.equal(call.options.env.DEVELOPER_DIR, f.items[0].developer);
  }
  assert.equal(candidate.modulemaps.length, 4);
  for (const entry of candidate.modulemaps) {
    const bytes = `fixture ${entry.name}`;
    assert.equal(entry.size, Buffer.byteLength(bytes));
    assert.equal(
      entry.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  assert.equal(candidate.clang.path, f.items[0].clang);
  assert.ok(!JSON.stringify(result).includes("credential"));
  assert.deepEqual(environment.SDKROOT, "foreign");
});

test("an older SDK missing required Darwin maps is explicitly incompatible, never synthesized", async (t) => {
  const f = await fixture(t);
  for (const name of MAC_REQUIRED_MODULEMAPS.slice(0, 3))
    await rm(path.join(f.items[0].sdk, "usr", "include", name));
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.candidates[0].status, "missing-required-inputs");
  assert.equal(result.candidates[0].requiredInputsPresent, false);
  assert.deepEqual(
    result.candidates[0].modulemaps.map((entry) => entry.present),
    [false, false, false, true],
  );
});

test("candidate count and command budgets are finite", async (t) => {
  const f = await fixture(t, 10);
  await mkdir(path.join(f.applications, "not-Xcode.app"));
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.candidates.length, 8);
  assert.equal(result.truncated, true);
  assert.equal(result.totalCanonicalCandidates, 10);
  assert.equal(result.unprobedCanonicalCount, 2);
  assert.equal(f.calls.length, 32);
});

test("old Xcode aliases cannot hide a newer canonical SDK behind the eight-probe limit", async (t) => {
  const f = await fixture(t, 2);
  for (const [index, name] of ["Xcode_26.5.app", "Xcode_16.4.app"].entries()) {
    const old = f.items[index].application;
    const current = path.join(f.applications, name);
    await rename(old, current);
    for (const key of Object.keys(f.items[index]))
      f.items[index][key] = f.items[index][key].replace(old, current);
  }
  try {
    for (let index = 0; index < 12; index++)
      await symlink(
        f.items[1].application,
        path.join(f.applications, `Xcode_00alias${index}.app`),
        process.platform === "win32" ? "junction" : "dir",
      );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.candidates[0].application, f.items[0].application);
  assert.equal(result.candidates.length, 2);
  assert.equal(f.calls.length, 8);
  assert.equal(result.totalCanonicalCandidates, 2);
  assert.equal(result.duplicateAliasCount, 12);
  assert.equal(result.unprobedCanonicalCount, 0);
  assert.equal(result.unresolvedNameCount, 0);
  assert.equal(result.truncated, false);
});

test("overall monotonic deadline stops discovery and reports an incomplete observation", async (t) => {
  const f = await fixture(t, 2);
  let elapsed = 0;
  const result = await inventoryMacSdks(
    { applications: f.applications },
    {
      now: () => elapsed,
      execute: async (...args) => {
        const result = await f.execute(...args);
        elapsed += 45_000;
        return result;
      },
    },
  );
  assert.equal(f.calls.length, 3);
  assert.equal(result.candidates[0].failure, "inventory-deadline");
  assert.equal(result.candidates[0].requiredInputsPresent, false);
  assert.equal(result.truncated, true);
  assert.equal(result.deadlineReached, true);
});

test("name resolution has its own 64-entry bound and never invents a complete canonical count", async (t) => {
  const f = await fixture(t);
  try {
    for (let index = 0; index < 70; index++)
      await symlink(
        f.items[0].application,
        path.join(f.applications, `Xcode_Alias${index}.app`),
        process.platform === "win32" ? "junction" : "dir",
      );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.totalMatchingNames, 71);
  assert.equal(result.nameResolutionLimit, 64);
  assert.equal(result.resolvedNameCount, 64);
  assert.equal(result.unresolvedNameCount, 7);
  assert.equal(result.totalCanonicalCandidates, null);
  assert.equal(result.resolvedCanonicalCount, 1);
  assert.equal(result.probedCanonicalCount, 1);
  assert.equal(result.truncated, true);
  assert.equal(f.calls.length, 4);
});

for (const escaped of ["sdk", "clang"])
  test(`canonical ${escaped} must stay within that exact Xcode`, async (t) => {
    const f = await fixture(t);
    const result = await inventoryMacSdks(
      { applications: f.applications },
      {
        execute: async (...args) => {
          const result = await f.execute(...args);
          if (
            (escaped === "sdk" && args[1][2] === "--show-sdk-path") ||
            (escaped === "clang" && args[1][0] === "--find")
          )
            return { stdout: f.root };
          return result;
        },
      },
    );
    assert.equal(result.candidates[0].failure, "sdk-or-clang-outside-xcode");
    assert.equal(result.candidates[0].requiredInputsPresent, false);
    assert.equal(result.candidates[0].modulemaps, undefined);
  });

test("Xcode links outside Applications are rejected and internal aliases are deduplicated", async (t) => {
  const f = await fixture(t);
  try {
    await symlink(
      f.root,
      path.join(f.applications, "Xcode_Outside.app"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      f.items[0].application,
      path.join(f.applications, "Xcode_Alias.app"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(f.calls.length, 4);
  assert.ok(
    result.resolutionFailures.some(
      (entry) => entry.failure === "xcode-outside-applications",
    ),
  );
  assert.equal(result.duplicateAliasCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.resolvedNameCount, 2);
  assert.equal(result.unresolvedNameCount, 1);
  assert.equal(result.totalCanonicalCandidates, null);
  assert.equal(result.truncated, true);
});

test("a failed canonical resolution cannot claim a complete installed-Xcode count", async (t) => {
  const f = await fixture(t);
  try {
    await symlink(
      path.join(f.root, "missing-xcode"),
      path.join(f.applications, "Xcode_Broken.app"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.totalMatchingNames, 2);
  assert.equal(result.resolvedNameCount, 1);
  assert.equal(result.unresolvedNameCount, 1);
  assert.equal(result.totalCanonicalCandidates, null);
  assert.equal(result.resolvedCanonicalCount, 1);
  assert.equal(result.resolutionFailures.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(f.calls.length, 4);
});

test("command failure diagnostics never echo raw output or environment", async (t) => {
  const f = await fixture(t);
  const result = await inventoryMacSdks(
    { applications: f.applications },
    {
      execute: async () => {
        throw Object.assign(new Error("private stderr credential"), {
          stderr: "private stderr credential",
        });
      },
    },
  );
  assert.equal(result.candidates[0].failure, "probe-command-or-file-failed");
  assert.ok(!JSON.stringify(result).includes("credential"));
});

test("modulemap directory links cannot import bytes from outside that SDK", async (t) => {
  const f = await fixture(t);
  const include = path.join(f.items[0].sdk, "usr", "include");
  await rename(include, `${include}-owned`);
  const outside = path.join(f.root, "outside-headers");
  await mkdir(outside);
  await writeFile(
    path.join(outside, MAC_REQUIRED_MODULEMAPS[0]),
    "private outside bytes",
  );
  try {
    await symlink(
      outside,
      include,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  const result = await inventoryMacSdks(
    { applications: f.applications },
    { execute: f.execute },
  );
  assert.equal(result.candidates[0].failure, "file-outside-xcode");
  assert.equal(result.candidates[0].requiredInputsPresent, false);
  assert.ok(!JSON.stringify(result).includes("private outside bytes"));
});
