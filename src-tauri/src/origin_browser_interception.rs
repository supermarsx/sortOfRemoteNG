//! t-mitmproxy m4: how one browser attempt handles HTTPS, decided once
//! before its proxy and CEF context exist, and never switched afterwards.
//!
//! - "auto" on an engine that trusts a per-context CA
//!   (`CEF_SORNG_TLS_CAP_CUSTOM_CA`): the attempt's proxy terminates HTTPS
//!   with a fresh in-memory CA, the context trusts exactly that one anchor
//!   (`CustomOnly`), upstream trust is decided by the app in the proxy, and
//!   the page cache is the proxy's (encrypted disk under the c3 lease, else
//!   memory).
//! - "auto" without that capability, or when the CA cannot be created: the
//!   verified passthrough relay (Direct TLS) with the fixed diagnostic
//!   `interception-unavailable`.
//! - "off" (Direct TLS): today's verified passthrough relay and the CEF-side
//!   certificate evidence path, unchanged.
//!
//! Nothing here logs or exposes hosts, keys or paths.

use crate::origin_browser_observability::{HttpCacheDiagnostic, TlsInterceptionDiagnostic};
use sorng_browser_host::cef_tls_bridge::{NativeTlsCaMode, NativeTlsConfig};
use sorng_commands_core::origin_browser_authority::NativeTlsInterception;
use sorng_protocols::private_forward_proxy::intercept::{
    cache::{master_key_from_vault_dek, DEFAULT_MEMORY_BYTES},
    CacheMode, CacheUse, DiskCacheConfig, InterceptAuthority, MemoryCacheReason,
};
use std::sync::Arc;

/// The attempt's HTTPS handling. Built once before the session starts; the
/// CEF context configuration is derived from it, never re-decided.
pub(super) enum Plan {
    Intercept(Arc<InterceptAuthority>),
    Passthrough(TlsInterceptionDiagnostic),
}

impl Plan {
    /// `engine_custom_ca`: the loaded bridge advertises CUSTOM_CA. `generate`
    /// mints the attempt CA (`InterceptAuthority::generate` in production).
    pub(super) fn decide(
        preference: NativeTlsInterception,
        engine_custom_ca: bool,
        generate: impl FnOnce() -> std::io::Result<Arc<InterceptAuthority>>,
    ) -> Self {
        match preference {
            NativeTlsInterception::Off => Self::Passthrough(TlsInterceptionDiagnostic::Passthrough),
            NativeTlsInterception::Auto if !engine_custom_ca => {
                Self::Passthrough(TlsInterceptionDiagnostic::Unavailable)
            }
            NativeTlsInterception::Auto => match generate() {
                Ok(authority) => Self::Intercept(authority),
                Err(_) => Self::Passthrough(TlsInterceptionDiagnostic::Unavailable),
            },
        }
    }

    pub(super) fn diagnostic(&self) -> TlsInterceptionDiagnostic {
        match self {
            Self::Intercept(_) => TlsInterceptionDiagnostic::Active,
            Self::Passthrough(diagnostic) => *diagnostic,
        }
    }

    pub(super) fn authority(&self) -> Option<&Arc<InterceptAuthority>> {
        match self {
            Self::Intercept(authority) => Some(authority),
            Self::Passthrough(_) => None,
        }
    }
}

/// The attempt context's TLS configuration. Intercepting: CustomOnly with
/// exactly the attempt CA (no OS store, no Chrome roots). Passthrough: the
/// system verifier as before. Scoped exceptions stay required either way.
pub(super) fn context_tls_config(anchor: Option<&[u8]>) -> NativeTlsConfig {
    match anchor {
        Some(anchor) => NativeTlsConfig {
            ca_mode: NativeTlsCaMode::CustomOnly,
            trust_anchors: vec![anchor.to_vec()],
            require_scoped_exceptions: true,
        },
        None => NativeTlsConfig {
            require_scoped_exceptions: true,
            ..NativeTlsConfig::default()
        },
    }
}

