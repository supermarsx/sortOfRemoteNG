use super::*;
use std::sync::{atomic::AtomicUsize, Arc};
fn address(v4: bool, port: u16) -> SocketAddr {
    if v4 {
        ([127, 0, 0, 1], port).into()
    } else {
        (std::net::Ipv6Addr::LOCALHOST, port).into()
    }
}
#[test]
fn address_policy_is_explicit_deduplicated_and_never_rewrites_endpoint() {
    let rows = vec![
        address(false, 22),
        address(true, 22),
        address(true, 22),
        address(true, 23),
    ];
    assert_eq!(
        IpPolicy::Auto.select(rows.clone()),
        vec![address(false, 22), address(true, 22), address(true, 23)]
    );
    assert_eq!(
        IpPolicy::V4.select(rows.clone()),
        vec![address(true, 22), address(true, 23)]
    );
    assert_eq!(IpPolicy::V6.select(rows), vec![address(false, 22)]);
    for invalid in ["", "ipv5", "IPv4", "auto;direct"] {
        assert!(IpPolicy::parse(invalid).is_err());
    }
}
#[test]
fn legacy_any_policy_preserves_auto_address_order_and_family_fallback() {
    let addresses = vec![address(false, 22), address(false, 22), address(true, 22)];
    assert_eq!(IpPolicy::parse("any").unwrap(), IpPolicy::Auto);
    assert_eq!(
        IpPolicy::parse("any").unwrap().select(addresses),
        vec![address(false, 22), address(true, 22)]
    );
}
#[test]
fn endpoint_keys_are_process_scoped_and_omit_accounts() {
    let a = fingerprint_with(&[1; 32], "SSH.Example.test", 22);
    assert_eq!(a, fingerprint_with(&[1; 32], "ssh.example.test", 22));
    assert_ne!(a, fingerprint_with(&[2; 32], "ssh.example.test", 22));
    assert_ne!(a, fingerprint_with(&[1; 32], "ssh.example.test", 23));
    assert_ne!(a, fingerprint_with(&[1; 32], "other.example.test", 22));
    assert_eq!(a.len(), 32);
    assert!(!a.contains("ssh.example"));
}
struct CountDrop(Arc<AtomicUsize>);
impl Drop for CountDrop {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
#[tokio::test]
async fn stalled_first_candidate_does_not_hide_reachable_same_endpoint_address() {
    let attempt = Attempt::new(
        "fixture.invalid",
        22,
        IpPolicy::Auto,
        Duration::from_secs(1),
    );
    let mut phase = attempt.connecting();
    let dropped = Arc::new(AtomicUsize::new(0));
    let drops = dropped.clone();
    let start = Instant::now();
    let result = connect_candidates(
        vec![address(false, 22), address(true, 22)],
        move |a| {
            let drops = drops.clone();
            async move {
                if a.is_ipv6() {
                    let _guard = CountDrop(drops);
                    std::future::pending::<io::Result<SocketAddr>>().await
                } else {
                    Ok(a)
                }
            }
        },
        &mut phase,
        Duration::from_millis(20),
    )
    .await
    .unwrap();
    assert_eq!(result, address(true, 22));
    assert!(
        start.elapsed() >= Duration::from_millis(20),
        "alternate candidate must not become a zero-delay race"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn refusal_tries_next_without_waiting_for_stagger() {
    let attempt = Attempt::default();
    let mut phase = attempt.connecting();
    let start = Instant::now();
    let result = connect_candidates(
        vec![address(true, 1), address(true, 2)],
        |a| async move {
            if a.port() == 1 {
                Err(io::Error::from(io::ErrorKind::ConnectionRefused))
            } else {
                Ok(a)
            }
        },
        &mut phase,
        Duration::from_secs(10),
    )
    .await
    .unwrap();
    assert_eq!(result.port(), 2);
    assert!(start.elapsed() < Duration::from_secs(1));
}
#[tokio::test]
async fn dropping_dial_cancels_all_candidates_and_concurrency_is_two() {
    let attempt = Attempt::default();
    let mut phase = attempt.connecting();
    let active = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let a = active.clone();
    let d = dropped.clone();
    let pending = connect_candidates(
        (1..20).map(|p| address(true, p)).collect(),
        move |_| {
            let a = a.clone();
            let d = d.clone();
            async move {
                a.fetch_add(1, Ordering::SeqCst);
                let _guard = CountDrop(d);
                std::future::pending::<io::Result<()>>().await
            }
        },
        &mut phase,
        Duration::from_millis(5),
    );
    assert!(tokio::time::timeout(Duration::from_millis(50), pending)
        .await
        .is_err());
    assert_eq!(active.load(Ordering::SeqCst), 2);
    assert_eq!(dropped.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn real_loopback_dial_returns_one_owned_socket_without_auth_or_public_network() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = listener.local_addr().unwrap();
    let attempt = Attempt::default();
    let mut phase = attempt.connecting();
    let stream = connect_candidates(
        vec![endpoint],
        tokio::net::TcpStream::connect,
        &mut phase,
        Duration::from_millis(20),
    )
    .await
    .unwrap();
    let (peer, _) = listener.accept().await.unwrap();
    assert_eq!(stream.peer_addr().unwrap(), endpoint);
    drop(stream);
    drop(peer);
}

#[tokio::test]
async fn production_resolver_enforces_family_even_for_numeric_hosts() {
    use super::super::{
        PendingSshConnection, SshConnectionConfig, SshEstablishmentControl, SshService,
    };
    let mut config:SshConnectionConfig=serde_json::from_value(serde_json::json!({"host":"127.0.0.1","port":22,"username":"fixture","password":null,"private_key_path":null,"private_key_passphrase":null,"jump_hosts":[],"proxy_config":null,"openvpn_config":null,"connect_timeout":1,"keep_alive_interval":30,"strict_host_key_checking":true,"known_hosts_path":null,"totp_secret":null,"keyboard_interactive_responses":[]})).unwrap();
    assert_eq!(
        config.ip_protocol, "auto",
        "legacy omitted field retains serde default"
    );
    let state = SshService::new();
    let service = state.lock().await;
    config.ip_protocol = "ipv6".into();
    let control =
        SshEstablishmentControl::new(&config, Arc::new(PendingSshConnection::new())).unwrap();
    assert!(service
        .resolve_establishment_addresses(
            config.host.clone(),
            22,
            &control,
            "direct-dns",
            Duration::from_secs(1)
        )
        .await
        .is_err());
    assert_eq!(
        service
            .resolve_establishment_addresses(
                "::1".into(),
                22,
                &control,
                "direct-dns",
                Duration::from_secs(1)
            )
            .await
            .unwrap(),
        vec![address(false, 22)]
    );
    config.ip_protocol = "ipv4".into();
    let control =
        SshEstablishmentControl::new(&config, Arc::new(PendingSshConnection::new())).unwrap();
    assert!(service
        .resolve_establishment_addresses(
            "::1".into(),
            22,
            &control,
            "direct-dns",
            Duration::from_secs(1)
        )
        .await
        .is_err());
    assert_eq!(
        service
            .resolve_establishment_addresses(
                config.host.clone(),
                22,
                &control,
                "direct-dns",
                Duration::from_secs(1)
            )
            .await
            .unwrap(),
        vec![address(true, 22)]
    );
}
#[test]
fn auto_alternates_families_without_changing_per_family_resolver_order() {
    assert_eq!(
        IpPolicy::Auto.select(vec![
            address(false, 1),
            address(false, 2),
            address(true, 3),
            address(true, 4),
            address(false, 1)
        ]),
        vec![
            address(false, 1),
            address(true, 3),
            address(false, 2),
            address(true, 4)
        ]
    );
}

struct Capture;
static CAPTURED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
impl log::Log for Capture {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target() == "ssh::establishment"
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            CAPTURED.lock().unwrap().push(record.args().to_string());
        }
    }
    fn flush(&self) {}
}
#[test]
fn actual_log_records_are_closed_fields_and_compare_callers_without_endpoint_disclosure() {
    static INSTALL: std::sync::Once = std::sync::Once::new();
    INSTALL.call_once(|| {
        log::set_logger(&Capture).unwrap();
        log::set_max_level(log::LevelFilter::Info);
    });
    let attempt = Attempt::new(
        "private-ssh.example.invalid",
        2237,
        IpPolicy::V6,
        Duration::from_secs(17),
    );
    attempt.set_origin(SshEstablishmentOrigin::NativeBrowser);
    attempt
        .resolve("private-upstream.example.invalid", 8822)
        .finish("resolved", &["[2001:db8::7]:2237".parse().unwrap()]);
    let rows: Vec<_> = CAPTURED
        .lock()
        .unwrap()
        .iter()
        .filter(|line| line.contains(&format!("attempt={} ", attempt.id)))
        .cloned()
        .collect();
    assert_eq!(rows.len(), 2);
    for row in rows {
        assert!(row.contains("caller=native-browser route=direct"));
        assert!(row.contains("policy=ipv6"));
        assert!(row.contains("budgetMs=17000"));
        for private in [
            "private-ssh",
            "private-upstream",
            "2001:db8",
            "8822",
            "2237",
        ] {
            assert!(
                !row.contains(private),
                "endpoint text must not enter shared application logs"
            );
        }
    }
}
