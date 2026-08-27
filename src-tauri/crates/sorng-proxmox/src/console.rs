//! VNC / SPICE / xterm.js console ticket acquisition.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

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
    use super::urlencoding;

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