/// What the proxy cache gets for an intercepting attempt, from the c3 lease
/// outcome and the vault DEK. The lease is returned to be held for the
/// attempt's lifetime; on any failure it is released and memory is used.
pub(super) fn cache_mode<L: LeaseView>(
    lease: Result<L, HttpCacheDiagnostic>,
    dek: Option<Vec<u8>>,
) -> (CacheMode, Option<L>, HttpCacheDiagnostic) {
    let memory = CacheMode::Memory {
        max_bytes: DEFAULT_MEMORY_BYTES,
    };
    let lease = match lease {
        Ok(lease) => lease,
        Err(reason) => return (memory, None, reason),
    };
    let Some(key) = dek.and_then(master_key_from_vault_dek) else {
        return (memory, None, HttpCacheDiagnostic::Unavailable);
    };
    let config = DiskCacheConfig {
        directory: lease.proxy_directory(),
        max_bytes: lease.max_bytes(),
        key,
        binding: lease.binding_digest(),
    };
    (
        CacheMode::Disk(config),
        Some(lease),
        HttpCacheDiagnostic::Disk,
    )
}

/// The diagnostic to record once the proxy opened its cache: the app's own
/// reason for memory, or the proxy's when a leased disk store failed.
pub(super) fn observed_cache(
    requested: HttpCacheDiagnostic,
    actual: Option<CacheUse>,
) -> HttpCacheDiagnostic {
    match (requested, actual) {
        (HttpCacheDiagnostic::Disk, Some(CacheUse::Disk)) => HttpCacheDiagnostic::Disk,
        (HttpCacheDiagnostic::Disk, Some(CacheUse::Memory(MemoryCacheReason::BindingMismatch))) => {
            HttpCacheDiagnostic::InUse
        }
        (HttpCacheDiagnostic::Disk, _) => HttpCacheDiagnostic::StoreUnavailable,
        (reason, _) => reason,
    }
}

/// The lease parts the proxy needs (c3 `CacheLease`; a fake in tests).
pub(super) trait LeaseView {
    fn proxy_directory(&self) -> std::path::PathBuf;
    fn max_bytes(&self) -> u64;
    fn binding_digest(&self) -> [u8; 32];
}

