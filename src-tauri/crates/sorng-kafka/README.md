# sorng-kafka

Apache Kafka integration for sortOfRemoteNG — cluster management, topic operations, consumer groups, producer/consumer, ACLs, Schema Registry, Kafka Connect, quotas, reassignment, and performance monitoring. Built on [`rdkafka`](https://github.com/fede1024/rust-rdkafka) (the Rust binding for librdkafka).

## Opt-in feature — not compiled by default

Kafka is **off by default** in the top-level `app` crate. Default workspace builds do **not** include this crate and do **not** try to build librdkafka. If you don't pass a Kafka feature flag, you can ignore this README entirely.

To verify: `cargo check --workspace --exclude sorng-kafka` passes cleanly; `cargo check --workspace` only fails because this crate (unconditionally behind a feature gate on the app side) cannot build without its native dependency configured.

## Runtime requirement: librdkafka ≥ 2.x

> **v1.0 default** — `sorng-kafka` ships with the `dynamic-linking` feature as the default (t3-e38). Release artifacts do **not** bundle librdkafka; users install librdkafka ≥ 2.x via their OS package manager. See "Installing librdkafka" below.

At service-init time (`KafkaService::connect`), `sorng-kafka` runs a fast `dlopen` probe against the platform's candidate sonames (`librdkafka.so.*` / `librdkafka.dylib` / `rdkafka.dll`). If the library cannot be loaded the crate returns a typed `KafkaError` with:

- `kind = KafkaErrorKind::LibraryMissing`
- `message = "librdkafka shared library not found on this host"`
- `detail` = a copy-pasteable per-OS install hint (apt / dnf / pacman / brew / vcpkg / winget / MSYS2 commands)

The probe is a no-op under the static `cmake-build` feature (librdkafka is already inside the binary). See `src/runtime_check.rs` for the implementation and `MockProbe` test double.

## The two feature flags

`sorng-kafka` offers two mutually exclusive ways to link librdkafka. The v1.0 default is **`dynamic-linking`**. Enable exactly one via the top-level `app` crate:

| Top-level flag | Internal `sorng-kafka` feature | What happens | Use when |
|---|---|---|---|
| `--features kafka` (v1.0 default) | `dynamic-linking` | `rdkafka-sys` links against a librdkafka already installed on the system. No C build at Rust-build time. Runtime probe surfaces `LibraryMissing` if absent. | Production release flow. You (or your users) install librdkafka via vcpkg, apt, dnf, pacman, brew, winget. |
| `--features kafka-dynamic` | `dynamic-linking` | Alias of `--features kafka`. Kept for CI compatibility with `--features kafka-dynamic` invocations. | Same as `kafka`. |
| `--features kafka-static` | `cmake-build` | `rdkafka-sys` invokes CMake to compile librdkafka from source at build time. Produces a statically linked binary. | Developer / CI images that want a self-contained artifact. **Requires**: CMake + a C toolchain. **Fails on Windows/MSYS64** (see "Known issue" below). |

These linking modes are mutually exclusive — enabling both results in a duplicate-symbol link error from librdkafka. The top-level `app` crate declares `sorng-kafka` with `default-features = false`, so each feature flag explicitly opts into exactly one linking mode. (The `tokio` and `libz` rdkafka features that the async APIs need stay enabled unconditionally inside this crate's `rdkafka` dep declaration — only the linking mode is user-selectable.)

### Build invocations

```bash
# v1.0 default — dynamic-link against a system-installed librdkafka:
cargo build --features kafka              # or: --features kafka-dynamic

# Self-contained binary (static, developer/CI only; fails on Windows/MSYS64):
cargo build --features kafka-static

# Default build — no Kafka at all, fastest check:
cargo check --workspace --exclude sorng-kafka
```

## Installing librdkafka (for `kafka-dynamic`)

### Linux

**Debian / Ubuntu:**
```bash
sudo apt-get install librdkafka-dev
```

**Fedora / RHEL:**
```bash
sudo dnf install librdkafka-devel
```

**Arch:**
```bash
sudo pacman -S librdkafka
```

### macOS

**Homebrew:**
```bash
brew install librdkafka
```

The Homebrew-installed headers land under `/opt/homebrew/include` (Apple Silicon) or `/usr/local/include` (Intel). `pkg-config` discovers them automatically.

### Windows

Three options, in order of recommendation:

**1. vcpkg (recommended for MSVC toolchain users):**
```powershell
git clone https://github.com/microsoft/vcpkg
.\vcpkg\bootstrap-vcpkg.bat
.\vcpkg\vcpkg install librdkafka:x64-windows
# Then either add <vcpkg>\installed\x64-windows to PATH + set VCPKG_ROOT
# or use the vcpkg-cmake integration.
```

**2. winget:**
```powershell
winget install librdkafka
```
(Availability varies by package source; check `winget search librdkafka` first.)

**3. MSYS2 pacman (for the mingw/cygwin toolchain):**
```bash
pacman -S mingw-w64-x86_64-librdkafka
```

After install, make sure the librdkafka DLL directory is on `PATH` at runtime (not just at build time).

## Known issue: MSYS64 cmake failure with `kafka-static`

**Symptom:** When you run `cargo build --features kafka-static` on Windows with an MSYS64 (mingw64 / cygwin) toolchain, the rdkafka-sys build script invokes cmake and fails with:

```
/bin/sh: line 1: /C/msys64/mingw64/bin/cmake.exe: No such file or directory
make[1]: *** [CMakeFiles/cmTC_xxxxx.dir/build.make:80: CMakeFiles/cmTC_xxxxx.dir/testCCompiler.c.obj] Error 127
CMake Error at <path>: The C compiler "C:/msys64/mingw64/bin/cmake.exe" is not able to compile a simple test program.
```

**Root cause:** cmake receives a Windows-native path (`C:/msys64/...`) but the invoking `make` is a cygwin/MSYS build that re-interprets that path through its POSIX translator (`/C/msys64/...`). The translated path does not exist from cygwin's perspective, so the sub-tool invocation fails.

**Workaround (fastest):** Use `kafka` (the v1.0 default) instead. Install librdkafka via vcpkg or MSYS2 pacman (above), then:

```bash
cargo build --features kafka          # dynamic-link (default in v1.0)
```

**Workaround (if you need the static build):**
- Use the MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`) with Visual Studio Build Tools. cmake's native-Windows path handling matches MSVC's, and the static build succeeds.
- Or build in WSL2 where the cygwin/mingw path translation layer does not apply.

**CI:** the project's CI workflow passes `--exclude sorng-kafka` on Windows jobs and enables `--features kafka` (dynamic-linking) on Linux jobs, so the failure does not block merges. Release artifacts are built with `--features kafka-dynamic`. See `.github/workflows/ci.yml` and `.github/workflows/release.yml`.

## Source layout

- `admin.rs` — topic + cluster admin operations
- `producer.rs` / `consumer.rs` — data plane
- `acls.rs` — ACL management
- `consumer_groups.rs` — consumer group operations
- `quotas.rs` — client quota management
- `partitions.rs` + `reassignment.rs` — partition operations
- `schema_registry.rs` — Confluent Schema Registry REST client
- `connect.rs` — Kafka Connect REST client

Roughly 6,500 LOC across 14 files; 137 `rdkafka::` call sites. A future orchestration task (t4) may migrate the pure-Rust data path to [`rskafka`](https://crates.io/crates/rskafka) to drop the librdkafka C dependency entirely — this is tracked separately and is not part of t2.
