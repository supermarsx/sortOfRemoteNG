# Distribution package recipes

The repository ships source-build recipes for current Arch Linux and Alpine
Linux 3.24:

- `arch/PKGBUILD`
- `alpine/APKBUILD`

Both recipes pin the exact gated source commit and the exact OPKSSH upstream
commit. Release snapshots update `pkgver` and `_commit` together, while the
recipe projects the public `YY.N` identity into the source tree before build.
The official Arch recipe targets x86_64; the Alpine recipe supports x86_64 and
aarch64.

The packages deliberately use distribution shared libraries for Kafka,
SQLite, libssh2, and OpenH264. Their `check()` functions require the installed
`/usr/bin/com.sortofremote.ng` binary to contain the corresponding ELF imports,
including the hard OpenH264 ABI contract `libopenh264.so.8`. Locales and the
embedded OPKSSH bridge are installed below `/usr/lib/sortOfRemoteNG`, matching
the application's packaged resource lookup. Package checks also load that
bridge and require its ABI, embedded-runtime, and callable-backend flags.

Build on Arch Linux with:

```sh
cd packaging/arch
makepkg --syncdeps --install
```

Build on Alpine Linux 3.24 with an initialized `abuild` environment:

```sh
cd packaging/alpine
abuild -r
```

The Alpine recipe targets 3.24 because it provides Node.js 24, WebKitGTK 4.1,
and OpenH264 2.6 with ABI 8 on both supported architectures. Both recipes fetch
the locked npm, Cargo, and Go dependency sets during `prepare()`, build the
frontend once, stage the pinned OPKSSH bridge, and then run Tauri without a
second frontend build. Network access is therefore required while preparing
the package sources.

To keep this unusually large Rust graph within ordinary builder memory, the
recipes default to one Cargo job, 16 codegen units, optimization level 1, and
no LTO. Maintainers can override those `CARGO_*` variables before invoking the
package tool when their builders have more memory or prioritize minimum size.