impl LeaseView for super::http_cache::CacheLease {
    fn proxy_directory(&self) -> std::path::PathBuf {
        self.directory()
    }
    fn max_bytes(&self) -> u64 {
        super::http_cache::CacheLease::max_bytes(self)
    }
    fn binding_digest(&self) -> [u8; 32] {
        super::http_cache::CacheLease::binding_digest(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn generated() -> std::io::Result<Arc<InterceptAuthority>> {
        InterceptAuthority::generate()
    }

    #[test]
    fn auto_intercepts_only_on_a_custom_ca_engine_and_off_keeps_direct_tls() {
        use NativeTlsInterception::{Auto, Off};
        let minted = AtomicUsize::new(0);
        let count = || {
            minted.fetch_add(1, Ordering::SeqCst);
            generated()
        };
        assert!(matches!(
            Plan::decide(Auto, true, count),
            Plan::Intercept(_)
        ));
        assert_eq!(
            Plan::decide(Auto, true, generated).diagnostic(),
            TlsInterceptionDiagnostic::Active
        );
        // Direct TLS by setting: the old verified path, no CA minted.
        let off = Plan::decide(Off, true, || unreachable!("no CA for Direct TLS"));
        assert_eq!(off.diagnostic(), TlsInterceptionDiagnostic::Passthrough);
        assert!(off.authority().is_none());
        assert_eq!(
            Plan::decide(Off, false, || unreachable!()).diagnostic(),
            TlsInterceptionDiagnostic::Passthrough
        );
        // Engine without CUSTOM_CA: passthrough plus the fixed diagnostic.
        let unavailable = Plan::decide(Auto, false, || unreachable!("never minted"));
        assert_eq!(
            unavailable.diagnostic(),
            TlsInterceptionDiagnostic::Unavailable
        );
        assert_eq!(
            unavailable.diagnostic().as_str(),
            "interception-unavailable"
        );
        // A CA that cannot be created never fails the attempt mid-way.
        let failed = Plan::decide(Auto, true, || Err(std::io::Error::other("rng")));
        assert_eq!(failed.diagnostic(), TlsInterceptionDiagnostic::Unavailable);
        assert_eq!(minted.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn intercepting_context_is_custom_only_with_exactly_the_attempt_anchor() {
        let plan = Plan::decide(NativeTlsInterception::Auto, true, generated);
        let authority = plan.authority().expect("intercepting").clone();
        let config = context_tls_config(plan.authority().map(|a| a.anchor_der()));
        assert_eq!(config.ca_mode, NativeTlsCaMode::CustomOnly);
        assert_eq!(config.trust_anchors, vec![authority.anchor_der().to_vec()]);
        assert!(config.require_scoped_exceptions);
        // Each attempt gets its own CA: another attempt's anchor differs.
        let other = Plan::decide(NativeTlsInterception::Auto, true, generated);
        assert_ne!(
            context_tls_config(other.authority().map(|a| a.anchor_der())).trust_anchors,
            config.trust_anchors
        );
    }

    #[test]
    fn passthrough_context_keeps_the_system_verifier_with_scoped_exceptions() {
        for preference in [NativeTlsInterception::Off, NativeTlsInterception::Auto] {
            let plan = Plan::decide(preference, false, generated);
            let config = context_tls_config(plan.authority().map(|a| a.anchor_der()));
            assert_eq!(config.ca_mode, NativeTlsCaMode::System);
            assert!(config.trust_anchors.is_empty());
            assert!(config.require_scoped_exceptions);
        }
    }

    struct FakeLease {
        released: Arc<AtomicUsize>,
    }
    impl Drop for FakeLease {
        fn drop(&mut self) {
            self.released.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl LeaseView for FakeLease {
        fn proxy_directory(&self) -> PathBuf {
            PathBuf::from("conn").join("proxy-v1")
        }
        fn max_bytes(&self) -> u64 {
            64 << 20
        }
        fn binding_digest(&self) -> [u8; 32] {
            [9; 32]
        }
    }

    #[test]
    fn a_disk_lease_feeds_the_proxy_store_with_the_derived_key() {
        let released = Arc::new(AtomicUsize::new(0));
        let dek = vec![5u8; 32];
        let (mode, lease, diagnostic) = cache_mode(
            Ok(FakeLease {
                released: released.clone(),
            }),
            Some(dek.clone()),
        );
        assert_eq!(diagnostic, HttpCacheDiagnostic::Disk);
        let CacheMode::Disk(config) = mode else {
            panic!("disk")
        };
        assert_eq!(config.directory, PathBuf::from("conn").join("proxy-v1"));
        assert_eq!(config.max_bytes, 64 << 20);
        assert_eq!(config.binding, [9; 32]);
        assert_eq!(
            *config.key,
            *master_key_from_vault_dek(dek.clone()).unwrap()
        );
        assert_ne!(config.key.as_slice(), dek.as_slice());
        // Held for the attempt; released when the attempt drops it.
        assert_eq!(released.load(Ordering::SeqCst), 0);
        drop(lease);
        assert_eq!(released.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn without_a_lease_or_a_dek_the_proxy_uses_memory_and_releases_the_lease() {
        let (mode, lease, diagnostic) =
            cache_mode::<FakeLease>(Err(HttpCacheDiagnostic::InUse), Some(vec![1; 32]));
        assert!(matches!(mode, CacheMode::Memory { max_bytes } if max_bytes == 32 * 1024 * 1024));
        assert!(lease.is_none());
        assert_eq!(diagnostic, HttpCacheDiagnostic::InUse);
        for dek in [None, Some(Vec::new()), Some(vec![1; 16])] {
            let released = Arc::new(AtomicUsize::new(0));
            let (mode, lease, diagnostic) = cache_mode(
                Ok(FakeLease {
                    released: released.clone(),
                }),
                dek,
            );
            assert!(matches!(mode, CacheMode::Memory { .. }));
            assert!(lease.is_none());
            assert_eq!(released.load(Ordering::SeqCst), 1, "released at once");
            assert_eq!(diagnostic, HttpCacheDiagnostic::Unavailable);
        }
    }

    #[test]
    fn the_recorded_cache_reason_is_the_real_one() {
        use HttpCacheDiagnostic as D;
        assert_eq!(observed_cache(D::Disk, Some(CacheUse::Disk)), D::Disk);
        assert_eq!(
            observed_cache(
                D::Disk,
                Some(CacheUse::Memory(MemoryCacheReason::StoreUnavailable))
            ),
            D::StoreUnavailable
        );
        assert_eq!(
            observed_cache(
                D::Disk,
                Some(CacheUse::Memory(MemoryCacheReason::BindingMismatch))
            ),
            D::InUse
        );
        // The proxy reports Memory(Disabled) for any memory mode; the app
        // overwrites it with why the disk was not leased.
        for reason in [
            D::Disabled,
            D::NotLocal,
            D::EngineUnsupported,
            D::InUse,
            D::DeletePending,
            D::Unavailable,
        ] {
            assert_eq!(
                observed_cache(reason, Some(CacheUse::Memory(MemoryCacheReason::Disabled))),
                reason
            );
        }
    }
}
