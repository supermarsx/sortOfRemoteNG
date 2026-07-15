# psrp-rs core provenance and local patches

This directory is derived from the published `psrp-rs` 1.0.0 crate.

- Upstream: <https://crates.io/crates/psrp-rs/1.0.0>
- Repository recorded by the crate: <https://github.com/muchini/psrp-rs>
- Published archive SHA-256: `1cd98db58a18fcb0607886749f57f41834c15b4683361263b15ba4a024680dc4`
- Recorded upstream Git revision: `d62bcff6b671900d3a0a2595ca6003597a98b73d`
- License: MIT OR Apache-2.0; both upstream license files are preserved here.

The local fork contains only the transport-agnostic protocol core:

1. `winrm-rs` and all WinRM-only modules, exports, error variants, transport
   implementations, feature declarations, and dependencies are excluded.
2. The upstream SSH adapter and its optional dependencies are excluded. It
   accepts every server host key, uses a raw fragment framing contract that is
   incompatible with PowerShell's `-sshs` OutOfProcess protocol, and implements
   cancellation as a no-op. The application provides its own strict, tested
   OutOfProcess-over-SSH adapter instead.
3. Published examples and integration-test target declarations are omitted
   from this minimal vendored core. The library's source unit tests remain.
4. The parent workspace excludes this vendored package so it remains an
   explicitly maintained third-party core rather than an application member.

The application depends on this crate with `default-features = false`.
