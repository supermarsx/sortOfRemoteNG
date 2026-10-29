//! K3/K8: the proxy HTTP cache (owner: x3).
//!
//! Private browser cache (RFC 9111 via `http-cache-semantics`,
//! `shared: false`), per (database, connection), encrypted at rest.
//!
//! - `policy`: RFC 9111 decisions plus the app's storage rules;
//! - `crypto`: DEK wrapping and AES-256-GCM STREAM entry sealing;
//! - `store`: the encrypted on-disk store under `<connKey>/proxy-v1/`;
//! - `memory`: the per-attempt in-memory LRU.
//!
//! Concurrent attempts of one connection share one disk store through an
//! in-process registry keyed by directory; an attempt with a different
//! binding (or key) while another holds the store gets
//! `Memory(BindingMismatch)`. The cache never runs hooks and never logs
//! hosts, URLs or headers.

mod crypto;
mod memory;
mod policy;
mod store;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError, Weak};
use std::task::{Context, Poll};
use std::time::SystemTime;

use http_body_util::{BodyExt, Full};
use http_cache_semantics::{AfterResponse, BeforeRequest};
use hyper::body::{Body, Bytes, Frame, SizeHint};
use hyper::http::{self, header, Method, StatusCode};
use zeroize::Zeroizing;

use self::memory::MemoryStore;
use self::policy::{Entry, StoredHead};
use self::store::{DiskStore, ReadOutcome};
use super::{CacheCounters, CacheUse, MemoryCacheReason, ProxyBody};
use crate::private_forward_proxy::Authority;

/// In-memory cache size per attempt when the disk store is not used.
pub const DEFAULT_MEMORY_BYTES: u64 = 32 * 1024 * 1024;

/// Disk cache for one connection. No `Debug`/`Clone`: it carries the key.
pub struct DiskCacheConfig {
    /// `<connKey>/proxy-v1/` under the c3 lease.
    pub directory: PathBuf,
    pub max_bytes: u64,
    /// Per-connection cache master key (HKDF from the vault DEK).
    pub key: Zeroizing<[u8; 32]>,
    /// c3 `binding.v1` digest; a mismatch wipes the store.
    pub binding: [u8; 32],
}

pub enum CacheMode {
    Off,
    Memory { max_bytes: u64 },
    Disk(DiskCacheConfig),
}

type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

enum Backend {
    Off,
    Memory(Arc<MemoryStore>),
    Disk(Arc<DiskStore>),
}

#[derive(Default)]
struct Counters {
    hits: AtomicU64,
    misses: AtomicU64,
    revalidations: AtomicU64,
    stores: AtomicU64,
}

impl Counters {
    fn bump(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }
}

/// One attempt's cache handle.
// Wired by x1 (forward.rs); unused until then.
#[allow(dead_code)]
pub(crate) struct ProxyCache {
    backend: Backend,
    counters: Arc<Counters>,
    clock: Clock,
}

// Wired by x1 (forward.rs); unused until then.
#[allow(dead_code)]
pub(crate) enum CacheLookup {
    Fresh(http::Response<ProxyBody>),
    /// Send `conditional` upstream (it carries If-None-Match / If-Modified-Since); pass the result to `on_upstream`.
    Revalidate {
        conditional: http::request::Parts,
        token: RevalidateToken,
    },
    Miss,
}

/// The stored entry a revalidation refers to (opaque to callers).
pub(crate) struct RevalidateToken {
    key: String,
    entry: Box<Entry>,
}

type Registry = Mutex<HashMap<PathBuf, Weak<DiskStore>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

fn registry_path(dir: &std::path::Path) -> PathBuf {
    let _ = std::fs::create_dir_all(dir);
    std::fs::canonicalize(dir)
        .or_else(|_| std::path::absolute(dir))
        .unwrap_or_else(|_| dir.to_path_buf())
}

fn full_body(bytes: Bytes) -> ProxyBody {
    Full::new(bytes).map_err(|never| match never {}).boxed()
}

// Wired by x1 (forward.rs); unused until then.
#[allow(dead_code)]
impl ProxyCache {
    pub(crate) fn open(mode: CacheMode) -> (Arc<Self>, CacheUse) {
        Self::open_with_clock(mode, Arc::new(SystemTime::now))
    }

