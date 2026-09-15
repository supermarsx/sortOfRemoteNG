//! Network management — interfaces, DNS, firewall, DHCP, VPN, proxy.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::{bool_lenient, string_or_number, string_param};
use serde::Deserialize;
use serde_json::Value;

const NETWORK: &str = "SYNO.Core.Network";
const NETWORK_INTERFACE: &str = "SYNO.Core.Network.Interface";
const FIREWALL_ADAPTER: &str = "SYNO.Core.Security.Firewall.Adapter";
const FIREWALL_RULES: &str = "SYNO.Core.Security.Firewall.Rules";

/// Upper bound on the firewall adapters (profiles) whose rules are loaded, one
/// `load` request each.
const MAX_FIREWALL_ADAPTERS: usize = 32;

/// `SYNO.Core.Network get` with DSM's field names. DSM sends no interface
/// list here (`SYNO.Core.Network.Interface list` has it) and no workgroup.
#[derive(Deserialize)]
struct NetworkWire {
    server_name: String,
    #[serde(default)]
    dns_primary: Option<String>,
    #[serde(default)]
    dns_secondary: Option<String>,
    #[serde(default)]
    gateway: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

impl From<NetworkWire> for NetworkOverview {
    fn from(wire: NetworkWire) -> Self {
        Self {
            hostname: wire.server_name,
            workgroup: None,
            dns: [wire.dns_primary, wire.dns_secondary]
                .into_iter()
                .filter_map(non_empty)
                .collect(),
            gateway: non_empty(wire.gateway),
            interfaces: None,
        }
    }
}

/// One `SYNO.Core.Network.Interface list` row with DSM's field names: a single
/// IPv4 address and mask, the link speed as a number and no MAC address.
#[derive(Deserialize)]
struct InterfaceWire {
    ifname: String,
    #[serde(default)]
    ip: Option<String>,
    #[serde(default)]
    mask: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_i64_lenient")]
    speed: Option<i64>,
    status: String,
    #[serde(default, rename = "type")]
    interface_type: Option<String>,
}

impl From<InterfaceWire> for NetworkInterface {
    fn from(wire: InterfaceWire) -> Self {
        Self {
            id: wire.ifname.clone(),
            name: Some(wire.ifname),
            mac: None,
            ip: non_empty(wire.ip).into_iter().collect(),
            ipv6: Vec::new(),
            subnet: non_empty(wire.mask),
            mtu: None,
            // A negative speed is not a link speed.
            link_speed: wire
                .speed
                .filter(|speed| *speed >= 0)
                .map(|speed| speed.to_string()),
            status: wire.status,
            interface_type: non_empty(wire.interface_type),
        }
    }
}

/// `SYNO.Core.Security.Firewall.Adapter list`.
#[derive(Deserialize)]
struct FirewallAdaptersWire {
    adapter_names: Vec<String>,
}

/// `SYNO.Core.Security.Firewall.Rules load` for one adapter:
/// `{"policy":…,"rules":[…],"total":n}`. Only `rules` is read.
#[derive(Deserialize)]
struct FirewallLoadWire {
    rules: Vec<FirewallRuleWire>,
}

/// One firewall rule. The rule field names are only partly confirmed (S§7 #2:
/// KastnerRG `apply_security.py` shows `enabled`/`policy`/`src`/`protocol`/
/// `ports`), so each DTO field reads the first usable of several candidate
/// keys and an unusable value stays unknown (`None`) instead of failing the
/// whole list. A reply whose rows are not objects is still a schema failure.
#[derive(Deserialize)]
struct FirewallRuleWire {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    enabled: Option<Value>,
    #[serde(default)]
    policy: Option<Value>,
    #[serde(default)]
    service_policy: Option<Value>,
    #[serde(default)]
    action: Option<Value>,
    #[serde(default)]
    protocol: Option<Value>,
    #[serde(default)]
    src: Option<Value>,
    #[serde(default)]
    source_ip: Option<Value>,
    #[serde(default)]
    src_ip: Option<Value>,
    #[serde(default)]
    ports: Option<Value>,
    #[serde(default)]
    port: Option<Value>,
    #[serde(default)]
    dst_port: Option<Value>,
}

/// A scalar as text, or a list of scalars joined with `", "`. Empty strings,
/// null, objects and empty lists are unknown.
fn rule_text(value: Value) -> Option<String> {
    match value {
        Value::Array(items) => {
            let parts: Vec<String> = items.into_iter().filter_map(rule_text).collect();
            (!parts.is_empty()).then(|| parts.join(", "))
        }
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null | Value::Object(_) => None,
        scalar => string_or_number(scalar)
            .ok()
            .filter(|text| !text.trim().is_empty()),
    }
}

fn first_text(candidates: [Option<Value>; 3]) -> Option<String> {
    candidates.into_iter().flatten().find_map(rule_text)
}

impl FirewallRuleWire {
    fn into_rule(self, adapter: &str) -> FirewallRule {
        FirewallRule {
            id: self.id.and_then(|id| string_or_number(id).ok()),
            adapter: Some(adapter.to_owned()),
            src_ip: first_text([self.src, self.source_ip, self.src_ip]),
            src_port: first_text([self.ports, self.port, self.dst_port]),
            direction: None,
            action: first_text([self.policy, self.service_policy, self.action]),
            protocol: self.protocol.and_then(rule_text),
            enabled: self.enabled.and_then(|flag| bool_lenient(flag).ok()),
        }
    }
}

pub struct NetworkManager;

impl NetworkManager {
    /// Get the network overview: host name, DNS servers and default gateway.
    /// Interfaces come from [`Self::list_interfaces`].
    pub async fn get_overview(client: &SynoClient) -> SynologyResult<NetworkOverview> {
        let v = client.best_version(NETWORK, 1).unwrap_or(1);
        let wire: NetworkWire = client.api_call(NETWORK, v, "get", &[]).await?;
        Ok(wire.into())
    }

