use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
    Basic { username: String, password: String },
    Bearer { token: String },
    Custom { method: String, credentials: serde_json::Value },
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
}

impl RpcService {
    pub fn new() -> RpcServiceState {
        Arc::new(Mutex::new(RpcService {
            sessions: HashMap::new(),
        }))
    }

    pub async fn connect_rpc(&mut self, config: RpcConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // For now, simulate RPC connection
        // In a real implementation, this would establish actual RPC connections
        let session = RpcSession {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            protocol: config.protocol.clone(),
            connected_at: Utc::now(),
            authenticated: config.auth_method.is_some(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_rpc(&mut self, session_id: &str) -> Result<(), String> {
        if self.sessions.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(format!("RPC session {} not found", session_id))
        }
    }

    pub async fn call_rpc_method(&self, session_id: &str, request: RpcRequest) -> Result<RpcResponse, String> {
        let _session = self.sessions.get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        // For now, simulate RPC method call
        // In a real implementation, this would make actual RPC calls
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        // Mock response based on method
        let response = match request.method.as_str() {
            "system.listMethods" => RpcResponse {
                result: Some(serde_json::json!(["method1", "method2", "system.listMethods"])),
                error: None,
                id: request.id,
            },
            "system.describe" => RpcResponse {
                result: Some(serde_json::json!({
                    "service": "Mock RPC Service",
                    "version": "1.0",
                    "methods": ["method1", "method2"]
                })),
                error: None,
                id: request.id,
            },
            _ => RpcResponse {
                result: Some(serde_json::json!({"status": "success", "method": request.method})),
                error: None,
                id: request.id,
            },
        };

        Ok(response)
    }

    pub async fn get_rpc_session(&self, session_id: &str) -> Option<RpcSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_rpc_sessions(&self) -> Vec<RpcSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn discover_rpc_methods(&self, session_id: &str) -> Result<Vec<String>, String> {
        let _session = self.sessions.get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        // For now, return mock RPC methods
        // In a real implementation, this would discover available RPC methods
        let methods = vec![
            "system.listMethods".to_string(),
            "system.describe".to_string(),
            "service.status".to_string(),
            "service.restart".to_string(),
            "data.get".to_string(),
            "data.set".to_string(),
        ];

        Ok(methods)
    }

    pub async fn batch_rpc_calls(&self, session_id: &str, requests: Vec<RpcRequest>) -> Result<Vec<RpcResponse>, String> {
        let _session = self.sessions.get(session_id)
            .ok_or_else(|| format!("RPC session {} not found", session_id))?;

        // For now, simulate batch RPC calls
        // In a real implementation, this would make actual batch RPC calls
        let mut responses = Vec::new();

        for request in requests {
            let response = self.call_rpc_method(session_id, request).await?;
            responses.push(response);
        }

        Ok(responses)
    }
}

#[tauri::command]
pub async fn connect_rpc(
    state: tauri::State<'_, RpcServiceState>,
    config: RpcConnectionConfig,
) -> Result<String, String> {
    let mut rpc = state.lock().await;
    rpc.connect_rpc(config).await
}

#[tauri::command]
pub async fn disconnect_rpc(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut rpc = state.lock().await;
    rpc.disconnect_rpc(&session_id).await
}

#[tauri::command]
pub async fn call_rpc_method(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
    request: RpcRequest,
) -> Result<RpcResponse, String> {
    let rpc = state.lock().await;
    rpc.call_rpc_method(&session_id, request).await
}

#[tauri::command]
pub async fn get_rpc_session(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<RpcSession, String> {
    let rpc = state.lock().await;
    rpc.get_rpc_session(&session_id).await
        .ok_or_else(|| format!("RPC session {} not found", session_id))
}

#[tauri::command]
pub async fn list_rpc_sessions(
    state: tauri::State<'_, RpcServiceState>,
) -> Result<Vec<RpcSession>, String> {
    let rpc = state.lock().await;
    Ok(rpc.list_rpc_sessions().await)
}

#[tauri::command]
pub async fn discover_rpc_methods(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let rpc = state.lock().await;
    rpc.discover_rpc_methods(&session_id).await
}

#[tauri::command]
pub async fn batch_rpc_calls(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
    requests: Vec<RpcRequest>,
) -> Result<Vec<RpcResponse>, String> {
    let rpc = state.lock().await;
    rpc.batch_rpc_calls(&session_id, requests).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
            RpcAuthMethod::Basic { username: "user".to_string(), password: "pass".to_string() },
            RpcAuthMethod::Bearer { token: "tok123".to_string() },
            RpcAuthMethod::Custom { 
                method: "hmac".to_string(), 
                credentials: serde_json::json!({"key": "value"}) 
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
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let resp = svc.call_rpc_method(&id, RpcRequest {
            method: "system.listMethods".to_string(),
            params: serde_json::json!(null),
            id: Some(serde_json::json!(1)),
        }).await.unwrap();
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert!(result.as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn call_system_describe() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let resp = svc.call_rpc_method(&id, RpcRequest {
            method: "system.describe".to_string(),
            params: serde_json::json!(null),
            id: Some(serde_json::json!(2)),
        }).await.unwrap();
        let result = resp.result.unwrap();
        assert!(result["service"].is_string());
    }

    #[tokio::test]
    async fn call_unknown_method_returns_success() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let resp = svc.call_rpc_method(&id, RpcRequest {
            method: "custom.method".to_string(),
            params: serde_json::json!({}),
            id: Some(serde_json::json!(3)),
        }).await.unwrap();
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["method"], "custom.method");
    }

    #[tokio::test]
    async fn call_on_nonexistent_session_fails() {
        let state = RpcService::new();
        let svc = state.lock().await;
        let result = svc.call_rpc_method("nonexistent", RpcRequest {
            method: "test".to_string(),
            params: serde_json::json!(null),
            id: None,
        }).await;
        assert!(result.is_err());
    }

    // ── Discover methods ────────────────────────────────────────────────

    #[tokio::test]
    async fn discover_methods_returns_list() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
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
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let requests = vec![
            RpcRequest { method: "m1".to_string(), params: serde_json::json!(null), id: Some(serde_json::json!(1)) },
            RpcRequest { method: "m2".to_string(), params: serde_json::json!(null), id: Some(serde_json::json!(2)) },
            RpcRequest { method: "m3".to_string(), params: serde_json::json!(null), id: Some(serde_json::json!(3)) },
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
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let resp = svc.call_rpc_method(&id, RpcRequest {
            method: "test".to_string(),
            params: serde_json::json!(null),
            id: Some(serde_json::json!("my-id-42")),
        }).await.unwrap();
        assert_eq!(resp.id, Some(serde_json::json!("my-id-42")));
    }

    #[tokio::test]
    async fn response_preserves_null_id() {
        let state = RpcService::new();
        let mut svc = state.lock().await;
        let id = svc.connect_rpc(test_config()).await.unwrap();
        let resp = svc.call_rpc_method(&id, RpcRequest {
            method: "test".to_string(),
            params: serde_json::json!(null),
            id: None,
        }).await.unwrap();
        assert!(resp.id.is_none());
    }
}