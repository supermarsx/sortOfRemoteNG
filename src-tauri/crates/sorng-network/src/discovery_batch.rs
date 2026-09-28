//! Bounded, single-host port batches for one IPC round trip.
//!
//! This module does not own Tauri commands or the scanner's global permits.
//! Callers reserve the entire batch against their global limit before invoking
//! it. At most `parallelism` port checks are live here; the batch spawns no tasks.

use crate::network::{service_probe, PortCheckResult};
use futures::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::future::Future;
use std::net::IpAddr;

const MAX_BATCH_SIZE: usize = 32;
const MAX_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryBatchProbe {
    pub port: u16,
    pub identify_http: Option<String>,
    pub identify_protocol: Option<String>,
}

/// Check a literal-IP host with bounded concurrency and input-ordered results.
///
/// Validate the entire request before starting any connection. Ports must be
/// nonzero and unique, there may be at most 32 probes, parallelism is 1..=32,
/// and the per-port connect timeout is 1..=30 seconds. An empty batch is valid.
/// Identification/banner deadlines remain owned by `service_probe`; the timeout
/// is not a wall-clock deadline for all batch waves. Dropping this future drops
/// its in-flight port futures, without detached batch workers.
pub async fn probe_discovery_batch(
    host: String,
    probes: Vec<DiscoveryBatchProbe>,
    timeout_secs: u64,
    parallelism: usize,
) -> Result<Vec<PortCheckResult>, String> {
    let address = validate_batch(&host, &probes, timeout_secs, parallelism)?;
    let host = address.to_string();
    // Legacy passive check_port formats host:port. Its identification paths
    // instead parse a bare IP into SocketAddr. Keep both IPv6 contracts intact.
    let passive_host = match address {
        IpAddr::V6(_) => format!("[{address}]"),
        IpAddr::V4(_) => host.clone(),
    };
    run_bounded(probes, parallelism, |probe| {
        let probe_host = if probe.identify_http.is_none() && probe.identify_protocol.is_none() {
            passive_host.clone()
        } else {
            host.clone()
        };
        service_probe::check_port(
            probe_host,
            probe.port,
            Some(timeout_secs),
            probe.identify_http,
            probe.identify_protocol,
        )
    })
    .await
}

fn validate_batch(
    host: &str,
    probes: &[DiscoveryBatchProbe],
    timeout_secs: u64,
    parallelism: usize,
) -> Result<IpAddr, String> {
    let address = host.parse::<IpAddr>().map_err(|_| "batch_requires_ip")?;
    if probes.len() > MAX_BATCH_SIZE {
        return Err("invalid_batch_size".into());
    }
    if !(1..=MAX_BATCH_SIZE).contains(&parallelism) {
        return Err("invalid_batch_parallelism".into());
    }
    if !(1..=MAX_TIMEOUT_SECS).contains(&timeout_secs) {
        return Err("invalid_batch_timeout".into());
    }
    let mut ports = HashSet::with_capacity(probes.len());
    for probe in probes {
        if probe.port == 0 {
            return Err("invalid_batch_port".into());
        }
        if !ports.insert(probe.port) {
            return Err("duplicate_batch_port".into());
        }
        if !matches!(
            probe.identify_http.as_deref(),
            None | Some("http" | "https")
        ) {
            return Err("invalid_identification_scheme".into());
        }
        if !matches!(
            probe.identify_protocol.as_deref(),
            None | Some("smb" | "rdp" | "postgresql" | "postgres")
        ) {
            return Err("invalid_identification_protocol".into());
        }
        if probe.identify_http.is_some() && probe.identify_protocol.is_some() {
            return Err("conflicting_identification_modes".into());
        }
    }
    Ok(address)
}

