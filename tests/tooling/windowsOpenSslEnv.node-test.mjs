import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveWindowsOpenSslEnvironment } from "../../scripts/lib/windows-openssl-env.mjs";
import { rustTargetFromArgs } from "../../scripts/stage-windows-native-runtime.mjs";

test("selects existing architecture/CRT vendor static libs without mutating process configuration", () => {
  const env = { OPENSSL_LIB_DIR: "vendor/lib" };
  const directory = path.join(env.OPENSSL_LIB_DIR, "VC", "x64", "MD");
  const files = new Set(
    ["libssl_static.lib", "libcrypto_static.lib"].map((name) =>
      path.join(directory, name),
    ),
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(env, {
      platform: "win32",
      arch: "x64",
      exists: (file) => files.has(file),
    }),
    {
      OPENSSL_LIB_DIR: directory,
      OPENSSL_STATIC: "1",
      OPENSSL_LIBS: "libssl_static:libcrypto_static",
    },
  );
  assert.deepEqual(env, { OPENSSL_LIB_DIR: "vendor/lib" });
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(
      { ...env, CARGO_BUILD_TARGET: "aarch64-pc-windows-msvc" },
      { platform: "win32", arch: "x64", exists: (file) => files.has(file) },
    ),
    {},
  );
});
test("preserves a valid explicit toolchain and ignores non-Windows environments", () => {
  const env = { OPENSSL_LIB_DIR: "custom/lib", OPENSSL_LIBS: "ssl:crypto" };
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(env, {
      platform: "win32",
      exists: () => true,
    }),
    {},
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(env, {
      platform: "linux",
      exists: () => false,
    }),
    {},
  );
});

test("explicit cross target wins over host architecture and TARGET; static CRT uses matching archive directory", () => {
  const env = {
    OPENSSL_LIB_DIR: "vendor/lib",
    CARGO_BUILD_TARGET: "aarch64-pc-windows-msvc",
    TARGET: "x86_64-pc-windows-msvc",
    RUSTFLAGS: "-C target-feature=+crt-static",
  };
  const directory = path.join(env.OPENSSL_LIB_DIR, "VC", "ARM64", "MT");
  const files = new Set(
    ["libssl_static.lib", "libcrypto_static.lib"].map((name) =>
      path.join(directory, name),
    ),
  );
  const options = {
    platform: "win32",
    arch: "x64",
    exists: (file) => files.has(file),
  };
  assert.deepEqual(resolveWindowsOpenSslEnvironment(env, options), {
    OPENSSL_LIB_DIR: directory,
    OPENSSL_STATIC: "1",
    OPENSSL_LIBS: "libssl_static:libcrypto_static",
  });
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(
      { ...env, CARGO_BUILD_TARGET: "x86_64-pc-windows-msvc" },
      options,
    ),
    {},
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment({ ...env, OPENSSL_STATIC: "0" }, options),
    {},
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(
      { ...env, CARGO_BUILD_TARGET: "aarch64-unknown-linux-gnu" },
      options,
    ),
    {},
  );
});

test("preserves custom vcpkg archive names and explicit static flags without selecting dynamic fallback", () => {
  const env = {
    OPENSSL_LIB_DIR: "vcpkg/lib",
    OPENSSL_LIBS: "ssl:crypto",
    OPENSSL_STATIC: "1",
  };
  const files = new Set(
    ["ssl.lib", "crypto.lib"].map((name) =>
      path.join(env.OPENSSL_LIB_DIR, name),
    ),
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(env, {
      platform: "win32",
      exists: (file) => files.has(file),
    }),
    {},
  );
  const directory = path.join("vendor/lib", "VC", "x64", "MD");
  const imports = new Set(
    ["libssl.lib", "libcrypto.lib"].map((name) => path.join(directory, name)),
  );
  assert.deepEqual(
    resolveWindowsOpenSslEnvironment(
      { OPENSSL_LIB_DIR: "vendor/lib", OPENSSL_STATIC: "1" },
      { platform: "win32", arch: "x64", exists: (file) => imports.has(file) },
    ),
    {},
  );
});

test("CLI cross-target and encoded Rust flags override host/environment defaults", () => {
  const env = {
    OPENSSL_LIB_DIR: "vendor/lib",
    CARGO_BUILD_TARGET: "x86_64-pc-windows-msvc",
    RUSTFLAGS: "-C target-feature=+crt-static",
    CARGO_ENCODED_RUSTFLAGS: "-C\x1ftarget-feature=-crt-static",
  };
  const directory = path.join(env.OPENSSL_LIB_DIR, "VC", "ARM64", "MD");
  const files = new Set(
    ["libssl_static.lib", "libcrypto_static.lib"].map((name) =>
      path.join(directory, name),
    ),
  );
  for (const args of [
    ["cargo", "test", "--target", "aarch64-pc-windows-msvc"],
    ["cargo", "test", "--target=aarch64-pc-windows-msvc"],
  ]) {
    assert.equal(
      resolveWindowsOpenSslEnvironment(
        { ...env, CARGO_BUILD_TARGET: rustTargetFromArgs(args, env) },
        { platform: "win32", arch: "x64", exists: (file) => files.has(file) },
      ).OPENSSL_LIB_DIR,
      directory,
    );
  }
  const staticDir = path.join(env.OPENSSL_LIB_DIR, "VC", "ARM64", "MT");
  const archives = new Set(
    ["libssl_static.lib", "libcrypto_static.lib"].map((name) =>
      path.join(staticDir, name),
    ),
  );
  assert.equal(
    resolveWindowsOpenSslEnvironment(
      {
        ...env,
        CARGO_BUILD_TARGET: "aarch64-pc-windows-msvc",
        RUSTFLAGS: "",
        CARGO_ENCODED_RUSTFLAGS: "-C\x1ftarget-feature=+crt-static",
      },
      { platform: "win32", arch: "x64", exists: (file) => archives.has(file) },
    ).OPENSSL_LIB_DIR,
    staticDir,
  );
});
