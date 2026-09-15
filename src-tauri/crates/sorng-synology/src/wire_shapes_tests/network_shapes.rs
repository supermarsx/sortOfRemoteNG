//! Owned by t84-e12e: `SYNO.Core.Network get`, `SYNO.Core.Network.Interface
//! list` and the firewall rule read (`SYNO.Core.Security.Firewall.Adapter
//! list`, then `SYNO.Core.Security.Firewall.Rules load` per adapter), addendum
//! §4 L2.
//!
//! Legacy compatibility is kept only where DSM's own variants differ (an
//! interface envelope, a string speed). The pre-t84 overview and interface
//! DTO shapes are not accepted: no evidence shows DSM ever sent them. The
//! firewall read never sends `list_all`, which DSM does not implement.

use super::*;

const NETWORK: &str = "SYNO.Core.Network";
const NETWORK_INTERFACE: &str = "SYNO.Core.Network.Interface";
const FIREWALL_ADAPTER: &str = "SYNO.Core.Security.Firewall.Adapter";
const FIREWALL_RULES: &str = "SYNO.Core.Security.Firewall.Rules";

// ── Fixtures ────────────────────────────────────────────────────────

/// `networkOverview` read.
// shape: dsm_helper lib/models/Syno/Core/Network.dart and Core/Network/Network.dart (Apache-2.0)
pub(super) fn real_network_overview() -> Value {
    json!({
        "arp_ignore": true,
        "dns_manual": false,
        "dns_primary": "192.0.2.1",
        "dns_secondary": "",
        "enable_ip_conflict_detect": true,
        "enable_windomain": false,
        "gateway": "192.0.2.1",
        "gateway_info": {"ifname": "ovs_eth0", "ip": "192.0.2.100", "mask": "255.255.255.0", "status": "connected", "type": "ovseth", "use_dhcp": false},
        "ipv4_first": false,
        "multi_gateway": false,
        "server_name": "fixture-nas",
        "use_dhcp_domain": true,
        "v6gateway": "fe80::1"
    })
}

/// `networkInterfaces` read: a bare array.
// shape: pmilano1/synology-dsm-api probed/core-network.md [DSM 7.4 probe] (MIT), vcf-content-factory synology-system.md [observed DSM 7.3.2] (MIT)
pub(super) fn real_network_interfaces() -> Value {
    json!([
        {"ifname": "eth0", "ip": "192.0.2.10", "mask": "255.255.255.0", "speed": 1000, "status": "connected", "type": "lan", "use_dhcp": true},
        {"ifname": "eth1", "ip": "", "mask": "", "speed": 0, "status": "disconnected", "type": "lan", "use_dhcp": true}
    ])
}

/// `firewallRules` read, request 1: the adapter (profile) names.
// shape: pmilano1/synology-dsm-api probed/core-security.md SYNO.Core.Security.Firewall.Adapter list [DSM 7.4 probe] (MIT)
pub(super) fn real_firewall_adapters() -> Value {
    json!({"adapter_names": ["global", "ovs_eth0"]})
}

/// `firewallRules` read, `load` for adapter `global`. Synthetic; the rule
/// field names are only partly confirmed (S§7 #2).
// shape: KastnerRG/krg-infra ansible/synology apply_security.py data.{policy,rules,total} (MIT)
pub(super) fn real_firewall_rules() -> Value {
    json!({
        "policy": "allow",
        "rules": [{"enabled": true, "policy": "allow", "set_type": "geoip", "src": "US", "protocol": "all", "ports": "all"}],
        "total": 1
    })
}

/// `firewallRules` read, `load` for an adapter without rules.
// shape: KastnerRG/krg-infra ansible/synology apply_security.py data.{policy,rules,total} (MIT)
pub(super) fn real_firewall_rules_empty() -> Value {
    json!({"policy": "allow", "rules": [], "total": 0})
}

