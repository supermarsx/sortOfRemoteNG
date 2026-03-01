use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

/// HTTP client for RustDesk Server Pro REST API.
///
/// All endpoints follow the pattern documented in the official
/// Python CLI tools (devices.py, users.py, ab.py, audits.py, etc.).
pub struct RustDeskApiClient {
    base_url: String,
    token: String,
    client: Client,
}

impl std::fmt::Debug for RustDeskApiClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RustDeskApiClient")
            .field("base_url", &self.base_url)
            .finish()
    }
}

impl RustDeskApiClient {
    pub fn new(base_url: String, token: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        let base_url = base_url.trim_end_matches('/').to_string();

        Self {
            base_url,
            token,
            client,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    // ── Low-level request helpers ───────────────────────────────────

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        let resp = self
            .client
            .get(&self.url(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| format!("GET {} failed: {}", path, e))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GET {} returned {}: {}", path, status, body));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let resp = self
            .client
            .post(&self.url(path))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("POST {} failed: {}", path, e))?;

        let status = resp.status();
        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("POST {} returned {}: {}", path, status, body_text));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))
    }

    pub async fn put(&self, path: &str, body: &Value) -> Result<Value, String> {
        let resp = self
            .client
            .put(&self.url(path))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("PUT {} failed: {}", path, e))?;

        let status = resp.status();
        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("PUT {} returned {}: {}", path, status, body_text));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))
    }

    pub async fn delete(&self, path: &str) -> Result<Value, String> {
        let resp = self
            .client
            .delete(&self.url(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| format!("DELETE {} failed: {}", path, e))?;

        let status = resp.status();
        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("DELETE {} returned {}: {}", path, status, body_text));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))
    }

    // ── Health / Connectivity ───────────────────────────────────────

    /// Test whether the API is reachable and the token is valid.
    pub async fn health_check(&self) -> Result<bool, String> {
        match self.get("/users?pageSize=1&current=1").await {
            Ok(_) => Ok(true),
            Err(e) => Err(e),
        }
    }

    /// Measure round-trip latency to the API server.
    pub async fn measure_latency(&self) -> Result<u64, String> {
        let start = std::time::Instant::now();
        self.get("/users?pageSize=1&current=1").await?;
        Ok(start.elapsed().as_millis() as u64)
    }

    // ── Devices ─────────────────────────────────────────────────────

    pub async fn list_devices(
        &self,
        id: Option<&str>,
        device_name: Option<&str>,
        user_name: Option<&str>,
        group_name: Option<&str>,
        device_group_name: Option<&str>,
        offline_days: Option<u32>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = id {
            params.push(format!("id={}", v));
        }
        if let Some(v) = device_name {
            params.push(format!("device_name={}", v));
        }
        if let Some(v) = user_name {
            params.push(format!("user_name={}", v));
        }
        if let Some(v) = group_name {
            params.push(format!("group_name={}", v));
        }
        if let Some(v) = device_group_name {
            params.push(format!("device_group_name={}", v));
        }
        if let Some(v) = offline_days {
            params.push(format!("offline_days={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        let path = format!("/peers?{}", params.join("&"));
        self.get(&path).await
    }

    pub async fn get_device(&self, device_id: &str) -> Result<Value, String> {
        self.get(&format!("/peers/{}", device_id)).await
    }

    pub async fn enable_device(&self, device_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/peers/{}/enable", device_guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn disable_device(&self, device_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/peers/{}/disable", device_guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn delete_device(&self, device_guid: &str) -> Result<Value, String> {
        self.delete(&format!("/peers/{}", device_guid)).await
    }

    pub async fn assign_device(
        &self,
        device_guid: &str,
        user_name: Option<&str>,
        device_group_name: Option<&str>,
        note: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(v) = user_name {
            body.insert("user_name".into(), Value::String(v.to_string()));
        }
        if let Some(v) = device_group_name {
            body.insert(
                "device_group_name".into(),
                Value::String(v.to_string()),
            );
        }
        if let Some(v) = note {
            body.insert("note".into(), Value::String(v.to_string()));
        }
        self.put(
            &format!("/peers/{}", device_guid),
            &Value::Object(body),
        )
        .await
    }

    // ── Users ───────────────────────────────────────────────────────

    pub async fn list_users(
        &self,
        name: Option<&str>,
        group_name: Option<&str>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = name {
            params.push(format!("name={}", v));
        }
        if let Some(v) = group_name {
            params.push(format!("group_name={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        self.get(&format!("/users?{}", params.join("&"))).await
    }

    pub async fn create_user(
        &self,
        name: &str,
        password: &str,
        group_name: &str,
        email: Option<&str>,
        note: Option<&str>,
        is_admin: Option<bool>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({
            "name": name,
            "password": password,
            "group_name": group_name,
        });
        if let Some(v) = email {
            body["email"] = Value::String(v.to_string());
        }
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        if let Some(v) = is_admin {
            body["is_admin"] = Value::Bool(v);
        }
        self.post("/users", &body).await
    }

    pub async fn enable_user(&self, user_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/users/{}/enable", user_guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn disable_user(&self, user_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/users/{}/disable", user_guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn delete_user(&self, user_guid: &str) -> Result<Value, String> {
        self.delete(&format!("/users/{}", user_guid)).await
    }

    pub async fn reset_user_2fa(&self, user_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/users/{}/reset-2fa", user_guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn force_logout_user(&self, user_guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/users/{}/force-logout", user_guid),
            &serde_json::json!({}),
        )
        .await
    }

    // ── User Groups ─────────────────────────────────────────────────

    pub async fn list_user_groups(&self, name: Option<&str>) -> Result<Value, String> {
        let path = match name {
            Some(n) => format!("/user-groups?name={}", n),
            None => "/user-groups".to_string(),
        };
        self.get(&path).await
    }

    pub async fn create_user_group(
        &self,
        name: &str,
        note: Option<&str>,
        accessed_from: Option<&Value>,
        access_to: Option<&Value>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        if let Some(v) = accessed_from {
            body["accessed_from"] = v.clone();
        }
        if let Some(v) = access_to {
            body["access_to"] = v.clone();
        }
        self.post("/user-groups", &body).await
    }

    pub async fn update_user_group(
        &self,
        guid: &str,
        new_name: Option<&str>,
        note: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(v) = new_name {
            body.insert("name".into(), Value::String(v.to_string()));
        }
        if let Some(v) = note {
            body.insert("note".into(), Value::String(v.to_string()));
        }
        self.put(&format!("/user-groups/{}", guid), &Value::Object(body))
            .await
    }

    pub async fn delete_user_group(&self, guid: &str) -> Result<Value, String> {
        self.delete(&format!("/user-groups/{}", guid)).await
    }

    pub async fn add_users_to_group(
        &self,
        group_guid: &str,
        user_guids: &[String],
    ) -> Result<Value, String> {
        let body = serde_json::json!({ "user_guids": user_guids });
        self.post(&format!("/user-groups/{}/users", group_guid), &body)
            .await
    }

    // ── Device Groups ───────────────────────────────────────────────

    pub async fn list_device_groups(&self, name: Option<&str>) -> Result<Value, String> {
        let path = match name {
            Some(n) => format!("/device-groups?name={}", n),
            None => "/device-groups".to_string(),
        };
        self.get(&path).await
    }

    pub async fn create_device_group(
        &self,
        name: &str,
        note: Option<&str>,
        accessed_from: Option<&Value>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        if let Some(v) = accessed_from {
            body["accessed_from"] = v.clone();
        }
        self.post("/device-groups", &body).await
    }

    pub async fn update_device_group(
        &self,
        guid: &str,
        new_name: Option<&str>,
        note: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(v) = new_name {
            body.insert("name".into(), Value::String(v.to_string()));
        }
        if let Some(v) = note {
            body.insert("note".into(), Value::String(v.to_string()));
        }
        self.put(&format!("/device-groups/{}", guid), &Value::Object(body))
            .await
    }

    pub async fn delete_device_group(&self, guid: &str) -> Result<Value, String> {
        self.delete(&format!("/device-groups/{}", guid)).await
    }

    pub async fn add_devices_to_group(
        &self,
        group_guid: &str,
        device_guids: &[String],
    ) -> Result<Value, String> {
        let body = serde_json::json!({ "peer_guids": device_guids });
        self.post(&format!("/device-groups/{}/peers", group_guid), &body)
            .await
    }

    pub async fn remove_devices_from_group(
        &self,
        group_guid: &str,
        device_guids: &[String],
    ) -> Result<Value, String> {
        let body = serde_json::json!({ "peer_guids": device_guids });
        self.post(
            &format!("/device-groups/{}/peers/delete", group_guid),
            &body,
        )
        .await
    }

    // ── Address Books ───────────────────────────────────────────────

    pub async fn list_address_books(
        &self,
        name: Option<&str>,
    ) -> Result<Value, String> {
        let path = match name {
            Some(n) => format!("/ab?name={}", n),
            None => "/ab".to_string(),
        };
        self.get(&path).await
    }

    pub async fn get_personal_address_book(&self) -> Result<Value, String> {
        self.get("/ab/personal").await
    }

    pub async fn create_address_book(
        &self,
        name: &str,
        note: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        self.post("/ab", &body).await
    }

    pub async fn update_address_book(
        &self,
        guid: &str,
        new_name: Option<&str>,
        note: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(v) = new_name {
            body.insert("name".into(), Value::String(v.to_string()));
        }
        if let Some(v) = note {
            body.insert("note".into(), Value::String(v.to_string()));
        }
        self.put(&format!("/ab/{}", guid), &Value::Object(body))
            .await
    }

    pub async fn delete_address_book(&self, guid: &str) -> Result<Value, String> {
        self.delete(&format!("/ab/{}", guid)).await
    }

    // ── Address Book Peers ──────────────────────────────────────────

    pub async fn list_ab_peers(
        &self,
        ab_guid: &str,
        peer_id: Option<&str>,
    ) -> Result<Value, String> {
        let path = match peer_id {
            Some(p) => format!("/ab/{}/peers?peer_id={}", ab_guid, p),
            None => format!("/ab/{}/peers", ab_guid),
        };
        self.get(&path).await
    }

    pub async fn add_ab_peer(
        &self,
        ab_guid: &str,
        peer_id: &str,
        alias: Option<&str>,
        note: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "id": peer_id });
        if let Some(v) = alias {
            body["alias"] = Value::String(v.to_string());
        }
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        if let Some(v) = tags {
            body["tags"] = serde_json::json!(v);
        }
        self.post(&format!("/ab/{}/peers", ab_guid), &body).await
    }

    pub async fn update_ab_peer(
        &self,
        ab_guid: &str,
        peer_id: &str,
        alias: Option<&str>,
        note: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "id": peer_id });
        if let Some(v) = alias {
            body["alias"] = Value::String(v.to_string());
        }
        if let Some(v) = note {
            body["note"] = Value::String(v.to_string());
        }
        if let Some(v) = tags {
            body["tags"] = serde_json::json!(v);
        }
        self.put(&format!("/ab/{}/peers/{}", ab_guid, peer_id), &body)
            .await
    }

    pub async fn delete_ab_peer(&self, ab_guid: &str, peer_id: &str) -> Result<Value, String> {
        self.delete(&format!("/ab/{}/peers/{}", ab_guid, peer_id))
            .await
    }

    // ── Address Book Tags ───────────────────────────────────────────

    pub async fn list_ab_tags(&self, ab_guid: &str) -> Result<Value, String> {
        self.get(&format!("/ab/{}/tags", ab_guid)).await
    }

    pub async fn add_ab_tag(
        &self,
        ab_guid: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(c) = color {
            body["color"] = Value::String(c.to_string());
        }
        self.post(&format!("/ab/{}/tags", ab_guid), &body).await
    }

    pub async fn delete_ab_tag(&self, ab_guid: &str, tag_name: &str) -> Result<Value, String> {
        self.delete(&format!("/ab/{}/tags/{}", ab_guid, tag_name))
            .await
    }

    // ── Address Book Rules ──────────────────────────────────────────

    pub async fn list_ab_rules(&self, ab_guid: &str) -> Result<Value, String> {
        self.get(&format!("/ab/{}/rules", ab_guid)).await
    }

    pub async fn add_ab_rule(
        &self,
        ab_guid: &str,
        rule_type: &str,
        user: Option<&str>,
        group: Option<&str>,
        permission: &str,
    ) -> Result<Value, String> {
        let mut body = serde_json::json!({
            "rule_type": rule_type,
            "permission": permission,
        });
        if let Some(u) = user {
            body["user"] = Value::String(u.to_string());
        }
        if let Some(g) = group {
            body["group"] = Value::String(g.to_string());
        }
        self.post(&format!("/ab/{}/rules", ab_guid), &body).await
    }

    pub async fn delete_ab_rule(&self, rule_guid: &str) -> Result<Value, String> {
        self.delete(&format!("/ab/rules/{}", rule_guid)).await
    }

    // ── Strategies ──────────────────────────────────────────────────

    pub async fn list_strategies(&self) -> Result<Value, String> {
        self.get("/strategies").await
    }

    pub async fn get_strategy(&self, name: &str) -> Result<Value, String> {
        self.get(&format!("/strategies?name={}", name)).await
    }

    pub async fn enable_strategy(&self, guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/strategies/{}/enable", guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn disable_strategy(&self, guid: &str) -> Result<Value, String> {
        self.post(
            &format!("/strategies/{}/disable", guid),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn assign_strategy(
        &self,
        strategy_guid: &str,
        peer_guids: Option<&[String]>,
        user_guids: Option<&[String]>,
        device_group_guids: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(p) = peer_guids {
            body.insert("peer_guids".into(), serde_json::json!(p));
        }
        if let Some(u) = user_guids {
            body.insert("user_guids".into(), serde_json::json!(u));
        }
        if let Some(d) = device_group_guids {
            body.insert("device_group_guids".into(), serde_json::json!(d));
        }
        self.post(
            &format!("/strategies/{}/assign", strategy_guid),
            &Value::Object(body),
        )
        .await
    }

    pub async fn unassign_strategy(
        &self,
        peer_guids: Option<&[String]>,
        user_guids: Option<&[String]>,
        device_group_guids: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(p) = peer_guids {
            body.insert("peer_guids".into(), serde_json::json!(p));
        }
        if let Some(u) = user_guids {
            body.insert("user_guids".into(), serde_json::json!(u));
        }
        if let Some(d) = device_group_guids {
            body.insert("device_group_guids".into(), serde_json::json!(d));
        }
        self.post("/strategies/unassign", &Value::Object(body))
            .await
    }

    // ── Audit Logs ──────────────────────────────────────────────────

    pub async fn list_connection_audits(
        &self,
        remote: Option<&str>,
        conn_type: Option<u32>,
        days_ago: Option<u32>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = remote {
            params.push(format!("remote={}", v));
        }
        if let Some(v) = conn_type {
            params.push(format!("conn_type={}", v));
        }
        if let Some(v) = days_ago {
            params.push(format!("days_ago={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        self.get(&format!("/audits/conn?{}", params.join("&")))
            .await
    }

    pub async fn list_file_audits(
        &self,
        remote: Option<&str>,
        days_ago: Option<u32>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = remote {
            params.push(format!("remote={}", v));
        }
        if let Some(v) = days_ago {
            params.push(format!("days_ago={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        self.get(&format!("/audits/file?{}", params.join("&")))
            .await
    }

    pub async fn list_alarm_audits(
        &self,
        device: Option<&str>,
        days_ago: Option<u32>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = device {
            params.push(format!("device={}", v));
        }
        if let Some(v) = days_ago {
            params.push(format!("days_ago={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        self.get(&format!("/audits/alarm?{}", params.join("&")))
            .await
    }

    pub async fn list_console_audits(
        &self,
        operator: Option<&str>,
        days_ago: Option<u32>,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<Value, String> {
        let mut params = Vec::new();
        if let Some(v) = operator {
            params.push(format!("operator={}", v));
        }
        if let Some(v) = days_ago {
            params.push(format!("days_ago={}", v));
        }
        params.push(format!("current={}", page.unwrap_or(1)));
        params.push(format!("pageSize={}", page_size.unwrap_or(100)));

        self.get(&format!("/audits/console?{}", params.join("&")))
            .await
    }

    // ── Login / Auth ────────────────────────────────────────────────

    /// Authenticate with username/password and get a token.
    pub async fn login(&self, username: &str, password: &str) -> Result<Value, String> {
        let body = serde_json::json!({
            "username": username,
            "password": password,
        });
        // Login uses a different path (no /api prefix sometimes)
        let resp = self
            .client
            .post(&format!("{}/api/login", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Login failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("Login returned {}: {}", status, body_text));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse login response: {}", e))
    }
}
