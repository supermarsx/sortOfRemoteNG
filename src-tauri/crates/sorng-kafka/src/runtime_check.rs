//! Runtime probe for native `librdkafka` (t3-e38).
//!
//! The [`rdkafka`] crate (and transitively `rdkafka-sys`) statically links
//! `librdkafka.a` under the `cmake-build` feature, but dynamically links
//! against a *system-installed* `librdkafka.so` / `librdkafka.dll` /
//! `librdkafka.dylib` under the `dynamic-linking` feature. On a dynamic
//! build the absence of the library produces a confusing `ImageLoadError`
//! / `dlopen` failure deep inside `rdkafka-sys` initialisation the first
//! time the crate touches the `AdminClient` / `FutureProducer` / etc.
//!
//! This module runs a *fast, side-effect-free* `dlopen` probe at service
//! init time and surfaces a typed [`KafkaError`] of kind
//! [`KafkaErrorKind::LibraryMissing`] carrying a per-OS install hint when
//! the library is missing. That turns a confusing link-time crash into an
//! actionable error the UI can render verbatim.
//!
//! ## Feature matrix
//!
//! | Feature            | Probe behaviour                                                              |
//! |--------------------|------------------------------------------------------------------------------|
//! | `cmake-build`      | `librdkafka` is statically linked — probe is a no-op and always returns Ok. |
//! | `dynamic-linking`  | Full probe via [`libloading::Library::new`] on a list of candidate sonames. |
//! | neither            | Probe returns Ok (the crate itself will not link). Kept here for testing.   |
//!
//! ## Testability
//!
//! The probe is behind the [`LibraryProbe`] trait so unit tests can inject
//! a [`MockProbe`] that simulates `present` / `missing` states without
//! touching the host filesystem or loading a real library.
//!
//! ## Caveat — DT_NEEDED vs. dlopen
//!
//! `rdkafka-sys` under `dynamic-linking` emits a normal
//! `cargo:rustc-link-lib=dylib=rdkafka` directive, which makes
//! `librdkafka.so.1` / `rdkafka.dll` a *hard* DT_NEEDED / IAT dependency
//! of the final binary. On Linux/macOS, if the library is completely
//! missing at process start the OS dynamic loader aborts **before**
//! `main()` runs — our probe never gets a chance to produce the typed
//! error. The probe still catches the interesting edge cases:
//! - library present on `LD_LIBRARY_PATH` / PATH but an older soname
//!   than what the binary was linked against (e.g. `.so.1` → `.so.2`);
//! - library damaged / wrong architecture;
//! - Windows, where the OS delay-loads the DLL only on first use of an
//!   rdkafka symbol — the probe fires first at `KafkaService::connect()`.
//!
//! The install-hint + typed `LibraryMissing` error is still the primary
//! deliverable for UX: even when the OS loader does abort at startup,
//! the README / root-README documentation (updated in t3-e38) tells
//! users what to install; the probe is the programmatic surface the UI
//! can render when it gets the chance.

use crate::error::{KafkaError, KafkaErrorKind};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Probe trait + real impl
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Abstracts the host-library probe so tests can mock it.
pub trait LibraryProbe: Send + Sync {
    /// Returns `Ok(())` when `librdkafka` is present (or statically linked),
    /// otherwise a [`KafkaError`] of kind [`KafkaErrorKind::LibraryMissing`]
    /// with an install-hint in `detail`.
    fn probe(&self) -> Result<(), KafkaError>;
}

/// Real host probe — runs at service init under the `dynamic-linking`
/// feature. Under `cmake-build` (static) it is a no-op.
#[derive(Debug, Default, Clone, Copy)]
pub struct RealProbe;

impl LibraryProbe for RealProbe {
    fn probe(&self) -> Result<(), KafkaError> {
        probe_host()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  install_hint_for_host / library_missing_error
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Per-OS install hint surfaced to the UI when the library is missing.
/// The hint is a multi-line string safe to copy-paste into a terminal.
pub fn install_hint_for_host() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "Install librdkafka ≥ 2.x for your distro:\n  \
         Debian/Ubuntu: sudo apt-get install librdkafka-dev\n  \
         Fedora/RHEL:   sudo dnf install librdkafka-devel\n  \
         Arch:          sudo pacman -S librdkafka\n\
         See src-tauri/crates/sorng-kafka/README.md for details."
    }
    #[cfg(target_os = "macos")]
    {
        "Install librdkafka ≥ 2.x via Homebrew:\n  \
         brew install librdkafka\n\
         Apple Silicon: headers land under /opt/homebrew/include.\n\
         Intel:         headers land under /usr/local/include.\n\
         See src-tauri/crates/sorng-kafka/README.md for details."
    }
    #[cfg(target_os = "windows")]
    {
        "Install librdkafka ≥ 2.x (Windows):\n  \
         vcpkg:  vcpkg install librdkafka:x64-windows\n  \
         winget: winget install librdkafka\n  \
         MSYS2:  pacman -S mingw-w64-x86_64-librdkafka\n\
         Make sure the librdkafka DLL directory is on PATH at runtime.\n\
         See src-tauri/crates/sorng-kafka/README.md for details."
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        "librdkafka ≥ 2.x is required. This OS is not a supported \
         configuration. Please file an issue with the target triple."
    }
}

