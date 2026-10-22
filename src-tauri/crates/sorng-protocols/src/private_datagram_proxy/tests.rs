use super::*;
use std::sync::atomic::AtomicUsize;

struct UdpDialer {
    peer: std::net::SocketAddr,
    opens: AtomicUsize,
}
impl RouteDatagramDialer for UdpDialer {
    fn open(&self, _: Authority) -> DatagramOpenFuture {
        self.opens.fetch_add(1, Ordering::SeqCst);
        let peer = self.peer;
        Box::pin(async move {
            let socket = UdpSocket::bind("127.0.0.1:0").await?;
            socket.connect(peer).await?;
            Ok(Arc::new(ConnectedUdpDatagram::new(socket)?) as Arc<dyn RouteDatagram>)
        })
    }
}
fn authority() -> Authority {
    Authority::parse("fixture.test:443").unwrap()
}
fn limits() -> DatagramLimits {
    DatagramLimits {
        owner_poll: Duration::from_millis(5),
        io_timeout: Duration::from_millis(150),
        ..Default::default()
    }
}
fn proxy(
    dialer: Arc<dyn RouteDatagramDialer>,
    owner: Arc<AtomicBool>,
    grant: Arc<AtomicBool>,
    limits: DatagramLimits,
) -> PrivateDatagramProxy {
    PrivateDatagramProxy::new(
        Arc::new(move || owner.load(Ordering::SeqCst)),
        Arc::new(move |a| a == &authority() && grant.load(Ordering::SeqCst)),
        dialer,
        limits,
    )
    .unwrap()
}
async fn fixture() -> (UdpSocket, Arc<UdpDialer>) {
    let peer = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let dialer = Arc::new(UdpDialer {
        peer: peer.local_addr().unwrap(),
        opens: AtomicUsize::new(0),
    });
    (peer, dialer)
}

#[tokio::test]
async fn connected_loopback_preserves_messages_zero_length_and_peer_filter() {
    let (peer, dialer) = fixture().await;
    let proxy = proxy(
        dialer,
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        limits(),
    );
    let flow = proxy.open(authority()).await.unwrap();
    let mut bytes = [0; 32];
    for payload in [
        b"one".as_slice(),
        b"".as_slice(),
        b"two separate messages".as_slice(),
    ] {
        flow.send(payload).await.unwrap();
        let (n, client) = peer.recv_from(&mut bytes).await.unwrap();
        assert_eq!(&bytes[..n], payload);
        // A different socket must not inject into a connected flow.
        let foreign = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        foreign.send_to(b"foreign", client).await.unwrap();
        peer.send_to(payload, client).await.unwrap();
        assert_eq!(flow.recv().await.unwrap(), payload);
    }
}

