import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const arch = read("packaging/arch/PKGBUILD");
const alpine = read("packaging/alpine/APKBUILD");
const cargo = read("src-tauri/Cargo.toml");
const syncVersion = read("scripts/sync-version.mjs");
const snapshotVerifier = read("scripts/ci/resolve-release-version.mjs");
const releaseWorkflow = read(".github/workflows/release.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
const packageManifest = JSON.parse(read("package.json"));

test("Arch and Alpine recipes build the system-native Linux feature profile", () => {
  assert.match(
    cargo,
    /^full-linux-system = \[[^\n]*"db-sqlite-dynamic"[^\n]*"kafka-dynamic"[^\n]*"rdp-software-decode-dynamic"[^\n]*\]$/m,
  );

  for (const recipe of [arch, alpine]) {
    assert.match(recipe, /--features full-linux-system/);
    assert.match(recipe, /LIBSSH2_SYS_USE_PKG_CONFIG=1/);
    assert.match(recipe, /OPENSSL_NO_VENDOR=1/);
    assert.match(recipe, /OPENH264_LIB_DIR=\/usr\/lib/);
    assert.match(recipe, /SORNG_OPKSSH_VENDOR_CHECKOUT=/);
    assert.match(recipe, /npm ci --ignore-scripts/);
    assert.match(recipe, /cargo fetch --locked/);
    assert.match(
      recipe,
      /stage-opkssh-vendor\.mjs --release --enable --frozen/,
    );
    assert.match(
      recipe,
      /--config packaging\/linux\/tauri\.distro\.conf\.json/,
    );
    assert.match(recipe, /--no-default-features --frozen/);
    assert.match(recipe, /CARGO_BUILD_JOBS="\$\{CARGO_BUILD_JOBS:-1\}"/);
    assert.match(
      recipe,
      /CARGO_PROFILE_RELEASE_CODEGEN_UNITS="\$\{CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-16\}"/,
    );
    assert.match(
      recipe,
      /CARGO_PROFILE_RELEASE_LTO="\$\{CARGO_PROFILE_RELEASE_LTO:-off\}"/,
    );
    assert.match(
      recipe,
      /CARGO_PROFILE_RELEASE_OPT_LEVEL="\$\{CARGO_PROFILE_RELEASE_OPT_LEVEL:-1\}"/,
    );
    assert.doesNotMatch(recipe, /stage-openh264-runtime|native-build-env/);
  }
});

test("package checks enforce every requested shared native library", () => {
  for (const recipe of [arch, alpine]) {
    for (const soname of [
      "libopenh264.so.8",
      "librdkafka.so.1",
      "libsqlite3.so.0",
      "libssh2.so.1",
    ]) {
      assert.match(recipe, new RegExp(soname.replaceAll(".", "\\.")));
    }
    assert.match(recipe, /readelf -d/);
    assert.match(recipe, /sorng_opkssh_vendor_abi_version/);
    assert.match(recipe, /sorng_opkssh_vendor_embedded_runtime/);
    assert.match(recipe, /sorng_opkssh_vendor_backend_callable/);
    assert.match(recipe, /ctypes\.CDLL/);
  }
});

test("recipes declare supported distro architectures and runtime helpers", () => {
  assert.match(arch, /^arch=\('x86_64'\)$/m);
  assert.match(arch, /'libserialport'/);
  assert.match(arch, /'openh264=2\.6\.0'/);

  assert.match(alpine, /^arch="x86_64 aarch64"$/m);
  assert.match(alpine, /^options="net ldpath-recursive"$/m);
  assert.match(alpine, /\n\tfont-dejavu\n/);
  assert.match(alpine, /\n\tlibrsvg\n/);
  assert.match(alpine, /\n\tsetserial\n/);
  assert.match(alpine, /\n\topenh264~2\.6\.0\n/);
});

test("recipes install the executable, desktop metadata, icons, and resources", () => {
  for (const recipe of [arch, alpine]) {
    assert.match(recipe, /target\/release\/com\.sortofremote\.ng/);
    assert.match(recipe, /usr\/bin\/com\.sortofremote\.ng/);
    assert.match(recipe, /usr\/lib\/sortOfRemoteNG/);
    assert.match(recipe, /packaging\/linux\/com\.sortofremote\.ng\.desktop/);
    assert.match(recipe, /com\.sortofremote\.ng\.metainfo\.xml/);
    assert.match(recipe, /hicolor\/512x512\/apps\/com\.sortofremote\.ng\.png/);
    assert.match(recipe, /src\/i18n\/locales/);
    assert.match(recipe, /sorng-opkssh-vendor\/bundle\/opkssh/);
  }
});

test("release snapshots synchronize recipe versions and exact source commits", () => {
  const expectedPackageVersion = packageManifest.version;

  for (const recipe of [arch, alpine]) {
    assert.match(
      recipe,
      new RegExp(
        `^pkgver=${expectedPackageVersion.replaceAll(".", "\\.")}$`,
        "m",
      ),
    );
    assert.match(recipe, /^_commit=[0-9a-f]{40}$/m);
    assert.match(recipe, /sync-version\.mjs --write --version "\$_release"/);
  }

  assert.match(syncVersion, /packaging\/alpine\/APKBUILD/);
  assert.match(syncVersion, /packaging\/arch\/PKGBUILD/);
  assert.match(syncVersion, /rewriteShellAssignment\(recipe, "_commit"/);
  assert.match(
    snapshotVerifier,
    /"--version",\s*publicVersion,\s*"--source-sha",\s*sourceSha/s,
  );
  assert.match(
    releaseWorkflow,
    /sync-version\.mjs --write[\s\\]*--version "\$PUBLIC_VERSION"[\s\\]*--source-sha "\$SOURCE_SHA"/,
  );
});

test("main CI validates both recipes with their native package tools", () => {
  assert.match(
    ciWorkflow,
    /linux-package-recipes:[\s\S]*?archlinux:base-devel[\s\S]*?makepkg --printsrcinfo/,
  );
  assert.match(
    ciWorkflow,
    /linux-package-recipes:[\s\S]*?alpine:3\.24[\s\S]*?abuild validate[\s\S]*?apk add --simulate \$depends \$makedepends/,
  );
  assert.match(
    ciWorkflow.slice(ciWorkflow.indexOf("  rolling-release:")),
    /\n\s+- linux-package-recipes\n/,
  );
});
