// Read-only observations, never toolchain selection or build acceptance.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const exec = promisify(execFile);
export const MAC_REQUIRED_MODULEMAPS = Object.freeze([
  "DarwinFoundation1.modulemap",
  "DarwinFoundation2.modulemap",
  "DarwinFoundation3.modulemap",
  "libunwind.modulemap",
]);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
};
const fault = (code) => Object.assign(new Error(code), { inventoryCode: code });

export async function inventoryMacSdks(
  { applications = "/Applications", environment = process.env } = {},
  { execute = exec, now = () => performance.now() } = {},
) {
  const deadline = now() + 120_000;
  const remaining = () => {
    const value = Math.floor(deadline - now());
    if (value <= 0) throw fault("inventory-deadline");
    return value;
  };
  const root = await realpath(applications);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw fault("applications-not-directory");
  const verifyRoot = async () => {
    remaining();
    const info = await stat(root);
    if (
      (await realpath(applications)) !== root ||
      info.dev !== rootInfo.dev ||
      info.ino !== rootInfo.ino
    )
      throw fault("applications-changed");
  };
  const candidates = [];
  const seen = new Set();
  const names = (await readdir(root))
    .filter((name) => /^Xcode(?:[_-][A-Za-z0-9_.-]+)?\.app$/.test(name))
    .sort();
  const selected = names.slice(0, 8);
  const measure = async (file, owner) => {
    await verifyRoot();
    let canonical;
    try {
      canonical = await realpath(file);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw fault("file-unavailable");
    }
    if (!inside(owner, canonical)) throw fault("file-outside-xcode");
    const handle = await open(
      canonical,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 512 * 1024 ** 2)
        throw fault("file-invalid");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        remaining();
        hash.update(chunk);
      }
      const after = await handle.stat();
      const current = await stat(canonical);
      if (
        (await realpath(file)) !== canonical ||
        !inside(owner, await realpath(canonical)) ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw fault("file-changed");
      return { path: canonical, size: before.size, sha256: hash.digest("hex") };
    } finally {
      await handle.close();
    }
  };
  for (const name of selected) {
    const candidate = {
      application: path.join(root, name),
      status: "probe-failed",
      requiredInputsPresent: false,
      buildCompatibilityVerified: false,
    };
    candidates.push(candidate);
    try {
      await verifyRoot();
      const entry = await lstat(candidate.application);
      if (!entry.isDirectory() && !entry.isSymbolicLink())
        throw fault("xcode-not-directory");
      const app = await realpath(candidate.application);
      if (
        app === root ||
        !inside(root, app) ||
        !(await stat(app)).isDirectory()
      )
        throw fault("xcode-outside-applications");
      if (seen.has(app)) {
        candidate.status = "duplicate-canonical-xcode";
        continue;
      }
      seen.add(app);
      candidate.application = app;
      const developer = await realpath(path.join(app, "Contents", "Developer"));
      if (!inside(app, developer)) throw fault("developer-outside-xcode");
      const env = {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        LANG: "C",
        LC_ALL: "C",
        DEVELOPER_DIR: developer,
      };
      for (const key of ["HOME", "TMPDIR"])
        if (typeof environment[key] === "string") env[key] = environment[key];
      const command = async (executable, args) => {
        const result = await execute(executable, args, {
          env,
          timeout: Math.min(10_000, remaining()),
          maxBuffer: 64 * 1024,
          encoding: "utf8",
        });
        remaining();
        return result.stdout.trim();
      };
      const version =
        /^Xcode ([0-9]+(?:\.[0-9]+){0,2})\r?\nBuild version ([A-Za-z0-9.]+)$/.exec(
          await command("/usr/bin/xcodebuild", ["-version"]),
        );
      if (!version) throw fault("invalid-xcode-version");
      candidate.xcodeVersion = version[1];
      candidate.xcodeBuild = version[2];
      const sdkPath = await command("/usr/bin/xcrun", [
        "--sdk",
        "macosx",
        "--show-sdk-path",
      ]);
      const sdkVersion = await command("/usr/bin/xcrun", [
        "--sdk",
        "macosx",
        "--show-sdk-version",
      ]);
      if (!/^[0-9]+(?:\.[0-9]+){0,2}$/.test(sdkVersion))
        throw fault("invalid-sdk-version");
      const clangPath = await command("/usr/bin/xcrun", ["--find", "clang"]);
      if (!path.isAbsolute(sdkPath) || !path.isAbsolute(clangPath))
        throw fault("nonabsolute-tool-path");
      const sdk = await realpath(sdkPath);
      const clang = await realpath(clangPath);
      if (!inside(developer, sdk) || !inside(developer, clang))
        throw fault("sdk-or-clang-outside-xcode");
      candidate.sdk = sdk;
      candidate.sdkVersion = sdkVersion;
      candidate.sdkSelection = "xcrun-macosx";
      candidate.modulemaps = [];
      for (const modulemap of MAC_REQUIRED_MODULEMAPS) {
        const inventory = await measure(
          path.join(sdk, "usr", "include", modulemap),
          sdk,
        );
        candidate.modulemaps.push({
          name: modulemap,
          present: inventory !== null,
          ...(inventory ?? {}),
        });
      }
      candidate.sdkSettings = await measure(
        path.join(sdk, "SDKSettings.json"),
        sdk,
      );
      candidate.clang = await measure(clang, developer);
      await verifyRoot();
      if (
        (await realpath(candidate.application)) !== app ||
        (await realpath(path.join(app, "Contents", "Developer"))) !== developer
      )
        throw fault("xcode-changed");
      candidate.requiredInputsPresent =
        candidate.modulemaps.every((item) => item.present) &&
        candidate.sdkSettings !== null &&
        candidate.clang !== null;
      candidate.status = candidate.requiredInputsPresent
        ? "required-inputs-present"
        : "missing-required-inputs";
    } catch (error) {
      candidate.failure = error.inventoryCode ?? "probe-command-or-file-failed";
      if (
        candidate.failure === "inventory-deadline" ||
        candidate.failure === "applications-changed"
      )
        break;
    }
  }
  return {
    schemaVersion: 1,
    kind: "sorng-cef-installed-mac-sdk-inventory",
    candidates,
    truncated: names.length > 8 || candidates.length < selected.length,
    engineBuildAttempted: false,
    publicationAllowed: false,
  };
}
