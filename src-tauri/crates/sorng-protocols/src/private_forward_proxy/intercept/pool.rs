//! K7 (x2): per-attempt upstream connection pool.
//!
//! - Keyed by the exact authority and scheme. Never coalesces by IP or SAN, so
//!   a tunnel for one authority can never reach another upstream.
//! - h2: one connection per authority, multiplexed.
//! - HTTP/1.1: up to `MAX_H1_PER_AUTHORITY` connections, kept alive while
//!   idle for `IDLE_TIMEOUT`.
//! - Every NEW connection is trust-evaluated before any request byte
//!   (`upstream::establish`). Upstream TLS resumption is disabled.
//! - `close_all` (attempt revoke) drops every pooled connection and refuses
//!   further sends.

use super::trust::UpstreamTrust;
use super::upstream::{establish, Admission, ConnectRequest, Established, Offer, UpstreamFailure};
use super::upstream_verify::UpstreamVerifierConfig;
use super::ProxyBody;
use crate::private_forward_proxy::{Authority, RouteDialer};
use hyper::body::Incoming;
use hyper::client::conn::{http1, http2};
use hyper::header::{HeaderValue, HOST, PROXY_AUTHORIZATION};
use hyper::{Request, Response, Version};
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::AbortHandle;

pub(crate) const MAX_H1_PER_AUTHORITY: usize = 6;
pub(crate) const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
/// Re-check interval while every HTTP/1.1 connection of an authority is busy.
const H1_BUSY_POLL: Duration = Duration::from_millis(2);

#[derive(Clone, Eq, PartialEq, Hash)]
struct Key {
    authority: Authority,
    tls: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Proto {
    H1,
    H2,
}

struct H2Conn {
    sender: http2::SendRequest<ProxyBody>,
    admission: Admission,
    last_used: Instant,
}

/// A pooled HTTP/1.1 connection. It returns to the pool as soon as its
/// response head arrives; checkout only takes one whose previous exchange has
/// finished (`is_ready`). The slot permit lives exactly as long as the
/// connection.
struct H1Conn {
    sender: http1::SendRequest<ProxyBody>,
    admission: Admission,
    last_used: Instant,
    _slot: OwnedSemaphorePermit,
}

impl H1Conn {
    fn expired(&self, idle: Duration) -> bool {
        self.sender.is_closed() || (self.sender.is_ready() && self.last_used.elapsed() >= idle)
    }
}

#[derive(Default)]
struct EntryState {
    proto: Option<Proto>,
    h2: Option<H2Conn>,
    h1: Vec<H1Conn>,
}

/// Result of an HTTP/1.1 checkout attempt.
enum Checkout {
    Reuse(H1Conn),
    Open(OwnedSemaphorePermit),
    Wait,
}

struct Entry {
    /// HTTP/1.1 connection slots: one permit per open connection.
    slots: Arc<Semaphore>,
    /// Serialises opening the first connection while the protocol is unknown
    /// and every h2 (re)connect, so h2 stays at one connection.
    connect_gate: tokio::sync::Mutex<()>,
    /// Serialises trust evaluations for this authority.
    trust_gate: tokio::sync::Mutex<()>,
    state: Mutex<EntryState>,
}

impl Entry {
    fn new(proto: Option<Proto>) -> Arc<Self> {
        Arc::new(Self {
            slots: Arc::new(Semaphore::new(MAX_H1_PER_AUTHORITY)),
            connect_gate: tokio::sync::Mutex::new(()),
            trust_gate: tokio::sync::Mutex::new(()),
            state: Mutex::new(EntryState {
                proto,
                ..EntryState::default()
            }),
        })
    }

    fn state(&self) -> MutexGuard<'_, EntryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn proto(&self) -> Option<Proto> {
        self.state().proto
    }

    /// A live, not-yet-idle-expired h2 sender.
    fn h2_sender(&self, idle: Duration) -> Option<(http2::SendRequest<ProxyBody>, Admission)> {
        let mut state = self.state();
        let usable = state
            .h2
            .as_ref()
            .is_some_and(|conn| !conn.sender.is_closed() && conn.last_used.elapsed() < idle);
        if !usable {
            state.h2 = None;
            return None;
        }
        let conn = state.h2.as_mut()?;
        conn.last_used = Instant::now();
        Some((conn.sender.clone(), conn.admission))
    }

