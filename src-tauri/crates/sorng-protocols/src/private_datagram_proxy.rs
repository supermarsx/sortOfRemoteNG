//! Owner-bound datagram flows for a future native CONNECT-UDP adapter.
//!
//! This module exposes no listener, does no DNS or route selection, and does not
//! enable CEF QUIC. The supplied native dialer must preserve the selected route;
//! unsupported UDP routes must fail instead of falling back to direct traffic.
use crate::private_forward_proxy::{Authority, DestinationGrant};
use std::{
    collections::HashMap,
    future::Future,
    io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::Duration,
};
use tokio::{
    net::UdpSocket,
    sync::{Notify, OwnedSemaphorePermit, Semaphore},
    task::JoinHandle,
    time::Instant,
};

const MAX_PAYLOAD: usize = 65_507;
pub type DatagramFuture<'a, T> = Pin<Box<dyn Future<Output = io::Result<T>> + Send + 'a>>;
pub type DatagramOpenFuture =
    Pin<Box<dyn Future<Output = io::Result<Arc<dyn RouteDatagram>>> + Send>>;
pub type DatagramOwner = Arc<dyn Fn() -> bool + Send + Sync>;

/// Message boundaries must survive both operations. Dropping pending operations
/// or the last transport owner must cancel/release only that flow. Dialers must
/// not detach establishment work or permit peer/address migration.
pub trait RouteDatagram: Send + Sync {
    fn send<'a>(&'a self, bytes: &'a [u8]) -> DatagramFuture<'a, usize>;
    fn recv<'a>(&'a self, bytes: &'a mut [u8]) -> DatagramFuture<'a, usize>;
}
pub trait RouteDatagramDialer: Send + Sync {
    fn open(&self, authority: Authority) -> DatagramOpenFuture;
}

