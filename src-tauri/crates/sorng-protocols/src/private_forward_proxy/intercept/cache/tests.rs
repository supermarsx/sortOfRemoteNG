//! Proxy cache tests (x3): RFC 9111 table, app storage rules, LRU and caps,
//! encryption at rest, binding handling and store sharing.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::time::{Duration, UNIX_EPOCH};

use http_body_util::StreamBody;
use hyper::http::{HeaderMap, HeaderName, HeaderValue, Uri};

use super::*;

// ---- fixtures ----

const HOST: &str = "secret-host-marker.example";

struct TestClock {
    base: SystemTime,
    offset: Arc<AtomicU64>,
}

impl TestClock {
    fn new() -> Self {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        Self {
            base: UNIX_EPOCH + Duration::from_secs(now.as_secs()),
            offset: Arc::new(AtomicU64::new(0)),
        }
    }
    fn clock(&self) -> Clock {
        let base = self.base;
        let offset = Arc::clone(&self.offset);
        Arc::new(move || base + Duration::from_secs(offset.load(Ordering::SeqCst)))
    }
    fn now(&self) -> SystemTime {
        self.base + Duration::from_secs(self.offset.load(Ordering::SeqCst))
    }
    fn advance(&self, secs: u64) {
        self.offset.fetch_add(secs, Ordering::SeqCst);
    }
    fn date(&self, delta_secs: i64) -> String {
        let t = if delta_secs >= 0 {
            self.now() + Duration::from_secs(delta_secs as u64)
        } else {
            self.now() - Duration::from_secs(delta_secs.unsigned_abs())
        };
        chrono::DateTime::<chrono::Utc>::from(t)
            .format("%a, %d %b %Y %H:%M:%S GMT")
            .to_string()
    }
}

fn authority() -> Authority {
    Authority::parse(&format!("{HOST}:443")).unwrap()
}

fn headers(list: &[(&str, &str)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (n, v) in list {
        map.append(
            HeaderName::from_bytes(n.as_bytes()).unwrap(),
            HeaderValue::from_str(v).unwrap(),
        );
    }
    map
}

fn req(method: Method, uri: &str, list: &[(&str, &str)]) -> http::request::Parts {
    let (mut parts, ()) = http::Request::new(()).into_parts();
    parts.method = method;
    parts.uri = uri.parse().unwrap();
    parts.headers = headers(list);
    parts
}

fn get(uri: &str) -> http::request::Parts {
    req(Method::GET, uri, &[])
}

fn resp(status: u16, list: &[(&str, &str)], body: &[u8]) -> http::Response<ProxyBody> {
    let mut r = http::Response::new(full_body(Bytes::copy_from_slice(body)));
    *r.status_mut() = StatusCode::from_u16(status).unwrap();
    *r.headers_mut() = headers(list);
    r
}

/// A body without a known length, delivered in several frames.
fn chunked(status: u16, list: &[(&str, &str)], chunks: Vec<Vec<u8>>) -> http::Response<ProxyBody> {
    let frames = chunks
        .into_iter()
        .map(|c| Ok::<_, std::io::Error>(Frame::data(Bytes::from(c))));
    let body = StreamBody::new(futures_util::stream::iter(frames)).boxed();
    let mut r = http::Response::new(body);
    *r.status_mut() = StatusCode::from_u16(status).unwrap();
    *r.headers_mut() = headers(list);
    r
}

struct Served {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

async fn read(r: http::Response<ProxyBody>) -> Result<Served, std::io::Error> {
    let (parts, body) = r.into_parts();
    let body = body.collect().await?.to_bytes();
    Ok(Served {
        status: parts.status,
        headers: parts.headers,
        body,
    })
}

/// One full upstream exchange through the cache (no revalidation token).
async fn exchange(
    cache: &ProxyCache,
    request: &http::request::Parts,
    response: http::Response<ProxyBody>,
    persistent: bool,
) -> Served {
    let served = cache
        .on_upstream(&authority(), request, None, response, persistent)
        .await;
    let served = read(served).await.expect("body");
    cache.settle().await;
    served
}

async fn store(cache: &ProxyCache, uri: &str, list: &[(&str, &str)], body: &[u8]) {
    exchange(cache, &get(uri), resp(200, list, body), true).await;
}

#[allow(clippy::large_enum_variant)]
enum Kind {
    Fresh(Served),
    Revalidate(http::request::Parts, RevalidateToken),
    Miss,
}

async fn look(cache: &ProxyCache, request: &http::request::Parts) -> Kind {
    match cache.lookup(&authority(), request).await {
        CacheLookup::Fresh(r) => Kind::Fresh(read(r).await.unwrap()),
        CacheLookup::Revalidate { conditional, token } => Kind::Revalidate(conditional, token),
        CacheLookup::Miss => Kind::Miss,
    }
}

async fn is_fresh(cache: &ProxyCache, request: &http::request::Parts) -> bool {
    matches!(look(cache, request).await, Kind::Fresh(_))
}

async fn is_miss(cache: &ProxyCache, request: &http::request::Parts) -> bool {
    matches!(look(cache, request).await, Kind::Miss)
}

fn memory(clock: &TestClock) -> Arc<ProxyCache> {
    memory_sized(clock, DEFAULT_MEMORY_BYTES)
}

fn memory_sized(clock: &TestClock, max_bytes: u64) -> Arc<ProxyCache> {
    ProxyCache::open_with_clock(CacheMode::Memory { max_bytes }, clock.clock()).0
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let mut suffix = [0u8; 8];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut suffix);
        let path = std::env::temp_dir()
            .join("sorng-proxy-cache-tests")
            .join(format!("{tag}-{}", hex::encode(suffix)))
            .join("proxy-v1");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        if let Some(parent) = self.0.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }
}

fn disk_mode(dir: &Path, max_bytes: u64, key: u8, binding: u8) -> CacheMode {
    CacheMode::Disk(DiskCacheConfig {
        directory: dir.to_path_buf(),
        max_bytes,
        key: Zeroizing::new([key; 32]),
        binding: [binding; 32],
    })
}

