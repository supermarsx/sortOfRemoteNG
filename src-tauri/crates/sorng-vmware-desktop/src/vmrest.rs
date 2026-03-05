//! VMware REST API (`vmrest`) client.
//!
//! `vmrest` ships with Workstation Pro 15+ / Fusion 11+ and exposes VM
//! management over HTTP with basic auth.  This module wraps the REST
//! endpoints into typed async methods.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// HTTP client for the vmrest daemon.
#[derive(Debug, Clone)]
pub struct VmRestClient {
    pub http: HttpClient,
    pub base_url: String,
    pub username: String,
    pub password: String,
}

impl VmRestClient {
    /// Create a new vmrest client.
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> VmwResult<Self> {
        let http = HttpClient::builder()
            .danger_accept_invalid_certs(true) // vmrest uses self-signed by default
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| VmwError::http(e))?;
        Ok(Self {
            http,
            base_url: format!("http://{}:{}/api", host, port),
            username: username.to_string(),
            password: password.to_string(),
        })
    }

    /// Check connectivity.
    pub async fn ping(&self) -> VmwResult<bool> {
        let resp = self
            .http
            .get(&self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        Ok(resp.status().is_success())
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    async fn get<T: DeserializeOwned>(&self, path: &str) -> VmwResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn get_text(&self, path: &str) -> VmwResult<String> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(VmwError::new(
                VmwErrorKind::HttpError,
                format!("HTTP {status}: {body}"),
            ));
        }
        resp.text().await.map_err(|e| VmwError::http(e))
    }

    async fn put<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(body)
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn put_value<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(body)
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(body)
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn post_value<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(body)
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn post_empty(&self, path: &str) -> VmwResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn delete(&self, path: &str) -> VmwResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .delete(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| VmwError::http(e))?;
        self.handle_response(resp).await
    }

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> VmwResult<T> {
        let status = resp.status();
        let body = resp.text().await.map_err(|e| VmwError::http(e))?;
        if !status.is_success() {
            return Err(VmwError::new(
                match status.as_u16() {
                    401 => VmwErrorKind::PermissionDenied,
                    404 => VmwErrorKind::VmNotFound,
                    _ => VmwErrorKind::HttpError,
                },
                format!("HTTP {}: {}", status.as_u16(), body),
            ));
        }
        if body.trim().is_empty() {
            // Try deserializing empty/null
            return serde_json::from_str("null")
                .map_err(|e| VmwError::new(VmwErrorKind::InternalError, e.to_string()));
        }
        serde_json::from_str(&body)
            .map_err(|e| VmwError::new(VmwErrorKind::InternalError, format!("JSON parse error: {e}: {body}")))
    }

    // ═════════════════════════════════════════════════════════════════════
    // VM endpoints
    // ═════════════════════════════════════════════════════════════════════

    /// GET /vms — list all registered VMs.
    pub async fn list_vms(&self) -> VmwResult<Vec<VmRestVm>> {
        self.get("/vms").await
    }

    /// GET /vms/{id} — get VM settings.
    pub async fn get_vm(&self, id: &str) -> VmwResult<Value> {
        self.get(&format!("/vms/{id}")).await
    }

    /// GET /vms/{id}/params/{name} — get a single VM config parameter.
    pub async fn get_vm_param(&self, id: &str, name: &str) -> VmwResult<Value> {
        self.get(&format!("/vms/{id}/params/{name}")).await
    }

    /// PUT /vms/{id} — update VM settings (CPU, memory, etc.).
    pub async fn update_vm(&self, id: &str, body: &Value) -> VmwResult<Value> {
        self.put_value(&format!("/vms/{id}"), body).await
    }

    /// POST /vms — register a VM by vmx path.
    pub async fn register_vm(&self, vmx_path: &str) -> VmwResult<VmRestVm> {
        #[derive(serde::Serialize)]
        struct Req<'a> {
            path: &'a str,
        }
        self.post("/vms", &Req { path: vmx_path }).await
    }

    /// DELETE /vms/{id} — unregister a VM (does NOT delete files).
    pub async fn unregister_vm(&self, id: &str) -> VmwResult<Value> {
        self.delete(&format!("/vms/{id}")).await
    }

    // ── Power ────────────────────────────────────────────────────────────

    /// GET /vms/{id}/power — current power state.
    pub async fn get_power_state(&self, id: &str) -> VmwResult<VmRestPowerState> {
        self.get(&format!("/vms/{id}/power")).await
    }

    /// PUT /vms/{id}/power — change power state.
    pub async fn set_power_state(&self, id: &str, action: &str) -> VmwResult<Value> {
        self.put_value(&format!("/vms/{id}/power"), &action).await
    }

    // ── NICs ─────────────────────────────────────────────────────────────

    /// GET /vms/{id}/nic — list NICs.
    pub async fn list_nics(&self, id: &str) -> VmwResult<VmRestNics> {
        self.get(&format!("/vms/{id}/nic")).await
    }

    /// PUT /vms/{id}/nic/{index} — update a NIC.
    pub async fn update_nic(&self, id: &str, index: u32, body: &Value) -> VmwResult<Value> {
        self.put_value(&format!("/vms/{id}/nic/{index}"), body).await
    }

    /// POST /vms/{id}/nic — create a NIC.
    pub async fn create_nic(&self, id: &str, body: &Value) -> VmwResult<Value> {
        self.post_value(&format!("/vms/{id}/nic"), body).await
    }

    /// DELETE /vms/{id}/nic/{index} — delete a NIC.
    pub async fn delete_nic(&self, id: &str, index: u32) -> VmwResult<Value> {
        self.delete(&format!("/vms/{id}/nic/{index}")).await
    }

    /// GET /vms/{id}/ip — get guest IP address.
    pub async fn get_ip_address(&self, id: &str) -> VmwResult<VmRestIp> {
        self.get(&format!("/vms/{id}/ip")).await
    }

    // ── Shared Folders ───────────────────────────────────────────────────

    /// GET /vms/{id}/sharedfolders — list shared folders.
    pub async fn list_shared_folders(&self, id: &str) -> VmwResult<Vec<VmRestSharedFolder>> {
        self.get(&format!("/vms/{id}/sharedfolders")).await
    }

    /// POST /vms/{id}/sharedfolders — add a shared folder.
    pub async fn add_shared_folder(&self, id: &str, body: &Value) -> VmwResult<Value> {
        self.post_value(&format!("/vms/{id}/sharedfolders"), body).await
    }

    /// PUT /vms/{id}/sharedfolders/{id2} — update a shared folder.
    pub async fn update_shared_folder(
        &self,
        vm_id: &str,
        folder_id: &str,
        body: &Value,
    ) -> VmwResult<Value> {
        self.put_value(&format!("/vms/{vm_id}/sharedfolders/{folder_id}"), body).await
    }

    /// DELETE /vms/{id}/sharedfolders/{id2} — remove a shared folder.
    pub async fn delete_shared_folder(
        &self,
        vm_id: &str,
        folder_id: &str,
    ) -> VmwResult<Value> {
        self.delete(&format!("/vms/{vm_id}/sharedfolders/{folder_id}")).await
    }

    // ── Virtual Networks (vmnet) ─────────────────────────────────────────

    /// GET /vmnet — list virtual networks.
    pub async fn list_networks(&self) -> VmwResult<VmRestNetworks> {
        self.get("/vmnet").await
    }

    /// GET /vmnet/{name}/mactoip — list MAC-to-IP mappings for a vmnet.
    pub async fn get_mac_to_ip(&self, name: &str) -> VmwResult<Value> {
        self.get(&format!("/vmnet/{name}/mactoip")).await
    }

    /// GET /vmnet/{name}/portforward — list port-forwarding rules.
    pub async fn list_port_forwards(&self, name: &str) -> VmwResult<Value> {
        self.get(&format!("/vmnet/{name}/portforward")).await
    }

    /// PUT /vmnet/{name}/portforward/{proto}/{host_port} — add/update a rule.
    pub async fn set_port_forward(
        &self,
        name: &str,
        proto: &str,
        host_port: u16,
        body: &Value,
    ) -> VmwResult<Value> {
        self.put_value(
            &format!("/vmnet/{name}/portforward/{proto}/{host_port}"),
            body,
        )
        .await
    }

    /// DELETE /vmnet/{name}/portforward/{proto}/{host_port} — remove a rule.
    pub async fn delete_port_forward(
        &self,
        name: &str,
        proto: &str,
        host_port: u16,
    ) -> VmwResult<Value> {
        self.delete(&format!(
            "/vmnet/{name}/portforward/{proto}/{host_port}"
        ))
        .await
    }

    /// POST /vmnet — create a virtual network.
    pub async fn create_network(&self, body: &Value) -> VmwResult<Value> {
        self.post_value("/vmnet", body).await
    }

    /// PUT /vmnet/{name} — update a virtual network.
    pub async fn update_network(&self, name: &str, body: &Value) -> VmwResult<Value> {
        self.put_value(&format!("/vmnet/{name}"), body).await
    }

    /// DELETE /vmnet/{name} — delete a virtual network.
    pub async fn delete_network(&self, name: &str) -> VmwResult<Value> {
        self.delete(&format!("/vmnet/{name}")).await
    }
}

// ─── Response types from vmrest ──────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestVm {
    pub id: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestPowerState {
    pub power_state: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestIp {
    pub ip: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestNics {
    pub nics: Option<Vec<VmRestNic>>,
    pub num: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestNic {
    pub index: Option<u32>,
    #[serde(rename = "type")]
    pub nic_type: Option<String>,
    pub vmnet: Option<String>,
    pub macAddress: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestSharedFolder {
    pub folder_id: Option<String>,
    pub host_path: Option<String>,
    pub flags: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestNetworks {
    pub vmnets: Option<Vec<VmRestNetwork>>,
    pub num: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmRestNetwork {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub net_type: Option<String>,
    pub dhcp: Option<String>,
    pub subnet: Option<String>,
    pub mask: Option<String>,
}
