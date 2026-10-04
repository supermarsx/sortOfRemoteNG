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