fn disk(clock: &TestClock, dir: &Path, key: u8, binding: u8) -> (Arc<ProxyCache>, CacheUse) {
    ProxyCache::open_with_clock(
        disk_mode(dir, 128 * 1024 * 1024, key, binding),
        clock.clock(),
    )
}

fn disk_store(cache: &ProxyCache) -> &Arc<DiskStore> {
    match &cache.backend {
        Backend::Disk(d) => d,
        _ => panic!("not a disk cache"),
    }
}

fn key(method: Method, uri: &str) -> String {
    policy::cache_key(&authority(), &method, &uri.parse::<Uri>().unwrap())
}

fn entry_files(dir: &Path) -> Vec<PathBuf> {
    match std::fs::read_dir(dir.join("e")) {
        Ok(items) => items.map(|i| i.unwrap().path()).collect(),
        Err(_) => Vec::new(),
    }
}

fn all_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for item in std::fs::read_dir(&d).unwrap() {
            let path = item.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

// ---- RFC 9111 table ----

#[tokio::test]
async fn max_age_is_fresh_then_revalidates_with_etag() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/a",
        &[("cache-control", "max-age=60"), ("etag", "\"v1\"")],
        b"alpha",
    )
    .await;
    match look(&cache, &get("/a")).await {
        Kind::Fresh(s) => {
            assert_eq!(s.status, StatusCode::OK);
            assert_eq!(&s.body[..], b"alpha");
            assert!(s.headers.contains_key("age"));
        }
        _ => panic!("expected fresh"),
    }
    clock.advance(61);
    match look(&cache, &get("/a")).await {
        Kind::Revalidate(cond, _) => {
            assert_eq!(cond.headers.get("if-none-match").unwrap(), "\"v1\"");
            assert_eq!(cond.uri, "/a");
        }
        _ => panic!("expected revalidate"),
    }
    let c = cache.counters();
    assert_eq!((c.hits, c.revalidations, c.stores), (1, 1, 1));
}

#[tokio::test]
async fn max_age_without_validator_expires_to_miss() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(&cache, "/a", &[("cache-control", "max-age=60")], b"alpha").await;
    assert!(is_fresh(&cache, &get("/a")).await);
    clock.advance(61);
    assert!(is_miss(&cache, &get("/a")).await);
}

#[tokio::test]
async fn s_maxage_is_ignored_by_a_private_cache() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(&cache, "/s", &[("cache-control", "s-maxage=600")], b"x").await;
    assert!(
        is_miss(&cache, &get("/s")).await,
        "no private freshness, no validator"
    );
    store(
        &cache,
        "/t",
        &[
            ("cache-control", "s-maxage=600, max-age=0"),
            ("etag", "\"e\""),
        ],
        b"x",
    )
    .await;
    assert!(matches!(
        look(&cache, &get("/t")).await,
        Kind::Revalidate(..)
    ));
}

#[tokio::test]
async fn expires_sets_freshness() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let (date, expires) = (clock.date(0), clock.date(3600));
    store(
        &cache,
        "/e",
        &[("date", &date), ("expires", &expires)],
        b"x",
    )
    .await;
    clock.advance(1800);
    assert!(is_fresh(&cache, &get("/e")).await);
    clock.advance(1900);
    assert!(is_miss(&cache, &get("/e")).await);
}

#[tokio::test]
async fn heuristic_freshness_from_last_modified() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let (date, lm) = (clock.date(0), clock.date(-10 * 86_400));
    store(
        &cache,
        "/h",
        &[("date", &date), ("last-modified", &lm)],
        b"x",
    )
    .await;
    // 10% of 10 days = 1 day.
    clock.advance(3600);
    assert!(is_fresh(&cache, &get("/h")).await);
    clock.advance(2 * 86_400);
    match look(&cache, &get("/h")).await {
        Kind::Revalidate(cond, _) => {
            assert_eq!(cond.headers.get("if-modified-since").unwrap(), lm.as_str())
        }
        _ => panic!("expected revalidate"),
    }
}

#[tokio::test]
async fn no_cache_response_always_revalidates() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/n",
        &[("cache-control", "no-cache"), ("etag", "\"n\"")],
        b"x",
    )
    .await;
    assert!(matches!(
        look(&cache, &get("/n")).await,
        Kind::Revalidate(..)
    ));
}

#[tokio::test]
async fn request_no_cache_forces_revalidation() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/n",
        &[("cache-control", "max-age=600"), ("etag", "\"n\"")],
        b"x",
    )
    .await;
    let r = req(Method::GET, "/n", &[("cache-control", "no-cache")]);
    assert!(matches!(look(&cache, &r).await, Kind::Revalidate(..)));
    assert!(is_fresh(&cache, &get("/n")).await);
}

#[tokio::test]
async fn no_store_on_request_or_response_is_not_stored() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/r",
        &[("cache-control", "no-store, max-age=60")],
        b"x",
    )
    .await;
    assert!(is_miss(&cache, &get("/r")).await);
    let r = req(Method::GET, "/q", &[("cache-control", "no-store")]);
    exchange(
        &cache,
        &r,
        resp(200, &[("cache-control", "max-age=60")], b"x"),
        true,
    )
    .await;
    assert!(is_miss(&cache, &get("/q")).await);
    assert_eq!(cache.counters().stores, 0);
}

#[tokio::test]
async fn private_responses_are_stored() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/p",
        &[("cache-control", "private, max-age=60")],
        b"x",
    )
    .await;
    assert!(is_fresh(&cache, &get("/p")).await);
}

#[tokio::test]
async fn authorization_requires_public_s_maxage_or_must_revalidate() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let auth = |uri: &str| req(Method::GET, uri, &[("authorization", "Basic dXNlcjpwYXNz")]);
    for (uri, cc, stored) in [
        ("/a1", "max-age=60", false),
        ("/a2", "private, max-age=60", false),
        ("/a3", "public, max-age=60", true),
        ("/a4", "must-revalidate, max-age=60", true),
        ("/a5", "s-maxage=60, max-age=60", true),
    ] {
        exchange(
            &cache,
            &auth(uri),
            resp(200, &[("cache-control", cc)], b"x"),
            true,
        )
        .await;
        assert_eq!(is_fresh(&cache, &auth(uri)).await, stored, "{cc}");
    }
}

