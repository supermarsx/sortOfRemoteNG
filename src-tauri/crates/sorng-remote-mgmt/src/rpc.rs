use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type RpcServiceState = Arc<Mutex<RpcService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcConnectionConfig {
    pub host: String,
    pub port: u16,
    pub protocol: RpcProtocol,
    pub auth_method: Option<RpcAuthMethod>,
    pub timeout: Option<u64>,
    pub use_ssl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RpcProtocol {
    JsonRpc,
    XmlRpc,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RpcAuthMethod {
    None,
    Basic {
        username: String,
        password: String,
    },
    Bearer {
        token: String,
    },
    Custom {
        method: String,
        credentials: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub protocol: RpcProtocol,
    pub connected_at: DateTime<Utc>,
    pub authenticated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    pub params: serde_json::Value,
    pub id: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub result: Option<serde_json::Value>,
    pub error: Option<RpcError>,
    pub id: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

pub struct RpcService {
    sessions: HashMap<String, RpcSession>,
    configs: HashMap<String, RpcConnectionConfig>,
    client: reqwest::Client,
}

impl RpcService {
    pub fn new() -> RpcServiceState {
        Arc::new(Mutex::new(RpcService {
            sessions: HashMap::new(),
            configs: HashMap::new(),
            client: reqwest::Client::new(),
        }))
    }

    fn build_url(&self, config: &RpcConnectionConfig) -> String {
        let scheme = if config.use_ssl { "https" } else { "http" };
        format!("{}://{}:{}/", scheme, config.host, config.port)
    }

    fn apply_auth(
        &self,
        builder: reqwest::RequestBuilder,
        config: &RpcConnectionConfig,
    ) -> reqwest::RequestBuilder {
        match &config.auth_method {
            Some(RpcAuthMethod::Basic { username, password }) => {
                builder.basic_auth(username, Some(password))
            }
            Some(RpcAuthMethod::Bearer { token }) => builder.bearer_auth(token),
            Some(RpcAuthMethod::Custom {
                method,
                credentials,
            }) => builder
                .header("X-Auth-Method", method.as_str())
                .header("X-Auth-Credentials", credentials.to_string()),
            Some(RpcAuthMethod::None) | None => builder,
        }
    }

    pub async fn connect_rpc(&mut self, config: RpcConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        let session = RpcSession {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            protocol: config.protocol.clone(),
            connected_at: Utc::now(),
            authenticated: config.auth_method.is_some(),
        };

        self.configs.insert(session_id.clone(), config);
        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_rpc(&mut self, session_id: &str) -> Result<(), String> {
        self.configs.remove(session_id);
        if self.sessions.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(format!("RPC session {} not found", session_id))
        }
    }

    pub async fn call_rpc_method(
        &self,
        session_id: &str,
        request: RpcRequest,
    ) -> Result<RpcResponse, String> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("RPC config for session {} not found", session_id))?;

        let url = self.build_url(config);
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": request.method,
            "params": request.params,
            "id": request.id,
        });

        let mut builder = self.client.post(&url).json(&body);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("RPC request failed: {}", e))?;

        let status = resp.status();
        let resp_body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read RPC response: {}", e))?;

        if !status.is_success() {
            return Err(format!("RPC HTTP error {}: {}", status, resp_body));
        }

        let json_resp: serde_json::Value = serde_json::from_str(&resp_body)
            .map_err(|e| format!("Failed to parse RPC response JSON: {}", e))?;

        Ok(RpcResponse {
            result: json_resp.get("result").cloned(),
            error: json_resp
                .get("error")
                .and_then(|e| serde_json::from_value(e.clone()).ok()),
            id: json_resp.get("id").and_then(|v| if v.is_null() { None } else { Some(v.clone()) }),
        })
    }

    pub async fn get_rpc_session(&self, session_id: &str) -> Option<RpcSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_rpc_sessions(&self) -> Vec<RpcSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn discover_rpc_methods(&self, session_id: &str) -> Result<Vec<String>, String> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        let request = RpcRequest {
            method: "system.listMethods".to_string(),
            params: serde_json::Value::Null,
            id: Some(serde_json::json!(1)),
        };

        let response = self.call_rpc_method(session_id, request).await?;

        if let Some(error) = response.error {
            return Err(format!("RPC error {}: {}", error.code, error.message));
        }

        let result = response
            .result
            .ok_or_else(|| "No result in system.listMethods response".to_string())?;

        serde_json::from_value(result).map_err(|e| format!("Failed to parse methods list: {}", e))
    }

    pub async fn batch_rpc_calls(
        &self,
        session_id: &str,
        requests: Vec<RpcRequest>,
    ) -> Result<Vec<RpcResponse>, String> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        if requests.is_empty() {
            return Ok(Vec::new());
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("RPC config for session {} not found", session_id))?;

        let url = self.build_url(config);
        let batch: Vec<serde_json::Value> = requests
            .iter()
            .map(|r| {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": r.method,
                    "params": r.params,
                    "id": r.id,
                })
            })
            .collect();

        let mut builder = self.client.post(&url).json(&batch);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("RPC batch request failed: {}", e))?;

        let status = resp.status();
        let resp_body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read RPC batch response: {}", e))?;

        if !status.is_success() {
            return Err(format!("RPC batch HTTP error {}: {}", status, resp_body));
        }

        let json_responses: Vec<serde_json::Value> = serde_json::from_str(&resp_body)
            .map_err(|e| format!("Failed to parse RPC batch response: {}", e))?;

        Ok(json_responses
            .iter()
            .map(|j| RpcResponse {
                result: j.get("result").cloned(),
                error: j
                    .get("error")
                    .and_then(|e| serde_json::from_value(e.clone()).ok()),
                id: j.get("id").cloned(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spawn a minimal HTTP server for JSON-RPC testing. Returns (port, shutdown_tx).
    async fn spawn_mock_jsonrpc_server() -> (u16, tokio::sync::oneshot::Sender<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        if let Ok((mut stream, _)) = accepted {
                            tokio::spawn(async move {
                                let mut buf = vec![0u8; 8192];
                                let n = stream.read(&mut buf).await.unwrap_or(0);
                                let req_str = String::from_utf8_lossy(&buf[..n]);
                                // Extract body after blank line
                                let body = req_str.split("\r\n\r\n").nth(1).unwrap_or("{}");
                                let response_body = if body.starts_with('[') {
                                    // Batch request
                                    let reqs: Vec<serde_json::Value> = serde_json::from_str(body).unwrap_or_default();
                                    let resps: Vec<serde_json::Value> = reqs.iter().map(|r| {
                                        serde_json::json!({
                                            "jsonrpc": "2.0",
                                            "result": mock_method_result(r["method"].as_str().unwrap_or("")),
                                            "id": r.get("id").cloned()
                                        })
                                    }).collect();
                                    serde_json::to_string(&resps).unwrap()
                                } else {
                                    let r: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
                                    let method = r["method"].as_str().unwrap_or("");
                                    let resp = serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "result": mock_method_result(method),
                                        "id": r.get("id").cloned()
                                    });
                                    serde_json::to_string(&resp).unwrap()
                                };
                                let http = format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                    response_body.len(), response_body
                                );
                                let _ = stream.write_all(http.as_bytes()).await;
                            });
                        }
                    }
                    _ = &mut rx => break,
                }
            }
        });
        (port, tx)
    }

    fn mock_method_result(method: &str) -> serde_json::Value {
        match method {
            "system.listMethods" => serde_json::json!(["system.listMethods", "system.describe", "custom.method"]),
            "system.describe" => serde_json::json!({"service": "mock-rpc", "version": "1.0"}),
            _ => serde_json::json!({"method": method, "status": "ok"}),
        }
    }

    fn test_config_with_port(port: u16) -> RpcConnectionConfig {
        RpcConnectionConfig {
            host: "127.0.0.1".to_string(),
            port,
            protocol: RpcProtocol::JsonRpc,
            auth_method: None,
            timeout: Some(5000),
            use_ssl: false,
        }
    }

    fn test_config() -> RpcConnectionConfig {
        RpcConnectionConfig {
            host: "localhost".to_string(),
            port: 8080,
            protocol: RpcProtocol::JsonRpc,
            auth_method: None,
            timeout: Some(5000),
            use_ssl: false,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn rpc_protocol_serde_roundtrip() {
        let variants = vec![
            RpcProtocol::JsonRpc,
            RpcProtocol::XmlRpc,
            RpcProtocol::Custom("grpc".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: RpcProtocol = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn rpc_auth_method_serde_roundtrip() {
        let variants: Vec<RpcAuthMethod> = vec![
            RpcAuthMethod::None,
            RpcAuthMethod::Basic {
                username: "user".to_string(),
                password: "pass".to_string(),
            },
            RpcAuthMethod::Bearer {
                token: "tok123".to_string(),
            },
            RpcAuthMethod::Custom {
                method: "hmac".to_string(),
                credentials: serde_json::json!({"key": "value"}),
            },
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: RpcAuthMethod = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn rpc_session_serde_roundtrip() {
        let session = RpcSession {
            id: "s1".to_string(),
            host: "localhost".to_string(),
            port: 8080,
            protocol: RpcProtocol::JsonRpc,
            connected_at: Utc::now(),
            authenticated: true,
        };
        let json = serde_json::to_string(&session).unwrap();
        let back: RpcSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s1");
        assert!(back.authenticated);
    }

    #[test]
    fn rpc_request_serde() {
        let req = RpcRequest {
            method: "test.method".to_string(),
            params: serde_json::json!({"key": "value"}),
            id: Some(serde_json::json!(1)),
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: RpcRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.method, "test.method");
    }

    #[test]
    fn rpc_response_serde() {
        let resp = RpcResponse {
            result: Some(serde_json::json!({"status": "ok"})),
            error: None,
            id: Some(serde_json::json!(1)),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: RpcResponse = serde_json::from_str(&json).unwrap();
        assert!(back.error.is_none());
        assert_eq!(back.result.unwrap()["status"], "ok");
    }

    #[test]
    fn rpc_error_serde() {
        let err = RpcError {
            code: -32601,
            message: "Method not found".to_string(),
            data: Some(serde_json::json!({"details": "unknown method"})),
        };
        let json = serde_json::to_string(&err).unwrap();
        let back: RpcError = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, -32601);
        assert_eq!(back.message, "Method not found");
    }

    #[test]
    fn rpc_connection_config_serde() {
        let cfg = test_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: RpcConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.host, "localhost");
        assert_eq!(back.port, 8080);
        assert!(!back.use_ssl);
    }

    // ── Session CRUD ────────────────────────────────────────────────────

    #[tokio::test]
    async fn connect_rpc_returns_session_id() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn connect_rpc_unauthenticated_when_no_auth() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let session = svc.get_rpc_session(&id).await.unwrap();
        assert!(!session.authenticated);
    }

    #[tokio::test]
    async fn connect_rpc_authenticated_with_auth() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let mut cfg = test_config();
        cfg.auth_method = Some(RpcAuthMethod::Basic {
            username: "admin".to_string(),
            password: "secret".to_string(),
        });
        let id = svc.connect_rpc(cfg).await.unwrap();
        let session = svc.get_rpc_session(&id).await.unwrap();
        assert!(session.authenticated);
    }

    #[tokio::test]
    async fn disconnect_rpc_removes_session() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        svc.disconnect_rpc(&id).await.unwrap();
        assert!(svc.get_rpc_session(&id).await.is_none());
    }

    #[tokio::test]
    async fn disconnect_nonexistent_fails() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let result = svc.disconnect_rpc("nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_sessions_empty() {
        let state = RpcService::new();
        let svc = state.lock().await;
        assert!(svc.list_rpc_sessions().await.is_empty());
    }

    #[tokio::test]
    async fn list_sessions_after_connect() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        svc.connect_rpc(test_config()).await.unwrap();
        svc.connect_rpc(test_config()).await.unwrap();
        assert_eq!(svc.list_rpc_sessions().await.len(), 2);
    }

    #[tokio::test]
    async fn get_session_not_found() {
        let state = RpcService::new();
        let svc = state.lock().await;
        assert!(svc.get_rpc_session("nonexistent").await.is_none());
    }

    // ── Method dispatch ─────────────────────────────────────────────────

    #[tokio::test]
    async fn call_system_list_methods() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let resp = svc
            .call_rpc_method(
                &id,
                RpcRequest {
                    method: "system.listMethods".to_string(),
                    params: serde_json::json!(null),
                    id: Some(serde_json::json!(1)),
                },
            )
            .await
            .unwrap();
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert!(result.as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn call_system_describe() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let resp = svc
            .call_rpc_method(
                &id,
                RpcRequest {
                    method: "system.describe".to_string(),
                    params: serde_json::json!(null),
                    id: Some(serde_json::json!(2)),
                },
            )
            .await
            .unwrap();
        let result = resp.result.unwrap();
        assert!(result["service"].is_string());
    }

    #[tokio::test]
    async fn call_unknown_method_returns_success() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let resp = svc
            .call_rpc_method(
                &id,
                RpcRequest {
                    method: "custom.method".to_string(),
                    params: serde_json::json!({}),
                    id: Some(serde_json::json!(3)),
                },
            )
            .await
            .unwrap();
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["method"], "custom.method");
    }

    #[tokio::test]
    async fn call_on_nonexistent_session_fails() {
        let state = RpcService::new();
        let svc = state.lock().await;
        let result = svc
            .call_rpc_method(
                "nonexistent",
                RpcRequest {
                    method: "test".to_string(),
                    params: serde_json::json!(null),
                    id: None,
                },
            )
            .await;
        assert!(result.is_err());
    }

    // ── Discover methods ────────────────────────────────────────────────

    #[tokio::test]
    async fn discover_methods_returns_list() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let methods = svc.discover_rpc_methods(&id).await.unwrap();
        assert!(!methods.is_empty());
        assert!(methods.contains(&"system.listMethods".to_string()));
    }

    #[tokio::test]
    async fn discover_methods_nonexistent_session() {
        let state = RpcService::new();
        let svc = state.lock().await;
        let result = svc.discover_rpc_methods("nonexistent").await;
        assert!(result.is_err());
    }

    // ── Batch calls ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn batch_calls_returns_same_count() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let requests = vec![
            RpcRequest {
                method: "m1".to_string(),
                params: serde_json::json!(null),
                id: Some(serde_json::json!(1)),
            },
            RpcRequest {
                method: "m2".to_string(),
                params: serde_json::json!(null),
                id: Some(serde_json::json!(2)),
            },
            RpcRequest {
                method: "m3".to_string(),
                params: serde_json::json!(null),
                id: Some(serde_json::json!(3)),
            },
        ];
        let responses = svc.batch_rpc_calls(&id, requests).await.unwrap();
        assert_eq!(responses.len(), 3);
    }

    #[tokio::test]
    async fn batch_calls_empty() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let responses = svc.batch_rpc_calls(&id, vec![]).await.unwrap();
        assert!(responses.is_empty());
    }

    #[tokio::test]
    async fn batch_calls_nonexistent_session() {
        let state = RpcService::new();
        let svc = state.lock().await;
        let result = svc.batch_rpc_calls("nonexistent", vec![]).await;
        assert!(result.is_err());
    }

    // ── Response ID preservation ────────────────────────────────────────

    #[tokio::test]
    async fn response_preserves_request_id() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let resp = svc
            .call_rpc_method(
                &id,
                RpcRequest {
                    method: "test".to_string(),
                    params: serde_json::json!(null),
                    id: Some(serde_json::json!("my-id-42")),
                },
            )
            .await
            .unwrap();
        assert_eq!(resp.id, Some(serde_json::json!("my-id-42")));
    }

    #[tokio::test]
    async fn response_preserves_null_id() {
        let (port, _tx) = spawn_mock_jsonrpc_server().await;
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config_with_port(port)).await.unwrap();
        let resp = svc
            .call_rpc_method(
                &id,
                RpcRequest {
                    method: "test".to_string(),
                    params: serde_json::json!(null),
                    id: None,
                },
            )
            .await
            .unwrap();
        assert!(resp.id.is_none());
    }
}
