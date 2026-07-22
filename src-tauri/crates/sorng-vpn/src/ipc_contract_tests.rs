use crate::ikev2::{IKEv2Config, IKEv2Connection, IKEv2Status};
use crate::ipsec::{IPsecConfig, IPsecConnection, IPsecStatus};
use crate::l2tp::{L2TPConfig, L2TPConnection, L2TPStatus};
use crate::pptp::{PPTPConfig, PPTPConnection, PPTPStatus};
use crate::routing::VpnRoutingMode;
use crate::sstp::{SSTPConfig, SSTPConnection, SSTPStatus};
use chrono::Utc;
use serde_json::json;

#[test]
fn legacy_vpn_configs_accept_the_exact_snake_case_ipc_contract() {
    let ikev2: IKEv2Config = serde_json::from_value(json!({
        "server": "ike.example.com",
        "username": "alice",
        "password": "password",
        "certificate": "/etc/certs/client.pem",
        "private_key": "/etc/certs/client.key",
        "ca_certificate": "/etc/certs/ca.pem",
        "eap_method": "mschapv2",
        "phase1_algorithms": "aes256-sha256-modp2048",
        "phase2_algorithms": "aes256-sha256",
        "local_id": "alice@example.com",
        "remote_id": "ike.example.com",
        "fragmentation": true,
        "mobike": true,
        "routing_mode": "split",
        "remote_subnets": ["10.20.0.0/16", "2001:db8:42::/48"],
        "custom_options": ["fragmentation=yes"]
    }))
    .unwrap();
    assert_eq!(ikev2.private_key.as_deref(), Some("/etc/certs/client.key"));
    assert_eq!(ikev2.routing_mode, VpnRoutingMode::Split);
    assert_eq!(ikev2.remote_subnets, ["10.20.0.0/16", "2001:db8:42::/48"]);
    assert_eq!(ikev2.custom_options, ["fragmentation=yes"]);

    let sstp: SSTPConfig = serde_json::from_value(json!({
        "server": "sstp.example.com",
        "username": "alice",
        "password": "password",
        "domain": "EXAMPLE",
        "certificate": "/etc/certs/client.pem",
        "ca_certificate": "/etc/certs/ca.pem",
        "ignore_certificate": false,
        "proxy_host": "proxy.example.com",
        "proxy_port": 8080,
        "custom_options": ["--save-server-route"]
    }))
    .unwrap();
    assert_eq!(sstp.proxy_port, Some(8080));
    assert_eq!(sstp.custom_options, ["--save-server-route"]);

    let l2tp: L2TPConfig = serde_json::from_value(json!({
        "server": "l2tp.example.com",
        "username": "alice",
        "password": "password",
        "psk": "gateway secret",
        "ipsec_ike": "aes256-sha256-modp2048",
        "ipsec_esp": "aes256-sha256",
        "ipsec_pfs": "modp2048",
        "mru": 1400,
        "mtu": 1400,
        "lcp_echo_interval": 30,
        "lcp_echo_failure": 4,
        "require_chap": true,
        "refuse_chap": false,
        "require_mschap": false,
        "refuse_mschap": false,
        "require_mschapv2": true,
        "refuse_mschapv2": false,
        "require_eap": false,
        "refuse_eap": true,
        "require_pap": false,
        "refuse_pap": true,
        "ipsec_ikelifetime": 3600,
        "ipsec_lifetime": 1800,
        "ipsec_phase2alg": "aes256-sha256",
        "custom_options": ["debug"]
    }))
    .unwrap();
    assert_eq!(l2tp.psk.as_deref(), Some("gateway secret"));
    assert_eq!(l2tp.ipsec_pfs.as_deref(), Some("modp2048"));
    assert_eq!(l2tp.lcp_echo_interval, Some(30));
    assert_eq!(l2tp.require_mschapv2, Some(true));
    assert_eq!(l2tp.ipsec_ikelifetime, Some(3600));
    assert_eq!(l2tp.custom_options, ["debug"]);

    let pptp: PPTPConfig = serde_json::from_value(json!({
        "server": "pptp.example.com",
        "username": "alice",
        "password": "password",
        "domain": "EXAMPLE",
        "require_mppe": true,
        "mppe_stateful": false,
        "refuse_eap": true,
        "refuse_pap": true,
        "refuse_chap": false,
        "refuse_mschap": false,
        "refuse_mschapv2": false,
        "nobsdcomp": true,
        "nodeflate": true,
        "no_vj_comp": true,
        "custom_options": ["lock"]
    }))
    .unwrap();
    assert_eq!(pptp.require_mppe, Some(true));
    assert_eq!(pptp.custom_options, ["lock"]);

    let ipsec: IPsecConfig = serde_json::from_value(json!({
        "server": "ipsec.example.com",
        "auth_method": "psk",
        "psk": "gateway secret",
        "certificate": "/etc/certs/client.pem",
        "private_key": "/etc/certs/client.key",
        "ca_certificate": "/etc/certs/ca.pem",
        "phase1_proposals": "aes256-sha256-modp2048",
        "phase2_proposals": "aes256-sha256",
        "sa_lifetime": 3600,
        "dpd_delay": 30,
        "dpd_timeout": 120,
        "tunnel_mode": true,
        "routing_mode": "split",
        "remote_subnets": ["192.0.2.0/24"],
        "custom_options": ["closeaction=restart"]
    }))
    .unwrap();
    assert_eq!(ipsec.auth_method.as_deref(), Some("psk"));
    assert_eq!(ipsec.routing_mode, VpnRoutingMode::Split);
    assert_eq!(ipsec.remote_subnets, ["192.0.2.0/24"]);
    assert_eq!(ipsec.custom_options, ["closeaction=restart"]);
}