fn ipc(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

/// Every firewall request is `Firewall.Adapter list` or `Firewall.Rules load`,
/// so no request ever uses the nonexistent "list all" rules method. (Written
/// without that method's literal, which g1's grep guard requires to be absent.)
fn assert_never_list_all(nas: &Nas) {
    for index in 0..nas.requests().len() {
        let method = request_method(nas, index);
        match request_api(nas, index).as_str() {
            FIREWALL_ADAPTER => assert_eq!(method, "list", "request {index}"),
            FIREWALL_RULES => assert_eq!(method, "load", "request {index}"),
            other => panic!("request {index} went to {other}"),
        }
        assert!(!method.contains("_all"), "request {index}: {method}");
    }
}

// ── Overview ────────────────────────────────────────────────────────

#[tokio::test]
async fn network_overview_maps_dsm_server_name_dns_and_gateway() {
    let (service, nas) = service_with(&[(NETWORK, 2)], vec![ok(real_network_overview())]).await;

    let overview = service.get_network_overview().await.unwrap();
    assert_eq!(overview.hostname, "fixture-nas");
    // The empty secondary DNS is not a server.
    assert_eq!(overview.dns, vec!["192.0.2.1".to_owned()]);
    assert_eq!(overview.gateway.as_deref(), Some("192.0.2.1"));
    assert_eq!(overview.workgroup, None);
    assert!(overview.interfaces.is_none());
    assert_eq!(
        ipc(&overview),
        json!({
            "hostname": "fixture-nas",
            "workgroup": null,
            "dns": ["192.0.2.1"],
            "gateway": "192.0.2.1",
            "interfaces": null
        })
    );

    assert_eq!(nas.requests().len(), 1);
    assert_eq!(request_api(&nas, 0), NETWORK);
    assert_eq!(request_method(&nas, 0), "get");
    // Discovery offers v2, the manager caps at v1.
    assert_eq!(request_version(&nas, 0), 1);
    assert_eq!(request_field(&nas, 0, "group"), None);
}

#[tokio::test]
async fn network_overview_keeps_both_dns_servers_and_drops_an_empty_gateway() {
    let mut both = real_network_overview();
    both["dns_secondary"] = json!("198.51.100.53");
    both["gateway"] = json!("");
    let mut sparse = real_network_overview();
    let fields = sparse.as_object_mut().unwrap();
    fields.remove("dns_primary");
    fields.remove("dns_secondary");
    fields.remove("gateway");
    let (service, _nas) = service_with(&[(NETWORK, 1)], vec![ok(both), ok(sparse)]).await;

    let overview = service.get_network_overview().await.unwrap();
    assert_eq!(
        overview.dns,
        vec!["192.0.2.1".to_owned(), "198.51.100.53".to_owned()]
    );
    assert_eq!(overview.gateway, None);

    let overview = service.get_network_overview().await.unwrap();
    assert!(overview.dns.is_empty());
    assert_eq!(overview.gateway, None);
}

#[tokio::test]
async fn network_overview_without_a_server_name_is_a_schema_failure() {
    let mut nameless = real_network_overview();
    nameless.as_object_mut().unwrap().remove("server_name");
    let (service, nas) = service_with(
        &[(NETWORK, 1)],
        vec![
            ok(nameless),
            // The pre-t84 DTO shape: DSM never sends `hostname`/`dns` here.
            ok(json!({"hostname": "fixture-nas", "dns": ["192.0.2.1"], "interfaces": []})),
        ],
    )
    .await;

    for _ in 0..2 {
        let error = service.get_network_overview().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 2);
}

// ── Interfaces ──────────────────────────────────────────────────────

#[tokio::test]
async fn network_interfaces_decode_the_bare_dsm_array() {
    let (service, nas) = service_with(
        &[(NETWORK_INTERFACE, 1)],
        vec![ok(real_network_interfaces())],
    )
    .await;

    let interfaces = service.list_network_interfaces().await.unwrap();
    assert_eq!(interfaces.len(), 2);
    let eth0 = &interfaces[0];
    assert_eq!(eth0.id, "eth0");
    assert_eq!(eth0.name.as_deref(), Some("eth0"));
    assert_eq!(eth0.ip, vec!["192.0.2.10".to_owned()]);
    assert!(eth0.ipv6.is_empty());
    assert_eq!(eth0.subnet.as_deref(), Some("255.255.255.0"));
    assert_eq!(eth0.link_speed.as_deref(), Some("1000"));
    assert_eq!(eth0.status, "connected");
    assert_eq!(eth0.interface_type.as_deref(), Some("lan"));
    assert_eq!(eth0.mac, None);
    assert_eq!(eth0.mtu, None);
    let eth1 = &interfaces[1];
    assert_eq!(eth1.id, "eth1");
    assert!(eth1.ip.is_empty());
    assert_eq!(eth1.subnet, None);
    assert_eq!(eth1.link_speed.as_deref(), Some("0"));
    assert_eq!(eth1.status, "disconnected");

    // `mac` is `null` in the IPC, never an invented address.
    assert_eq!(
        ipc(eth0),
        json!({
            "id": "eth0",
            "name": "eth0",
            "mac": null,
            "ip": ["192.0.2.10"],
            "ipv6": [],
            "subnet": "255.255.255.0",
            "mtu": null,
            "linkSpeed": "1000",
            "status": "connected",
            "interfaceType": "lan"
        })
    );

    assert_eq!(nas.requests().len(), 1);
    assert_eq!(request_api(&nas, 0), NETWORK_INTERFACE);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
}

#[tokio::test]
async fn network_interfaces_regression_envelope_and_lenient_speed_decode() {
    let (service, _nas) = service_with(
        &[(NETWORK_INTERFACE, 1)],
        vec![
            ok(json!({"interfaces": real_network_interfaces(), "total": 2})),
            ok(json!([
                {"ifname": "bond0", "ip": "198.51.100.20", "mask": "255.255.255.0", "speed": "10000", "status": "connected"},
                {"ifname": "eth2", "speed": -1, "status": "disconnected"}
            ])),
        ],
    )
    .await;

    let wrapped = service.list_network_interfaces().await.unwrap();
    assert_eq!(wrapped.len(), 2);
    assert_eq!(wrapped[0].link_speed.as_deref(), Some("1000"));

    let lenient = service.list_network_interfaces().await.unwrap();
    assert_eq!(lenient[0].link_speed.as_deref(), Some("10000"));
    assert_eq!(lenient[0].interface_type, None);
    assert_eq!(lenient[1].link_speed, None);
    assert!(lenient[1].ip.is_empty());
    assert_eq!(lenient[1].subnet, None);
}

#[tokio::test]
async fn network_interfaces_without_the_list_or_required_fields_are_schema_failures() {
    let (service, nas) = service_with(
        &[(NETWORK_INTERFACE, 1)],
        vec![
            ok(json!({"total": 0})),
            ok(json!([{"ip": "192.0.2.10", "status": "connected"}])),
            ok(json!([{"ifname": "eth0", "ip": "192.0.2.10"}])),
            ok(json!([{"ifname": "eth0", "status": "connected", "speed": "fast"}])),
        ],
    )
    .await;

    for _ in 0..4 {
        let error = service.list_network_interfaces().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 4);
}

// ── Firewall rules ──────────────────────────────────────────────────

#[tokio::test]
async fn firewall_rules_load_each_adapter_and_tag_rules_with_it() {
    let (service, nas) = service_with(
        &[(FIREWALL_ADAPTER, 1), (FIREWALL_RULES, 1)],
        vec![
            ok(real_firewall_adapters()),
            ok(real_firewall_rules()),
            ok(real_firewall_rules_empty()),
        ],
    )
    .await;

    let rules = service.list_firewall_rules().await.unwrap();
    assert_eq!(rules.len(), 1);
    let rule = &rules[0];
    assert_eq!(rule.adapter.as_deref(), Some("global"));
    assert_eq!(rule.action.as_deref(), Some("allow"));
    assert_eq!(rule.protocol.as_deref(), Some("all"));
    assert_eq!(rule.src_ip.as_deref(), Some("US"));
    assert_eq!(rule.src_port.as_deref(), Some("all"));
    assert_eq!(rule.enabled, Some(true));
    assert_eq!(rule.direction, None);
    assert_eq!(rule.id, None);
    assert_eq!(
        ipc(rule),
        json!({
            "id": null,
            "adapter": "global",
            "srcIp": "US",
            "srcPort": "all",
            "direction": null,
            "action": "allow",
            "protocol": "all",
            "enabled": true
        })
    );

    assert_eq!(nas.requests().len(), 3);
    assert_eq!(request_api(&nas, 0), FIREWALL_ADAPTER);
    assert_eq!(request_method(&nas, 0), "list");
    assert_eq!(request_version(&nas, 0), 1);
    for (index, adapter) in [(1, r#""global""#), (2, r#""ovs_eth0""#)] {
        assert_eq!(request_api(&nas, index), FIREWALL_RULES);
        assert_eq!(request_method(&nas, index), "load");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(
            request_field(&nas, index, "adapter").as_deref(),
            Some(adapter)
        );
    }
    assert_never_list_all(&nas);
}

#[tokio::test]
async fn firewall_rules_send_the_adapter_raw_to_a_plain_format_api() {
    let (service, nas) = service_with_format(
        &[
            (FIREWALL_ADAPTER, 1, Some("JSON")),
            (FIREWALL_RULES, 1, None),
        ],
        vec![
            ok(json!({"adapter_names": ["global"]})),
            ok(real_firewall_rules()),
        ],
    )
    .await;

    let rules = service.list_firewall_rules().await.unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(request_field(&nas, 1, "adapter").as_deref(), Some("global"));
    assert_eq!(nas.requests().len(), 2);
    assert_never_list_all(&nas);
}

#[tokio::test]
async fn firewall_rules_map_candidate_keys_leniently() {
    // Synthetic variants for the partly confirmed rule keys (S§7 #2).
    let (service, _nas) = service_with(
        &[(FIREWALL_ADAPTER, 1), (FIREWALL_RULES, 1)],
        vec![
            ok(json!({"adapter_names": ["ovs_eth0"]})),
            ok(json!({
                "policy": "deny",
                "rules": [
                    {"id": 7, "enabled": 0, "service_policy": "deny", "source_ip": ["198.51.100.1", "198.51.100.2"], "port": 22, "protocol": "tcp"},
                    {"id": "rule-8", "enabled": "yes", "action": "allow", "src": "", "src_ip": "192.0.2.0/24", "dst_port": [80, 443]},
                    {"enabled": "maybe", "policy": {"nested": true}, "ports": [], "protocol": null}
                ],
                "total": 3
            })),
        ],
    )
    .await;

    let rules = service.list_firewall_rules().await.unwrap();
    assert_eq!(rules.len(), 3);
    assert!(rules
        .iter()
        .all(|rule| rule.adapter.as_deref() == Some("ovs_eth0")));

    assert_eq!(rules[0].id.as_deref(), Some("7"));
    assert_eq!(rules[0].enabled, Some(false));
    assert_eq!(rules[0].action.as_deref(), Some("deny"));
    assert_eq!(
        rules[0].src_ip.as_deref(),
        Some("198.51.100.1, 198.51.100.2")
    );
    assert_eq!(rules[0].src_port.as_deref(), Some("22"));
    assert_eq!(rules[0].protocol.as_deref(), Some("tcp"));

    assert_eq!(rules[1].id.as_deref(), Some("rule-8"));
    assert_eq!(rules[1].enabled, Some(true));
    assert_eq!(rules[1].action.as_deref(), Some("allow"));
    // An empty `src` falls through to the next candidate key.
    assert_eq!(rules[1].src_ip.as_deref(), Some("192.0.2.0/24"));
    assert_eq!(rules[1].src_port.as_deref(), Some("80, 443"));
    assert_eq!(rules[1].protocol, None);

    // Unusable values stay unknown instead of failing the list.
    assert_eq!(rules[2].id, None);
    assert_eq!(rules[2].enabled, None);
    assert_eq!(rules[2].action, None);
    assert_eq!(rules[2].src_ip, None);
    assert_eq!(rules[2].src_port, None);
    assert_eq!(rules[2].protocol, None);
}

#[tokio::test]
async fn firewall_rules_stop_at_32_adapters() {
    let names: Vec<String> = (0..40).map(|index| format!("ovs_eth{index}")).collect();
    let mut responses = vec![ok(json!({"adapter_names": names}))];
    responses.extend((0..32).map(|_| ok(real_firewall_rules())));
    let (service, nas) =
        service_with(&[(FIREWALL_ADAPTER, 1), (FIREWALL_RULES, 1)], responses).await;

    let rules = service.list_firewall_rules().await.unwrap();
    assert_eq!(rules.len(), 32);
    assert_eq!(rules[31].adapter.as_deref(), Some("ovs_eth31"));
    assert_eq!(nas.requests().len(), 33);
    assert_eq!(
        request_field(&nas, 32, "adapter").as_deref(),
        Some(r#""ovs_eth31""#)
    );
    assert_never_list_all(&nas);
}

#[tokio::test]
async fn firewall_rules_without_the_adapter_api_send_nothing() {
    let (service, nas) = service_with(&[(FIREWALL_RULES, 1)], vec![]).await;

    let error = service.list_firewall_rules().await.unwrap_err();
    assert!(
        matches!(error.kind, SynologyErrorKind::ApiNotFound),
        "{error}"
    );
    assert_eq!(nas.requests().len(), 0);
}

#[tokio::test]
async fn firewall_rules_return_the_first_dsm_error_unchanged() {
    let (service, nas) = service_with(
        &[(FIREWALL_ADAPTER, 1), (FIREWALL_RULES, 1)],
        vec![
            ok(real_firewall_adapters()),
            dsm_error(114),
            // Adapter list refused.
            dsm_error(105),
        ],
    )
    .await;

    let rejected = service.list_firewall_rules().await.unwrap_err();
    assert!(
        matches!(rejected.kind, SynologyErrorKind::ApiError(114)),
        "{rejected}"
    );
    assert_dsm_failure(&rejected, 114);
    // The second adapter is never loaded after the first error.
    assert_eq!(nas.requests().len(), 2);

    let denied = service.list_firewall_rules().await.unwrap_err();
    assert!(
        matches!(denied.kind, SynologyErrorKind::PermissionDenied),
        "{denied}"
    );
    assert_dsm_failure(&denied, 105);
    assert_eq!(nas.requests().len(), 3);
    assert_eq!(request_api(&nas, 2), FIREWALL_ADAPTER);
    assert_never_list_all(&nas);
}

#[tokio::test]
async fn firewall_rules_without_adapter_names_or_rules_are_schema_failures() {
    let (service, nas) = service_with(
        &[(FIREWALL_ADAPTER, 1), (FIREWALL_RULES, 1)],
        vec![
            ok(json!({})),
            ok(json!({"adapter_names": ["global"]})),
            ok(json!({"policy": "allow", "total": 0})),
            ok(json!({"adapter_names": ["global"]})),
            ok(json!({"policy": "allow", "rules": ["allow all"], "total": 1})),
        ],
    )
    .await;

    for _ in 0..3 {
        let error = service.list_firewall_rules().await.unwrap_err();
        assert_schema_failure(&error);
    }
    assert_eq!(nas.requests().len(), 5);
    assert_never_list_all(&nas);
}