#[tokio::test]
async fn denied_owner_and_destination_never_open_transport() {
    let (_, dialer) = fixture().await;
    let owner = Arc::new(AtomicBool::new(false));
    let grant = Arc::new(AtomicBool::new(true));
    let proxy = proxy(dialer.clone(), owner.clone(), grant.clone(), limits());
    assert!(matches!(
        proxy.open(authority()).await,
        Err(DatagramError::Unavailable)
    ));
    owner.store(true, Ordering::SeqCst);
    assert!(matches!(
        proxy
            .open(Authority::parse("foreign.test:443").unwrap())
            .await,
        Err(DatagramError::Unavailable)
    ));
    grant.store(false, Ordering::SeqCst);
    assert!(matches!(
        proxy.open(authority()).await,
        Err(DatagramError::Unavailable)
    ));
    assert_eq!(dialer.opens.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn flow_capacity_releases_on_drop_and_other_proxy_survives_revoke() {
    let (peer, dialer) = fixture().await;
    let one = DatagramLimits {
        max_flows: 1,
        ..limits()
    };
    let a = proxy(
        dialer.clone(),
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        one,
    );
    let b = proxy(
        dialer,
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        one,
    );
    let first = a.open(authority()).await.unwrap();
    assert!(matches!(
        a.open(authority()).await,
        Err(DatagramError::Capacity)
    ));
    drop(first);
    let replacement = a.open(authority()).await.unwrap();
    let other = b.open(authority()).await.unwrap();
    a.revoke();
    assert_eq!(
        replacement.send(b"denied").await,
        Err(DatagramError::Unavailable)
    );
    other.send(b"live").await.unwrap();
    let mut bytes = [0; 16];
    let (n, _) = peer.recv_from(&mut bytes).await.unwrap();
    assert_eq!(&bytes[..n], b"live");
}

#[tokio::test]
async fn oversized_messages_are_not_sent_or_silently_truncated() {
    let (peer, dialer) = fixture().await;
    let proxy = proxy(
        dialer,
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        DatagramLimits {
            max_payload: 8,
            ..limits()
        },
    );
    let flow = proxy.open(authority()).await.unwrap();
    assert_eq!(
        flow.send(b"123456789").await,
        Err(DatagramError::PayloadTooLarge)
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(20), peer.readable())
            .await
            .is_err()
    );
    flow.send(b"identify").await.unwrap();
    let mut bytes = [0; 32];
    let (_, client) = peer.recv_from(&mut bytes).await.unwrap();
    peer.send_to(b"123456789", client).await.unwrap();
    assert_eq!(flow.recv().await, Err(DatagramError::PayloadTooLarge));
    peer.send_to(b"valid", client).await.unwrap();
    assert_eq!(flow.recv().await.unwrap(), b"valid");
}

#[tokio::test]
async fn revoked_owner_destination_and_proxy_drop_cancel_pending_receives() {
    for mode in 0..3 {
        let (_, dialer) = fixture().await;
        let owner = Arc::new(AtomicBool::new(true));
        let grant = Arc::new(AtomicBool::new(true));
        let proxy = proxy(dialer, owner.clone(), grant.clone(), limits());
        let flow = proxy.open(authority()).await.unwrap();
        let mut receive = Box::pin(flow.recv());
        assert!(futures_util::poll!(&mut receive).is_pending());
        match mode {
            0 => owner.store(false, Ordering::SeqCst),
            1 => grant.store(false, Ordering::SeqCst),
            _ => drop(proxy),
        }
        assert_eq!(
            tokio::time::timeout(Duration::from_millis(100), receive)
                .await
                .unwrap(),
            Err(DatagramError::Unavailable)
        );
        assert_eq!(flow.send(b"late").await, Err(DatagramError::Unavailable));
    }
}

#[tokio::test]
async fn operation_capacity_timeout_and_hard_lifetime_are_bounded() {
    let (_, dialer) = fixture().await;
    let proxy = proxy(
        dialer,
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        DatagramLimits {
            max_operations_per_flow: 1,
            io_timeout: Duration::from_millis(20),
            lifetime: Duration::from_millis(70),
            ..limits()
        },
    );
    let flow = proxy.open(authority()).await.unwrap();
    let mut receive = Box::pin(flow.recv());
    assert!(futures_util::poll!(&mut receive).is_pending());
    assert_eq!(flow.send(b"busy").await, Err(DatagramError::Capacity));
    assert_eq!(receive.await, Err(DatagramError::Timeout));
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert_eq!(flow.send(b"expired").await, Err(DatagramError::Unavailable));
}

struct PendingDialer {
    started: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}
struct DropMark(Arc<AtomicUsize>);
impl Drop for DropMark {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
impl RouteDatagramDialer for PendingDialer {
    fn open(&self, _: Authority) -> DatagramOpenFuture {
        let started = self.started.clone();
        let dropped = self.dropped.clone();
        Box::pin(async move {
            let _mark = DropMark(dropped);
            started.fetch_add(1, Ordering::SeqCst);
            std::future::pending().await
        })
    }
}

#[tokio::test]
async fn pending_establishment_is_cancelled_without_detached_work_or_slot_leak() {
    let started = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let proxy = proxy(
        Arc::new(PendingDialer {
            started: started.clone(),
            dropped: dropped.clone(),
        }),
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicBool::new(true)),
        DatagramLimits {
            max_flows: 1,
            open_timeout: Duration::from_millis(20),
            ..limits()
        },
    );
    {
        let mut opening = Box::pin(proxy.open(authority()));
        assert!(futures_util::poll!(&mut opening).is_pending());
        assert_eq!(started.load(Ordering::SeqCst), 1);
    }
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    assert_eq!(proxy.slots.available_permits(), 1);
    assert!(matches!(
        proxy.open(authority()).await,
        Err(DatagramError::Timeout)
    ));
    assert_eq!(dropped.load(Ordering::SeqCst), 2);
    let mut opening = Box::pin(proxy.open(authority()));
    assert!(futures_util::poll!(&mut opening).is_pending());
    proxy.revoke();
    assert!(matches!(opening.await, Err(DatagramError::Unavailable)));
    assert_eq!(dropped.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn invalid_limits_and_unconnected_sockets_fail_closed() {
    let (_, dialer) = fixture().await;
    assert!(matches!(
        PrivateDatagramProxy::new(
            Arc::new(|| true),
            Arc::new(|_| true),
            dialer,
            DatagramLimits {
                max_flows: 0,
                ..limits()
            }
        ),
        Err(DatagramError::InvalidLimits)
    ));
    assert!(ConnectedUdpDatagram::new(UdpSocket::bind("127.0.0.1:0").await.unwrap()).is_err());
}

struct LateTransport(Arc<AtomicUsize>);
impl Drop for LateTransport {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
impl RouteDatagram for LateTransport {
    fn send<'a>(&'a self, _: &'a [u8]) -> DatagramFuture<'a, usize> {
        panic!("late transport must not be published")
    }
    fn recv<'a>(&'a self, _: &'a mut [u8]) -> DatagramFuture<'a, usize> {
        panic!("late transport must not be published")
    }
}
struct LateDialer {
    owner: Arc<AtomicBool>,
    dropped: Arc<AtomicUsize>,
}
impl RouteDatagramDialer for LateDialer {
    fn open(&self, _: Authority) -> DatagramOpenFuture {
        let owner = self.owner.clone();
        let dropped = self.dropped.clone();
        Box::pin(async move {
            owner.store(false, Ordering::SeqCst);
            Ok(Arc::new(LateTransport(dropped)) as Arc<dyn RouteDatagram>)
        })
    }
}
#[tokio::test]
async fn owner_changed_during_successful_open_discards_transport_and_reservation() {
    let owner = Arc::new(AtomicBool::new(true));
    let dropped = Arc::new(AtomicUsize::new(0));
    let proxy = proxy(
        Arc::new(LateDialer {
            owner: owner.clone(),
            dropped: dropped.clone(),
        }),
        owner,
        Arc::new(AtomicBool::new(true)),
        limits(),
    );
    assert!(matches!(
        proxy.open(authority()).await,
        Err(DatagramError::Unavailable)
    ));
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    assert_eq!(proxy.slots.available_permits(), limits().max_flows);
    assert!(proxy.state.flows.lock().unwrap().is_empty());
}

#[tokio::test]
async fn idle_watcher_has_no_periodic_owner_polls_and_new_flows_wake_it() {
    let (_peer, dialer) = fixture().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let owner = Arc::new(AtomicBool::new(true));
    let observed = calls.clone();
    let current = owner.clone();
    let proxy = PrivateDatagramProxy::new(
        Arc::new(move || {
            observed.fetch_add(1, Ordering::SeqCst);
            current.load(Ordering::SeqCst)
        }),
        Arc::new(|_| true),
        dialer,
        limits(),
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(35)).await;
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "idle proxy polled its owner"
    );
    let first = proxy.open(authority()).await.unwrap();
    let before = calls.load(Ordering::SeqCst);
    tokio::time::timeout(Duration::from_millis(100), async {
        while calls.load(Ordering::SeqCst) == before {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    first.revoke();
    let idle = calls.load(Ordering::SeqCst);
    // Retain the closed handle: it must not keep the timer running.
    tokio::time::sleep(Duration::from_millis(35)).await;
    assert_eq!(
        calls.load(Ordering::SeqCst),
        idle,
        "closed flow kept owner polling alive"
    );
    let next = proxy.open(authority()).await.unwrap();
    let mut receive = Box::pin(next.recv());
    assert!(futures_util::poll!(&mut receive).is_pending());
    owner.store(false, Ordering::SeqCst);
    assert_eq!(
        tokio::time::timeout(Duration::from_millis(100), receive)
            .await
            .unwrap(),
        Err(DatagramError::Unavailable)
    );
}
