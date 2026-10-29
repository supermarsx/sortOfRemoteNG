//! Per-connection HTTP disk cache handed to the patched CEF bridge (revision 6).
//!
//! Only the network-layer HTTP cache of an otherwise off-the-record, attempt-
//! private context is placed on disk. The request context keeps an empty
//! `cache_path`, no cookie database and in-memory profile preferences. Cache
//! semantics (Cache-Control, ETag, Vary, no-store, partitioning) are Chromium's.
//!
//! [`HttpDiskCacheSpec`] is native-only: it is built by the application from its
//! own authorised attempt identity and lease, never deserialised from IPC. It
//! deliberately implements no serde trait.

use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Smallest per-connection cache the engine accepts (16 MiB).
pub const HTTP_CACHE_MIN_BYTES: u64 = 16 * 1024 * 1024;
/// Largest per-connection cache the engine accepts (1 GiB).
pub const HTTP_CACHE_MAX_BYTES: u64 = 1024 * 1024 * 1024;
/// The directory must be a strict descendant of `<root_cache_path>/http-cache`.
pub const HTTP_CACHE_DIRECTORY_NAME: &str = "http-cache";
/// Bounded native path length in UTF-8 bytes.
pub const HTTP_CACHE_MAX_PATH_BYTES: usize = 4096;

/// Native-owned request for one context's disk cache. No serde, by design.
/// No `Debug`: the path names the OS user's profile directory.
#[derive(Clone, PartialEq, Eq)]
pub struct HttpDiskCacheSpec {
    /// Existing, app-created directory under `<root>/http-cache/...`.
    pub directory: PathBuf,
    /// Chromium `http_cache_max_size`, in [16 MiB, 1 GiB].
    pub max_bytes: u64,
}

/// Why a spec was refused before any native call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum HttpCacheSpecError {
    #[error("HTTP cache directory must be an absolute, normalised UTF-8 path")]
    Path,
    #[error("HTTP cache directory must be inside the http-cache root")]
    Location,
    #[error("HTTP cache size is outside the supported range")]
    Size,
}

impl HttpDiskCacheSpec {
    /// Validating constructor. The engine re-validates everything, including
    /// that the directory exists below the actual `root_cache_path`.
    pub fn new(directory: PathBuf, max_bytes: u64) -> Result<Self, HttpCacheSpecError> {
        let spec = Self {
            directory,
            max_bytes,
        };
        spec.validate()?;
        Ok(spec)
    }

    /// Structural checks done in Rust before FFI, mirroring the engine's path
    /// rules (c1, revision 6): absolute (Windows: drive-absolute only, no UNC
    /// or `\\?\`); UTF-8 without control characters; bounded length; no empty,
    /// `.` or `..` segment and no trailing separator; on Windows no `<>:"|?*`,
    /// no trailing dot/space and no `~` below `http-cache`; a strict
    /// descendant of an `http-cache` segment; size in range. Existence, link
    /// and reparse-point checks and the exact `root_cache_path` match are the
    /// app's (at creation) and the engine's.
    pub fn validate(&self) -> Result<(), HttpCacheSpecError> {
        if !(HTTP_CACHE_MIN_BYTES..=HTTP_CACHE_MAX_BYTES).contains(&self.max_bytes) {
            return Err(HttpCacheSpecError::Size);
        }
        let text = self.directory.to_str().ok_or(HttpCacheSpecError::Path)?;
        if text.is_empty()
            || text.len() > HTTP_CACHE_MAX_PATH_BYTES
            || text.chars().any(|c| c.is_control())
            || !self.directory.is_absolute()
        {
            return Err(HttpCacheSpecError::Path);
        }
        let windows = cfg!(windows);
        let segments: Vec<&str> = if windows {
            // Drive-absolute only: `X:\...` (either separator).
            let bytes = text.as_bytes();
            if bytes.len() < 3
                || !bytes[0].is_ascii_alphabetic()
                || bytes[1] != b':'
                || !matches!(bytes[2], b'\\' | b'/')
            {
                return Err(HttpCacheSpecError::Path);
            }
            text[3..].split(['\\', '/']).collect()
        } else {
            text.strip_prefix('/')
                .ok_or(HttpCacheSpecError::Path)?
                .split('/')
                .collect()
        };
        let mut below_cache_root: Option<usize> = None;
        for segment in segments {
            if segment.is_empty() || segment == "." || segment == ".." {
                return Err(HttpCacheSpecError::Path);
            }
            if windows
                && (segment.contains(['<', '>', ':', '"', '|', '?', '*'])
                    || segment.ends_with(['.', ' '])
                    || (below_cache_root.is_some() && segment.contains('~')))
            {
                return Err(HttpCacheSpecError::Path);
            }
            below_cache_root = match below_cache_root {
                Some(depth) => Some(depth + 1),
                None if segment == HTTP_CACHE_DIRECTORY_NAME
                    || (windows && segment.eq_ignore_ascii_case(HTTP_CACHE_DIRECTORY_NAME)) =>
                {
                    Some(0)
                }
                None => None,
            };
        }
        match below_cache_root {
            Some(depth) if depth > 0 => Ok(()),
            _ => Err(HttpCacheSpecError::Location),
        }
    }
}