#[test]
fn legacy_vpn_configs_default_custom_options_but_reject_camel_case_drift() {
    let config: L2TPConfig = serde_json::from_value(json!({
        "server": "l2tp.example.com",
        "username": "alice",
        "password": "password"
    }))
    .unwrap();
    assert!(config.custom_options.is_empty());

    let ikev2: IKEv2Config = serde_json::from_value(json!({
        "server": "ike.example.com"
    }))
    .unwrap();
    assert_eq!(ikev2.routing_mode, VpnRoutingMode::Full);
    assert!(ikev2.remote_subnets.is_empty());

    let ipsec: IPsecConfig = serde_json::from_value(json!({
        "server": "ipsec.example.com"
    }))
    .unwrap();
    assert_eq!(ipsec.routing_mode, VpnRoutingMode::Full);
    assert!(ipsec.remote_subnets.is_empty());

    let error = serde_json::from_value::<L2TPConfig>(json!({
        "server": "l2tp.example.com",
        "username": "alice",
        "password": "password",
        "customOptions": ["debug"]
    }))
    .unwrap_err();
    assert!(error.to_string().contains("customOptions"));
}

#[test]
fn legacy_vpn_views_redact_every_secret_and_report_presence() {
    let now = Utc::now();
    let ikev2_config: IKEv2Config = serde_json::from_value(json!({
        "server": "ike.example.com", "password": "sentinel-password",
        "private_key": "sentinel-private-key"
    }))
    .unwrap();
    let ikev2 = IKEv2Connection {
        id: "ike".into(),
        name: "IKE".into(),
        config: ikev2_config,
        status: IKEv2Status::Disconnected,
        created_at: now,
        connected_at: None,
        local_ip: None,
        remote_ip: None,
        ras_entry_name: None,
        process_id: None,
    }
    .into_redacted_view();
    assert!(ikev2.connection.config.password.is_none());
    assert!(ikev2.connection.config.private_key.is_none());
    assert!(ikev2.secret_presence.password && ikev2.secret_presence.private_key);

    let ipsec_config: IPsecConfig = serde_json::from_value(json!({
        "server": "ipsec.example.com", "psk": "sentinel-psk",
        "private_key": "sentinel-private-key"
    }))
    .unwrap();
    let ipsec = IPsecConnection {
        id: "ipsec".into(),
        name: "IPsec".into(),
        config: ipsec_config,
        status: IPsecStatus::Disconnected,
        created_at: now,
        connected_at: None,
        local_ip: None,
        remote_ip: None,
        ras_entry_name: None,
        process_id: None,
    }
    .into_redacted_view();
    assert!(ipsec.connection.config.psk.is_none());
    assert!(ipsec.connection.config.private_key.is_none());
    assert!(ipsec.secret_presence.psk && ipsec.secret_presence.private_key);

    let l2tp_config: L2TPConfig = serde_json::from_value(json!({
        "server": "l2tp.example.com", "password": "sentinel-password",
        "psk": "sentinel-psk"
    }))
    .unwrap();
    let l2tp = L2TPConnection {
        id: "l2tp".into(),
        name: "L2TP".into(),
        config: l2tp_config,
        status: L2TPStatus::Disconnected,
        created_at: now,
        connected_at: None,
        local_ip: None,
        remote_ip: None,
        ras_entry_name: None,
        process_id: None,
    }
    .into_redacted_view();
    assert!(l2tp.connection.config.password.is_none());
    assert!(l2tp.connection.config.psk.is_none());
    assert!(l2tp.secret_presence.password && l2tp.secret_presence.psk);

    let pptp_config: PPTPConfig = serde_json::from_value(json!({
        "server": "pptp.example.com", "password": "sentinel-password"
    }))
    .unwrap();
    let pptp = PPTPConnection {
        id: "pptp".into(),
        name: "PPTP".into(),
        config: pptp_config,
        status: PPTPStatus::Disconnected,
        created_at: now,
        connected_at: None,
        local_ip: None,
        remote_ip: None,
        ras_entry_name: None,
        process_id: None,
    }
    .into_redacted_view();
    assert!(pptp.connection.config.password.is_none());
    assert!(pptp.secret_presence.password);

    let sstp_config: SSTPConfig = serde_json::from_value(json!({
        "server": "sstp.example.com", "password": "sentinel-password"
    }))
    .unwrap();
    let sstp = SSTPConnection {
        id: "sstp".into(),
        name: "SSTP".into(),
        config: sstp_config,
        status: SSTPStatus::Disconnected,
        created_at: now,
        connected_at: None,
        local_ip: None,
        remote_ip: None,
        ras_entry_name: None,
        process_id: None,
    }
    .into_redacted_view();
    assert!(sstp.connection.config.password.is_none());
    assert!(sstp.secret_presence.password);
}
