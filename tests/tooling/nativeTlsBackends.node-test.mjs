import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("SSH does not force OpenSSL into Windows through dependency feature unification", () => {
  for (const file of [
    "src-tauri/Cargo.toml",
    "src-tauri/crates/sorng-ssh/Cargo.toml",
  ]) {
    const manifest = read(file);
    const declarations = [
      ...manifest.matchAll(/^ssh2\s*=\s*(?:"[^"]*"|\{[^}]*\})/gm),
    ];
    assert.ok(declarations.length > 0, `${file}: expected ssh2 dependency`);
    for (const [declaration] of declarations)
      assert.doesNotMatch(
        declaration,
        /"(?:openssl-on-win32|vendored-openssl)"/,
        `${file}: SSH must retain the native Windows cryptographic backend`,
      );
    assert.doesNotMatch(
      manifest,
      /"ssh2\??\/(?:openssl-on-win32|vendored-openssl)"/,
      `${file}: a forwarded feature must not reactivate OpenSSL`,
    );
  }
});

test("Windows SSH retains the registered crate-scoped native ECC patch", () => {
  const manifest = read("src-tauri/Cargo.toml");
  assert.match(
    manifest,
    /libssh2-sys = \{ path = "vendor\/libssh2-sys-wincng" \}/,
  );
  assert.match(manifest, /exclude = \[[^\]]*"vendor\/libssh2-sys-wincng"/);
  const build = read("src-tauri/vendor/libssh2-sys-wincng/build.rs");
  const nativeBranch = [...build.matchAll(/else \{([^}]+)\}/g)].find(
    ([, body]) => body.includes('cfg.define("LIBSSH2_WINCNG", None)'),
  );
  assert.ok(nativeBranch, "expected the native Windows cryptographic branch");
  assert.match(nativeBranch[1], /cfg\.define\("LIBSSH2_ECDSA_WINCNG", None\)/);
  assert.equal(
    [...build.matchAll(/cfg\.define\("LIBSSH2_ECDSA_WINCNG"/g)].length,
    1,
    "the native ECC switch must not leak into other TLS backends",
  );
});

test("the lockfile selects both local TLS and SSH patches rather than newer registry packages", () => {
  const blocks = read("src-tauri/Cargo.lock")
    .replace(/\r\n/g, "\n")
    .split("[[package]]");
  for (const [name, version] of [
    ["libssh2-sys", "0.3.2"],
    ["tiberius", "0.12.3"],
  ]) {
    const selected = blocks.filter((block) =>
      block.split("\n").includes(`name = "${name}"`),
    );
    assert.equal(
      selected.length,
      1,
      `${name}: expected exactly one local package`,
    );
    assert.ok(
      selected[0].split("\n").includes(`version = "${version}"`),
      `${name}: the reviewed local patch version must remain selected`,
    );
    assert.doesNotMatch(
      selected[0],
      /^(?:source|checksum)\s*=/m,
      `${name}: a registry package must not silently replace the local patch`,
    );
  }
});

test("shared HTTP and WebSocket clients retain Rustls with native roots", () => {
  const manifest = read("src-tauri/Cargo.toml");
  for (const dependency of ["reqwest", "tokio-tungstenite"]) {
    const line = manifest
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${dependency} =`));
    assert.match(line, /default-features = false/);
    assert.match(line, /"rustls-tls-native-roots"/);
    assert.doesNotMatch(
      line,
      /"(?:default-tls|native-tls|native-tls-vendored)"/,
    );
  }
});

test("SQL Server explicitly selects Rustls without enabling default native TLS", () => {
  const manifest = read("src-tauri/crates/sorng-mssql/Cargo.toml");
  const line = manifest
    .split(/\r?\n/)
    .find((row) => row.startsWith("tiberius ="));
  assert.match(line, /default-features = false/);
  for (const feature of ["tds73", "chrono", "rustls"])
    assert.ok(line.includes(`"${feature}"`));
  assert.doesNotMatch(line, /"(?:native-tls|vendored-openssl)"/);
});

test("SQL Server remains part of ordinary full-feature builds", () => {
  const manifest = read("src-tauri/Cargo.toml");
  for (const name of [
    "full",
    "full-windows-dynamic",
    "full-unix-dynamic",
    "full-linux-system",
  ]) {
    const line = manifest
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${name} =`));
    assert.ok(
      line.includes('"db-mssql"'),
      `${name} must not hide the TLS consumer`,
    );
  }
});

test("SQL Server uses the maintained TLS patch without introducing the obsolete verifier", () => {
  assert.match(
    read("src-tauri/Cargo.toml"),
    /exclude = \[[^\]]*"vendor\/tiberius-rustls"/,
  );
  assert.match(
    read("src-tauri/Cargo.toml"),
    /tiberius = \{ path = "vendor\/tiberius-rustls" \}/,
  );
  const manifest = read("src-tauri/vendor/tiberius-rustls/Cargo.toml");
  assert.match(
    manifest,
    /\[dependencies\.tokio-rustls\]\s+version = "0\.26"\s+default-features = false/,
  );
  assert.match(
    manifest,
    /\[dependencies\.rustls-native-certs\]\s+version = "0\.8"/,
  );
  const blocks = read("src-tauri/Cargo.lock")
    .replace(/\r\n/g, "\n")
    .split("[[package]]");
  assert.ok(blocks.some((block) => /\nname = "rustls"\n/.test(block)));
  for (const block of blocks) {
    if (/\nname = "rustls"\n/.test(block))
      assert.match(block, /version = "0\.23\./);
    if (/\nname = "rustls-webpki"\n/.test(block))
      assert.doesNotMatch(block, /version = "0\.101\./);
  }
  const adapter = read(
    "src-tauri/vendor/tiberius-rustls/src/client/tls_stream/rustls_tls_stream.rs",
  );
  assert.match(adapter, /ClientConfig::builder_with_provider/);
  assert.doesNotMatch(adapter, /install_default\(|ClientConfig::builder\(/);
  assert.match(
    read("src-tauri/vendor/tiberius-rustls/PATCHES.md"),
    /a1446cb4198848d1562301a3340424b4f425ef79f35ef9ee034769a9dd92c10d/,
  );
});