/// Adopts an already connected, native-owned UDP socket. Resolution, route
/// choice, socket policy/DF and certificate admission belong to its caller.
pub struct ConnectedUdpDatagram(UdpSocket);
impl ConnectedUdpDatagram {
    pub fn new(socket: UdpSocket) -> io::Result<Self> {
        socket.peer_addr()?;
        Ok(Self(socket))
    }
}
impl RouteDatagram for ConnectedUdpDatagram {
    fn send<'a>(&'a self, bytes: &'a [u8]) -> DatagramFuture<'a, usize> {
        Box::pin(self.0.send(bytes))
    }
    fn recv<'a>(&'a self, bytes: &'a mut [u8]) -> DatagramFuture<'a, usize> {
        Box::pin(self.0.recv(bytes))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DatagramError {
    #[error("Datagram owner or destination unavailable")]
    Unavailable,
    #[error("Datagram capacity exhausted")]
    Capacity,
    #[error("Datagram payload exceeds the flow limit")]
    PayloadTooLarge,
    #[error("Datagram operation timed out")]
    Timeout,
    #[error("Datagram transport failed")]
    Transport,
    #[error("Invalid datagram limits")]
    InvalidLimits,
}
#[derive(Clone, Copy)]
pub struct DatagramLimits {
    pub max_flows: usize,
    pub max_payload: usize,
    pub max_operations_per_flow: usize,
    pub open_timeout: Duration,
    pub io_timeout: Duration,
    pub lifetime: Duration,
    pub owner_poll: Duration,
}
impl Default for DatagramLimits {
    fn default() -> Self {
        Self {
            max_flows: 32,
            max_payload: 1232,
            max_operations_per_flow: 2,
            open_timeout: Duration::from_secs(10),
            io_timeout: Duration::from_secs(30),
            lifetime: Duration::from_secs(900),
            owner_poll: Duration::from_millis(100),
        }
    }
}
impl DatagramLimits {
    fn valid(self) -> bool {
        (1..=64).contains(&self.max_flows)
            && (1..=MAX_PAYLOAD).contains(&self.max_payload)
            && (1..=16).contains(&self.max_operations_per_flow)
            && !self.open_timeout.is_zero()
            && self.open_timeout <= Duration::from_secs(30)
            && !self.io_timeout.is_zero()
            && self.io_timeout <= Duration::from_secs(60)
            && !self.lifetime.is_zero()
            && self.lifetime <= Duration::from_secs(3600)
            && !self.owner_poll.is_zero()
            && self.owner_poll <= Duration::from_millis(250)
    }
}
struct ProxyState {
    owner: DatagramOwner,
    grant: DestinationGrant,
    revoked: AtomicBool,
    stop: Notify,
    flows: Mutex<HashMap<u64, Weak<FlowState>>>,
}
impl ProxyState {
    fn allowed(&self, authority: &Authority) -> bool {
        !self.revoked.load(Ordering::Acquire) && (self.owner)() && (self.grant)(authority)
    }
    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        self.stop.notify_waiters();
        let flows: Vec<_> = self
            .flows
            .lock()
            .unwrap()
            .values()
            .filter_map(Weak::upgrade)
            .collect();
        for flow in flows {
            flow.close();
        }
    }
}
struct FlowState {
    proxy: Weak<ProxyState>,
    authority: Authority,
    expires: Instant,
    transport: Mutex<Option<Arc<dyn RouteDatagram>>>,
    stop: Notify,
}
impl FlowState {
    fn active(&self) -> bool {
        Instant::now() < self.expires
            && self
                .proxy
                .upgrade()
                .is_some_and(|p| p.allowed(&self.authority))
            && self.transport.lock().unwrap().is_some()
    }
    fn close(&self) {
        let transport = self.transport.lock().unwrap().take();
        drop(transport);
        self.stop.notify_waiters();
    }
}

pub struct PrivateDatagramProxy {
    state: Arc<ProxyState>,
    dialer: Arc<dyn RouteDatagramDialer>,
    slots: Arc<Semaphore>,
    next_id: AtomicU64,
    limits: DatagramLimits,
    watcher: JoinHandle<()>,
}
impl PrivateDatagramProxy {
    /// Requires an active Tokio runtime. Callbacks must be native, synchronous,
    /// nonblocking and bind the exact current owner/document/destination scope.
    pub fn new(
        owner: DatagramOwner,
        grant: DestinationGrant,
        dialer: Arc<dyn RouteDatagramDialer>,
        limits: DatagramLimits,
    ) -> Result<Self, DatagramError> {
        if !limits.valid() {
            return Err(DatagramError::InvalidLimits);
        }
        let state = Arc::new(ProxyState {
            owner,
            grant,
            revoked: AtomicBool::new(false),
            stop: Notify::new(),
            flows: Mutex::new(HashMap::new()),
        });
        let weak = Arc::downgrade(&state);
        let watcher = tokio::spawn(async move {
            loop {
                tokio::time::sleep(limits.owner_poll).await;
                let Some(state) = weak.upgrade() else {
                    break;
                };
                if state.revoked.load(Ordering::Acquire) {
                    break;
                }
                if !(state.owner)() {
                    state.revoke();
                    break;
                }
                let flows: Vec<_> = state
                    .flows
                    .lock()
                    .unwrap()
                    .values()
                    .filter_map(Weak::upgrade)
                    .collect();
                for flow in flows {
                    if !flow.active() {
                        flow.close();
                    }
                }
            }
        });
        Ok(Self {
            state,
            dialer,
            slots: Arc::new(Semaphore::new(limits.max_flows)),
            next_id: AtomicU64::new(1),
            limits,
            watcher,
        })
    }
    pub fn revoke(&self) {
        self.state.revoke();
    }
    pub async fn open(&self, authority: Authority) -> Result<PrivateDatagramFlow, DatagramError> {
        if !self.state.allowed(&authority) {
            return Err(DatagramError::Unavailable);
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| DatagramError::Capacity)?;
        let id = self
            .next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
            .map_err(|_| DatagramError::Capacity)?;
        let mut opening = self.dialer.open(authority.clone());
        let expires = Instant::now() + self.limits.lifetime;
        let deadline = std::cmp::min(expires, Instant::now() + self.limits.open_timeout);
        let transport = loop {
            if !self.state.allowed(&authority) {
                return Err(DatagramError::Unavailable);
            }
            tokio::select! {
                biased;
                _ = self.state.stop.notified() => return Err(DatagramError::Unavailable),
                _ = tokio::time::sleep_until(deadline) => return Err(DatagramError::Timeout),
                _ = tokio::time::sleep(self.limits.owner_poll) => {},
                result = &mut opening => break result.map_err(|_| DatagramError::Transport)?,
            }
        };
        if !self.state.allowed(&authority) {
            return Err(DatagramError::Unavailable);
        }
        let state = Arc::new(FlowState {
            proxy: Arc::downgrade(&self.state),
            authority,
            expires,
            transport: Mutex::new(Some(transport)),
            stop: Notify::new(),
        });
        self.state
            .flows
            .lock()
            .unwrap()
            .insert(id, Arc::downgrade(&state));
        // Revocation may have raced the insertion; never publish a late flow.
        let flow = PrivateDatagramFlow {
            id,
            state,
            _permit: permit,
            operations: Semaphore::new(self.limits.max_operations_per_flow),
            limits: self.limits,
        };
        if !flow.state.active() {
            return Err(DatagramError::Unavailable);
        }
        Ok(flow)
    }
}
impl Drop for PrivateDatagramProxy {
    fn drop(&mut self) {
        self.state.revoke();
        self.watcher.abort();
    }
}
pub struct PrivateDatagramFlow {
    id: u64,
    state: Arc<FlowState>,
    _permit: OwnedSemaphorePermit,
    operations: Semaphore,
    limits: DatagramLimits,
}
impl PrivateDatagramFlow {
    pub fn revoke(&self) {
        self.state.close();
    }
    async fn operation<T>(
        &self,
        future: impl Future<Output = io::Result<T>>,
    ) -> Result<T, DatagramError> {
        // Register before checking the lease: notify_waiters does not retain a
        // permit for a future waiter. Revocation between the check and select
        // must still wake a blocked transport operation.
        let stopped = self.state.stop.notified();
        tokio::pin!(stopped);
        stopped.as_mut().enable();
        if !self.state.active() {
            self.state.close();
            return Err(DatagramError::Unavailable);
        }
        let _permit = self
            .operations
            .try_acquire()
            .map_err(|_| DatagramError::Capacity)?;
        let deadline = std::cmp::min(self.state.expires, Instant::now() + self.limits.io_timeout);
        let result = tokio::select! {
            biased;
            _ = &mut stopped => Err(DatagramError::Unavailable),
            _ = tokio::time::sleep_until(deadline) => Err(DatagramError::Timeout),
            result = future => result.map_err(|_| DatagramError::Transport),
        };
        if !self.state.active() {
            self.state.close();
            return Err(DatagramError::Unavailable);
        }
        result
    }
    fn transport(&self) -> Result<Arc<dyn RouteDatagram>, DatagramError> {
        self.state
            .transport
            .lock()
            .unwrap()
            .clone()
            .ok_or(DatagramError::Unavailable)
    }
    pub async fn send(&self, bytes: &[u8]) -> Result<(), DatagramError> {
        if bytes.len() > self.limits.max_payload {
            return Err(DatagramError::PayloadTooLarge);
        }
        let transport = self.transport()?;
        let written = self
            .operation(async { transport.send(bytes).await })
            .await?;
        if written != bytes.len() {
            return Err(DatagramError::Transport);
        }
        Ok(())
    }
    pub async fn recv(&self) -> Result<Vec<u8>, DatagramError> {
        let transport = self.transport()?;
        // A one-byte oversize sentinel detects truncation rather than turning
        // an oversized UDP message into an apparently valid smaller message.
        let (mut bytes, received) = self
            .operation(async {
                let mut bytes = vec![0; MAX_PAYLOAD + 1];
                let received = transport.recv(&mut bytes).await?;
                Ok((bytes, received))
            })
            .await?;
        if received > self.limits.max_payload || received > MAX_PAYLOAD {
            return Err(DatagramError::PayloadTooLarge);
        }
        bytes.truncate(received);
        Ok(bytes)
    }
}
impl Drop for PrivateDatagramFlow {
    fn drop(&mut self) {
        self.state.close();
        if let Some(proxy) = self.state.proxy.upgrade() {
            proxy.flows.lock().unwrap().remove(&self.id);
        }
    }
}

#[cfg(test)]
#[path = "private_datagram_proxy/tests.rs"]
mod tests;