#[tokio::test]
async fn set_cookie_requires_public_and_is_stripped_from_storage() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let first = exchange(
        &cache,
        &get("/c1"),
        resp(
            200,
            &[("cache-control", "max-age=60"), ("set-cookie", "sid=1")],
            b"x",
        ),
        true,
    )
    .await;
    assert_eq!(first.headers.get("set-cookie").unwrap(), "sid=1");
    assert!(is_miss(&cache, &get("/c1")).await);

    let first = exchange(
        &cache,
        &get("/c2"),
        resp(
            200,
            &[
                ("cache-control", "public, max-age=60"),
                ("set-cookie", "sid=2"),
                ("set-cookie2", "old=1"),
            ],
            b"x",
        ),
        true,
    )
    .await;
    assert_eq!(
        first.headers.get("set-cookie").unwrap(),
        "sid=2",
        "browser still gets it"
    );
    match look(&cache, &get("/c2")).await {
        Kind::Fresh(s) => {
            assert!(!s.headers.contains_key("set-cookie"));
            assert!(!s.headers.contains_key("set-cookie2"));
        }
        _ => panic!("expected fresh"),
    }
}

#[tokio::test]
async fn vary_matches_and_mismatches() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let en = req(Method::GET, "/v", &[("accept-language", "en")]);
    let de = req(Method::GET, "/v", &[("accept-language", "de")]);
    exchange(
        &cache,
        &en,
        resp(
            200,
            &[("cache-control", "max-age=60"), ("vary", "Accept-Language")],
            b"en",
        ),
        true,
    )
    .await;
    assert!(is_fresh(&cache, &en).await);
    assert!(is_miss(&cache, &de).await);
    assert!(is_miss(&cache, &get("/v")).await);
}

#[tokio::test]
async fn etag_304_merges_headers_and_serves_stored_body() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/m",
        &[
            ("cache-control", "max-age=0"),
            ("etag", "\"v1\""),
            ("x-meta", "old"),
            ("content-type", "text/plain"),
            ("content-length", "6"),
        ],
        b"stored",
    )
    .await;
    clock.advance(5);
    let Kind::Revalidate(cond, token) = look(&cache, &get("/m")).await else {
        panic!("expected revalidate");
    };
    assert_eq!(cond.headers.get("if-none-match").unwrap(), "\"v1\"");
    let not_modified = resp(
        304,
        &[
            ("etag", "\"v1\""),
            ("cache-control", "max-age=100"),
            ("x-meta", "new"),
            ("content-length", "0"),
            ("set-cookie", "s=1"),
        ],
        b"",
    );
    let served = cache
        .on_upstream(&authority(), &get("/m"), Some(token), not_modified, true)
        .await;
    let served = read(served).await.unwrap();
    cache.settle().await;
    assert_eq!(served.status, StatusCode::OK);
    assert_eq!(&served.body[..], b"stored");
    assert_eq!(served.headers.get("x-meta").unwrap(), "new");
    assert_eq!(served.headers.get("content-length").unwrap(), "6");
    assert_eq!(served.headers.get("set-cookie").unwrap(), "s=1");
    match look(&cache, &get("/m")).await {
        Kind::Fresh(s) => {
            assert_eq!(s.headers.get("x-meta").unwrap(), "new");
            assert!(!s.headers.contains_key("set-cookie"));
        }
        _ => panic!("merged entry must now be fresh"),
    }
}

#[tokio::test]
async fn foreign_304_passes_through() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/m",
        &[("cache-control", "no-cache"), ("etag", "\"mine\"")],
        b"x",
    )
    .await;
    let Kind::Revalidate(_, token) = look(&cache, &get("/m")).await else {
        panic!("expected revalidate");
    };
    let served = cache
        .on_upstream(
            &authority(),
            &get("/m"),
            Some(token),
            resp(304, &[("etag", "\"browser-own\"")], b""),
            true,
        )
        .await;
    assert_eq!(served.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn last_modified_revalidation() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let lm = clock.date(-3600);
    store(
        &cache,
        "/l",
        &[("cache-control", "max-age=0"), ("last-modified", &lm)],
        b"lm",
    )
    .await;
    let Kind::Revalidate(cond, token) = look(&cache, &get("/l")).await else {
        panic!("expected revalidate");
    };
    assert_eq!(cond.headers.get("if-modified-since").unwrap(), lm.as_str());
    assert!(!cond.headers.contains_key("if-none-match"));
    let served = cache
        .on_upstream(
            &authority(),
            &get("/l"),
            Some(token),
            resp(304, &[("last-modified", &lm)], b""),
            true,
        )
        .await;
    let served = read(served).await.unwrap();
    assert_eq!(served.status, StatusCode::OK);
    assert_eq!(&served.body[..], b"lm");
}

#[tokio::test]
async fn revalidation_with_new_200_replaces_entry() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/r",
        &[("cache-control", "no-cache"), ("etag", "\"1\"")],
        b"one",
    )
    .await;
    let Kind::Revalidate(_, token) = look(&cache, &get("/r")).await else {
        panic!("expected revalidate");
    };
    let served = cache
        .on_upstream(
            &authority(),
            &get("/r"),
            Some(token),
            resp(
                200,
                &[("cache-control", "max-age=60"), ("etag", "\"2\"")],
                b"two",
            ),
            true,
        )
        .await;
    assert_eq!(&read(served).await.unwrap().body[..], b"two");
    match look(&cache, &get("/r")).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"two"),
        _ => panic!("expected fresh"),
    }
}

