# Local libssh2-sys WinCNG ECC patch

Base: published crates.io `libssh2-sys` **0.3.2**, upstream ssh2-rs commit
`5b39b5fabb6b5a6b953519a571cd6af30d460ac3`, path `libssh2-sys`
(retained `.cargo_vcs_info.json`). Published `.crate` SHA-256:
`c04141a07bb0c0bc461cb657808764de571702a59bc5c726c400ac9a7625e3ab`.
The bundled libssh2 identifies itself as `1.11.1_DEV`; it is the exact source
shipped in that crate, not an independently upgraded libssh2 release.

The package's MIT/Apache-2.0 license texts and bundled libssh2 copyright/license
files are retained. Upstream public test keys are test fixtures, not application
credentials. The registry completion marker and package-local Cargo lock are
not copied; the application's workspace lock is authoritative.

Cosmetic normalization changes the equivalent Setext heading in
`libssh2/docs/INSTALL_CMAKE.md` to an ATX heading (avoiding a false conflict-marker
warning), and removes a surplus final blank line from `libssh2/src/chacha.h`.
No license or test-key bytes are changed.

## Narrow change

`build.rs` defines `LIBSSH2_ECDSA_WINCNG` only in the existing bundled Windows
WinCNG branch. Upstream `libssh2/src/wincng.h` explains that this enables native
ECDSA/ECDH using `BCryptDeriveKey(..., BCRYPT_KDF_RAW_SECRET, ...)`, available
from Windows 10. This matches the application's Windows 10+ baseline. No
cryptographic implementation or preference list is modified, no OpenSSL feature
is added, and no global `CFLAGS` or machine environment setting is required.

The build script also refuses missing bundled source with a clear error instead
of running upstream's automatic `git submodule update --init`. A published source
archive has no `.git` submodule metadata; attempting that command from this
vendor directory could otherwise operate on the application's repository.

The active Cargo manifest adds `publish = false`; `Cargo.toml.orig` remains
unchanged provenance. The root `[patch.crates-io]` applies this to direct Cargo,
managed development and CI builds alike; the vendor is excluded from automatic
workspace membership.

The upstream source is documented at
[libssh2 WinCNG configuration](https://github.com/libssh2/libssh2/blob/libssh2-1.11.1/src/wincng.h),
with the OS API described by
[Microsoft BCryptDeriveKey](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/nf-bcrypt-bcryptderivekey).

## Scope and verification

This enables the existing NIST P-256/P-384/P-521 ECC implementation. It does not
add Ed25519 host-key verification to WinCNG: an Ed25519-only server remains
unsupported by this transport backend. User-key signing is a separate adapter.
No server or fixture algorithms should be weakened to test this patch.

Upstream explicit OpenSSL builds and Unix builds are unchanged. Externally
selected vcpkg/pkg-config libraries are already compiled and are not altered by
this flag; those libraries must provide their own matching capabilities.

Acceptance uses a native algorithm-inventory test plus the isolated modern
OpenSSH loopback runner `scripts/test-vault-ssh-inline.mjs`, without changing its
server algorithm policy. These tests do not prove every remote deployment,
older Windows compatibility, or all target architectures. Recheck the native
matrix and target feature graph before replacing or rebasing this patch.
