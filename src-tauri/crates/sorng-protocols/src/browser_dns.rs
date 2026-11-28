//! OS DNS shared by native browser transports. Caller deadlines bound admission
//! waits; a submitted OS lookup keeps its slot even if its caller is cancelled.

use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use tokio::sync::Semaphore;

const MAX_DNS_JOBS: usize = 16;
const MAX_RESOLVED_ADDRESSES: usize = 64;
static DNS_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

pub(crate) async fn resolve(authority: String) -> io::Result<Vec<SocketAddr>> {
    let slots = DNS_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(MAX_DNS_JOBS)))
        .clone();
    resolve_with(authority, slots, |authority| authority.to_socket_addrs()).await
}

// Private per-attempt caches never cross connection/database ownership. The
// process-wide generation invalidates all caches without exposing hostnames.
use crate::http::{ProxyAddressFamily, ProxyTransportSettings};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};
static CACHE_GENERATION: AtomicU64 = AtomicU64::new(0);
static CACHE_HITS: AtomicU64 = AtomicU64::new(0);
static CACHE_MISSES: AtomicU64 = AtomicU64::new(0);
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDnsStats {
    pub hits: u64,
    pub misses: u64,
    pub generation: u64,
}
pub fn stats() -> BrowserDnsStats {
    BrowserDnsStats {
        hits: CACHE_HITS.load(Ordering::Relaxed),
        misses: CACHE_MISSES.load(Ordering::Relaxed),
        generation: CACHE_GENERATION.load(Ordering::Acquire),
    }
}
pub fn clear_caches() {
    CACHE_GENERATION.fetch_add(1, Ordering::AcqRel);
}
struct Cache {
    generation: u64,
    entries: HashMap<String, (Instant, Vec<SocketAddr>)>,
}
#[derive(Clone)]
pub struct BrowserDnsResolver {
    settings: ProxyTransportSettings,
    cache: Arc<Mutex<Cache>>,
    slots: Arc<Semaphore>,
}
impl BrowserDnsResolver {
    pub fn new(settings: ProxyTransportSettings) -> Result<Self, String> {
        settings.validate()?;
        Ok(Self {
            settings,
            slots: Arc::new(Semaphore::new(settings.dns_concurrency)),
            cache: Arc::new(Mutex::new(Cache {
                generation: CACHE_GENERATION.load(Ordering::Acquire),
                entries: HashMap::new(),
            })),
        })
    }
    pub async fn lookup(&self, host: &str, port: u16) -> io::Result<Vec<SocketAddr>> {
        let slots = self.slots.clone();
        self.lookup_with(host, port, move |authority| async move {
            let local = slots.acquire_owned().await.map_err(|_| io::Error::other("Browser DNS resolver unavailable"))?;
            let global = DNS_SLOTS.get_or_init(|| Arc::new(Semaphore::new(MAX_DNS_JOBS))).clone();
            resolve_with(authority, global, move |authority| {
                let _local = local;
                authority.to_socket_addrs()
            }).await
        }).await
    }
    async fn lookup_with<F, Fut>(
        &self,
        host: &str,
        port: u16,
        lookup: F,
    ) -> io::Result<Vec<SocketAddr>>
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = io::Result<Vec<SocketAddr>>>,
    {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        if host.is_empty()
            || host.len() > 253
            || host
                .chars()
                .any(|c| c.is_control() || c.is_whitespace() || "/\\@?#".contains(c))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid DNS target",
            ));
        }
        let authority = if host.contains(':') {
            format!("[{host}]:{port}")
        } else {
            format!("{}:{port}", host.to_ascii_lowercase())
        };
        let generation = CACHE_GENERATION.load(Ordering::Acquire);
        if self.settings.dns_cache_ttl_seconds > 0 && host.parse::<std::net::IpAddr>().is_err() {
            let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
            if cache.generation != generation {
                cache.entries.clear();
                cache.generation = generation;
            }
            if let Some((expires, values)) = cache.entries.get(&authority) {
                if *expires > Instant::now() {
                    CACHE_HITS.fetch_add(1, Ordering::Relaxed);
                    return Ok(values.clone());
                }
            }
        }
        CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        let mut values = tokio::time::timeout(
            Duration::from_secs(self.settings.dns_timeout_seconds),
            lookup(authority.clone()),
        )
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Browser DNS deadline expired"))??;
        order_addresses(&mut values, self.settings.address_family);
        if values.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "No DNS addresses match the selected address family",
            ));
        }
        if self.settings.dns_cache_ttl_seconds > 0
            && host.parse::<std::net::IpAddr>().is_err()
            && CACHE_GENERATION.load(Ordering::Acquire) == generation
        {
            let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
            // A flush while a lookup was in flight must never resurrect its result.
            if cache.generation == generation
                && CACHE_GENERATION.load(Ordering::Acquire) == generation
            {
                cache
                    .entries
                    .retain(|_, (expires, _)| *expires > Instant::now());
                if cache.entries.len() >= self.settings.dns_cache_max_entries {
                    if let Some(oldest) = cache
                        .entries
                        .iter()
                        .min_by_key(|(_, (expires, _))| *expires)
                        .map(|(key, _)| key.clone())
                    {
                        cache.entries.remove(&oldest);
                    }
                }
                cache.entries.insert(
                    authority,
                    (
                        Instant::now() + Duration::from_secs(self.settings.dns_cache_ttl_seconds),
                        values.clone(),
                    ),
                );
            }
        }
        Ok(values)
    }
}
fn order_addresses(values: &mut Vec<SocketAddr>, family: ProxyAddressFamily) {
    match family {
        ProxyAddressFamily::System => (),
        ProxyAddressFamily::Ipv4First => values.sort_by_key(|v| !v.is_ipv4()),
        ProxyAddressFamily::Ipv6First => values.sort_by_key(|v| !v.is_ipv6()),
        ProxyAddressFamily::Ipv4Only => values.retain(SocketAddr::is_ipv4),
        ProxyAddressFamily::Ipv6Only => values.retain(SocketAddr::is_ipv6),
    }
}
impl reqwest::dns::Resolve for BrowserDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let this = self.clone();
        Box::pin(async move {
            let values = this.lookup(name.as_str(), 0).await?;
            Ok(Box::new(values.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

// Local semaphore and blocking-function injection keep tests synthetic and
// independent of the process-wide limiter and OS resolver configuration.
async fn resolve_with<F, I>(
    authority: String,
    slots: Arc<Semaphore>,
    lookup: F,
) -> io::Result<Vec<SocketAddr>>
where
    F: FnOnce(&str) -> io::Result<I> + Send + 'static,
    I: Iterator<Item = SocketAddr>,
{
    if let Ok(address) = authority.parse::<SocketAddr>() {
        return Ok(vec![address]);
    }

    // Wait BEFORE submitting to Tokio's blocking pool. At most MAX_DNS_JOBS
    // jobs can be queued/running there, including jobs whose callers left.
    // Waiting callers remain cancellable futures under their existing deadlines.
    let permit = slots
        .acquire_owned()
        .await
        .map_err(|_| io::Error::other("Browser DNS resolver unavailable"))?;
    tokio::task::spawn_blocking(move || {
        // The worker owns admission until OS resolution and bounded collection
        // finish, even when the JoinHandle is dropped or the worker unwinds.
        let _permit = permit;
        lookup(&authority)
            .map(|addresses| addresses.take(MAX_RESOLVED_ADDRESSES).collect())
            .map_err(|_| io::Error::other("Browser name resolution failed"))
    })
    .await
    .map_err(|_| io::Error::other("Browser DNS worker failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn configured_cache_is_scoped_bounded_expiring_and_flush_safe() {
        let settings = ProxyTransportSettings {
            dns_cache_ttl_seconds: 60,
            dns_cache_max_entries: 16,
            ..Default::default()
        };
        let resolver = BrowserDnsResolver::new(settings).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let lookup = |_: String| {
            count.fetch_add(1, Ordering::SeqCst);
            async { Ok(vec![address()]) }
        };
        resolver
            .lookup_with("cache.test", 443, lookup)
            .await
            .unwrap();
        resolver
            .lookup_with("cache.test", 443, lookup)
            .await
            .unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let other = BrowserDnsResolver::new(settings).unwrap();
        other.lookup_with("cache.test", 443, lookup).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
        resolver
            .cache
            .lock()
            .unwrap()
            .entries
            .get_mut("cache.test:443")
            .unwrap()
            .0 = Instant::now() - Duration::from_secs(1);
        resolver
            .lookup_with("cache.test", 443, lookup)
            .await
            .unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 3);
        clear_caches();
        resolver
            .lookup_with("cache.test", 443, lookup)
            .await
            .unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 4);
        resolver
            .lookup_with("in-flight.test", 443, |_: String| async {
                clear_caches();
                Ok(vec![address()])
            })
            .await
            .unwrap();
        assert!(!resolver
            .cache
            .lock()
            .unwrap()
            .entries
            .contains_key("in-flight.test:443"));
        for index in 0..20 {
            resolver
                .lookup_with(&format!("bounded-{index}.test"), 443, lookup)
                .await
                .unwrap();
        }
        assert_eq!(resolver.cache.lock().unwrap().entries.len(), 16);
        let uncached = BrowserDnsResolver::new(Default::default()).unwrap();
        uncached
            .lookup_with("uncached.test", 443, lookup)
            .await
            .unwrap();
        uncached
            .lookup_with("uncached.test", 443, lookup)
            .await
            .unwrap();
        assert!(uncached.cache.lock().unwrap().entries.is_empty());
    }
    #[test]
    fn configured_address_family_preserves_order_and_enforces_only_modes() {
        let values: Vec<SocketAddr> = ["[::1]:443", "127.0.0.2:443", "127.0.0.1:443", "[::2]:443"]
            .iter()
            .map(|v| v.parse().unwrap())
            .collect();
        let mut ordered = values.clone();
        order_addresses(&mut ordered, ProxyAddressFamily::Ipv4First);
        assert_eq!(ordered, [values[1], values[2], values[0], values[3]]);
        order_addresses(&mut ordered, ProxyAddressFamily::Ipv6Only);
        assert_eq!(ordered, [values[0], values[3]]);
    }

    const TEST_DEADLINE: Duration = Duration::from_secs(5);

    fn address() -> SocketAddr {
        "192.0.2.1:1080".parse().unwrap()
    }

    async fn within<T>(future: impl Future<Output = T>) -> T {
        tokio::time::timeout(TEST_DEADLINE, future)
            .await
            .expect("synthetic DNS fixture timed out")
    }

    // Every blocking fixture is released during unwinding as well as success.
    // recv_timeout is an additional bound if a fixture itself is broken.
    struct ReleaseOnDrop(Option<mpsc::Sender<()>>);

    impl ReleaseOnDrop {
        fn release(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    impl Drop for ReleaseOnDrop {
        fn drop(&mut self) {
            self.release();
        }
    }

    fn blocked_lookup() -> (
        ReleaseOnDrop,
        oneshot::Receiver<()>,
        impl FnOnce(&str) -> io::Result<std::iter::Once<SocketAddr>> + Send + 'static,
    ) {
        let (release_tx, release_rx) = mpsc::channel();
        let (started_tx, started_rx) = oneshot::channel();
        (ReleaseOnDrop(Some(release_tx)), started_rx, move |_| {
            let _ = started_tx.send(());
            release_rx
                .recv_timeout(TEST_DEADLINE)
                .map_err(|_| io::Error::other("Synthetic DNS gate closed"))?;
            Ok(std::iter::once(address()))
        })
    }

    #[tokio::test]
    async fn numeric_ipv4_and_ipv6_bypass_dns_and_admission() {
        let slots = Arc::new(Semaphore::new(0));
        slots.close();
        for authority in ["127.0.0.1:1080", "[::1]:1080", "[2001:db8::1]:443"] {
            let result = within(resolve_with(
                authority.into(),
                slots.clone(),
                |_| -> io::Result<std::iter::Empty<SocketAddr>> {
                    panic!("numeric address reached DNS")
                },
            ))
            .await
            .unwrap();
            assert_eq!(result, vec![authority.parse::<SocketAddr>().unwrap()]);
        }
    }

    #[tokio::test]
    async fn aborting_caller_keeps_slot_until_blocking_lookup_finishes() {
        let slots = Arc::new(Semaphore::new(1));
        let (mut release, started, lookup) = blocked_lookup();
        let caller = tokio::spawn(resolve_with(
            "proxy.invalid:1080".into(),
            slots.clone(),
            lookup,
        ));
        within(started).await.unwrap();
        assert_eq!(slots.available_permits(), 0);
        caller.abort();
        assert!(within(caller).await.unwrap_err().is_cancelled());
        assert_eq!(slots.available_permits(), 0);

        let calls = Arc::new(AtomicUsize::new(0));
        let called = calls.clone();
        let mut next = Box::pin(resolve_with(
            "next.invalid:1080".into(),
            slots.clone(),
            move |_| {
                called.fetch_add(1, Ordering::SeqCst);
                Ok(std::iter::once(address()))
            },
        ));
        assert!(futures_util::poll!(next.as_mut()).is_pending());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        release.release();
        assert_eq!(within(next).await.unwrap(), vec![address()]);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(slots.available_permits(), 1);
    }

    struct DroppedLookup(Arc<AtomicUsize>);

    #[tokio::test]
    async fn sixteen_cancelled_context_lookups_hold_global_budget_but_release_recovers_other_context(
    ) {
        let slots = Arc::new(Semaphore::new(MAX_DNS_JOBS));
        let mut releases = Vec::new();
        for _ in 0..MAX_DNS_JOBS {
            let (release, started, lookup) = blocked_lookup();
            releases.push(release);
            let caller = tokio::spawn(resolve_with(
                "context-a.invalid:443".into(),
                slots.clone(),
                lookup,
            ));
            within(started).await.unwrap();
            caller.abort();
            assert!(within(caller).await.unwrap_err().is_cancelled());
        }
        assert_eq!(slots.available_permits(), 0);
        let calls = Arc::new(AtomicUsize::new(0));
        let called = calls.clone();
        let mut other = Box::pin(resolve_with(
            "context-b.invalid:443".into(),
            slots.clone(),
            move |_| {
                called.fetch_add(1, Ordering::SeqCst);
                Ok(std::iter::once(address()))
            },
        ));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), other.as_mut())
                .await
                .is_err()
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        // Numeric destinations never need a DNS admission slot.
        assert_eq!(
            within(resolve_with(
                "127.0.0.1:443".into(),
                slots.clone(),
                |_| -> io::Result<std::iter::Empty<SocketAddr>> {
                    panic!("numeric route reached DNS")
                }
            ))
            .await
            .unwrap()
            .len(),
            1
        );
        releases[0].release();
        assert_eq!(within(other).await.unwrap(), vec![address()]);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        for release in &mut releases {
            release.release();
        }
        within(async {
            while slots.available_permits() != MAX_DNS_JOBS {
                tokio::task::yield_now().await;
            }
        })
        .await;
    }

    impl Drop for DroppedLookup {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn cancelled_admission_waiters_never_enter_the_blocking_queue() {
        let slots = Arc::new(Semaphore::new(2));
        let (mut release_a, started_a, lookup_a) = blocked_lookup();
        let (mut release_b, started_b, lookup_b) = blocked_lookup();
        let caller_a = tokio::spawn(resolve_with(
            "a.invalid:1080".into(),
            slots.clone(),
            lookup_a,
        ));
        let caller_b = tokio::spawn(resolve_with(
            "b.invalid:1080".into(),
            slots.clone(),
            lookup_b,
        ));
        within(started_a).await.unwrap();
        within(started_b).await.unwrap();
        assert_eq!(slots.available_permits(), 0);

        let calls = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let mut waiters = Vec::new();
        for _ in 0..64 {
            let calls = calls.clone();
            let guard = DroppedLookup(dropped.clone());
            let mut waiter = Box::pin(resolve_with(
                "waiting.invalid:1080".into(),
                slots.clone(),
                move |_| {
                    let _guard = guard;
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(std::iter::once(address()))
                },
            ));
            assert!(futures_util::poll!(waiter.as_mut()).is_pending());
            waiters.push(waiter);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(dropped.load(Ordering::SeqCst), 0);
        drop(waiters);
        // Immediate destruction proves no lookup closures were detached into
        // Tokio's queue; they were still owned by their admission futures.
        assert_eq!(dropped.load(Ordering::SeqCst), 64);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(slots.available_permits(), 0);
        release_a.release();
        release_b.release();
        within(caller_a).await.unwrap().unwrap();
        within(caller_b).await.unwrap().unwrap();
        assert_eq!(slots.available_permits(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
