//! VNC / SPICE / xterm.js console ticket acquisition.
//!
//! [`ConsoleTarget`] normalises the three things a console can attach to
//! (a QEMU VM, an LXC container, or a node shell) into the API path prefixes
//! that the ticket endpoints and the `vncwebsocket` upgrade share. The live
//! relay that consumes those tickets lives in [`crate::console_ws`].

use crate::client::PveClient;
use crate::error::{ProxmoxError, ProxmoxResult};
use crate::types::*;

/// Longest accepted node name / path segment.
const MAX_PATH_SEGMENT_BYTES: usize = 64;

/// Reject anything that could escape its position in an API path.
fn validate_path_segment(value: &str, label: &str) -> ProxmoxResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_PATH_SEGMENT_BYTES {
        return Err(ProxmoxError::console(format!("Invalid Proxmox {label}")));
    }
    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
        || value.starts_with('.')
    {
        return Err(ProxmoxError::console(format!("Invalid Proxmox {label}")));
    }
    Ok(value.to_string())
}

/// What a console session is attached to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsoleTarget {
    Qemu { node: String, vmid: u64 },
    Lxc { node: String, vmid: u64 },
    Node { node: String },
}

impl ConsoleTarget {
    /// Build a target from the command-level `{ node, vmid?, vm_type? }` triple.
    ///
    /// `vm_type` accepts `qemu`/`vm`, `lxc`/`ct`/`container` and `node`/`shell`
    /// (case-insensitive). When it is omitted the presence of `vmid` decides:
    /// `Some` → QEMU, `None` → node shell.
    pub fn parse(node: &str, vmid: Option<u64>, vm_type: Option<&str>) -> ProxmoxResult<Self> {
        let node = validate_path_segment(node, "node name")?;
        let kind = vm_type
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase());
        let kind = match kind.as_deref() {
            Some("qemu" | "vm") => "qemu",
            Some("lxc" | "ct" | "container") => "lxc",
            Some("node" | "shell") => "node",
            Some(_) => {
                return Err(ProxmoxError::console(
                    "Invalid Proxmox console type (expected qemu, lxc or node)",
                ))
            }
            None if vmid.is_some() => "qemu",
            None => "node",
        };
        match kind {
            "node" => Ok(Self::Node { node }),
            _ => {
                let vmid = vmid.ok_or_else(|| {
                    ProxmoxError::console("A Proxmox guest console requires a vmid")
                })?;
                if vmid == 0 {
                    return Err(ProxmoxError::console("Invalid Proxmox vmid"));
                }
                Ok(if kind == "qemu" {
                    Self::Qemu { node, vmid }
                } else {
                    Self::Lxc { node, vmid }
                })
            }
        }
    }

    pub fn node(&self) -> &str {
        match self {
            Self::Qemu { node, .. } | Self::Lxc { node, .. } | Self::Node { node } => node,
        }
    }

    pub fn vmid(&self) -> Option<u64> {
        match self {
            Self::Qemu { vmid, .. } | Self::Lxc { vmid, .. } => Some(*vmid),
            Self::Node { .. } => None,
        }
    }

    /// `"qemu"`, `"lxc"` or `"node"` — the value echoed back to the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Qemu { .. } => "qemu",
            Self::Lxc { .. } => "lxc",
            Self::Node { .. } => "node",
        }
    }

    /// API path prefix shared by the ticket and websocket endpoints.
    pub fn api_base(&self) -> String {
        match self {
            Self::Qemu { node, vmid } => format!("/api2/json/nodes/{node}/qemu/{vmid}"),
            Self::Lxc { node, vmid } => format!("/api2/json/nodes/{node}/lxc/{vmid}"),
            Self::Node { node } => format!("/api2/json/nodes/{node}"),
        }
    }

    pub fn termproxy_path(&self) -> String {
        format!("{}/termproxy", self.api_base())
    }

    pub fn vncwebsocket_path(&self) -> String {
        format!("{}/vncwebsocket", self.api_base())
    }
}