#[tokio::test]
async fn unsafe_methods_invalidate_on_success_only() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    for uri in ["/a", "/done", "/kept"] {
        store(&cache, uri, &[("cache-control", "max-age=60")], b"x").await;
    }
    let post = req(Method::POST, "/a", &[]);
    exchange(
        &cache,
        &post,
        resp(303, &[("location", "/done")], b""),
        true,
    )
    .await;
    assert!(is_miss(&cache, &get("/a")).await);
    assert!(is_miss(&cache, &get("/done")).await);
    let failed = req(Method::DELETE, "/kept", &[]);
    exchange(&cache, &failed, resp(500, &[], b""), true).await;
    assert!(is_fresh(&cache, &get("/kept")).await);
    let put = req(Method::PUT, "/kept", &[]);
    exchange(&cache, &put, resp(204, &[], b""), true).await;
    assert!(is_miss(&cache, &get("/kept")).await);
}

#[tokio::test]
async fn head_is_stored_and_served_without_body() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let head = req(Method::HEAD, "/h", &[]);
    exchange(
        &cache,
        &head,
        resp(
            200,
            &[("cache-control", "max-age=60"), ("content-length", "10")],
            b"",
        ),
        true,
    )
    .await;
    match look(&cache, &head).await {
        Kind::Fresh(s) => {
            assert!(s.body.is_empty());
            assert_eq!(s.headers.get("content-length").unwrap(), "10");
        }
        _ => panic!("expected fresh"),
    }
    assert!(is_miss(&cache, &get("/h")).await, "HEAD never answers GET");
}

// ---- app rules ----

#[tokio::test]
async fn partial_content_and_range_requests_are_skipped() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    exchange(
        &cache,
        &get("/r"),
        resp(
            206,
            &[
                ("cache-control", "max-age=60"),
                ("content-range", "bytes 0-0/10"),
            ],
            b"x",
        ),
        true,
    )
    .await;
    assert!(is_miss(&cache, &get("/r")).await);
    store(
        &cache,
        "/full",
        &[("cache-control", "max-age=60")],
        b"0123456789",
    )
    .await;
    let ranged = req(Method::GET, "/full", &[("range", "bytes=0-1")]);
    assert!(
        is_miss(&cache, &ranged).await,
        "range requests bypass the cache"
    );
    exchange(
        &cache,
        &ranged,
        resp(200, &[("cache-control", "max-age=60")], b"zz"),
        true,
    )
    .await;
    match look(&cache, &get("/full")).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"0123456789"),
        _ => panic!("ranged exchange must not touch the entry"),
    }
}

#[tokio::test]
async fn event_streams_and_upgrades_are_skipped() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/sse",
        &[
            ("cache-control", "max-age=60"),
            ("content-type", "text/event-stream; charset=utf-8"),
        ],
        b"data: 1\n\n",
    )
    .await;
    assert!(is_miss(&cache, &get("/sse")).await);
    let ws = req(
        Method::GET,
        "/ws",
        &[
            ("upgrade", "websocket"),
            ("sec-websocket-key", "dGhlIHNhbXBsZQ=="),
        ],
    );
    exchange(
        &cache,
        &ws,
        resp(200, &[("cache-control", "max-age=60")], b"x"),
        true,
    )
    .await;
    assert!(is_miss(&cache, &get("/ws")).await);
    assert_eq!(cache.counters().stores, 0);
}

#[tokio::test]
async fn per_entry_limit_applies_with_and_without_length() {
    let clock = TestClock::new();
    let cache = memory_sized(&clock, 8192); // per-entry cap 1024
    let big = vec![b'b'; 2000];
    store(
        &cache,
        "/len",
        &[("cache-control", "max-age=60"), ("content-length", "2000")],
        &big,
    )
    .await;
    assert!(is_miss(&cache, &get("/len")).await);
    let served = exchange(
        &cache,
        &get("/chunked"),
        chunked(
            200,
            &[("cache-control", "max-age=60")],
            vec![vec![1; 700], vec![2; 700]],
        ),
        true,
    )
    .await;
    assert_eq!(served.body.len(), 1400, "the browser still gets everything");
    assert!(is_miss(&cache, &get("/chunked")).await);
    exchange(
        &cache,
        &get("/ok"),
        chunked(
            200,
            &[("cache-control", "max-age=60")],
            vec![vec![1; 500], vec![2; 500]],
        ),
        true,
    )
    .await;
    match look(&cache, &get("/ok")).await {
        Kind::Fresh(s) => assert_eq!(s.body.len(), 1000),
        _ => panic!("expected fresh"),
    }
}

#[tokio::test]
async fn truncated_or_failed_bodies_are_not_stored() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    store(
        &cache,
        "/short",
        &[("cache-control", "max-age=60"), ("content-length", "100")],
        b"half",
    )
    .await;
    assert!(is_miss(&cache, &get("/short")).await);
    let frames = vec![
        Ok(Frame::data(Bytes::from_static(b"part"))),
        Err(std::io::Error::other("reset")),
    ];
    let mut failing =
        http::Response::new(StreamBody::new(futures_util::stream::iter(frames)).boxed());
    failing
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("max-age=60"));
    let served = cache
        .on_upstream(&authority(), &get("/err"), None, failing, true)
        .await;
    assert!(read(served).await.is_err());
    assert!(is_miss(&cache, &get("/err")).await);
}

#[tokio::test]
async fn memory_lru_evicts_least_recently_used() {
    let clock = TestClock::new();
    let cache = memory_sized(&clock, 2048); // per-entry cap 256
    let Backend::Memory(m) = &cache.backend else {
        panic!("memory backend");
    };
    for i in 0..12 {
        store(
            &cache,
            &format!("/e{i}"),
            &[("cache-control", "max-age=600")],
            &[b'x'; 200],
        )
        .await;
        assert!(is_fresh(&cache, &get("/e0")).await, "e0 kept hot");
        assert!(m.total() <= 2048);
    }
    assert!(is_miss(&cache, &get("/e1")).await, "coldest entry evicted");
    assert!(is_fresh(&cache, &get("/e11")).await);
}

