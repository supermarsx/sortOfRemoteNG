//! Public-API boundaries for native proxy challenge credential release.
//!
//! No native engine is started: challenge metadata is synthetic and must still
//! come from a trusted native callback in production. The only sockets are the
//! session's loopback listeners; no destination is dialled. Tests do not expose
//! private proxy credentials in failure messages or certify browser readiness.

use base64::Engine;
use sorng_protocols::origin_browser::{
    BrowserIdentity, BrowserPolicyError, BrowserSessionStatus, HostUnavailableReason,
    NativeHostReadiness, NativeProxyChallenge, OriginBrowserPolicy, OriginBrowserSession,
};
use sorng_protocols::private_forward_proxy::{Authority, DialFuture, ProxyLimits};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use zeroize::Zeroizing;

const DEADLINE: Duration = Duration::from_secs(5);

async fn session() -> OriginBrowserSession {
    // Deliberately reuse the same visible identifiers. Only the native attempt
    // identity, retained endpoint and its random secret distinguish reconnects.
    let policy = OriginBrowserPolicy::new(
        "fixture-owner",
        "fixture-connection",
        "fixture-tab",
        "https://source.invalid",
    )
    .unwrap();
    OriginBrowserSession::start(
        policy,
        Arc::new(|_: Authority| -> DialFuture {
            panic!("authentication boundary test must never dial a destination")
        }),
        ProxyLimits::default(),
    )
    .await
    .unwrap()
}

fn challenge(host: &str, port: u16) -> NativeProxyChallenge<'_> {
    NativeProxyChallenge {
        is_proxy: true,
        host,
        port,
        scheme: "Basic",
        realm: "private-forward-proxy",
    }
}

fn assert_rejected(
    session: &OriginBrowserSession,
    identity: &BrowserIdentity,
    challenge: NativeProxyChallenge<'_>,
) {
    assert!(session
        .answer_proxy_challenge(identity, challenge, |_, _| {
            panic!("rejected challenge invoked the credential callback")
        })
        .is_none());
}

async fn reply(endpoint: SocketAddr, authorization: &str) -> Vec<u8> {
    assert!(endpoint.ip().is_loopback());
    timeout(DEADLINE, async {
        let mut stream = TcpStream::connect(endpoint).await.unwrap();
        // Auth must succeed before the ungranted authority is rejected. No
        // upstream socket is needed to distinguish valid credentials (403)
        // from another attempt's credentials (407).
        let request = Zeroizing::new(format!(
            "CONNECT denied.invalid:443 HTTP/1.1\r\nHost: denied.invalid:443\r\nProxy-Authorization: Basic {authorization}\r\n\r\n"
        ));
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        while !response.ends_with(b"\r\n\r\n") {
            response.push(stream.read_u8().await.unwrap());
            assert!(response.len() < 8192);
        }
        response
    })
    .await
    .expect("loopback authentication exchange timed out")
}

async fn stop(session: &mut OriginBrowserSession) {
    timeout(DEADLINE, session.stop()).await.unwrap().unwrap();
}

#[tokio::test]
async fn challenge_answer_authenticates_only_its_own_live_attempt_without_granting_navigation() {
    let mut first = session().await;
    let mut second = session().await;
    let identity = first.policy().identity().clone();
    assert!(identity != *second.policy().identity());
    assert_ne!(first.proxy_endpoint(), second.proxy_endpoint());
    let host = first.proxy_endpoint().ip().to_string();
    let authorization = first
        .answer_proxy_challenge(
            &identity,
            challenge(&host, first.proxy_endpoint().port()),
            |user, password| {
                let credentials = Zeroizing::new(format!("{user}:{password}"));
                Zeroizing::new(
                    base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes()),
                )
            },
        )
        .expect("matching native challenge must receive authentication during setup");
    assert!(reply(first.proxy_endpoint(), &authorization)
        .await
        .starts_with(b"HTTP/1.1 403 "));
    assert!(reply(second.proxy_endpoint(), &authorization)
        .await
        .starts_with(b"HTTP/1.1 407 "));
    assert_eq!(first.status(), BrowserSessionStatus::NotReady);
    assert_eq!(second.status(), BrowserSessionStatus::NotReady);
    assert_eq!(
        first.authorize_navigation(&identity, "https://source.invalid/login"),
        Err(BrowserPolicyError::NotReady)
    );
    stop(&mut first).await;
    stop(&mut second).await;
}