    /// `may_open == false` only reuses (first pass, before yielding once so
    /// that a just-finished exchange can mark its connection ready).
    fn checkout_h1(&self, idle: Duration, may_open: bool) -> Checkout {
        let mut state = self.state();
        state.h1.retain(|conn| !conn.expired(idle));
        if let Some(index) = state.h1.iter().position(|conn| conn.sender.is_ready()) {
            let mut conn = state.h1.swap_remove(index);
            conn.last_used = Instant::now();
            return Checkout::Reuse(conn);
        }
        if !may_open && !state.h1.is_empty() {
            return Checkout::Wait;
        }
        match self.slots.clone().try_acquire_owned() {
            Ok(permit) => Checkout::Open(permit),
            Err(_) => Checkout::Wait,
        }
    }

    fn prune(&self, idle: Duration) {
        let mut state = self.state();
        state.h1.retain(|conn| !conn.expired(idle));
        if state
            .h2
            .as_ref()
            .is_some_and(|conn| conn.sender.is_closed() || conn.last_used.elapsed() >= idle)
        {
            state.h2 = None;
        }
    }
}

#[derive(Default)]
struct PoolState {
    closed: bool,
    entries: HashMap<Key, Arc<Entry>>,
    admitted: HashSet<Authority>,
    /// Admission-only warm-ups in flight (main-frame cache hits).
    warming: HashSet<Authority>,
    hsts: HashSet<Authority>,
    tasks: Vec<AbortHandle>,
}

/// One per attempt; never shared between attempts.
pub(crate) struct UpstreamPool {
    dialer: Arc<dyn RouteDialer>,
    trust: Arc<dyn UpstreamTrust>,
    verifier: UpstreamVerifierConfig,
    idle_timeout: Duration,
    state: Mutex<PoolState>,
}

enum SendError {
    /// The connection refused the request before writing it; retry once on
    /// another connection.
    Retry(Box<Request<ProxyBody>>),
    Failed(UpstreamFailure),
}

impl From<UpstreamFailure> for SendError {
    fn from(failure: UpstreamFailure) -> Self {
        Self::Failed(failure)
    }
}

impl UpstreamPool {
    pub(crate) fn new(
        dialer: Arc<dyn RouteDialer>,
        trust: Arc<dyn UpstreamTrust>,
        verifier: UpstreamVerifierConfig,
    ) -> Arc<Self> {
        Self::with_idle_timeout(dialer, trust, verifier, IDLE_TIMEOUT)
    }

    pub(crate) fn with_idle_timeout(
        dialer: Arc<dyn RouteDialer>,
        trust: Arc<dyn UpstreamTrust>,
        verifier: UpstreamVerifierConfig,
        idle_timeout: Duration,
    ) -> Arc<Self> {
        let pool = Arc::new(Self {
            dialer,
            trust,
            verifier,
            idle_timeout,
            state: Mutex::new(PoolState::default()),
        });
        Self::spawn_reaper(&pool);
        pool
    }