#[tokio::test]
async fn off_mode_passes_everything_through() {
    let (cache, used) = ProxyCache::open(CacheMode::Off);
    assert_eq!(used, CacheUse::Off);
    let served = exchange(
        &cache,
        &get("/o"),
        resp(200, &[("cache-control", "max-age=60")], b"o"),
        true,
    )
    .await;
    assert_eq!(&served.body[..], b"o");
    assert!(is_miss(&cache, &get("/o")).await);
    assert_eq!(cache.counters(), CacheCounters::default());
}

// ---- disk store ----

#[tokio::test]
async fn disk_persists_across_reopen() {
    let clock = TestClock::new();
    let dir = TempDir::new("reopen");
    {
        let (cache, used) = disk(&clock, &dir.0, 1, 1);
        assert_eq!(used, CacheUse::Disk);
        store(
            &cache,
            "/p",
            &[("cache-control", "max-age=600"), ("etag", "\"p\"")],
            b"persisted",
        )
        .await;
        assert_eq!(cache.counters().stores, 1);
    }
    clock.advance(10);
    let (cache, used) = disk(&clock, &dir.0, 1, 1);
    assert_eq!(used, CacheUse::Disk);
    match look(&cache, &get("/p")).await {
        Kind::Fresh(s) => {
            assert_eq!(&s.body[..], b"persisted");
            assert_eq!(s.headers.get("age").unwrap(), "10");
        }
        _ => panic!("expected fresh after reopen"),
    }
    clock.advance(600);
    assert!(matches!(
        look(&cache, &get("/p")).await,
        Kind::Revalidate(..)
    ));
}

#[tokio::test]
async fn temporary_admission_is_never_written_to_disk() {
    let clock = TestClock::new();
    let dir = TempDir::new("temporary");
    let (cache, _) = disk(&clock, &dir.0, 1, 1);
    let served = exchange(
        &cache,
        &get("/t"),
        resp(200, &[("cache-control", "max-age=60")], b"tmp"),
        false,
    )
    .await;
    assert_eq!(&served.body[..], b"tmp");
    assert!(entry_files(&dir.0).is_empty());
    assert!(is_miss(&cache, &get("/t")).await);
    assert_eq!(cache.counters().stores, 0);
    // A memory-mode attempt is in-memory anyway and may keep it.
    let mem = memory(&clock);
    exchange(
        &mem,
        &get("/t"),
        resp(200, &[("cache-control", "max-age=60")], b"tmp"),
        false,
    )
    .await;
    assert!(is_fresh(&mem, &get("/t")).await);
}