/// Why a context uses Chromium's in-memory HTTP cache.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HttpCacheMemoryReason {
    /// The caller asked for no disk cache.
    NotRequested,
    /// The loaded engine does not report `HTTP_DISK_CACHE` (bit 10).
    EngineUnsupported,
    /// The spec failed Rust-side validation; nothing was sent to the engine.
    InvalidSpec,
    /// The engine refused the cache variant (NULL); a plain context was made.
    EngineRejected,
}

/// Which HTTP cache the created context actually uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HttpCacheUse {
    Disk,
    Memory(HttpCacheMemoryReason),
}

/// Sendable observation of engine state 7 ("HTTP disk cache released") for
/// one context. It outlives the context owner so an app cache lease can be
/// released only once Chromium no longer holds the directory. Also set when
/// CEF shuts down. Never set for a context that holds no disk cache.
#[derive(Clone, Debug, Default)]
pub struct HttpCacheReleaseSignal(Arc<AtomicBool>);

impl HttpCacheReleaseSignal {
    pub fn is_released(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
    /// Returns false when it was already released (duplicate state 7).
    #[cfg(any(feature = "cef-host", test))]
    pub(crate) fn release(&self) -> bool {
        !self.0.swap(true, Ordering::AcqRel)
    }
}

/// C mirror of `cef_sorng_http_cache_v2` (C-H1). Borrowed for the call only.
#[cfg(feature = "cef-host")]
#[repr(C)]
pub(crate) struct RawHttpCache {
    pub(crate) size: u32,
    pub(crate) reserved: u32,
    pub(crate) directory_utf8: *const std::ffi::c_char,
    pub(crate) directory_length: usize,
    pub(crate) max_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\u\AppData\Local\app\browser")
        } else {
            PathBuf::from("/home/u/.local/share/app/browser")
        }
    }

    #[test]
    fn spec_accepts_only_normalised_descendants_of_the_cache_root_in_range() {
        let base = root().join(HTTP_CACHE_DIRECTORY_NAME);
        let good = base.join("0123456789abcdef").join("fedcba9876543210");
        assert!(HttpDiskCacheSpec::new(good.clone(), 128 * 1024 * 1024).is_ok());
        assert!(HttpDiskCacheSpec::new(good.clone(), HTTP_CACHE_MIN_BYTES).is_ok());
        assert!(HttpDiskCacheSpec::new(good.clone(), HTTP_CACHE_MAX_BYTES).is_ok());
        for size in [
            0,
            HTTP_CACHE_MIN_BYTES - 1,
            HTTP_CACHE_MAX_BYTES + 1,
            u64::MAX,
        ] {
            assert_eq!(
                HttpDiskCacheSpec::new(good.clone(), size).err(),
                Some(HttpCacheSpecError::Size)
            );
        }
        // The cache root itself and unrelated directories are not eligible.
        assert_eq!(
            HttpDiskCacheSpec::new(base.clone(), HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Location)
        );
        assert_eq!(
            HttpDiskCacheSpec::new(root().join("other").join("x"), HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Location)
        );
        let relative = PathBuf::from(HTTP_CACHE_DIRECTORY_NAME).join("a");
        assert_eq!(
            HttpDiskCacheSpec::new(relative, HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        assert_eq!(
            HttpDiskCacheSpec::new(base.join("a").join("..").join("b"), HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        let sep = std::path::MAIN_SEPARATOR;
        let dotted = PathBuf::from(format!("{}{sep}.{sep}a", base.display()));
        assert_eq!(
            HttpDiskCacheSpec::new(dotted, HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        let doubled = PathBuf::from(format!("{}{sep}{sep}a", base.display()));
        assert_eq!(
            HttpDiskCacheSpec::new(doubled, HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        let nul = PathBuf::from(format!("{}{sep}a\0b", base.display()));
        assert_eq!(
            HttpDiskCacheSpec::new(nul, HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        let long = base.join("a".repeat(HTTP_CACHE_MAX_PATH_BYTES));
        assert_eq!(
            HttpDiskCacheSpec::new(long, HTTP_CACHE_MIN_BYTES).err(),
            Some(HttpCacheSpecError::Path)
        );
        // A struct literal is still validated before any native call.
        let literal = HttpDiskCacheSpec {
            directory: base,
            max_bytes: HTTP_CACHE_MIN_BYTES,
        };
        assert_eq!(literal.validate(), Err(HttpCacheSpecError::Location));
    }

    #[test]
    #[cfg(windows)]
    fn windows_paths_follow_the_engine_rules() {
        let check = |path: &str| {
            HttpDiskCacheSpec {
                directory: PathBuf::from(path),
                max_bytes: HTTP_CACHE_MIN_BYTES,
            }
            .validate()
        };
        assert_eq!(
            check(r"C:\Users\u~1\AppData\Local\app\http-cache\a\b"),
            Ok(())
        );
        assert_eq!(check(r"C:/Users/u/app/HTTP-Cache/a"), Ok(()));
        for rejected in [
            r"\\?\C:\Users\u\http-cache\a",
            r"\\server\share\http-cache\a",
            r"C:\Users\\http-cache\a",
            r"C:\Users\u\http-cache\a\",
            r"C:\Users\u\http-cache\a.",
            r"C:\Users\u\http-cache\a ",
            r"C:\Users\u\http-cache\a~1",
            r"C:\Users\u\http-cache\a:b",
            r"C:\Users\u\http-cache\a\.\b",
            r"C:\Users\u\http-cache\a\..\b",
            "C:\\Users\\u\\http-cache\\a\u{7}",
        ] {
            assert_eq!(check(rejected), Err(HttpCacheSpecError::Path), "{rejected}");
        }
    }

    // Compile-time proof that the spec cannot come from (or leak to) serde.
    // If either impl existed, the blanket impls would overlap and inference of
    // `_` would be ambiguous, failing the build (static_assertions technique).
    trait AmbiguousIfDeserialize<A> {
        fn check() {}
    }
    impl<T> AmbiguousIfDeserialize<()> for T {}
    impl<T: serde::de::DeserializeOwned> AmbiguousIfDeserialize<u8> for T {}
    trait AmbiguousIfSerialize<A> {
        fn check() {}
    }
    impl<T> AmbiguousIfSerialize<()> for T {}
    impl<T: serde::Serialize> AmbiguousIfSerialize<u8> for T {}

    #[test]
    fn spec_is_not_constructible_from_serde() {
        <HttpDiskCacheSpec as AmbiguousIfDeserialize<_>>::check();
        <HttpDiskCacheSpec as AmbiguousIfSerialize<_>>::check();
        // Control: the probe does detect a Deserialize type.
        fn is_deserialize<T: serde::de::DeserializeOwned>() {}
        is_deserialize::<String>();
    }

    #[test]
    fn release_signal_is_shared_one_shot_and_sendable() {
        fn is_send_sync<T: Send + Sync>() {}
        is_send_sync::<HttpCacheReleaseSignal>();
        let signal = HttpCacheReleaseSignal::default();
        let observer = signal.clone();
        assert!(!observer.is_released());
        assert!(signal.release());
        assert!(observer.is_released());
        assert!(!signal.release());
    }

    #[test]
    #[cfg(all(feature = "cef-host", target_pointer_width = "64"))]
    fn raw_layout_matches_c_h1_on_64_bit_targets() {
        assert_eq!(std::mem::size_of::<RawHttpCache>(), 32);
        assert_eq!(std::mem::offset_of!(RawHttpCache, reserved), 4);
        assert_eq!(std::mem::offset_of!(RawHttpCache, directory_utf8), 8);
        assert_eq!(std::mem::offset_of!(RawHttpCache, directory_length), 16);
        assert_eq!(std::mem::offset_of!(RawHttpCache, max_bytes), 24);
    }
}