async fn run_bounded<P, T, F, Fut>(
    probes: Vec<P>,
    parallelism: usize,
    mut check: F,
) -> Result<Vec<T>, String>
where
    F: FnMut(P) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut results = Vec::with_capacity(probes.len());
    let mut pending = probes.into_iter().enumerate();
    let mut active = FuturesUnordered::new();
    loop {
        // Construct and poll only as many futures as this batch has permits.
        while active.len() < parallelism {
            let Some((index, probe)) = pending.next() else {
                break;
            };
            let future = check(probe);
            active.push(async move { (index, future.await) });
        }
        let Some((index, result)) = active.next().await else {
            break;
        };
        results.push((index, result?));
    }
    results.sort_unstable_by_key(|(index, _)| *index);
    Ok(results.into_iter().map(|(_, result)| result).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::{mpsc, oneshot};
    use tokio::time::timeout;

    fn probe(port: u16) -> DiscoveryBatchProbe {
        DiscoveryBatchProbe {
            port,
            identify_http: None,
            identify_protocol: None,
        }
    }

    #[test]
    fn accepts_literal_hosts_limits_and_optional_camel_case_fields() {
        for host in ["127.0.0.1", "192.0.2.1", "2001:db8::1", "::1"] {
            for (seconds, parallelism) in [(1, 1), (30, 32)] {
                let probes: Vec<_> = (1..=32).map(probe).collect();
                assert_eq!(
                    validate_batch(host, &probes, seconds, parallelism)
                        .unwrap()
                        .to_string(),
                    host
                );
            }
        }
        assert!(validate_batch("::1", &[], 1, 1).is_ok());
        for protocol in ["smb", "rdp", "postgresql", "postgres"] {
            let mut request = probe(12345);
            request.identify_protocol = Some(protocol.into());
            assert!(validate_batch("127.0.0.1", &[request], 1, 1).is_ok());
        }
        let request: DiscoveryBatchProbe =
            serde_json::from_str(r#"{"port":443,"identifyHttp":"https","identifyProtocol":null}"#)
                .unwrap();
        assert_eq!(request.identify_http.as_deref(), Some("https"));
        assert!(validate_batch("::1", std::slice::from_ref(&request), 1, 1).is_ok());
        assert_eq!(
            serde_json::to_value(request).unwrap()["identifyHttp"],
            "https"
        );
        assert_eq!(
            serde_json::from_str::<DiscoveryBatchProbe>(r#"{"port":22}"#).unwrap(),
            probe(22)
        );
        assert!(serde_json::from_str::<DiscoveryBatchProbe>(
            r#"{"port":22,"identify_protocol":"ssh"}"#
        )
        .is_err());
    }

    #[test]
    fn rejects_invalid_hosts_ports_schemes_protocols_and_bounds() {
        for host in [
            "localhost",
            "127.0.0.1:80",
            "[::1]",
            "fe80::1%eth0",
            "http://127.0.0.1",
            "127.0.0.1/path",
            " 127.0.0.1",
            "",
        ] {
            assert_eq!(
                validate_batch(host, &[probe(80)], 1, 1).unwrap_err(),
                "batch_requires_ip"
            );
        }
        for parallelism in [0, 33, usize::MAX] {
            assert_eq!(
                validate_batch("127.0.0.1", &[], 1, parallelism).unwrap_err(),
                "invalid_batch_parallelism"
            );
        }
        for seconds in [0, 31, u64::MAX] {
            assert_eq!(
                validate_batch("127.0.0.1", &[], seconds, 1).unwrap_err(),
                "invalid_batch_timeout"
            );
        }
        assert_eq!(
            validate_batch("127.0.0.1", &(1..=33).map(probe).collect::<Vec<_>>(), 1, 1)
                .unwrap_err(),
            "invalid_batch_size"
        );
        assert_eq!(
            validate_batch("127.0.0.1", &[probe(80), probe(0)], 1, 1).unwrap_err(),
            "invalid_batch_port"
        );
        assert_eq!(
            validate_batch("127.0.0.1", &[probe(80), probe(80)], 1, 1).unwrap_err(),
            "duplicate_batch_port"
        );
        for scheme in ["", "HTTP", "ftp", "https://", " http"] {
            let mut invalid = probe(80);
            invalid.identify_http = Some(scheme.into());
            assert_eq!(
                validate_batch("127.0.0.1", &[invalid], 1, 1).unwrap_err(),
                "invalid_identification_scheme"
            );
        }
        for protocol in ["", "not-a-protocol", "SMB", " rdp"] {
            let mut invalid = probe(80);
            invalid.identify_protocol = Some(protocol.into());
            assert_eq!(
                validate_batch("127.0.0.1", &[invalid], 1, 1).unwrap_err(),
                "invalid_identification_protocol"
            );
        }
        let mut conflict = probe(80);
        conflict.identify_http = Some("http".into());
        conflict.identify_protocol = Some("smb".into());
        assert_eq!(
            validate_batch("127.0.0.1", &[conflict], 1, 1).unwrap_err(),
            "conflicting_identification_modes"
        );
    }

    #[tokio::test]
    async fn late_invalid_probe_rejects_whole_batch_before_connect() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        for invalid in [
            probe(0),
            probe(port),
            DiscoveryBatchProbe {
                port: 1,
                identify_http: Some("ftp".into()),
                identify_protocol: None,
            },
            DiscoveryBatchProbe {
                port: 1,
                identify_http: None,
                identify_protocol: Some("not-a-protocol".into()),
            },
            DiscoveryBatchProbe {
                port: 1,
                identify_http: Some("http".into()),
                identify_protocol: Some("smb".into()),
            },
        ] {
            assert!(
                probe_discovery_batch("127.0.0.1".into(), vec![probe(port), invalid], 1, 2)
                    .await
                    .is_err()
            );
        }
        assert!(timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err());
    }

    struct LiveGuard(Arc<AtomicUsize>);
    impl Drop for LiveGuard {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn worker_bound_refills_without_spawning_all_and_preserves_input_order() {
        for parallelism in [1, 3, 32] {
            let live = Arc::new(AtomicUsize::new(0));
            let peak = Arc::new(AtomicUsize::new(0));
            let constructed = Arc::new(AtomicUsize::new(0));
            let (started, mut starts) = mpsc::unbounded_channel();
            let mut releases = Vec::new();
            let mut jobs = Vec::new();
            for index in 0..32 {
                let (release, released) = oneshot::channel();
                releases.push(Some(release));
                jobs.push((index, released));
            }
            let work_live = live.clone();
            let work_peak = peak.clone();
            let work_constructed = constructed.clone();
            let work = tokio::spawn(async move {
                run_bounded(jobs, parallelism, |(index, released)| {
                    work_constructed.fetch_add(1, Ordering::SeqCst);
                    let live = work_live.clone();
                    let peak = work_peak.clone();
                    let started = started.clone();
                    async move {
                        let count = live.fetch_add(1, Ordering::SeqCst) + 1;
                        let _guard = LiveGuard(live);
                        peak.fetch_max(count, Ordering::SeqCst);
                        started.send(index).unwrap();
                        released.await.unwrap();
                        Ok(index)
                    }
                })
                .await
            });
            let mut active = Vec::new();
            let mut total_started = 0;
            for _ in 0..parallelism {
                active.push(
                    timeout(Duration::from_secs(3), starts.recv())
                        .await
                        .unwrap()
                        .unwrap(),
                );
                total_started += 1;
            }
            assert!(starts.try_recv().is_err());
            assert_eq!(constructed.load(Ordering::SeqCst), parallelism);
            // Finish the newest job first to force out-of-order completion.
            while let Some(index) = active.pop() {
                releases[index].take().unwrap().send(()).unwrap();
                if total_started < 32 {
                    active.push(
                        timeout(Duration::from_secs(3), starts.recv())
                            .await
                            .unwrap()
                            .unwrap(),
                    );
                    total_started += 1;
                }
                assert!(starts.try_recv().is_err());
            }
            let result = timeout(Duration::from_secs(3), work)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            assert_eq!(result, (0..32).collect::<Vec<_>>());
            assert_eq!(peak.load(Ordering::SeqCst), parallelism);
            assert_eq!(live.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn dropping_batch_drops_active_workers_without_starting_the_queue() {
        let live = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(AtomicUsize::new(0));
        let work_live = live.clone();
        let work_started = started.clone();
        let work = run_bounded((0..32).collect(), 2, move |index| {
            let live = work_live.clone();
            let started = work_started.clone();
            async move {
                live.fetch_add(1, Ordering::SeqCst);
                started.fetch_add(1, Ordering::SeqCst);
                let _guard = LiveGuard(live);
                std::future::pending::<()>().await;
                Ok(index)
            }
        });
        assert!(timeout(Duration::from_millis(20), work).await.is_err());
        assert_eq!(started.load(Ordering::SeqCst), 2);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn returns_open_and_closed_loopback_results_in_requested_order() {
        let first = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let second = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let first_port = first.local_addr().unwrap().port();
        let second_port = second.local_addr().unwrap().port();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        let server = tokio::spawn(async move {
            let serve = |listener: TcpListener, banner: &'static [u8]| async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                stream.write_all(banner).await.unwrap();
            };
            tokio::join!(
                serve(first, b"first-local-fixture"),
                serve(second, b"second-local-fixture")
            );
        });
        let results = timeout(
            Duration::from_secs(5),
            probe_discovery_batch(
                "127.0.0.1".into(),
                vec![probe(second_port), probe(closed_port), probe(first_port)],
                1,
                2,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            results.iter().map(|result| result.port).collect::<Vec<_>>(),
            [second_port, closed_port, first_port]
        );
        assert!(results[0].open);
        assert_eq!(results[0].banner.as_deref(), Some("second-local-fixture"));
        assert!(!results[1].open);
        assert!(results[2].open);
        assert_eq!(results[2].banner.as_deref(), Some("first-local-fixture"));
        let json = serde_json::to_value(&results[0]).unwrap();
        assert!(json.get("time_ms").is_some());
        assert!(json.get("timeMs").is_none());
        timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn worker_error_drops_other_workers_and_does_not_start_queued_probes() {
        let live = Arc::new(AtomicUsize::new(0));
        let constructed = Arc::new(AtomicUsize::new(0));
        let result = run_bounded(vec![0, 1, 2], 2, |index| {
            constructed.fetch_add(1, Ordering::SeqCst);
            let live = live.clone();
            async move {
                live.fetch_add(1, Ordering::SeqCst);
                let _guard = LiveGuard(live);
                if index == 1 {
                    return Err("injected worker failure".into());
                }
                std::future::pending::<()>().await;
                Ok(index)
            }
        })
        .await;
        assert_eq!(result.unwrap_err(), "injected worker failure");
        assert_eq!(constructed.load(Ordering::SeqCst), 2);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn forwards_http_identification_to_local_fixture() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (passive, _) = listener.accept().await.unwrap();
            drop(passive);
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") && request.len() < 4096 {
                request.push(stream.read_u8().await.unwrap());
            }
            assert!(request.starts_with(b"GET / HTTP/1.1\r\n"));
            let body = "<title>Batch fixture</title>";
            stream.write_all(format!("HTTP/1.1 200 OK\r\nServer: local-batch\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let mut request = probe(port);
        request.identify_http = Some("http".into());
        let results = timeout(
            Duration::from_secs(5),
            probe_discovery_batch("127.0.0.1".into(), vec![request], 1, 1),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(results[0].open);
        assert_eq!(results[0].http_status, Some(200));
        assert_eq!(results[0].http_title.as_deref(), Some("Batch fixture"));
        assert_eq!(results[0].http_server.as_deref(), Some("local-batch"));
        timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn passive_ipv6_literal_reaches_local_fixture() {
        let listener = TcpListener::bind("[::1]:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"IPv6-local-fixture").await.unwrap();
        });
        let results = timeout(
            Duration::from_secs(5),
            probe_discovery_batch("::1".into(), vec![probe(port)], 1, 1),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(results[0].open);
        assert_eq!(results[0].banner.as_deref(), Some("IPv6-local-fixture"));
        timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn empty_batch_returns_no_results() {
        assert!(probe_discovery_batch("::1".into(), vec![], 1, 32)
            .await
            .unwrap()
            .is_empty());
    }
}
