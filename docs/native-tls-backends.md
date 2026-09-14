---
title: Native TLS backends
description: Rustls clients, SQL Server compatibility, and remaining native crypto boundaries.
---

# Native TLS backends

HTTP and WebSocket clients use Rustls with native platform certificate roots.
The database, mail and other enabled clients retain their existing verification
and explicit per-connection settings; switching TLS implementations never
implicitly trusts a certificate or disables encryption.

SQL Server uses the locally patched Tiberius 0.12.3 driver with Rustls 0.23.
The published driver's Rustls 0.21 backend is not used. The patch and its exact
upstream provenance are documented in
[`PATCHES.md`](https://github.com/supermarsx/sortOfRemoteNG/blob/main/src-tauri/vendor/tiberius-rustls/PATCHES.md).
Platform roots are loaded once and verified hostname matching remains enabled.
A configured PEM/CRT/DER CA is added to platform roots, not an exclusive pin.
If no usable platform roots exist, configure a valid CA or repair the platform
store: the connection returns an error instead of silently bypassing trust.
A valid configured CA can work without platform roots. The existing explicit
Trust Server Certificate option remains a separate verification bypass.
Rustls supports TLS 1.2/1.3; obsolete SQL Server TLS configurations may need
server-side updates. No weak-TLS or plaintext fallback was introduced.

SSH uses a different protocol and cryptographic backend; Rustls is not a
replacement for libssh2's signing/encryption implementation. Native packaging
may also legitimately include OpenSSL libraries for components such as
librdkafka. Therefore removing `openssl-sys` from the Windows Cargo build is
not a claim that every platform or packaged native dependency is OpenSSL-free.

Verification uses synthetic loopback TLS and Cargo dependency/feature graphs.
It does not establish live-provider authentication or every platform's native
runtime packaging without those separate acceptance gates.