/// Build the `wss://…/vncwebsocket?port=&vncticket=` URL for a target.
///
/// `base_url` is the client's `https://host:port` origin; the scheme is
/// swapped for `wss` because that is what the WebSocket client expects.
pub fn build_vncwebsocket_url(
    base_url: &str,
    target: &ConsoleTarget,
    port: &str,
    vncticket: &str,
) -> String {
    let origin = match base_url.strip_prefix("https://") {
        Some(rest) => format!("wss://{rest}"),
        None => base_url.to_string(),
    };
    format!(
        "{origin}{}?port={}&vncticket={}",
        target.vncwebsocket_path(),
        urlencoding(port),
        urlencoding(vncticket),
    )
}

pub struct ConsoleManager<'a> {
    client: &'a PveClient,
}

impl<'a> ConsoleManager<'a> {
    pub fn new(client: &'a PveClient) -> Self {
        Self { client }
    }

    /// Create a VNC proxy ticket for a QEMU VM.
    pub async fn qemu_vnc_proxy(
        &self,
        node: &str,
        vmid: u64,
        websocket: bool,
    ) -> ProxmoxResult<VncTicket> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/vncproxy");
        let ws = if websocket { "1" } else { "0" };
        self.client
            .post_form::<VncTicket>(&path, &[("websocket", ws)])
            .await
    }

    /// Create a SPICE proxy ticket for a QEMU VM.
    pub async fn qemu_spice_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<SpiceTicket> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/spiceproxy");
        self.client.post_form::<SpiceTicket>(&path, &[]).await
    }

    /// Create a termproxy (xterm.js) ticket for a QEMU VM.
    pub async fn qemu_termproxy(&self, node: &str, vmid: u64) -> ProxmoxResult<TermProxyTicket> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/termproxy");
        self.client.post_form::<TermProxyTicket>(&path, &[]).await
    }

    /// Create a VNC proxy ticket for an LXC container.
    pub async fn lxc_vnc_proxy(
        &self,
        node: &str,
        vmid: u64,
        websocket: bool,
    ) -> ProxmoxResult<VncTicket> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/vncproxy");
        let ws = if websocket { "1" } else { "0" };
        self.client
            .post_form::<VncTicket>(&path, &[("websocket", ws)])
            .await
    }

    /// Create a SPICE proxy ticket for an LXC container.
    pub async fn lxc_spice_proxy(&self, node: &str, vmid: u64) -> ProxmoxResult<SpiceTicket> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/spiceproxy");
        self.client.post_form::<SpiceTicket>(&path, &[]).await
    }

    /// Create a termproxy (xterm.js) ticket for an LXC container.
    pub async fn lxc_termproxy(&self, node: &str, vmid: u64) -> ProxmoxResult<TermProxyTicket> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/termproxy");
        self.client.post_form::<TermProxyTicket>(&path, &[]).await
    }

    /// Create a node-level shell termproxy (xterm.js).
    pub async fn node_termproxy(&self, node: &str) -> ProxmoxResult<TermProxyTicket> {
        let path = format!("/api2/json/nodes/{node}/termproxy");
        self.client.post_form::<TermProxyTicket>(&path, &[]).await
    }

    /// Create a termproxy ticket for any [`ConsoleTarget`].
    pub async fn termproxy(&self, target: &ConsoleTarget) -> ProxmoxResult<TermProxyTicket> {
        self.client
            .post_form::<TermProxyTicket>(&target.termproxy_path(), &[])
            .await
    }

    /// Create a VNC proxy for a node shell.
    pub async fn node_vnc_proxy(&self, node: &str, websocket: bool) -> ProxmoxResult<VncTicket> {
        let path = format!("/api2/json/nodes/{node}/vncproxy");
        let ws = if websocket { "1" } else { "0" };
        self.client
            .post_form::<VncTicket>(&path, &[("websocket", ws)])
            .await
    }

    /// Build a noVNC websocket URL for a QEMU VM.
    pub fn build_novnc_url(&self, node: &str, vmid: u64, ticket: &VncTicket) -> String {
        format!(
            "{}/api2/json/nodes/{}/qemu/{}/vncwebsocket?port={}&vncticket={}",
            self.client.base_url(),
            node,
            vmid,
            ticket.port,
            urlencoding(&ticket.ticket),
        )
    }

    /// Build a noVNC websocket URL for an LXC container.
    pub fn build_novnc_url_lxc(&self, node: &str, vmid: u64, ticket: &VncTicket) -> String {
        format!(
            "{}/api2/json/nodes/{}/lxc/{}/vncwebsocket?port={}&vncticket={}",
            self.client.base_url(),
            node,
            vmid,
            ticket.port,
            urlencoding(&ticket.ticket),
        )
    }
}