    /// List all network interfaces. DSM answers with a bare array.
    pub async fn list_interfaces(client: &SynoClient) -> SynologyResult<Vec<NetworkInterface>> {
        let v = client.best_version(NETWORK_INTERFACE, 1).unwrap_or(1);
        let rows: Vec<InterfaceWire> = client
            .api_list(NETWORK_INTERFACE, v, "list", &[], &["interfaces"])
            .await?;
        Ok(rows.into_iter().map(NetworkInterface::from).collect())
    }

    /// List firewall rules of every firewall adapter (profile).
    ///
    /// DSM's `SYNO.Core.Security.Firewall.Rules` has no `list_all`; its methods
    /// are `load`, `save_start`, `save_status` and `save_stop` (kwent/syno
    /// `definitions/{6.x,7.x}/_full.json`). Rules are read per adapter:
    /// `Firewall.Adapter list` names the adapters, then `Firewall.Rules load`
    /// with `adapter=<name>` (KastnerRG krg-infra `apply_security.py`) returns
    /// each adapter's rules. The first DSM error is returned unchanged.
    pub async fn list_firewall_rules(client: &SynoClient) -> SynologyResult<Vec<FirewallRule>> {
        let adapter_version = client.best_version(FIREWALL_ADAPTER, 1).unwrap_or(1);
        let adapters: FirewallAdaptersWire = client
            .api_call(FIREWALL_ADAPTER, adapter_version, "list", &[])
            .await?;
        let rules_version = client.best_version(FIREWALL_RULES, 1).unwrap_or(1);
        let mut rules = Vec::new();
        for adapter in adapters.adapter_names.iter().take(MAX_FIREWALL_ADAPTERS) {
            let name = string_param(client, FIREWALL_RULES, adapter);
            let loaded: FirewallLoadWire = client
                .api_call(
                    FIREWALL_RULES,
                    rules_version,
                    "load",
                    &[("adapter", name.as_str())],
                )
                .await?;
            rules.extend(loaded.rules.into_iter().map(|rule| rule.into_rule(adapter)));
        }
        Ok(rules)
    }

    /// Set firewall enabled/disabled.
    pub async fn set_firewall_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Security.Firewall", 1)
            .unwrap_or(1);
        let val = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.Security.Firewall", v, "set", &[("enable", val)])
            .await
    }

    /// List DHCP server leases.
    pub async fn list_dhcp_leases(client: &SynoClient) -> SynologyResult<Vec<DhcpLease>> {
        let v = client.best_version("SYNO.Core.DHCP.Server", 1).unwrap_or(1);
        client
            .api_call("SYNO.Core.DHCP.Server", v, "list", &[])
            .await
    }

    /// Get DNS settings.
    pub async fn get_dns(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Network", 1).unwrap_or(1);
        client
            .api_call("SYNO.Core.Network", v, "get", &[("group", "dns")])
            .await
    }

    /// Set DNS servers.
    pub async fn set_dns(
        client: &SynoClient,
        primary: &str,
        secondary: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Network", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Network",
                v,
                "set",
                &[("dns_primary", primary), ("dns_secondary", secondary)],
            )
            .await
    }

    /// List VPN profiles.
    pub async fn list_vpn_profiles(client: &SynoClient) -> SynologyResult<Vec<VpnProfile>> {
        let v = client
            .best_version("SYNO.Core.Network.VPN.PPTP", 1)
            .unwrap_or(1);
        if client.has_api("SYNO.Core.Network.VPN.Profile") {
            let vp = client
                .best_version("SYNO.Core.Network.VPN.Profile", 1)
                .unwrap_or(1);
            return client
                .api_call("SYNO.Core.Network.VPN.Profile", vp, "list", &[])
                .await;
        }
        // Fallback: try per-type listing
        client
            .api_call("SYNO.Core.Network.VPN.PPTP", v, "list", &[])
            .await
    }

    /// Get proxy settings.
    pub async fn get_proxy(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.Network.Proxy", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Network.Proxy", v, "get", &[])
            .await
    }

    /// Set proxy configuration.
    pub async fn set_proxy(
        client: &SynoClient,
        enable: bool,
        host: &str,
        port: &str,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Network.Proxy", 1)
            .unwrap_or(1);
        let en = if enable { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.Core.Network.Proxy",
                v,
                "set",
                &[("enable", en), ("host", host), ("port", port)],
            )
            .await
    }

    /// Get DDNS status.
    pub async fn get_ddns(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.DDNS.Record", 1).unwrap_or(1);
        client
            .api_call("SYNO.Core.DDNS.Record", v, "list", &[])
            .await
    }
}