    fn open_with_clock(mode: CacheMode, clock: Clock) -> (Arc<Self>, CacheUse) {
        let (backend, used) = match mode {
            CacheMode::Off => (Backend::Off, CacheUse::Off),
            // The caller chose memory; it knows (and reports) the precise reason.
            CacheMode::Memory { max_bytes } => (
                Backend::Memory(Arc::new(MemoryStore::new(max_bytes))),
                CacheUse::Memory(MemoryCacheReason::Disabled),
            ),
            CacheMode::Disk(config) => Self::open_disk(config),
        };
        let cache = Self {
            backend,
            counters: Arc::default(),
            clock,
        };
        (Arc::new(cache), used)
    }

    fn open_disk(config: DiskCacheConfig) -> (Backend, CacheUse) {
        let memory = |reason| {
            (
                Backend::Memory(Arc::new(MemoryStore::new(DEFAULT_MEMORY_BYTES))),
                CacheUse::Memory(reason),
            )
        };
        if config.max_bytes == 0 {
            return memory(MemoryCacheReason::StoreUnavailable);
        }
        let path = registry_path(&config.directory);
        let mut registry = registry().lock().unwrap_or_else(PoisonError::into_inner);
        registry.retain(|_, store| store.strong_count() > 0);
        if let Some(existing) = registry.get(&path).and_then(Weak::upgrade) {
            return if existing.accepts(&config) {
                (Backend::Disk(existing), CacheUse::Disk)
            } else {
                memory(MemoryCacheReason::BindingMismatch)
            };
        }
        match DiskStore::open(&config, path.clone()) {
            Ok(store) => {
                let store = Arc::new(store);
                registry.insert(path, Arc::downgrade(&store));
                (Backend::Disk(store), CacheUse::Disk)
            }
            Err(_) => memory(MemoryCacheReason::StoreUnavailable),
        }
    }

    fn now(&self) -> SystemTime {
        (self.clock)()
    }

    fn entry_cap(&self) -> u64 {
        match &self.backend {
            Backend::Off => 0,
            Backend::Memory(m) => policy::per_entry_cap(m.max_bytes()),
            Backend::Disk(d) => policy::per_entry_cap(d.max_bytes()),
        }
    }

    async fn load(&self, key: &str) -> Option<Entry> {
        match &self.backend {
            Backend::Off => None,
            Backend::Memory(m) => m.get(key),
            Backend::Disk(d) => {
                let store = Arc::clone(d);
                let key = key.to_owned();
                match tokio::task::spawn_blocking(move || store.read(&key)).await {
                    Ok(ReadOutcome::Hit(entry)) => Some(*entry),
                    _ => None,
                }
            }
        }
    }

    async fn remove(&self, key: String) {
        match &self.backend {
            Backend::Off => {}
            Backend::Memory(m) => m.remove(&key),
            Backend::Disk(d) => {
                if d.contains(&key) {
                    let store = Arc::clone(d);
                    let _ = tokio::task::spawn_blocking(move || store.remove(&key)).await;
                }
            }
        }
    }

    pub(crate) async fn lookup(
        &self,
        authority: &Authority,
        req: &http::request::Parts,
    ) -> CacheLookup {
        if matches!(self.backend, Backend::Off) || !policy::request_cacheable(req) {
            return CacheLookup::Miss;
        }
        let key = policy::cache_key(authority, &req.method, &req.uri);
        let Some(entry) = self.load(&key).await else {
            Counters::bump(&self.counters.misses);
            return CacheLookup::Miss;
        };
        let cache_policy = policy::policy_for(&entry.head);
        let policy_req = policy::policy_request(req, &entry.head.res_headers);
        match cache_policy.before_request(&policy_req, self.now()) {
            BeforeRequest::Fresh(computed) => {
                Counters::bump(&self.counters.hits);
                CacheLookup::Fresh(serve(&entry, &computed.headers, &req.method))
            }
            BeforeRequest::Stale { request, matches }
                if matches && policy::has_validator(&entry.head.res_headers) =>
            {
                Counters::bump(&self.counters.revalidations);
                CacheLookup::Revalidate {
                    conditional: policy::conditional_request(req, &request),
                    token: RevalidateToken {
                        key,
                        entry: Box::new(entry),
                    },
                }
            }
            BeforeRequest::Stale { .. } => {
                Counters::bump(&self.counters.misses);
                CacheLookup::Miss
            }
        }
    }

