use super::*;
use crate::origin_browser::{
    BrowserSessionStatus, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
};
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::time::timeout;

const DEADLINE: Duration = Duration::from_secs(3);

async fn session(tab: &str, fail_first: bool) -> OriginBrowserSession {
    let calls = AtomicU32::new(0);
    let dialer = Arc::new(move |_: Authority| -> DialFuture {
        let fail = calls.fetch_add(1, Ordering::Relaxed) == 0 && fail_first;
        Box::pin(async move {
            if fail {
                return Err(io::Error::other("fixture upstream failure"));
            }
            // In-memory fixture: never dial a destination or fall back to one.
            let (upstream, peer) = tokio::io::duplex(64);
            drop(peer);
            Ok(Box::new(upstream) as BoxedStream)
        })
    });
    let policy = OriginBrowserPolicy::new(
        "fixture-db",
        "fixture-connection",
        tab,
        "https://fixture.invalid",
    )
    .unwrap();
    let mut session = OriginBrowserSession::start(policy, dialer, ProxyLimits::default())
        .await
        .unwrap();
    session
        .report_host(
            &session.policy().identity().clone(),
            NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().into(),
                proxy_endpoint: session.proxy_endpoint(),
            },
        )
        .unwrap();
    session
}

async fn exchange(session: &OriginBrowserSession, destination: &str, authenticated: bool) -> u16 {
    let authorization = if authenticated {
        session
            .with_proxy_credentials(|user, password| {
                format!(
                    "Proxy-Authorization: Basic {}\r\n",
                    base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
                )
            })
            .unwrap()
    } else {
        String::new()
    };
    timeout(DEADLINE, async {
        let mut client = TcpStream::connect(session.proxy_endpoint()).await.unwrap();
        client
            .write_all(
                format!(
                    "CONNECT {destination} HTTP/1.1\r\nHost: {destination}\r\n{authorization}\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut response = Vec::new();
        while !response.ends_with(b"\r\n\r\n") {
            assert!(response.len() < 4096);
            response.push(client.read_u8().await.unwrap());
        }
        std::str::from_utf8(&response)
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap()
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn failed_requests_leave_own_listener_and_independent_session_alive() {
    let mut first = session("first", true).await;
    let mut second = session("second", false).await;
    let untouched = second.proxy_diagnostics();
    assert_eq!(untouched.state, PrivateProxyState::Listening);
    assert_eq!(untouched.accepted_connections, 0);

    assert_eq!(exchange(&first, "fixture.invalid:443", false).await, 407);
    assert_eq!(exchange(&first, "denied.invalid:443", true).await, 403);
    assert_eq!(exchange(&first, "fixture.invalid:443", true).await, 502);
    assert_eq!(first.status(), BrowserSessionStatus::Ready);
    assert_eq!(second.proxy_diagnostics(), untouched);
    assert_eq!(exchange(&first, "fixture.invalid:443", true).await, 200);
    assert_eq!(exchange(&second, "fixture.invalid:443", true).await, 200);

    let observed = first.proxy_diagnostics();
    assert_eq!(observed.state, PrivateProxyState::Listening);
    assert_eq!(observed.accepted_connections, 4);
    assert_eq!(observed.authentication_challenges, 1);
    assert_eq!(observed.authenticated_requests, 3);
    assert_eq!(observed.destination_denials, 1);
    assert_eq!(observed.upstream_failures, 1);
    assert_eq!(observed.request_rejections, 0);
    assert_eq!(observed.capacity_refusals, 0);
    let independent = second.proxy_diagnostics();
    assert_eq!(independent.accepted_connections, 1);
    assert_eq!(independent.authenticated_requests, 1);
    assert_eq!(independent.upstream_failures, 0);
    assert_eq!(independent.destination_denials, 0);

    first.revoke(&first.policy().identity().clone()).unwrap();
    assert_eq!(first.proxy_diagnostics().state, PrivateProxyState::Revoking);
    timeout(DEADLINE, first.stop()).await.unwrap().unwrap();
    let stopped = first.proxy_diagnostics();
    assert_eq!(stopped.state, PrivateProxyState::Stopped);
    assert_eq!(stopped.accepted_connections, observed.accepted_connections);
    assert_eq!(second.proxy_diagnostics(), independent);
    assert_eq!(exchange(&second, "fixture.invalid:443", true).await, 200);
    timeout(DEADLINE, second.stop()).await.unwrap().unwrap();
}

#[tokio::test]
async fn task_exit_is_distinct_from_idle_listener_and_survives_cleanup() {
    let mut proxy = PrivateForwardProxy::start(
        Arc::new(|_: Authority| -> DialFuture {
            Box::pin(async { Err(io::Error::other("fixture must not dial")) })
        }),
        Arc::new(|_| false),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert_eq!(proxy.diagnostics().state, PrivateProxyState::Listening);
    assert_eq!(proxy.diagnostics().accepted_connections, 0);
    proxy.task.as_ref().unwrap().abort();
    timeout(DEADLINE, async {
        while !proxy.task.as_ref().unwrap().is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(proxy.diagnostics().state, PrivateProxyState::TaskEnded);
    assert!(timeout(DEADLINE, proxy.stop()).await.unwrap().is_err());
    assert_eq!(proxy.diagnostics().state, PrivateProxyState::TaskEnded);
    assert_eq!(proxy.diagnostics().accepted_connections, 0);
}
