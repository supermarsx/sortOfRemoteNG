# Native dynamic runtime

Release builds hard-link OpenH264 and load its architecture-matched shared
library at process startup. The sole vcpkg manifest in this directory builds
OpenH264 2.6.0 from source on Windows, Linux, and macOS. Kafka, SQLite, and
libssh2 remain Windows-only manifest dependencies.

The pinned OpenH264 overlay is copied from the selected vcpkg baseline. Its
second patch corrects that port's stale Meson ABI major from 7 to the ABI 8
published by OpenH264 2.6.0. Do not remove that patch or silently accept an ABI
7 filename: the application's hard import and release validators require ABI 8.

## Windows

Stage an x64 release build with:

```powershell
npm run native:stage:windows -- --target x86_64-pc-windows-msvc
```

Use `aarch64-pc-windows-msvc` for Windows on ARM. The stager verifies package
versions, `openh264.lib`, every DLL's PE machine, the closed DLL dependency
graph, and all license notices. It exports `OPENH264_LIB_DIR` for the hard link
and stages this exact nine-DLL closure beside `sortOfRemoteNG.exe`:

- `openh264-8.dll`
- `rdkafka.dll`
- `sqlite3.dll`
- `libssh2.dll`
- `lz4.dll`
- `z.dll`
- `zstd.dll`
- `libcrypto-3-{x64|arm64}.dll`
- `libssl-3-{x64|arm64}.dll`

The custom `x64-windows-sorng` and `arm64-windows-sorng` triplets build
release-only DLLs while linking their MSVC runtime statically. The packaged
closure therefore does not require a separately installed Visual C++
Redistributable. SQLite retains the feature and compiler-option set previously
provided by `libsqlite3-sys`'s bundled build. The pinned librdkafka overlay
retains Snappy, gzip, LZ4, zstd, TLS, SCRAM, and OAuth bearer support.

`npm run tauri:build` stages this closure and creates a temporary Tauri bundle
overlay that places the DLLs and eight license notices next to the executable.

## Linux and macOS

The all-platform stager supports exactly these release targets:

```sh
node scripts/stage-openh264-runtime.mjs --target x86_64-unknown-linux-gnu
node scripts/stage-openh264-runtime.mjs --target aarch64-unknown-linux-gnu
node scripts/stage-openh264-runtime.mjs --target x86_64-apple-darwin
node scripts/stage-openh264-runtime.mjs --target aarch64-apple-darwin
```

CI can append the link and loader environment to its environment file with
`--github-env "$GITHUB_ENV"`. The script source-builds the pinned vcpkg port,
requires pkg-config version 2.6.0, validates the target architecture, stages
`openh264.txt`, and exports `OPENH264_LIB_DIR`.

Linux packages must ship `libopenh264.so.8` (SONAME `libopenh264.so.8`) beside
the application. macOS packages must ship `libopenh264.8.dylib`; its install
name is normalized to `@rpath/libopenh264.8.dylib`. The stager also exports
`LD_LIBRARY_PATH` or `DYLD_LIBRARY_PATH` for build-time probes. Packagers remain
responsible for placing the staged library at a loader location used by the
final application bundle.

## Licensing

This project redistributes a source-built OpenH264 library under the upstream
BSD-2-Clause license; it does **not** redistribute Cisco's separately hosted
binary module. Cisco explains that its MPEG-LA patent-license coverage applies
to Cisco's binary module and that parties building or distributing their own
binary are responsible for any applicable patent royalties. Review the
[OpenH264 licensing FAQ](https://www.openh264.org/faq.html) and the
[upstream license](https://github.com/cisco/openh264/blob/v2.6.0/LICENSE)
before distribution. This note is not legal advice.

Dynamic linking reduces the main executable's size; it does not remove these
native bytes from installers or portable archives. Release optimization and
linker dead-code folding account for the remaining executable-size reduction.