    /// Every upstream response passes through here (304 merge, store-on-complete tee, unsafe-method invalidation).
    /// `persistent == false` (temporary admission) is never written to disk. Returns the response to serve.
    pub(crate) async fn on_upstream(
        &self,
        authority: &Authority,
        req: &http::request::Parts,
        token: Option<RevalidateToken>,
        resp: http::Response<ProxyBody>,
        persistent: bool,
    ) -> http::Response<ProxyBody> {
        if matches!(self.backend, Backend::Off) {
            return resp;
        }
        if !policy::is_safe(&req.method) {
            let status = resp.status();
            if status.is_success() || status.is_redirection() {
                for uri in policy::invalidation_targets(authority, req, resp.headers()) {
                    for method in [Method::GET, Method::HEAD] {
                        self.remove(policy::cache_key(authority, &method, &uri))
                            .await;
                    }
                }
            }
            return resp;
        }
        if !policy::request_cacheable(req) {
            return resp;
        }
        let may_store = persistent || !matches!(self.backend, Backend::Disk(_));
        let now = self.now();
        let (parts, body) = resp.into_parts();
        if let Some(token) = token {
            if parts.status == StatusCode::NOT_MODIFIED {
                let cache_policy = policy::policy_for(&token.entry.head);
                let policy_req = policy::policy_request(req, &token.entry.head.res_headers);
                if let AfterResponse::NotModified(..) =
                    cache_policy.after_response(&policy_req, &parts, now)
                {
                    return self.serve_not_modified(req, token, &parts, now, may_store);
                }
                // Not a validator we sent: the client's own conditional request.
                return http::Response::from_parts(parts, body);
            }
        }
        if parts.status == StatusCode::NOT_MODIFIED {
            return http::Response::from_parts(parts, body);
        }
        let key = policy::cache_key(authority, &req.method, &req.uri);
        let cap = self.entry_cap();
        let head = if may_store {
            policy::admit(req, &parts, now, cap)
        } else {
            None
        };
        let Some(head) = head else {
            // A response that may not be stored dooms what is stored for it.
            self.remove(key).await;
            return http::Response::from_parts(parts, body);
        };
        if req.method == Method::HEAD || parts.status == StatusCode::NO_CONTENT {
            // No body to tee (hyper never polls a HEAD/204 body).
            self.sink(true).store(
                key,
                Entry {
                    head,
                    body: Bytes::new(),
                },
            );
            return http::Response::from_parts(parts, body);
        }
        let expected = policy::content_length(&parts.headers);
        let sink = self.sink(true);
        if expected == Some(0) || (expected.is_none() && body.is_end_stream()) {
            // Empty body: hyper may never poll it, so store now.
            sink.store(
                key,
                Entry {
                    head,
                    body: Bytes::new(),
                },
            );
            return http::Response::from_parts(parts, body);
        }
        let commit: Commit = Box::new(move |body: Bytes| sink.store(key, Entry { head, body }));
        http::Response::from_parts(parts, TeeBody::new(body, cap, expected, commit).boxed())
    }

    fn serve_not_modified(
        &self,
        req: &http::request::Parts,
        token: RevalidateToken,
        not_modified: &http::response::Parts,
        now: SystemTime,
        may_store: bool,
    ) -> http::Response<ProxyBody> {
        let RevalidateToken { key, entry } = token;
        let res_headers =
            policy::merge_not_modified(&entry.head.res_headers, &not_modified.headers);
        let refreshed = Entry {
            head: StoredHead {
                res_headers,
                response_time: now,
                ..entry.head
            },
            body: entry.body,
        };
        let computed = match policy::policy_for(&refreshed.head).before_request(
            &policy::policy_request(req, &refreshed.head.res_headers),
            now,
        ) {
            BeforeRequest::Fresh(parts) => parts.headers,
            BeforeRequest::Stale { .. } => {
                let mut headers = http::HeaderMap::new();
                headers.insert(header::AGE, http::HeaderValue::from_static("0"));
                if let Some(date) = not_modified.headers.get(header::DATE) {
                    headers.insert(header::DATE, date.clone());
                }
                headers
            }
        };
        let mut served = serve(&refreshed, &computed, &req.method);
        // Cookies set on the 304 still reach the browser (never stored).
        for name in [
            header::SET_COOKIE,
            http::HeaderName::from_static("set-cookie2"),
        ] {
            for value in not_modified.headers.get_all(&name) {
                served.headers_mut().append(name.clone(), value.clone());
            }
        }
        if may_store {
            self.sink(false).store(key, refreshed);
        }
        served
    }

    fn sink(&self, counts_as_store: bool) -> Sink {
        Sink {
            target: match &self.backend {
                Backend::Off => SinkTarget::Off,
                Backend::Memory(m) => SinkTarget::Memory(Arc::clone(m)),
                Backend::Disk(d) => SinkTarget::Disk(Arc::clone(d)),
            },
            counters: counts_as_store.then(|| Arc::clone(&self.counters)),
        }
    }