/// Encode a query-string value (`application/x-www-form-urlencoded`, which the
/// PVE `vncwebsocket` endpoint decodes; every reserved character is escaped).
pub(crate) fn urlencoding(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::{build_vncwebsocket_url, urlencoding, ConsoleTarget};

    #[test]
    fn console_target_defaults_to_qemu_when_a_vmid_is_present() {
        let target = ConsoleTarget::parse("pve1", Some(100), None).expect("target");
        assert_eq!(
            target,
            ConsoleTarget::Qemu {
                node: "pve1".into(),
                vmid: 100
            }
        );
        assert_eq!(target.kind(), "qemu");
        assert_eq!(
            target.termproxy_path(),
            "/api2/json/nodes/pve1/qemu/100/termproxy"
        );
    }

    #[test]
    fn console_target_defaults_to_a_node_shell_without_a_vmid() {
        let target = ConsoleTarget::parse("pve1", None, None).expect("target");
        assert_eq!(
            target,
            ConsoleTarget::Node {
                node: "pve1".into()
            }
        );
        assert_eq!(target.vmid(), None);
        assert_eq!(
            target.vncwebsocket_path(),
            "/api2/json/nodes/pve1/vncwebsocket"
        );
    }

    #[test]
    fn console_target_accepts_lxc_aliases_and_rejects_unknown_kinds() {
        for alias in ["lxc", "ct", "Container"] {
            let target = ConsoleTarget::parse("pve1", Some(7), Some(alias)).expect("target");
            assert_eq!(target.kind(), "lxc");
            assert_eq!(target.api_base(), "/api2/json/nodes/pve1/lxc/7");
        }
        assert!(ConsoleTarget::parse("pve1", Some(7), Some("spice")).is_err());
    }

    #[test]
    fn console_target_requires_a_vmid_for_guest_consoles() {
        assert!(ConsoleTarget::parse("pve1", None, Some("qemu")).is_err());
        assert!(ConsoleTarget::parse("pve1", Some(0), Some("qemu")).is_err());
    }

    #[test]
    fn console_target_rejects_path_traversal_in_the_node_name() {
        // Surrounding whitespace is trimmed, so the newline case is embedded.
        for node in [
            "..",
            "a/b",
            "pve 1",
            "",
            "pve\n1",
            "../../access/ticket",
            "%2e%2e",
        ] {
            assert!(
                ConsoleTarget::parse(node, Some(100), Some("qemu")).is_err(),
                "node {node:?} must be rejected"
            );
        }
    }

    #[test]
    fn vncwebsocket_url_switches_scheme_and_escapes_the_ticket() {
        let target = ConsoleTarget::parse("pve1", Some(100), Some("qemu")).expect("target");
        assert_eq!(
            build_vncwebsocket_url("https://10.0.0.5:8006", &target, "5900", "PVEVNC:a/b+c"),
            "wss://10.0.0.5:8006/api2/json/nodes/pve1/qemu/100/vncwebsocket?port=5900&vncticket=PVEVNC%3Aa%2Fb%2Bc"
        );
    }

    #[test]
    fn urlencoding_escapes_every_reserved_character() {
        assert_eq!(
            urlencoding("PVEVNC:abc/def+g=h&i?j#k%l m"),
            "PVEVNC%3Aabc%2Fdef%2Bg%3Dh%26i%3Fj%23k%25l+m"
        );
        assert_eq!(urlencoding("plain-._~"), "plain-._%7E");
        assert_eq!(urlencoding("é"), "%C3%A9");
    }
}
