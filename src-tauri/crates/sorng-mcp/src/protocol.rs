//! # MCP Protocol — JSON-RPC Message Handling
//!
//! Parses incoming JSON-RPC 2.0 messages and routes them to the appropriate
//! handler. Builds well-formed responses, errors, and notifications.

use crate::types::*;
use serde_json::Value;

/// Parse a raw JSON string into a JSON-RPC request or batch.
pub fn parse_message(raw: &str) -> Result<Vec<JsonRpcRequest>, JsonRpcErrorData> {
    let value: Value = serde_json::from_str(raw).map_err(|e| JsonRpcErrorData {
        code: error_codes::PARSE_ERROR,
        message: format!("Parse error: {e}"),
        data: None,
    })?;

    if let Some(arr) = value.as_array() {
        // Batch request
        let mut requests = Vec::new();
        for item in arr {
            let req: JsonRpcRequest =
                serde_json::from_value(item.clone()).map_err(|e| JsonRpcErrorData {
                    code: error_codes::INVALID_REQUEST,
                    message: format!("Invalid request in batch: {e}"),
                    data: None,
                })?;
            requests.push(req);
        }
        Ok(requests)
    } else {
        // Single request
        let req: JsonRpcRequest = serde_json::from_value(value).map_err(|e| JsonRpcErrorData {
            code: error_codes::INVALID_REQUEST,
            message: format!("Invalid request: {e}"),
            data: None,
        })?;
        Ok(vec![req])
    }
}

/// Build a success response.
pub fn build_response(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result,
    }
}

/// Build an error response.
pub fn build_error(id: Value, code: i32, message: &str, data: Option<Value>) -> JsonRpcError {
    JsonRpcError {
        jsonrpc: "2.0".to_string(),
        id,
        error: JsonRpcErrorData {
            code,
            message: message.to_string(),
            data,
        },
    }
}

/// Build a notification message.
pub fn build_notification(method: &str, params: Option<Value>) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
    }
}

/// Build a progress notification.
pub fn build_progress(
    token: Value,
    progress: f64,
    total: Option<f64>,
    message: Option<String>,
) -> JsonRpcNotification {
    let params = ProgressParams {
        progress_token: token,
        progress,
        total,
        message,
    };
    build_notification(
        "notifications/progress",
        Some(serde_json::to_value(params).unwrap_or_default()),
    )
}

/// Build a log notification.
pub fn build_log_notification(
    level: McpLogLevel,
    logger: &str,
    data: Value,
) -> JsonRpcNotification {
    let params = LogNotificationParams {
        level,
        logger: logger.to_string(),
        data,
    };
    build_notification(
        "notifications/message",
        Some(serde_json::to_value(params).unwrap_or_default()),
    )
}

/// Check if a JSON-RPC request is a notification (no id field).
pub fn is_notification(req: &JsonRpcRequest) -> bool {
    req.id.is_none()
}

/// Extract typed params from a request.
pub fn extract_params<T: serde::de::DeserializeOwned>(
    req: &JsonRpcRequest,
) -> Result<T, JsonRpcErrorData> {
    let params = req
        .params
        .clone()
        .unwrap_or(Value::Object(Default::default()));
    serde_json::from_value(params).map_err(|e| JsonRpcErrorData {
        code: error_codes::INVALID_PARAMS,
        message: format!("Invalid params: {e}"),
        data: None,
    })
}

/// Classify an MCP method into a category for routing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MethodCategory {
    Initialize,
    Initialized,
    Ping,
    ToolsList,
    ToolsCall,
    ResourcesList,
    ResourcesRead,
    ResourcesTemplatesList,
    ResourcesSubscribe,
    ResourcesUnsubscribe,
    PromptsList,
    PromptsGet,
    LoggingSetLevel,
    Cancelled,
    Unknown(String),
}

/// Classify a method string.
pub fn classify_method(method: &str) -> MethodCategory {
    match method {
        "initialize" => MethodCategory::Initialize,
        "notifications/initialized" => MethodCategory::Initialized,
        "ping" => MethodCategory::Ping,
        "tools/list" => MethodCategory::ToolsList,
        "tools/call" => MethodCategory::ToolsCall,
        "resources/list" => MethodCategory::ResourcesList,
        "resources/read" => MethodCategory::ResourcesRead,
        "resources/templates/list" => MethodCategory::ResourcesTemplatesList,
        "resources/subscribe" => MethodCategory::ResourcesSubscribe,
        "resources/unsubscribe" => MethodCategory::ResourcesUnsubscribe,
        "prompts/list" => MethodCategory::PromptsList,
        "prompts/get" => MethodCategory::PromptsGet,
        "logging/setLevel" => MethodCategory::LoggingSetLevel,
        "notifications/cancelled" => MethodCategory::Cancelled,
        other => MethodCategory::Unknown(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_request() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        let result = parse_message(raw).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].method, "initialize");
    }

    #[test]
    fn test_parse_batch_request() {
        let raw = r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]"#;
        let result = parse_message(raw).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_parse_invalid_json() {
        let result = parse_message("not json");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, error_codes::PARSE_ERROR);
    }

    #[test]
    fn test_classify_methods() {
        assert_eq!(classify_method("initialize"), MethodCategory::Initialize);
        assert_eq!(classify_method("tools/list"), MethodCategory::ToolsList);
        assert_eq!(classify_method("tools/call"), MethodCategory::ToolsCall);
        assert_eq!(
            classify_method("resources/read"),
            MethodCategory::ResourcesRead
        );
        assert_eq!(classify_method("prompts/get"), MethodCategory::PromptsGet);
        assert_eq!(classify_method("ping"), MethodCategory::Ping);
        assert!(matches!(
            classify_method("unknown"),
            MethodCategory::Unknown(_)
        ));
    }

    #[test]
    fn test_build_response() {
        let resp = build_response(
            serde_json::Value::Number(1.into()),
            serde_json::json!({"status": "ok"}),
        );
        assert_eq!(resp.jsonrpc, "2.0");
        assert_eq!(resp.result["status"], "ok");
    }

    #[test]
    fn test_build_error() {
        let err = build_error(
            serde_json::Value::Number(1.into()),
            error_codes::METHOD_NOT_FOUND,
            "Method not found",
            None,
        );
        assert_eq!(err.error.code, -32601);
    }
}