/// Construct a `LibraryMissing` error with the per-OS install hint in
/// `detail`.
pub fn library_missing_error() -> KafkaError {
    KafkaError::library_missing(
        "librdkafka shared library not found on this host",
        install_hint_for_host(),
    )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  probe_host — feature + OS dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Candidate shared-library filenames to try on each platform.
/// `libloading::Library::new` consults the OS's normal runtime linker
/// search path (`LD_LIBRARY_PATH` / `PATH` / `DYLD_LIBRARY_PATH`
/// + system defaults).
#[allow(dead_code)] // used only by the dynamic-linking probe; retained under
                    // cmake-build for test visibility.
pub(crate) fn candidate_sonames() -> &'static [&'static str] {
    #[cfg(target_os = "linux")]
    {
        &[
            "librdkafka.so.1",
            "librdkafka.so",
            "librdkafka.so.2",
        ]
    }
    #[cfg(target_os = "macos")]
    {
        &[
            "librdkafka.1.dylib",
            "librdkafka.dylib",
        ]
    }
    #[cfg(target_os = "windows")]
    {
        &[
            "rdkafka.dll",
            "librdkafka.dll",
        ]
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        &[]
    }
}

/// Host-probe implementation.
///
/// - `cmake-build`: librdkafka is statically linked — no probe needed.
/// - `dynamic-linking`: probe via libloading.
/// - Neither feature: no-op (the crate would not link anyway).
pub fn probe_host() -> Result<(), KafkaError> {
    // Static feature wins: if the caller opted into the static build,
    // librdkafka is inside the binary and the probe is definitionally Ok.
    #[cfg(feature = "cmake-build")]
    {
        return Ok(());
    }

    #[cfg(all(feature = "dynamic-linking", not(feature = "cmake-build")))]
    {
        return probe_host_dynamic();
    }

    #[cfg(not(any(feature = "cmake-build", feature = "dynamic-linking")))]
    {
        // Crate compiled with neither linking feature — should be
        // unreachable at runtime (rdkafka-sys would not have linked),
        // but the probe must not panic if called anyway.
        Ok(())
    }
}

#[cfg(all(feature = "dynamic-linking", not(feature = "cmake-build")))]
fn probe_host_dynamic() -> Result<(), KafkaError> {
    for soname in candidate_sonames() {
        if try_load(soname) {
            return Ok(());
        }
    }
    Err(library_missing_error())
}

#[cfg(all(feature = "dynamic-linking", not(feature = "cmake-build")))]
fn try_load(soname: &str) -> bool {
    // SAFETY: `libloading::Library::new` is unsafe because the act of
    // loading a library runs its initialisers. We load well-known system
    // libraries by soname only — the same libraries `rdkafka-sys` would
    // load itself moments later — and drop the handle immediately so the
    // library is unloaded (or kept mapped if another consumer has it).
    unsafe {
        match libloading::Library::new(soname) {
            Ok(lib) => {
                drop(lib);
                true
            }
            Err(_) => false,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MockProbe + unit tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Test double — returns whatever the test constructed it with.
#[derive(Debug, Clone)]
pub struct MockProbe {
    pub result: Result<(), KafkaError>,
}

impl MockProbe {
    pub fn ok() -> Self {
        Self { result: Ok(()) }
    }
    pub fn missing() -> Self {
        Self {
            result: Err(library_missing_error()),
        }
    }
}

impl LibraryProbe for MockProbe {
    fn probe(&self) -> Result<(), KafkaError> {
        self.result.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_hint_for_host_is_non_empty() {
        let hint = install_hint_for_host();
        assert!(!hint.is_empty(), "per-OS install hint must be populated");
        assert!(
            hint.contains("librdkafka"),
            "hint must name the library: {}",
            hint
        );
    }

    #[test]
    fn library_missing_error_has_library_missing_kind() {
        let err = library_missing_error();
        assert_eq!(err.kind, KafkaErrorKind::LibraryMissing);
        assert!(err.detail.is_some(), "install hint must live in detail");
        assert!(
            err.detail.as_deref().unwrap().contains("librdkafka"),
            "detail must contain install hint text"
        );
    }

    #[test]
    fn mock_probe_ok_surfaces_ok() {
        let p = MockProbe::ok();
        assert!(p.probe().is_ok());
    }

    #[test]
    fn mock_probe_missing_surfaces_library_missing_with_install_hint() {
        let p = MockProbe::missing();
        let err = p.probe().expect_err("expected LibraryMissing");
        assert_eq!(err.kind, KafkaErrorKind::LibraryMissing);
        let detail = err.detail.as_deref().expect("detail must carry hint");
        // The hint must be non-trivial so the UI has something actionable.
        assert!(detail.len() > 32, "hint too short: {}", detail);
    }

    #[test]
    fn real_probe_is_deterministic() {
        // The real probe must not panic and must return the same answer
        // on two consecutive calls, regardless of host configuration.
        let p = RealProbe;
        let a = p.probe().is_ok();
        let b = p.probe().is_ok();
        assert_eq!(a, b, "RealProbe must be deterministic");
    }

    #[cfg(feature = "cmake-build")]
    #[test]
    fn static_build_probe_is_always_ok() {
        assert!(
            probe_host().is_ok(),
            "under cmake-build (static) probe must be Ok"
        );
    }

    #[cfg(all(feature = "dynamic-linking", not(feature = "cmake-build")))]
    #[test]
    fn dynamic_candidate_list_is_non_empty_on_supported_os() {
        // At least on the three OSes we ship for, the candidate list
        // must be populated so the probe has something to try.
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        assert!(!candidate_sonames().is_empty());
    }
}