#[tokio::test]
async fn temporary_revalidation_does_not_rewrite_disk() {
    let clock = TestClock::new();
    let dir = TempDir::new("temp-304");
    let (cache, _) = disk(&clock, &dir.0, 1, 1);
    store(
        &cache,
        "/m",
        &[
            ("cache-control", "no-cache"),
            ("etag", "\"m\""),
            ("x-v", "1"),
        ],
        b"m",
    )
    .await;
    let path = disk_store(&cache).entry_path(&key(Method::GET, "/m"));
    let before = std::fs::read(&path).unwrap();
    let Kind::Revalidate(_, token) = look(&cache, &get("/m")).await else {
        panic!("expected revalidate");
    };
    let served = cache
        .on_upstream(
            &authority(),
            &get("/m"),
            Some(token),
            resp(304, &[("etag", "\"m\""), ("x-v", "2")], b""),
            false,
        )
        .await;
    assert_eq!(read(served).await.unwrap().headers.get("x-v").unwrap(), "2");
    cache.settle().await;
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn disk_lru_and_byte_cap() {
    let clock = TestClock::new();
    let dir = TempDir::new("lru");
    let max = 16 * 1024; // per-entry cap 2048
    let (cache, _) = ProxyCache::open_with_clock(disk_mode(&dir.0, max, 1, 1), clock.clock());
    for i in 0..20 {
        store(
            &cache,
            &format!("/d{i}"),
            &[("cache-control", "max-age=600")],
            &[b'y'; 1500],
        )
        .await;
        assert!(is_fresh(&cache, &get("/d0")).await);
        assert!(disk_store(&cache).total() <= max);
    }
    assert!(is_miss(&cache, &get("/d1")).await);
    assert!(is_fresh(&cache, &get("/d19")).await);
    let on_disk: u64 = entry_files(&dir.0)
        .iter()
        .map(|p| std::fs::metadata(p).unwrap().len())
        .sum();
    assert!(on_disk <= max);
    assert_eq!(on_disk, disk_store(&cache).total());
    // Oversized entries are skipped outright.
    store(
        &cache,
        "/big",
        &[("cache-control", "max-age=600")],
        &[b'z'; 3000],
    )
    .await;
    assert!(is_miss(&cache, &get("/big")).await);
}

#[tokio::test]
async fn tampered_entry_is_a_miss_and_deleted() {
    let clock = TestClock::new();
    let dir = TempDir::new("tamper");
    let (cache, _) = disk(&clock, &dir.0, 1, 1);
    store(
        &cache,
        "/x",
        &[("cache-control", "max-age=600")],
        &[b'q'; 5000],
    )
    .await;
    store(&cache, "/y", &[("cache-control", "max-age=600")], b"other").await;
    let path = disk_store(&cache).entry_path(&key(Method::GET, "/x"));
    let mut bytes = std::fs::read(&path).unwrap();
    let mid = bytes.len() / 2;
    bytes[mid] ^= 0x40;
    std::fs::write(&path, bytes).unwrap();
    assert!(is_miss(&cache, &get("/x")).await);
    assert!(!path.exists(), "tampered file deleted");
    assert!(is_fresh(&cache, &get("/y")).await, "other entries survive");
}

#[tokio::test]
async fn swapped_entry_files_do_not_decrypt() {
    let clock = TestClock::new();
    let dir = TempDir::new("swap");
    let (cache, _) = disk(&clock, &dir.0, 1, 1);
    store(&cache, "/one", &[("cache-control", "max-age=600")], b"one").await;
    store(&cache, "/two", &[("cache-control", "max-age=600")], b"two").await;
    let one = disk_store(&cache).entry_path(&key(Method::GET, "/one"));
    let two = disk_store(&cache).entry_path(&key(Method::GET, "/two"));
    std::fs::copy(&two, &one).unwrap();
    assert!(is_miss(&cache, &get("/one")).await);
    assert!(is_fresh(&cache, &get("/two")).await);
}

#[tokio::test]
async fn wrong_key_is_a_miss() {
    let clock = TestClock::new();
    let dir = TempDir::new("wrong-key");
    {
        let (cache, _) = disk(&clock, &dir.0, 1, 1);
        store(&cache, "/k", &[("cache-control", "max-age=600")], b"k").await;
    }
    let (cache, used) = disk(&clock, &dir.0, 2, 1);
    assert_eq!(used, CacheUse::Disk);
    assert!(is_miss(&cache, &get("/k")).await);
    assert!(entry_files(&dir.0).is_empty(), "unreadable store is wiped");
    store(&cache, "/k", &[("cache-control", "max-age=600")], b"k2").await;
    assert!(is_fresh(&cache, &get("/k")).await);
}

#[tokio::test]
async fn binding_mismatch_wipes_the_store() {
    let clock = TestClock::new();
    let dir = TempDir::new("binding");
    {
        let (cache, _) = disk(&clock, &dir.0, 1, 1);
        store(&cache, "/b", &[("cache-control", "max-age=600")], b"b").await;
        assert_eq!(entry_files(&dir.0).len(), 1);
    }
    let (cache, used) = disk(&clock, &dir.0, 1, 2);
    assert_eq!(used, CacheUse::Disk);
    assert!(entry_files(&dir.0).is_empty());
    assert!(is_miss(&cache, &get("/b")).await);
}

#[tokio::test]
async fn corrupt_keys_file_wipes_the_store() {
    let clock = TestClock::new();
    let dir = TempDir::new("corrupt");
    {
        let (cache, _) = disk(&clock, &dir.0, 1, 1);
        store(&cache, "/c", &[("cache-control", "max-age=600")], b"c").await;
    }
    std::fs::write(dir.0.join("keys.v1"), b"garbage").unwrap();
    std::fs::write(dir.0.join("e").join("leftover.tmp"), b"junk").unwrap();
    let (cache, used) = disk(&clock, &dir.0, 1, 1);
    assert_eq!(used, CacheUse::Disk);
    assert!(entry_files(&dir.0).is_empty());
    assert!(is_miss(&cache, &get("/c")).await);
}

#[tokio::test]
async fn concurrent_attempts_share_one_store() {
    let clock = TestClock::new();
    let dir = TempDir::new("share");
    let (a, used_a) = disk(&clock, &dir.0, 1, 1);
    let (b, used_b) = disk(&clock, &dir.0, 1, 1);
    assert_eq!((used_a, used_b), (CacheUse::Disk, CacheUse::Disk));
    assert!(Arc::ptr_eq(disk_store(&a), disk_store(&b)));
    store(&a, "/s", &[("cache-control", "max-age=600")], b"shared").await;
    match look(&b, &get("/s")).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"shared"),
        _ => panic!("attempt B must see attempt A's entry"),
    }
    assert_eq!(
        (a.counters().stores, b.counters().hits),
        (1, 1),
        "counters stay per attempt"
    );

    let (c, used_c) = disk(&clock, &dir.0, 1, 9);
    assert_eq!(used_c, CacheUse::Memory(MemoryCacheReason::BindingMismatch));
    assert!(is_miss(&c, &get("/s")).await);
    let (d, used_d) = disk(&clock, &dir.0, 9, 1);
    assert_eq!(
        used_d,
        CacheUse::Memory(MemoryCacheReason::BindingMismatch),
        "other key too"
    );
    assert!(
        is_fresh(&b, &get("/s")).await,
        "the holder's store is untouched"
    );
    drop((a, b, c, d));

    let (e, used_e) = disk(&clock, &dir.0, 1, 9);
    assert_eq!(
        used_e,
        CacheUse::Disk,
        "free again: reopened with the new binding"
    );
    assert!(is_miss(&e, &get("/s")).await);
}

#[tokio::test]
async fn parallel_lookups_and_stores_on_shared_store() {
    let clock = TestClock::new();
    let dir = TempDir::new("parallel");
    let (a, _) = disk(&clock, &dir.0, 1, 1);
    let (b, _) = disk(&clock, &dir.0, 1, 1);
    let mut tasks = Vec::new();
    for i in 0..16 {
        let cache = if i % 2 == 0 {
            Arc::clone(&a)
        } else {
            Arc::clone(&b)
        };
        tasks.push(tokio::spawn(async move {
            let uri = format!("/p{}", i % 4);
            let body = vec![b'0' + (i % 4) as u8; 3000];
            store(&cache, &uri, &[("cache-control", "max-age=600")], &body).await;
            match look(&cache, &get(&uri)).await {
                Kind::Fresh(s) => assert_eq!(s.body, Bytes::from(body)),
                Kind::Miss => {} // a concurrent replace may race the read
                Kind::Revalidate(..) => panic!("unexpected revalidate"),
            }
        }));
    }
    for t in tasks {
        t.await.unwrap();
    }
    for i in 0..4 {
        assert!(is_fresh(&a, &get(&format!("/p{i}"))).await);
    }
}

