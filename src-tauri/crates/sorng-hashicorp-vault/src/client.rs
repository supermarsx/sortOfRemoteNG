// ── sorng-hashicorp-vault/src/client.rs ───────────────────────────────────────
//! HTTP client for the HashiCorp Vault REST API.

use crate::error::{VaultError, VaultResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::time::Duration;

/// Low-level Vault HTTP client.
pub struct VaultClient {
    pub base_url: String,
    http: HttpClient,
    token: String,
    namespace: Option<String>,
}

// ── Vault API response envelope ──────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct VaultApiResponse<T> {
    #[serde(default)]
    data: Option<T>,
    #[serde(default)]
    errors: Option<Vec<String>>,
    #[serde(default)]
    auth: Option<Value>,
    #[serde(default)]
    wrap_info: Option<Value>,
    #[serde(default)]
    lease_id: Option<String>,
    #[serde(default)]
    renewable: Option<bool>,
    #[serde(default)]
    lease_duration: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
struct VaultListData {
    keys: Vec<String>,
}

impl VaultClient {
    pub fn new(config: &VaultConnectionConfig) -> VaultResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(config.tls_skip_verify)
            .build()
            .map_err(|e| VaultError::connection_failed(format!("http client build: {e}")))?;

        let base_url = config.addr.trim_end_matches('/').to_string();

        Ok(Self {
            base_url,
            http,
            token: config.token.clone(),
            namespace: config.namespace.clone(),
        })
    }

    // ── Helpers ──────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}/v1/{}", self.base_url, path.trim_start_matches('/'))
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut req = self.http.request(method, self.url(path))
            .header("X-Vault-Token", &self.token);
        if let Some(ns) = &self.namespace {
            req = req.header("X-Vault-Namespace", ns);
        }
        req
    }

    async fn check_response(&self, resp: reqwest::Response) -> VaultResult<Value> {
        let status = resp.status().as_u16();
        if status == 503 {
            return Err(VaultError::sealed());
        }
        let body: Value = resp.json().await?;
        if status == 403 {
            let errors = body["errors"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            return Err(VaultError::permission_denied(errors.join(", ")));
        }
        if status == 404 {
            let errors = body["errors"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            return Err(VaultError::not_found(errors.join(", ")));
        }
        if status >= 400 {
            let errors = body["errors"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
                .unwrap_or_default();
            return Err(VaultError::api_error(status, errors));
        }
        Ok(body)
    }

    fn extract_data<T: DeserializeOwned>(body: &Value) -> VaultResult<T> {
        let data = body.get("data").ok_or_else(|| VaultError::parse_error("missing 'data' field"))?;
        serde_json::from_value(data.clone()).map_err(|e| VaultError::parse_error(e.to_string()))
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> VaultResult<T> {
        debug!("VAULT GET {}", path);
        let resp = self.request(reqwest::Method::GET, path).send().await?;
        let body = self.check_response(resp).await?;
        Self::extract_data(&body)
    }

    pub async fn get_raw(&self, path: &str) -> VaultResult<Value> {
        debug!("VAULT GET (raw) {}", path);
        let resp = self.request(reqwest::Method::GET, path).send().await?;
        self.check_response(resp).await
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: &Value) -> VaultResult<T> {
        debug!("VAULT POST {}", path);
        let resp = self.request(reqwest::Method::POST, path).json(body).send().await?;
        let resp_body = self.check_response(resp).await?;
        Self::extract_data(&resp_body)
    }

    pub async fn post_raw(&self, path: &str, body: &Value) -> VaultResult<Value> {
        debug!("VAULT POST (raw) {}", path);
        let resp = self.request(reqwest::Method::POST, path).json(body).send().await?;
        self.check_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str) -> VaultResult<Value> {
        debug!("VAULT POST (no body) {}", path);
        let resp = self.request(reqwest::Method::POST, path).send().await?;
        self.check_response(resp).await
    }

    pub async fn put_raw(&self, path: &str, body: &Value) -> VaultResult<Value> {
        debug!("VAULT PUT {}", path);
        let resp = self.request(reqwest::Method::PUT, path).json(body).send().await?;
        self.check_response(resp).await
    }

    pub async fn delete_req(&self, path: &str) -> VaultResult<()> {
        debug!("VAULT DELETE {}", path);
        let resp = self.request(reqwest::Method::DELETE, path).send().await?;
        let status = resp.status().as_u16();
        if status == 204 || status == 200 {
            return Ok(());
        }
        let body = self.check_response(resp).await;
        match body {
            Ok(_) => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub async fn list(&self, path: &str) -> VaultResult<Vec<String>> {
        debug!("VAULT LIST {}", path);
        let resp = self.request(reqwest::Method::from_bytes(b"LIST").unwrap_or(reqwest::Method::GET), path)
            .send()
            .await?;
        let body = self.check_response(resp).await?;
        let data: VaultListData = Self::extract_data(&body)?;
        Ok(data.keys)
    }

    // ── Connection test ──────────────────────────────────────────

    pub async fn health(&self) -> VaultResult<VaultHealthResponse> {
        debug!("VAULT health check");
        let resp = self.http
            .get(format!("{}/v1/sys/health", self.base_url))
            .query(&[("standbyok", "true"), ("perfstandbyok", "true")])
            .send()
            .await?;
        let body = resp.json().await?;
        Ok(body)
    }

    pub async fn seal_status(&self) -> VaultResult<VaultSealStatus> {
        debug!("VAULT seal-status");
        let resp = self.http
            .get(format!("{}/v1/sys/seal-status", self.base_url))
            .send()
            .await?;
        let body = resp.json().await?;
        Ok(body)
    }

    pub async fn token_lookup_self(&self) -> VaultResult<VaultTokenInfo> {
        self.get("auth/token/lookup-self").await
    }

    // ── KV v2 ────────────────────────────────────────────────────

    pub async fn kv_read(&self, mount: &str, path: &str) -> VaultResult<VaultKvEntry> {
        let api_path = format!("{}/data/{}", mount, path);
        let body = self.get_raw(&api_path).await?;
        let data = body.get("data").ok_or_else(|| VaultError::secret_not_found(path))?;
        let value = data.get("data").cloned().unwrap_or(Value::Null);
        let metadata = data.get("metadata").cloned();
        let version = metadata.as_ref().and_then(|m| m.get("version")).and_then(|v| v.as_u64());
        let created_time = metadata.as_ref().and_then(|m| m.get("created_time")).and_then(|v| v.as_str()).map(String::from);
        let deletion_time = metadata.as_ref().and_then(|m| m.get("deletion_time")).and_then(|v| v.as_str()).map(String::from);
        let destroyed = metadata.as_ref().and_then(|m| m.get("destroyed")).and_then(|v| v.as_bool()).unwrap_or(false);

        Ok(VaultKvEntry {
            key: path.to_string(),
            value,
            metadata: metadata.and_then(|m| serde_json::from_value(m).ok()),
            version,
            created_time,
            deletion_time,
            destroyed,
        })
    }

    pub async fn kv_write(&self, mount: &str, path: &str, data: Value) -> VaultResult<Value> {
        let api_path = format!("{}/data/{}", mount, path);
        self.post_raw(&api_path, &json!({ "data": data })).await
    }

    pub async fn kv_delete(&self, mount: &str, path: &str) -> VaultResult<()> {
        let api_path = format!("{}/data/{}", mount, path);
        self.delete_req(&api_path).await
    }

    pub async fn kv_undelete(&self, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        let api_path = format!("{}/undelete/{}", mount, path);
        self.post_raw(&api_path, &json!({ "versions": versions })).await?;
        Ok(())
    }

    pub async fn kv_destroy(&self, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        let api_path = format!("{}/destroy/{}", mount, path);
        self.post_raw(&api_path, &json!({ "versions": versions })).await?;
        Ok(())
    }

    pub async fn kv_list(&self, mount: &str, path: &str) -> VaultResult<Vec<String>> {
        let api_path = format!("{}/metadata/{}", mount, path);
        self.list(&api_path).await
    }

    pub async fn kv_read_metadata(&self, mount: &str, path: &str) -> VaultResult<VaultKvMetadata> {
        let api_path = format!("{}/metadata/{}", mount, path);
        self.get(&api_path).await
    }

    pub async fn kv_delete_metadata(&self, mount: &str, path: &str) -> VaultResult<()> {
        let api_path = format!("{}/metadata/{}", mount, path);
        self.delete_req(&api_path).await
    }

    // ── Transit ──────────────────────────────────────────────────

    pub async fn transit_create_key(&self, name: &str, key_type: Option<&str>) -> VaultResult<()> {
        let mut body = json!({});
        if let Some(t) = key_type {
            body["type"] = Value::String(t.to_string());
        }
        self.post_raw(&format!("transit/keys/{}", name), &body).await?;
        Ok(())
    }

    pub async fn transit_read_key(&self, name: &str) -> VaultResult<VaultTransitKey> {
        self.get(&format!("transit/keys/{}", name)).await
    }

    pub async fn transit_list_keys(&self) -> VaultResult<Vec<String>> {
        self.list("transit/keys").await
    }

    pub async fn transit_delete_key(&self, name: &str) -> VaultResult<()> {
        self.delete_req(&format!("transit/keys/{}", name)).await
    }

    pub async fn transit_update_key_config(&self, name: &str, config: &VaultTransitKeyConfig) -> VaultResult<()> {
        let body = serde_json::to_value(config)?;
        self.post_raw(&format!("transit/keys/{}/config", name), &body).await?;
        Ok(())
    }

    pub async fn transit_rotate_key(&self, name: &str) -> VaultResult<()> {
        self.post_no_body(&format!("transit/keys/{}/rotate", name)).await?;
        Ok(())
    }

    pub async fn transit_encrypt(&self, name: &str, plaintext: &str, context: Option<&str>) -> VaultResult<VaultEncryptResponse> {
        let mut body = json!({ "plaintext": plaintext });
        if let Some(ctx) = context {
            body["context"] = Value::String(ctx.to_string());
        }
        self.post(&format!("transit/encrypt/{}", name), &body).await
    }

    pub async fn transit_decrypt(&self, name: &str, ciphertext: &str, context: Option<&str>) -> VaultResult<VaultDecryptResponse> {
        let mut body = json!({ "ciphertext": ciphertext });
        if let Some(ctx) = context {
            body["context"] = Value::String(ctx.to_string());
        }
        self.post(&format!("transit/decrypt/{}", name), &body).await
    }

    pub async fn transit_rewrap(&self, name: &str, ciphertext: &str) -> VaultResult<VaultEncryptResponse> {
        self.post(&format!("transit/rewrap/{}", name), &json!({ "ciphertext": ciphertext })).await
    }

    pub async fn transit_generate_data_key(&self, name: &str, key_type: &str) -> VaultResult<Value> {
        self.post_raw(&format!("transit/datakey/{}/{}", key_type, name), &json!({})).await
    }

    pub async fn transit_sign(&self, name: &str, input: &str) -> VaultResult<Value> {
        self.post_raw(&format!("transit/sign/{}", name), &json!({ "input": input })).await
    }

    pub async fn transit_verify(&self, name: &str, input: &str, signature: &str) -> VaultResult<Value> {
        self.post_raw(&format!("transit/verify/{}", name), &json!({ "input": input, "signature": signature })).await
    }

    pub async fn transit_hash(&self, input: &str, algorithm: Option<&str>) -> VaultResult<Value> {
        let mut body = json!({ "input": input });
        if let Some(alg) = algorithm {
            body["algorithm"] = Value::String(alg.to_string());
        }
        self.post_raw("transit/hash", &body).await
    }

    // ── PKI ──────────────────────────────────────────────────────

    pub async fn pki_read_ca_cert(&self, mount: &str) -> VaultResult<VaultCaInfo> {
        self.get(&format!("{}/ca", mount)).await
    }

    pub async fn pki_list_certs(&self, mount: &str) -> VaultResult<Vec<String>> {
        self.list(&format!("{}/certs", mount)).await
    }

    pub async fn pki_read_cert(&self, mount: &str, serial: &str) -> VaultResult<VaultCertificate> {
        self.get(&format!("{}/cert/{}", mount, serial)).await
    }

    pub async fn pki_issue_cert(&self, mount: &str, role: &str, params: &VaultPkiIssueCert) -> VaultResult<VaultCertificate> {
        let body = serde_json::to_value(params)?;
        self.post(&format!("{}/issue/{}", mount, role), &body).await
    }

    pub async fn pki_sign_cert(&self, mount: &str, role: &str, csr: &str) -> VaultResult<VaultCertificate> {
        self.post(&format!("{}/sign/{}", mount, role), &json!({ "csr": csr })).await
    }

    pub async fn pki_revoke_cert(&self, mount: &str, serial: &str) -> VaultResult<Value> {
        self.post_raw(&format!("{}/revoke", mount), &json!({ "serial_number": serial })).await
    }

    pub async fn pki_tidy(&self, mount: &str) -> VaultResult<Value> {
        self.post_raw(&format!("{}/tidy", mount), &json!({ "tidy_cert_store": true, "tidy_revoked_certs": true })).await
    }

    pub async fn pki_list_roles(&self, mount: &str) -> VaultResult<Vec<String>> {
        self.list(&format!("{}/roles", mount)).await
    }

    pub async fn pki_read_role(&self, mount: &str, name: &str) -> VaultResult<VaultPkiRole> {
        self.get(&format!("{}/roles/{}", mount, name)).await
    }

    pub async fn pki_create_role(&self, mount: &str, name: &str, config: &Value) -> VaultResult<Value> {
        self.post_raw(&format!("{}/roles/{}", mount, name), config).await
    }

    pub async fn pki_delete_role(&self, mount: &str, name: &str) -> VaultResult<()> {
        self.delete_req(&format!("{}/roles/{}", mount, name)).await
    }

    pub async fn pki_generate_root(&self, mount: &str, params: &Value) -> VaultResult<VaultCertificate> {
        self.post(&format!("{}/root/generate/internal", mount), params).await
    }

    pub async fn pki_set_urls(&self, mount: &str, urls: &Value) -> VaultResult<Value> {
        self.post_raw(&format!("{}/config/urls", mount), urls).await
    }

    // ── Auth Methods ─────────────────────────────────────────────

    pub async fn list_auth_methods(&self) -> VaultResult<Vec<VaultAuthMount>> {
        let body = self.get_raw("sys/auth").await?;
        let data = body.get("data").or_else(|| body.as_object().map(|_| &body))
            .ok_or_else(|| VaultError::parse_error("invalid auth list response"))?;
        let map: std::collections::HashMap<String, Value> = serde_json::from_value(data.clone())?;
        let mounts = map.into_iter().map(|(path, v)| {
            let auth_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
            let description = v.get("description").and_then(|d| d.as_str()).map(String::from);
            let accessor = v.get("accessor").and_then(|a| a.as_str()).map(String::from);
            let local = v.get("local").and_then(|l| l.as_bool()).unwrap_or(false);
            let seal_wrap = v.get("seal_wrap").and_then(|s| s.as_bool()).unwrap_or(false);
            let config = v.get("config").cloned();
            VaultAuthMount { path, auth_type, description, accessor, local, seal_wrap, config }
        }).collect();
        Ok(mounts)
    }

    pub async fn enable_auth_method(&self, path: &str, auth_type: &str, config: Option<&Value>) -> VaultResult<()> {
        let mut body = json!({ "type": auth_type });
        if let Some(c) = config {
            body["config"] = c.clone();
        }
        self.post_raw(&format!("sys/auth/{}", path), &body).await?;
        Ok(())
    }

    pub async fn disable_auth_method(&self, path: &str) -> VaultResult<()> {
        self.delete_req(&format!("sys/auth/{}", path)).await
    }

    pub async fn read_auth_config(&self, path: &str) -> VaultResult<Value> {
        self.get_raw(&format!("sys/auth/{}/tune", path)).await
    }

    pub async fn tune_auth_method(&self, path: &str, config: &Value) -> VaultResult<()> {
        self.post_raw(&format!("sys/auth/{}/tune", path), config).await?;
        Ok(())
    }

    // Userpass helpers
    pub async fn userpass_create_user(&self, mount: &str, username: &str, password: &str, policies: &[String]) -> VaultResult<()> {
        let body = json!({ "password": password, "policies": policies.join(",") });
        self.post_raw(&format!("auth/{}/users/{}", mount, username), &body).await?;
        Ok(())
    }

    pub async fn userpass_read_user(&self, mount: &str, username: &str) -> VaultResult<Value> {
        self.get_raw(&format!("auth/{}/users/{}", mount, username)).await
    }

    pub async fn userpass_list_users(&self, mount: &str) -> VaultResult<Vec<String>> {
        self.list(&format!("auth/{}/users", mount)).await
    }

    pub async fn userpass_delete_user(&self, mount: &str, username: &str) -> VaultResult<()> {
        self.delete_req(&format!("auth/{}/users/{}", mount, username)).await
    }

    // AppRole helpers
    pub async fn approle_create_role(&self, mount: &str, name: &str, config: &Value) -> VaultResult<()> {
        self.post_raw(&format!("auth/{}/role/{}", mount, name), config).await?;
        Ok(())
    }

    pub async fn approle_read_role(&self, mount: &str, name: &str) -> VaultResult<Value> {
        self.get_raw(&format!("auth/{}/role/{}", mount, name)).await
    }

    pub async fn approle_list_roles(&self, mount: &str) -> VaultResult<Vec<String>> {
        self.list(&format!("auth/{}/role", mount)).await
    }

    pub async fn approle_get_role_id(&self, mount: &str, name: &str) -> VaultResult<String> {
        let body = self.get_raw(&format!("auth/{}/role/{}/role-id", mount, name)).await?;
        let role_id = body.get("data")
            .and_then(|d| d.get("role_id"))
            .and_then(|r| r.as_str())
            .ok_or_else(|| VaultError::parse_error("missing role_id"))?;
        Ok(role_id.to_string())
    }

    pub async fn approle_generate_secret_id(&self, mount: &str, name: &str) -> VaultResult<Value> {
        self.post_raw(&format!("auth/{}/role/{}/secret-id", mount, name), &json!({})).await
    }

    // ── Policies ─────────────────────────────────────────────────

    pub async fn list_policies(&self) -> VaultResult<Vec<String>> {
        self.list("sys/policies/acl").await
    }

    pub async fn read_policy(&self, name: &str) -> VaultResult<VaultPolicy> {
        let body = self.get_raw(&format!("sys/policies/acl/{}", name)).await?;
        let data = body.get("data").ok_or_else(|| VaultError::policy_not_found(name))?;
        let policy_text = data.get("policy").and_then(|p| p.as_str()).unwrap_or("").to_string();
        Ok(VaultPolicy { name: name.to_string(), policy_text })
    }

    pub async fn create_or_update_policy(&self, name: &str, policy_text: &str) -> VaultResult<()> {
        self.put_raw(&format!("sys/policies/acl/{}", name), &json!({ "policy": policy_text })).await?;
        Ok(())
    }

    pub async fn delete_policy(&self, name: &str) -> VaultResult<()> {
        self.delete_req(&format!("sys/policies/acl/{}", name)).await
    }

    // ── Audit ────────────────────────────────────────────────────

    pub async fn list_audit_devices(&self) -> VaultResult<Vec<VaultAuditDevice>> {
        let body = self.get_raw("sys/audit").await?;
        let data = body.get("data").or_else(|| body.as_object().map(|_| &body))
            .ok_or_else(|| VaultError::parse_error("invalid audit list response"))?;
        let map: std::collections::HashMap<String, Value> = serde_json::from_value(data.clone())?;
        let devices = map.into_iter().map(|(path, v)| {
            let audit_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
            let description = v.get("description").and_then(|d| d.as_str()).map(String::from);
            let options = v.get("options")
                .and_then(|o| serde_json::from_value::<std::collections::HashMap<String, String>>(o.clone()).ok())
                .unwrap_or_default();
            let local = v.get("local").and_then(|l| l.as_bool()).unwrap_or(false);
            VaultAuditDevice { path, audit_type, description, options, local }
        }).collect();
        Ok(devices)
    }

    pub async fn enable_audit_device(&self, path: &str, audit_type: &str, options: &Value) -> VaultResult<()> {
        let body = json!({ "type": audit_type, "options": options });
        self.put_raw(&format!("sys/audit/{}", path), &body).await?;
        Ok(())
    }

    pub async fn disable_audit_device(&self, path: &str) -> VaultResult<()> {
        self.delete_req(&format!("sys/audit/{}", path)).await
    }

    pub async fn calculate_hash(&self, path: &str, input: &str) -> VaultResult<String> {
        let body = self.post_raw(&format!("sys/audit-hash/{}", path), &json!({ "input": input })).await?;
        let hash = body.get("data")
            .and_then(|d| d.get("hash"))
            .and_then(|h| h.as_str())
            .ok_or_else(|| VaultError::parse_error("missing hash"))?;
        Ok(hash.to_string())
    }

    // ── Tokens ───────────────────────────────────────────────────

    pub async fn create_token(&self, request: &VaultTokenCreateRequest) -> VaultResult<VaultTokenInfo> {
        let body = serde_json::to_value(request)?;
        let resp = self.post_raw("auth/token/create", &body).await?;
        let auth = resp.get("auth").ok_or_else(|| VaultError::parse_error("missing auth in token create response"))?;
        serde_json::from_value(auth.clone()).map_err(|e| VaultError::parse_error(e.to_string()))
    }

    pub async fn lookup_token(&self, token: &str) -> VaultResult<VaultTokenInfo> {
        self.post("auth/token/lookup", &json!({ "token": token })).await
    }

    pub async fn lookup_self(&self) -> VaultResult<VaultTokenInfo> {
        self.get("auth/token/lookup-self").await
    }

    pub async fn renew_token(&self, token: &str, increment: Option<&str>) -> VaultResult<Value> {
        let mut body = json!({ "token": token });
        if let Some(inc) = increment {
            body["increment"] = Value::String(inc.to_string());
        }
        self.post_raw("auth/token/renew", &body).await
    }

    pub async fn revoke_token(&self, token: &str) -> VaultResult<()> {
        self.post_raw("auth/token/revoke", &json!({ "token": token })).await?;
        Ok(())
    }

    pub async fn revoke_self(&self) -> VaultResult<()> {
        self.post_no_body("auth/token/revoke-self").await?;
        Ok(())
    }

    pub async fn revoke_token_and_orphans(&self, token: &str) -> VaultResult<()> {
        self.post_raw("auth/token/revoke-orphan", &json!({ "token": token })).await?;
        Ok(())
    }

    pub async fn list_accessors(&self) -> VaultResult<Vec<String>> {
        self.list("auth/token/accessors").await
    }

    pub async fn lookup_accessor(&self, accessor: &str) -> VaultResult<VaultTokenInfo> {
        self.post("auth/token/lookup-accessor", &json!({ "accessor": accessor })).await
    }

    // ── Leases ───────────────────────────────────────────────────

    pub async fn read_lease(&self, lease_id: &str) -> VaultResult<Value> {
        self.put_raw("sys/leases/lookup", &json!({ "lease_id": lease_id })).await
    }

    pub async fn list_leases(&self, prefix: &str) -> VaultResult<Vec<String>> {
        self.list(&format!("sys/leases/lookup/{}", prefix)).await
    }

    pub async fn renew_lease(&self, lease_id: &str, increment: Option<&str>) -> VaultResult<Value> {
        let mut body = json!({ "lease_id": lease_id });
        if let Some(inc) = increment {
            body["increment"] = Value::String(inc.to_string());
        }
        self.put_raw("sys/leases/renew", &body).await
    }

    pub async fn revoke_lease(&self, lease_id: &str) -> VaultResult<()> {
        self.put_raw("sys/leases/revoke", &json!({ "lease_id": lease_id })).await?;
        Ok(())
    }

    pub async fn revoke_force(&self, prefix: &str) -> VaultResult<()> {
        self.put_raw(&format!("sys/leases/revoke-force/{}", prefix), &json!({})).await?;
        Ok(())
    }

    // ── Sys ──────────────────────────────────────────────────────

    pub async fn seal(&self) -> VaultResult<()> {
        self.put_raw("sys/seal", &json!({})).await?;
        Ok(())
    }

    pub async fn unseal(&self, key: &str, reset: bool, migrate: bool) -> VaultResult<VaultSealStatus> {
        let body = json!({ "key": key, "reset": reset, "migrate": migrate });
        let resp = self.put_raw("sys/unseal", &body).await?;
        serde_json::from_value(resp).map_err(|e| VaultError::parse_error(e.to_string()))
    }

    pub async fn leader(&self) -> VaultResult<VaultLeader> {
        let resp = self.get_raw("sys/leader").await?;
        serde_json::from_value(resp).map_err(|e| VaultError::parse_error(e.to_string()))
    }

    pub async fn ha_status(&self) -> VaultResult<Value> {
        self.get_raw("sys/ha-status").await
    }

    pub async fn list_secret_engines(&self) -> VaultResult<Vec<VaultSecretEngine>> {
        let body = self.get_raw("sys/mounts").await?;
        let data = body.get("data").or_else(|| body.as_object().map(|_| &body))
            .ok_or_else(|| VaultError::parse_error("invalid mounts response"))?;
        let map: std::collections::HashMap<String, Value> = serde_json::from_value(data.clone())?;
        let engines = map.into_iter().map(|(path, v)| {
            let engine_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
            let description = v.get("description").and_then(|d| d.as_str()).map(String::from);
            let accessor = v.get("accessor").and_then(|a| a.as_str()).map(String::from);
            let local = v.get("local").and_then(|l| l.as_bool()).unwrap_or(false);
            let seal_wrap = v.get("seal_wrap").and_then(|s| s.as_bool()).unwrap_or(false);
            let config = v.get("config").and_then(|c| serde_json::from_value(c.clone()).ok());
            VaultSecretEngine { path, engine_type, description, accessor, local, seal_wrap, config }
        }).collect();
        Ok(engines)
    }

    pub async fn mount_secret_engine(&self, path: &str, engine_type: &str, config: Option<&Value>) -> VaultResult<()> {
        let mut body = json!({ "type": engine_type });
        if let Some(c) = config {
            body["config"] = c.clone();
        }
        self.post_raw(&format!("sys/mounts/{}", path), &body).await?;
        Ok(())
    }

    pub async fn unmount_secret_engine(&self, path: &str) -> VaultResult<()> {
        self.delete_req(&format!("sys/mounts/{}", path)).await
    }

    pub async fn tune_mount(&self, path: &str, config: &Value) -> VaultResult<()> {
        self.post_raw(&format!("sys/mounts/{}/tune", path), config).await?;
        Ok(())
    }

    pub async fn init_status(&self) -> VaultResult<Value> {
        self.get_raw("sys/init").await
    }

    pub async fn generate_root_status(&self) -> VaultResult<Value> {
        self.get_raw("sys/generate-root/attempt").await
    }

    pub async fn list_namespaces(&self) -> VaultResult<Vec<String>> {
        self.list("sys/namespaces").await
    }
}
