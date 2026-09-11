import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-contract regressions, not a substitute for the native Cargo feature
// matrix. These run without a compiler, platform SDK, GSSAPI, or network access.
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const vendor = "src-tauri/vendor/tiberius-rustls";
const source = (path) => read(`${vendor}/src/${path}`);
const compact = (text) => text.replace(/\s+/g, "");
const windowsAuth = 'all(windows,feature="winauth")';
const unixAuth = 'all(unix,feature="integrated-auth-gssapi")';
const integratedAuth = `any(${windowsAuth},${unixAuth})`;

// Anchor the cfg to its actual declaration, permitting only whitespace and
// documentation between them; a nearby unrelated cfg must not satisfy a test.
function assertGuard(text, declaration, predicate) {
  const offset = text.lastIndexOf(declaration);
  assert.notEqual(offset, -1, `missing declaration: ${declaration}`);
  const prefix = text.slice(0, offset);
  const match = prefix.match(/#\[cfg\(([^\]]*)\)\]((?:\s|\/\/\/[^\n]*\n)*)$/);
  assert.ok(match, `missing adjacent cfg: ${declaration}`);
  assert.equal(compact(match[1]), predicate, declaration);
}

for (const [path, declaration] of [
  ["client/connection.rs", "use codec::TokenSspi;"],
  ["client/connection.rs", "async fn flush_sspi("],
  ["tds/codec/login.rs", "pub fn integrated_security("],
  ["tds/codec/token/token_sspi.rs", "pub fn new("],
  ["tds/context.rs", "pub fn spn("],
  ["tds/stream/token.rs", "pub(crate) async fn flush_sspi("],
]) {
  test(`${path}: ${declaration} belongs to platform-enabled integrated authentication`, () => {
    assertGuard(source(path), declaration, integratedAuth);
  });
}

test("all real integrated login callers remain platform-and-feature gated", () => {
  const connection = source("client/connection.rs");
  const arms = [
    ...connection.matchAll(/AuthMethod::(?:Integrated|Windows\(auth\)) => \{/g),
  ];
  assert.equal(arms.length, 3, "review newly added integrated-auth callers");
  for (const [index, arm] of arms.entries()) {
    const end =
      arms[index + 1]?.index ??
      connection.indexOf("AuthMethod::None =>", arm.index);
    const body = connection.slice(arm.index, end);
    assertGuard(
      connection.slice(0, arm.index + arm[0].length),
      arm[0],
      index === 1 ? unixAuth : windowsAuth,
    );
    for (const call of [
      ".spn()",
      ".integrated_security(",
      ".flush_sspi()",
      "TokenSspi::new(",
    ])
      assert.ok(body.includes(call), `caller ${index}: missing ${call}`);
  }
});

test("SQL-password builds still decode and represent server SSPI tokens", () => {
  const token = source("tds/codec/token/token_sspi.rs");
  assert.match(
    token,
    /^#\[derive\(Debug\)\]\r?\npub struct TokenSspi\(Vec<u8>\);/m,
  );
  assert.match(token, /\}\s+pub\(crate\) async fn decode_async</);
  const stream = source("tds/stream/token.rs");
  assert.ok(stream.startsWith("use crate::tds::codec::TokenSspi;"));
  assert.match(stream, /LoginAck\(TokenLoginAck\),\s+Sspi\(TokenSspi\),/);
  assert.match(stream, /\}\s+async fn get_sspi\(/);
  assert.match(stream, /TokenSspi::decode_async\(self\.conn\)\.await\?/);
  assert.match(
    stream,
    /TokenType::LoginAck =>[^\n]+\n\s+TokenType::Sspi => this\.get_sspi\(\)\.await\?,/,
  );
});

test("connection-string GSSAPI selection also requires a Unix target", () => {
  const config = source("client/config.rs");
  const integratedArm =
    'Some(val) if val.to_lowercase() == "sspi" || Self::parse_bool(val)? => {';
  assertGuard(config, integratedArm, unixAuth);
});

for (const format of ["ado_net", "jdbc"]) {
  test(`${format} authentication tests compile only with their real backend`, () => {
    const config = source(`client/config/${format}.rs`);
    const tests = [
      ...config.matchAll(
        /#\[cfg\(([^\]]+)\)\]\s+fn (parsing_(?:sspi|windows)_authentication)\(/g,
      ),
    ];
    assert.deepEqual(
      tests.map((match) => [compact(match[1]), match[2]]),
      [
        [windowsAuth, "parsing_sspi_authentication"],
        [
          'all(feature="integrated-auth-gssapi",unix)',
          "parsing_sspi_authentication",
        ],
        [windowsAuth, "parsing_windows_authentication"],
      ],
    );
  });
}

test("warning repair does not switch MSSQL TLS or opt integrated authentication into normal builds", () => {
  const manifest = read("src-tauri/crates/sorng-mssql/Cargo.toml");
  const dependency = manifest.match(/^tiberius\s*=\s*\{[^}]+\}/m)?.[0];
  assert.ok(dependency, "expected the explicit Tiberius dependency");
  assert.match(dependency, /default-features\s*=\s*false/);
  for (const feature of ["tds73", "chrono", "rustls"])
    assert.ok(dependency.includes(`"${feature}"`));
  assert.doesNotMatch(
    dependency,
    /"(?:winauth|integrated-auth-gssapi|native-tls|vendored-openssl)"/,
  );
  const app = read("src-tauri/Cargo.toml");
  assert.match(app, /^default = \["full"\]/m);
  assert.match(app, /^full-dev = \["full"\]/m);
  for (const profile of [
    "full",
    "full-windows-dynamic",
    "full-unix-dynamic",
    "full-linux-system",
  ])
    assert.ok(
      app
        .match(new RegExp(`^${profile} = \\[[^\\]]+\\]`, "m"))?.[0]
        .includes('"db-mssql"'),
      `${profile} retains SQL Server`,
    );
  const features = read(`${vendor}/Cargo.toml`);
  assert.match(features, /integrated-auth-gssapi = \["libgssapi"\]/);
  assert.match(
    features,
    /\[target\."cfg\(windows\)"\.dependencies\.winauth\][\s\S]*?optional = true/,
  );
  assert.match(
    features,
    /\[target\."cfg\(unix\)"\.dependencies\.libgssapi\][\s\S]*?optional = true/,
  );
});