#[tokio::test]
async fn no_plaintext_body_url_or_host_on_disk() {
    let clock = TestClock::new();
    let dir = TempDir::new("grep");
    let body_marker = b"PLAINTEXT-BODY-MARKER-4f1d9c";
    let mut body = Vec::new();
    for _ in 0..5000 {
        body.extend_from_slice(body_marker);
    }
    let path = "/very-secret-path-marker/index.html?token=query-marker";
    {
        let (cache, _) = disk(&clock, &dir.0, 1, 1);
        let r = req(
            Method::GET,
            &format!("https://{HOST}{path}"),
            &[
                ("cookie", "sid=cookie-marker"),
                ("accept-language", "header-marker"),
            ],
        );
        exchange(
            &cache,
            &r,
            resp(
                200,
                &[
                    ("cache-control", "max-age=600"),
                    ("vary", "Accept-Language, Cookie"),
                    ("x-response-marker", "response-header-marker"),
                ],
                &body,
            ),
            true,
        )
        .await;
        store(
            &cache,
            "/small-path-marker",
            &[("cache-control", "max-age=600")],
            b"short-body-marker",
        )
        .await;
        assert_eq!(cache.counters().stores, 2);
        assert!(is_fresh(&cache, &r).await);
    }
    let needles: [&[u8]; 10] = [
        body_marker,
        b"short-body-marker",
        HOST.as_bytes(),
        b"secret-host",
        b"very-secret-path",
        b"query-marker",
        b"small-path-marker",
        b"cookie-marker",
        b"header-marker",
        b"response-header-marker",
    ];
    let files = all_files(&dir.0);
    assert_eq!(files.len(), 3, "keys.v1 + two entries");
    for file in files {
        let name = file.to_string_lossy().into_owned();
        let bytes = std::fs::read(&file).unwrap();
        for needle in needles {
            let text = String::from_utf8_lossy(needle).into_owned();
            assert!(!name.contains(&text), "file name leaks {text}");
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "{name} leaks {text}"
            );
        }
    }
}

#[tokio::test]
async fn memory_mode_reports_and_defaults() {
    let (_, used) = ProxyCache::open(CacheMode::Memory {
        max_bytes: DEFAULT_MEMORY_BYTES,
    });
    assert!(matches!(used, CacheUse::Memory(_)));
    let clock = TestClock::new();
    let dir = TempDir::new("zero");
    let (cache, used) = ProxyCache::open_with_clock(disk_mode(&dir.0, 0, 1, 1), clock.clock());
    assert_eq!(used, CacheUse::Memory(MemoryCacheReason::StoreUnavailable));
    let Backend::Memory(m) = &cache.backend else {
        panic!("memory fallback");
    };
    assert_eq!(m.max_bytes(), DEFAULT_MEMORY_BYTES);
}

// ---- body completion the way hyper's server drives it ----

/// A multi-frame body that never reports its end on its own (like an
/// upstream `Incoming` body still waiting for the next read).
fn streamed(chunks: &[&[u8]]) -> ProxyBody {
    let frames: Vec<Result<Frame<Bytes>, std::io::Error>> = chunks
        .iter()
        .map(|c| Ok(Frame::data(Bytes::copy_from_slice(c))))
        .collect();
    StreamBody::new(futures_util::stream::iter(frames)).boxed()
}

fn with_body(status: u16, list: &[(&str, &str)], body: ProxyBody) -> http::Response<ProxyBody> {
    let mut r = http::Response::new(body);
    *r.status_mut() = StatusCode::from_u16(status).unwrap();
    *r.headers_mut() = headers(list);
    r
}

/// hyper's h1 server: polls until `Content-Length` bytes were written, then
/// stops (never observes the end of the stream).
async fn drive_h1(body: &mut ProxyBody, content_length: usize) -> Vec<u8> {
    let mut out = Vec::new();
    while out.len() < content_length {
        let frame = body.frame().await.expect("frame").expect("data");
        if let Ok(data) = frame.into_data() {
            out.extend_from_slice(&data);
        }
    }
    out
}

/// hyper's h2 server: after each frame it asks `is_end_stream()` and stops
/// polling once that is true (it sets END_STREAM on the last DATA frame).
async fn drive_h2(body: &mut ProxyBody) -> Vec<u8> {
    let mut out = Vec::new();
    while !body.is_end_stream() {
        match body.frame().await {
            Some(frame) => {
                if let Ok(data) = frame.expect("frame").into_data() {
                    out.extend_from_slice(&data);
                }
            }
            None => break,
        }
    }
    out
}

#[tokio::test]
async fn content_length_body_commits_when_the_length_is_reached() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "9")],
        streamed(&[b"abc", b"def", b"ghi"]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/cl"), None, resp, true)
        .await;
    let mut body = served.into_body();
    assert_eq!(drive_h1(&mut body, 9).await, b"abcdefghi");
    // The server keeps the body alive (keep-alive) but never polls again.
    match look(&cache, &get("/cl")).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"abcdefghi"),
        _ => panic!("length-delimited response must be stored without EOS"),
    }
    drop(body);
    assert_eq!(cache.counters().stores, 1);
}

#[tokio::test]
async fn content_length_body_commits_on_disk_without_eos() {
    let clock = TestClock::new();
    let dir = TempDir::new("cl-disk");
    let (cache, _) = disk(&clock, &dir.0, 1, 1);
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "6")],
        streamed(&[b"one", b"two"]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/cl"), None, resp, true)
        .await;
    let mut body = served.into_body();
    drive_h1(&mut body, 6).await;
    cache.settle().await;
    assert_eq!(entry_files(&dir.0).len(), 1);
    assert!(is_fresh(&cache, &get("/cl")).await);
}

#[tokio::test]
async fn h2_style_end_stream_commits() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    // Single-frame body that knows its end (Full), with and without length.
    for (uri, list) in [
        (
            "/full-cl",
            vec![("cache-control", "max-age=60"), ("content-length", "4")],
        ),
        ("/full", vec![("cache-control", "max-age=60")]),
    ] {
        let resp = with_body(200, &list, full_body(Bytes::from_static(b"full")));
        let served = cache
            .on_upstream(&authority(), &get(uri), None, resp, true)
            .await;
        let mut body = served.into_body();
        assert_eq!(drive_h2(&mut body).await, b"full");
        assert!(is_fresh(&cache, &get(uri)).await, "{uri}");
    }
    // Chunked stream without a length: the end is the `None` frame.
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60")],
        streamed(&[b"a", b"b"]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/chunks"), None, resp, true)
        .await;
    let mut body = served.into_body();
    assert_eq!(drive_h2(&mut body).await, b"ab");
    assert!(is_fresh(&cache, &get("/chunks")).await);
}