    fn spawn_reaper(pool: &Arc<Self>) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return; // Expiry still applies lazily on every checkout.
        };
        let weak: Weak<Self> = Arc::downgrade(pool);
        let period = (pool.idle_timeout / 3).max(Duration::from_millis(10));
        let task = runtime.spawn(async move {
            let mut tick = tokio::time::interval(period);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let Some(pool) = weak.upgrade() else { break };
                if !pool.prune() {
                    break;
                }
            }
        });
        pool.track(task.abort_handle());
    }

    fn state(&self) -> MutexGuard<'_, PoolState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Drops idle connections past the idle timeout. False once closed.
    fn prune(&self) -> bool {
        let entries: Vec<Arc<Entry>> = {
            let mut state = self.state();
            if state.closed {
                return false;
            }
            state.tasks.retain(|task| !task.is_finished());
            state.entries.values().cloned().collect()
        };
        for entry in entries {
            entry.prune(self.idle_timeout);
        }
        true
    }

    fn track(&self, task: AbortHandle) {
        let mut state = self.state();
        if state.closed {
            task.abort();
        } else {
            state.tasks.push(task);
        }
    }

    fn entry(&self, key: &Key) -> Result<Arc<Entry>, UpstreamFailure> {
        let mut state = self.state();
        if state.closed {
            return Err(UpstreamFailure::RouteFailed);
        }
        Ok(state
            .entries
            .entry(key.clone())
            // Plain http:// is HTTP/1.1 only (no h2c upstream).
            .or_insert_with(|| Entry::new((!key.tls).then_some(Proto::H1)))
            .clone())
    }

    /// True once any connection to `authority` was admitted in this attempt.
    pub(crate) fn admitted(&self, authority: &Authority) -> bool {
        self.state().admitted.contains(authority)
    }

    /// Admission only (t-mitmproxy m4): dial, handshake and trust-evaluate a
    /// connection to `authority` exactly as a request would, then drop it
    /// unwritten. Not one request byte (nor an h2 preface) reaches the
    /// upstream. Used when a main-frame response came from the cache, so the
    /// origin is admitted in this attempt (login delivery requires that).
    /// True once the authority is admitted.
    pub(crate) async fn warm(&self, authority: &Authority, tls: bool) -> bool {
        if self.admitted(authority) {
            return true;
        }
        let key = Key {
            authority: authority.clone(),
            tls,
        };
        let Ok(entry) = self.entry(&key) else {
            return false;
        };
        match self.connect(&key, &entry, Offer::Http11Only).await {
            Ok(established) => {
                drop(established);
                true
            }
            Err(_) => false,
        }
    }

    /// Starts `warm` in the background unless the authority is already
    /// admitted or a warm-up for it is running. The task ends with the pool.
    pub(crate) fn spawn_warm(self: &Arc<Self>, authority: &Authority, tls: bool) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        {
            let mut state = self.state();
            if state.closed
                || state.admitted.contains(authority)
                || !state.warming.insert(authority.clone())
            {
                return;
            }
        }
        let pool = Arc::downgrade(self);
        let authority = authority.clone();
        let task = runtime.spawn(async move {
            let Some(strong) = pool.upgrade() else { return };
            strong.warm(&authority, tls).await;
            strong.state().warming.remove(&authority);
        });
        self.track(task.abort_handle());
    }

    /// The host sent Strict-Transport-Security: later name/date/authority
    /// failures on new connections are `Fatal(HstsViolation)`, no prompt.
    pub(crate) fn mark_hsts(&self, authority: &Authority) {
        let mut state = self.state();
        if !state.closed {
            state.hsts.insert(authority.clone());
        }
    }

    /// Revoke: drop every pooled connection and refuse further sends.
    pub(crate) fn close_all(&self) {
        let (entries, tasks) = {
            let mut state = self.state();
            state.closed = true;
            state.admitted.clear();
            (
                std::mem::take(&mut state.entries),
                std::mem::take(&mut state.tasks),
            )
        };
        for task in tasks {
            task.abort();
        }
        for entry in entries.into_values() {
            let mut state = entry.state();
            state.h2 = None;
            state.h1.clear();
        }
    }

    /// Sends one exchange over a pooled (or new, evaluated) connection.
    pub(crate) async fn send(
        &self,
        authority: &Authority,
        tls: bool,
        req: Request<ProxyBody>,
    ) -> Result<(Response<Incoming>, Admission), UpstreamFailure> {
        let key = Key {
            authority: authority.clone(),
            tls,
        };
        let mut req = req;
        // At most one retry, and only when a reused connection handed the
        // request back unwritten.
        for _ in 0..2 {
            let entry = self.entry(&key)?;
            match self.send_once(&key, entry, req).await {
                Ok(done) => return Ok(done),
                Err(SendError::Retry(back)) => req = *back,
                Err(SendError::Failed(failure)) => return Err(failure),
            }
        }
        Err(UpstreamFailure::RouteFailed)
    }

    async fn send_once(
        &self,
        key: &Key,
        entry: Arc<Entry>,
        req: Request<ProxyBody>,
    ) -> Result<(Response<Incoming>, Admission), SendError> {
        if let Some((sender, admission)) = entry.h2_sender(self.idle_timeout) {
            return self.send_h2(&entry, key, sender, admission, req).await;
        }
        if entry.proto() != Some(Proto::H1) {
            let gate = entry.connect_gate.lock().await;
            if let Some((sender, admission)) = entry.h2_sender(self.idle_timeout) {
                drop(gate);
                return self.send_h2(&entry, key, sender, admission, req).await;
            }
            if entry.proto() != Some(Proto::H1) {
                let permit = entry
                    .slots
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| UpstreamFailure::RouteFailed)?;
                let established = self.connect(key, &entry, Offer::H2AndHttp11).await?;
                if established.h2 {
                    drop(permit);
                    let (sender, admission) = self.attach_h2(&entry, established).await?;
                    drop(gate);
                    return self.send_h2(&entry, key, sender, admission, req).await;
                }
                entry.state().proto = Some(Proto::H1);
                drop(gate);
                let conn = self.attach_h1_pooled(established, permit).await?;
                return self.send_h1(&entry, key, conn, req, false).await;
            }
        }
        let mut pass = 0u32;
        let (conn, reused) = loop {
            match entry.checkout_h1(self.idle_timeout, pass > 0) {
                Checkout::Reuse(conn) => break (conn, true),
                Checkout::Open(permit) => {
                    let established = self.connect(key, &entry, Offer::Http11Only).await?;
                    break (self.attach_h1_pooled(established, permit).await?, false);
                }
                Checkout::Wait => {
                    if self.state().closed {
                        return Err(UpstreamFailure::RouteFailed.into());
                    }
                    if pass == 0 {
                        tokio::task::yield_now().await;
                    } else {
                        // All connections of this authority are busy.
                        tokio::time::sleep(H1_BUSY_POLL).await;
                    }
                    pass = pass.saturating_add(1);
                }
            }
        };
        self.send_h1(&entry, key, conn, req, reused).await
    }

    /// A dedicated, admitted HTTP/1.1 connection for a WebSocket upgrade.
    /// Never pooled; the caller sends the upgrade request (see
    /// `prepare_request`) and splices after `101`.
    pub(crate) async fn connect_upgrade(
        &self,
        authority: &Authority,
        tls: bool,
    ) -> Result<(http1::SendRequest<ProxyBody>, Admission), UpstreamFailure> {
        let key = Key {
            authority: authority.clone(),
            tls,
        };
        let entry = self.entry(&key)?;
        let established = self.connect(&key, &entry, Offer::Http11Only).await?;
        self.attach_h1(established, true).await
    }

    async fn connect(
        &self,
        key: &Key,
        entry: &Entry,
        offer: Offer,
    ) -> Result<Established, UpstreamFailure> {
        let hsts = self.state().hsts.contains(&key.authority);
        let established = establish(ConnectRequest {
            dialer: &self.dialer,
            trust: &self.trust,
            verifier: &self.verifier,
            authority: &key.authority,
            tls: key.tls,
            hsts,
            offer,
            trust_gate: &entry.trust_gate,
        })
        .await?;
        let mut state = self.state();
        if state.closed {
            return Err(UpstreamFailure::RouteFailed);
        }
        state.admitted.insert(key.authority.clone());
        Ok(established)
    }

    async fn attach_h1(
        &self,
        established: Established,
        upgrades: bool,
    ) -> Result<(http1::SendRequest<ProxyBody>, Admission), UpstreamFailure> {
        let (sender, connection) = http1::handshake(TokioIo::new(established.io))
            .await
            .map_err(|_| UpstreamFailure::RouteFailed)?;
        let task = if upgrades {
            tokio::spawn(async move {
                let _ = connection.with_upgrades().await;
            })
        } else {
            tokio::spawn(async move {
                let _ = connection.await;
            })
        };
        self.track(task.abort_handle());
        Ok((sender, established.admission))
    }

    async fn attach_h1_pooled(
        &self,
        established: Established,
        slot: OwnedSemaphorePermit,
    ) -> Result<H1Conn, UpstreamFailure> {
        let (sender, admission) = self.attach_h1(established, false).await?;
        Ok(H1Conn {
            sender,
            admission,
            last_used: Instant::now(),
            _slot: slot,
        })
    }

    async fn attach_h2(
        &self,
        entry: &Entry,
        established: Established,
    ) -> Result<(http2::SendRequest<ProxyBody>, Admission), UpstreamFailure> {
        let (sender, connection) =
            http2::handshake(TokioExecutor::new(), TokioIo::new(established.io))
                .await
                .map_err(|_| UpstreamFailure::RouteFailed)?;
        let task = tokio::spawn(async move {
            let _ = connection.await;
        });
        self.track(task.abort_handle());
        let mut state = entry.state();
        state.proto = Some(Proto::H2);
        state.h2 = Some(H2Conn {
            sender: sender.clone(),
            admission: established.admission,
            last_used: Instant::now(),
        });
        Ok((sender, established.admission))
    }

    async fn send_h2(
        &self,
        entry: &Entry,
        key: &Key,
        mut sender: http2::SendRequest<ProxyBody>,
        admission: Admission,
        mut req: Request<ProxyBody>,
    ) -> Result<(Response<Incoming>, Admission), SendError> {
        prepare_request(&mut req, &key.authority, key.tls, true)?;
        match sender.try_send_request(req).await {
            Ok(response) => Ok((response, admission)),
            Err(mut error) => {
                let mut state = entry.state();
                if state
                    .h2
                    .as_ref()
                    .is_some_and(|conn| conn.sender.is_closed())
                {
                    state.h2 = None;
                }
                drop(state);
                match error.take_message() {
                    Some(back) => Err(SendError::Retry(Box::new(back))),
                    None => Err(UpstreamFailure::RouteFailed.into()),
                }
            }
        }
    }

    async fn send_h1(
        &self,
        entry: &Entry,
        key: &Key,
        mut conn: H1Conn,
        mut req: Request<ProxyBody>,
        reused: bool,
    ) -> Result<(Response<Incoming>, Admission), SendError> {
        prepare_request(&mut req, &key.authority, key.tls, false)?;
        let admission = conn.admission;
        match conn.sender.try_send_request(req).await {
            Ok(response) => {
                // Back in the pool now; it is checked out again only once
                // this exchange has finished (`is_ready`).
                conn.last_used = Instant::now();
                if !self.state().closed {
                    entry.state().h1.push(conn);
                }
                Ok((response, admission))
            }
            Err(mut error) => match error.take_message() {
                Some(back) if reused => Err(SendError::Retry(Box::new(back))),
                _ => Err(UpstreamFailure::RouteFailed.into()),
            },
        }
    }
}