#[tokio::test]
async fn forged_or_cross_attempt_challenges_never_invoke_callback_or_poison_setup() {
    let mut first = session().await;
    let mut second = session().await;
    let identity = first.policy().identity().clone();
    let host = first.proxy_endpoint().ip().to_string();
    let port = first.proxy_endpoint().port();
    // A valid different proxy port is more realistic than just port zero.
    assert_rejected(
        &first,
        &identity,
        challenge(&host, second.proxy_endpoint().port()),
    );
    assert_rejected(&first, second.policy().identity(), challenge(&host, port));
    assert_rejected(
        &first,
        &identity,
        NativeProxyChallenge {
            is_proxy: false,
            ..challenge(&host, port)
        },
    );
    // These cannot be normalized into the retained numeric IPv4 endpoint:
    // IPv4-mapped IPv6, URL/authority strings, escapes, scope and malformed
    // brackets must not become alternate routes to credential disclosure.
    for forged_host in [
        "::ffff:127.0.0.1",
        "[::ffff:127.0.0.1]",
        "http://127.0.0.1",
        "127.0.0.1:80",
        "user@127.0.0.1",
        "127.0.0.01",
        "127.0.0.1%25lo",
        "%31%32%37.0.0.1",
        "[127.0.0.1",
        "127.0.0.1]",
        "[[127.0.0.1]]",
        "127.0.0.1\0",
    ] {
        assert_rejected(&first, &identity, challenge(forged_host, port));
    }
    for forged_realm in [
        "PRIVATE-FORWARD-PROXY",
        "private-forward-proxy\0",
        "private-forward-proxy\r\n",
    ] {
        assert_rejected(
            &first,
            &identity,
            NativeProxyChallenge {
                realm: forged_realm,
                ..challenge(&host, port)
            },
        );
    }
    assert_eq!(first.status(), BrowserSessionStatus::NotReady);
    let mut callback_count = 0;
    assert_eq!(
        first.answer_proxy_challenge(&identity, challenge(&host, port), |_, _| {
            callback_count += 1;
            true
        }),
        Some(true)
    );
    assert_eq!(callback_count, 1);
    stop(&mut first).await;
    stop(&mut second).await;
}

#[tokio::test]
async fn terminal_host_states_never_release_credentials_to_a_matching_native_challenge() {
    for transition in [
        "unsupported",
        "readiness-lost",
        "binding-mismatch",
        "stopped",
    ] {
        let mut session = session().await;
        let identity = session.policy().identity().clone();
        let host = session.proxy_endpoint().ip().to_string();
        let port = session.proxy_endpoint().port();
        match transition {
            "unsupported" => session
                .report_host(
                    &identity,
                    NativeHostReadiness::Unsupported(
                        HostUnavailableReason::TrafficContainmentUnverified,
                    ),
                )
                .unwrap(),
            "readiness-lost" => {
                session
                    .report_host(
                        &identity,
                        NativeHostReadiness::Ready {
                            profile_key: session.policy().profile_key().to_owned(),
                            proxy_endpoint: session.proxy_endpoint(),
                        },
                    )
                    .unwrap();
                session
                    .report_host(&identity, NativeHostReadiness::NotReady)
                    .unwrap();
            }
            "binding-mismatch" => {
                assert_eq!(
                    session.report_host(
                        &identity,
                        NativeHostReadiness::Ready {
                            profile_key: "another-attempt-profile".into(),
                            proxy_endpoint: session.proxy_endpoint(),
                        },
                    ),
                    Err(BrowserPolicyError::HostBindingMismatch)
                );
            }
            "stopped" => stop(&mut session).await,
            _ => unreachable!(),
        }
        assert_rejected(&session, &identity, challenge(&host, port));
        stop(&mut session).await;
    }
}