#[tokio::test]
async fn dropped_or_overlong_bodies_are_not_stored() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    // Client went away half-way.
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "6")],
        streamed(&[b"abc", b"def"]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/half"), None, resp, true)
        .await;
    let mut body = served.into_body();
    drive_h1(&mut body, 3).await;
    drop(body);
    assert!(is_miss(&cache, &get("/half")).await);
    // Upstream sent more than it declared.
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "2")],
        streamed(&[b"abc"]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/long"), None, resp, true)
        .await;
    let _ = read(served).await;
    assert!(is_miss(&cache, &get("/long")).await);
    // Declared but empty: stored at once (hyper never polls it).
    let resp = with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "0")],
        streamed(&[]),
    );
    let served = cache
        .on_upstream(&authority(), &get("/empty"), None, resp, true)
        .await;
    drop(served);
    match look(&cache, &get("/empty")).await {
        Kind::Fresh(s) => assert!(s.body.is_empty()),
        _ => panic!("empty length-delimited response must be stored"),
    }
    assert_eq!(cache.counters().stores, 1);
}

/// One request through a real hyper server/client pair; the server answers
/// with `make()` passed through the cache.
async fn through_hyper(
    cache: Arc<ProxyCache>,
    h2: bool,
    path: &'static str,
    make: fn() -> http::Response<ProxyBody>,
) -> Bytes {
    use hyper_util::rt::{TokioExecutor, TokioIo};
    let (client_io, server_io) = tokio::io::duplex(1 << 16);
    let service =
        hyper::service::service_fn(move |incoming: http::Request<hyper::body::Incoming>| {
            let cache = Arc::clone(&cache);
            async move {
                let (mut parts, _) = incoming.into_parts();
                parts.uri = origin_form_for_test(&parts.uri);
                let resp = cache
                    .on_upstream(&authority(), &parts, None, make(), true)
                    .await;
                Ok::<_, std::convert::Infallible>(resp)
            }
        });
    let request = http::Request::get(format!("https://{HOST}{path}"))
        .body(http_body_util::Empty::<Bytes>::new())
        .unwrap();
    let response = if h2 {
        tokio::spawn(
            hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                .serve_connection(TokioIo::new(server_io), service),
        );
        let (mut sender, conn) =
            hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(client_io))
                .await
                .unwrap();
        tokio::spawn(conn);
        sender.send_request(request).await.unwrap()
    } else {
        tokio::spawn(
            hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(server_io), service),
        );
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(client_io))
            .await
            .unwrap();
        tokio::spawn(conn);
        sender.send_request(request).await.unwrap()
    };
    response.into_body().collect().await.unwrap().to_bytes()
}

fn origin_form_for_test(uri: &Uri) -> Uri {
    policy::origin_form(uri)
}

fn length_delimited() -> http::Response<ProxyBody> {
    with_body(
        200,
        &[("cache-control", "max-age=60"), ("content-length", "12")],
        streamed(&[b"hello ", b"world!"]),
    )
}

fn chunked_stream() -> http::Response<ProxyBody> {
    with_body(
        200,
        &[("cache-control", "max-age=60")],
        streamed(&[b"chunk ", b"body"]),
    )
}

#[tokio::test]
async fn real_hyper_h1_and_h2_servers_store_both_framings() {
    let clock = TestClock::new();
    for h2 in [false, true] {
        let cache = memory(&clock);
        let body = through_hyper(Arc::clone(&cache), h2, "/cl", length_delimited).await;
        assert_eq!(&body[..], b"hello world!");
        let body = through_hyper(Arc::clone(&cache), h2, "/chunked", chunked_stream).await;
        assert_eq!(&body[..], b"chunk body");
        assert_eq!(cache.counters().stores, 2, "h2={h2}");
        assert!(is_fresh(&cache, &get("/cl")).await, "h2={h2}");
        assert!(is_fresh(&cache, &get("/chunked")).await, "h2={h2}");
    }
}

#[tokio::test]
async fn scheme_is_part_of_the_key() {
    let clock = TestClock::new();
    let cache = memory(&clock);
    let plain = |p: &str| get(&format!("http://{HOST}:443{p}"));
    exchange(
        &cache,
        &plain("/s"),
        resp(200, &[("cache-control", "max-age=60")], b"plain"),
        true,
    )
    .await;
    assert!(
        is_miss(&cache, &get("/s")).await,
        "origin-form (TLS tunnel) is https"
    );
    assert!(is_miss(&cache, &get(&format!("https://{HOST}/s"))).await);
    match look(&cache, &plain("/s")).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"plain"),
        _ => panic!("expected the http entry"),
    }
    store(&cache, "/s", &[("cache-control", "max-age=60")], b"tls").await;
    match look(&cache, &get(&format!("https://{HOST}/s"))).await {
        Kind::Fresh(s) => assert_eq!(&s.body[..], b"tls"),
        _ => panic!("expected the https entry"),
    }
    // Invalidating the https resource leaves the http one alone.
    exchange(
        &cache,
        &req(Method::POST, "/s", &[]),
        resp(204, &[], b""),
        true,
    )
    .await;
    assert!(is_miss(&cache, &get("/s")).await);
    assert!(is_fresh(&cache, &plain("/s")).await);
}

#[test]
fn master_key_is_a_deterministic_hkdf_of_the_vault_dek_and_never_the_dek() {
    let dek = vec![7u8; 32];
    let first = master_key_from_vault_dek(dek.clone()).expect("32-byte DEK");
    let second = master_key_from_vault_dek(dek.clone()).expect("32-byte DEK");
    assert_eq!(*first, *second, "deterministic");
    assert_ne!(first.as_slice(), dek.as_slice(), "never the DEK itself");
    // Pins the HKDF-SHA256 construction and its info string.
    let mut expected = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, &dek)
        .expand(b"sorng-http-cache-v1", &mut expected)
        .unwrap();
    assert_eq!(*first, expected);
    let other = master_key_from_vault_dek(vec![8u8; 32]).unwrap();
    assert_ne!(*other, *first);
    assert!(master_key_from_vault_dek(Vec::new()).is_none());
    assert!(master_key_from_vault_dek(vec![7u8; 31]).is_none());
}
