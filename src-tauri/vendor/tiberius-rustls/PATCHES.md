# Local Tiberius TLS patch

Base: crates.io `tiberius` **0.12.3**, upstream commit
`c34fab2e14c52ab74519d073d7a7b65bd023fc1a` (retained `.cargo_vcs_info.json`).
Published `.crate` SHA-256:
`a1446cb4198848d1562301a3340424b4f425ef79f35ef9ee034769a9dd92c10d`.
Upstream: <https://github.com/prisma/tiberius>. MIT and Apache-2.0 license
texts are retained unchanged. Other upstream source is unchanged except
the TLS adapter and cosmetic normalization described below. The registry `.cargo-ok` marker and upstream
development `Cargo.lock` are omitted; the application workspace lock is authoritative.

The retained `docker/certs/customCA.key` and `docker/certs/server.key` files
are public test fixtures from that exact published upstream crate. They are
not application or user credentials and are never used by the application at
runtime; they are retained only to keep the upstream test fixtures complete.

Cosmetic normalization removes a surplus final blank line from
`docker/certs/generate-signed-cert.sh` and trailing SQL whitespace from
`examples/bulk.rs` and `tests/query.rs`. This does not change SQL semantics,
script behavior, or any license/test-key bytes.

## Why this patch exists

The published crate's Rustls feature selects end-of-life Rustls 0.21 and its
older certificate verifier. Merely changing the application's feature would
introduce that unsupported stack. This local patch moves only TLS to the
application's maintained Rustls 0.23 line, tokio-rustls 0.26,
rustls-native-certs 0.8 and rustls-pemfile 2.

Modified upstream files:

- `Cargo.toml`: those TLS dependencies and `publish = false`.
- `src/client/tls_stream/rustls_tls_stream.rs`: current Rustls APIs; explicit
  per-client ring crypto provider, never a process-global installation;
  normal certificate-chain and hostname verification.
- New `src/client/tls_stream/rustls_roots.rs`: fallible, once-loaded platform
  roots plus an optional configured CA. Missing/unusable roots return an error,
  not a panic. A valid explicit CA still works when platform roots are unavailable.

The configured CA remains **additive** to usable platform roots, preserving
the application's previous native-TLS behavior. It is not an exclusive pin.
An invalid configured CA fails rather than being ignored. The existing explicit
`trust_server_certificate` option remains separate; it bypasses certificate
trust/hostname checks, but TLS handshake signatures are still checked.
Supported protocol versions use Rustls safe defaults (TLS 1.2/1.3), with no
fallback to obsolete TLS or plaintext.

`Cargo.toml.orig` is retained as provenance, not the active manifest. No TDS,
authentication, query, packet, or session implementation was changed.

## Maintenance and acceptance

This is an application-owned compatibility patch, not an upstream release.
Track upstream and Rustls advisories; prefer removing it once a maintained
upstream release supports the current TLS stack. Rebase only after comparing
these files and rerunning:

```text
node ../scripts/native-build-env.mjs cargo test -p sorng-mssql --locked --target-dir ../.artifacts/cargo-synology
node ../scripts/native-build-env.mjs cargo clippy -p sorng-mssql --all-targets --locked --target-dir ../.artifacts/cargo-synology -- -D warnings
node --test tests/tooling/nativeTlsBackends.node-test.mjs
```

Cargo commands run from `src-tauri`; Node tooling tests run from the repo root.
The SQL Server tests use synthetic loopback TDS prelogin and real TLS to prove
verified CA success, untrusted/wrong-host/invalid-CA refusal, explicit bypass,
provider independence, and no authenticated SQL session publication after a
failed login. Root-store tests include this exact production helper and do not
change any operating-system certificate store. They do not claim live SQL
Server query/authentication acceptance or test an entire driver fork.