/// `Host` / `:authority` value: the exact authority, default port omitted.
pub(crate) fn host_value(authority: &Authority, tls: bool) -> String {
    let default = if tls { 443 } else { 80 };
    if authority.port() == default {
        if authority.host().contains(':') {
            format!("[{}]", authority.host())
        } else {
            authority.host().to_owned()
        }
    } else {
        authority.to_string()
    }
}

/// Rewrites a request for this upstream: h2 uses an absolute URI (its
/// `:authority`), HTTP/1.1 an origin-form path plus `Host`. The authority is
/// always the pooled one, never a request-supplied value, and proxy
/// credentials never leave the proxy.
pub(crate) fn prepare_request(
    req: &mut Request<ProxyBody>,
    authority: &Authority,
    tls: bool,
    h2: bool,
) -> Result<(), UpstreamFailure> {
    let path = req
        .uri()
        .path_and_query()
        .map(|path| path.as_str().to_owned())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| "/".to_owned());
    let host = host_value(authority, tls);
    let invalid = |_| UpstreamFailure::RouteFailed;
    if h2 {
        let scheme = if tls { "https" } else { "http" };
        *req.uri_mut() = format!("{scheme}://{host}{path}")
            .parse()
            .map_err(invalid)?;
        *req.version_mut() = Version::HTTP_2;
        req.headers_mut().remove(HOST);
    } else {
        *req.uri_mut() = path.parse().map_err(invalid)?;
        *req.version_mut() = Version::HTTP_11;
        req.headers_mut().insert(
            HOST,
            HeaderValue::from_str(&host).map_err(|_| UpstreamFailure::RouteFailed)?,
        );
    }
    req.headers_mut().remove(PROXY_AUTHORIZATION);
    req.headers_mut().remove("proxy-connection");
    Ok(())
}