    pub(crate) fn counters(&self) -> CacheCounters {
        CacheCounters {
            hits: self.counters.hits.load(Ordering::Relaxed),
            misses: self.counters.misses.load(Ordering::Relaxed),
            revalidations: self.counters.revalidations.load(Ordering::Relaxed),
            stores: self.counters.stores.load(Ordering::Relaxed),
        }
    }

    /// Waits for background disk writes (tests only).
    #[cfg(test)]
    async fn settle(&self) {
        if let Backend::Disk(d) = &self.backend {
            d.pending.settle().await;
        }
    }
}

fn serve(entry: &Entry, computed: &http::HeaderMap, method: &Method) -> http::Response<ProxyBody> {
    let body = if *method == Method::HEAD {
        Bytes::new()
    } else {
        entry.body.clone()
    };
    let mut resp = http::Response::new(full_body(body));
    *resp.status_mut() = entry.head.status;
    *resp.headers_mut() = policy::served_headers(&entry.head.res_headers, computed);
    resp
}

enum SinkTarget {
    Off,
    Memory(Arc<MemoryStore>),
    Disk(Arc<DiskStore>),
}

/// Where a completed body goes.
struct Sink {
    target: SinkTarget,
    counters: Option<Arc<Counters>>,
}

impl Sink {
    fn store(self, key: String, entry: Entry) {
        let Sink { target, counters } = self;
        let stored = move || {
            if let Some(counters) = &counters {
                Counters::bump(&counters.stores);
            }
        };
        match target {
            SinkTarget::Off => {}
            SinkTarget::Memory(m) => {
                if m.insert(key, entry) {
                    stored();
                }
            }
            SinkTarget::Disk(d) => {
                // Registered before spawning so `settle` waits for it.
                let ticket = DiskStore::begin_write(&d);
                let job = move || {
                    let _ticket = ticket;
                    if matches!(d.write(&key, &entry), Ok(true)) {
                        stored();
                    }
                };
                match tokio::runtime::Handle::try_current() {
                    Ok(handle) => {
                        handle.spawn_blocking(job);
                    }
                    Err(_) => job(),
                }
            }
        }
    }
}

type Commit = Box<dyn FnOnce(Bytes) + Send + Sync>;

/// Streams the upstream body through unchanged and hands a complete copy to
/// `commit`, unless it grew past `cap` (or past `Content-Length`), carried
/// trailers, failed, or was dropped first.
///
/// Complete means: the declared `Content-Length` was reached (the hyper
/// server stops polling a length-delimited body there and never sees the
/// end), or the inner body reports its end after a frame (h2, chunked), or
/// a `None` frame arrived without a length mismatch.
struct TeeBody {
    inner: ProxyBody,
    buf: Option<Vec<Bytes>>,
    len: u64,
    cap: u64,
    expected: Option<u64>,
    commit: Option<Commit>,
}

impl TeeBody {
    fn new(inner: ProxyBody, cap: u64, expected: Option<u64>, commit: Commit) -> Self {
        Self {
            inner,
            buf: Some(Vec::new()),
            len: 0,
            cap,
            expected,
            commit: Some(commit),
        }
    }

    fn abandon(&mut self) {
        self.buf = None;
        self.commit = None;
    }

    fn finish(&mut self) {
        if self.expected.is_some_and(|expected| expected != self.len) {
            self.abandon();
            return;
        }
        if let (Some(buf), Some(commit)) = (self.buf.take(), self.commit.take()) {
            let body = if buf.len() == 1 {
                buf.into_iter().next().unwrap_or_default()
            } else {
                Bytes::from(buf.concat())
            };
            commit(body);
        }
    }
}

impl Body for TeeBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        let this = &mut *self;
        match Pin::new(&mut this.inner).poll_frame(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Ok(frame))) => {
                if this.commit.is_some() {
                    match frame.data_ref() {
                        Some(data) => {
                            this.len += data.len() as u64;
                            if this.len > this.cap
                                || this.expected.is_some_and(|expected| this.len > expected)
                            {
                                this.abandon();
                            } else if let Some(buf) = &mut this.buf {
                                buf.push(data.clone());
                            }
                        }
                        None => this.abandon(),
                    }
                    if this.expected == Some(this.len) || this.inner.is_end_stream() {
                        this.finish();
                    }
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(err))) => {
                this.abandon();
                Poll::Ready(Some(Err(err)))
            }
            Poll::Ready(None) => {
                this.finish();
                Poll::Ready(None)
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}
