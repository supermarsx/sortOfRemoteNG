// ── Tool / Function-Calling Framework ────────────────────────────────────────
//
// Registry for tools (functions) that the AI agent can invoke, execution
// engine, argument validation, and result formatting.

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;

// ── Tool Registry ────────────────────────────────────────────────────────────

/// A registered tool with its handler.
pub struct RegisteredTool {
    pub definition: ToolDefinition,
    /// Handler fn receives JSON arguments and returns a JSON string result.
    pub handler: Box<dyn Fn(&str) -> Result<String, String> + Send + Sync>,
}

/// Manages available tools the agent can call.
pub struct ToolRegistry {
    tools: HashMap<String, RegisteredTool>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: HashMap::new() }
    }

    /// Registers a tool with a sync handler.
    pub fn register(
        &mut self,
        definition: ToolDefinition,
        handler: Box<dyn Fn(&str) -> Result<String, String> + Send + Sync>,
    ) {
        let name = definition.name.clone();
        self.tools.insert(name, RegisteredTool { definition, handler });
    }

    /// Unregisters a tool by name.
    pub fn unregister(&mut self, name: &str) -> bool {
        self.tools.remove(name).is_some()
    }

    /// Lists all tool definitions (for sending to the LLM).
    pub fn list_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition.clone()).collect()
    }

    /// Gets a single tool definition.
    pub fn get_definition(&self, name: &str) -> Option<&ToolDefinition> {
        self.tools.get(name).map(|t| &t.definition)
    }

    /// Checks if a tool is registered.
    pub fn has_tool(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    pub fn count(&self) -> usize { self.tools.len() }

    /// Executes a tool by name using the provided arguments JSON.
    pub fn execute(&self, name: &str, arguments: &str) -> ToolResult {
        let start = std::time::Instant::now();
        let tool = match self.tools.get(name) {
            Some(t) => t,
            None => return ToolResult {
                tool_call_id: String::new(),
                name: name.to_string(),
                content: format!("Tool '{}' not found", name),
                success: false,
                execution_time_ms: 0,
                error: Some(format!("Tool '{}' not found", name)),
            },
        };

        match (tool.handler)(arguments) {
            Ok(result) => ToolResult {
                tool_call_id: String::new(),
                name: name.to_string(),
                content: result,
                success: true,
                execution_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            },
            Err(e) => ToolResult {
                tool_call_id: String::new(),
                name: name.to_string(),
                content: String::new(),
                success: false,
                execution_time_ms: start.elapsed().as_millis() as u64,
                error: Some(e),
            },
        }
    }

    /// Processes a list of tool calls from an LLM response.
    pub fn execute_tool_calls(&self, tool_calls: &[ToolCall]) -> Vec<ToolResult> {
        tool_calls.iter().map(|tc| {
            let mut result = self.execute(&tc.function.name, &tc.function.arguments);
            result.tool_call_id = tc.id.clone();
            result
        }).collect()
    }
}

// ── Built-in tool definition helper ──────────────────────────────────────────

fn builtin_def(name: &str, description: &str, parameters: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: description.into(),
        parameters,
        category: Some("builtin".into()),
        requires_confirmation: false,
        estimated_output_tokens: None,
        timeout_secs: 120,
    }
}

// ── Built-in Tools ───────────────────────────────────────────────────────────

/// Registers a set of generally useful built-in tools.
pub fn register_builtin_tools(registry: &mut ToolRegistry) {
    // ── current_datetime ──
    registry.register(
        builtin_def("current_datetime", "Returns the current date and time in ISO 8601 format.",
            serde_json::json!({ "type": "object", "properties": {}, "required": [] })),
        Box::new(|_args| {
            Ok(serde_json::json!({ "datetime": Utc::now().to_rfc3339() }).to_string())
        }),
    );

    // ── json_parse ──
    registry.register(
        builtin_def("json_parse", "Parses a JSON string and returns the parsed value.",
            serde_json::json!({
                "type": "object",
                "properties": { "json_string": { "type": "string", "description": "The JSON string to parse" } },
                "required": ["json_string"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let json_str = parsed["json_string"].as_str().ok_or("Missing json_string")?;
            let result: serde_json::Value = serde_json::from_str(json_str).map_err(|e| format!("Invalid JSON: {}", e))?;
            Ok(result.to_string())
        }),
    );

    // ── string_length ──
    registry.register(
        builtin_def("string_length", "Returns the character count and byte count of a string.",
            serde_json::json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let text = parsed["text"].as_str().unwrap_or("");
            Ok(serde_json::json!({ "chars": text.chars().count(), "bytes": text.len() }).to_string())
        }),
    );

    // ── base64_encode ──
    registry.register(
        builtin_def("base64_encode", "Base64-encodes a string.",
            serde_json::json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let text = parsed["text"].as_str().unwrap_or("");
            Ok(serde_json::json!({ "encoded": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, text) }).to_string())
        }),
    );

    // ── base64_decode ──
    registry.register(
        builtin_def("base64_decode", "Base64-decodes a string.",
            serde_json::json!({
                "type": "object",
                "properties": { "encoded": { "type": "string" } },
                "required": ["encoded"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let encoded = parsed["encoded"].as_str().unwrap_or("");
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                .map_err(|e| format!("Decode error: {}", e))?;
            let text = String::from_utf8(bytes).map_err(|e| format!("UTF-8 error: {}", e))?;
            Ok(serde_json::json!({ "decoded": text }).to_string())
        }),
    );

    // ── sha256_hash ──
    registry.register(
        builtin_def("sha256_hash", "Computes the SHA-256 hash of a string.",
            serde_json::json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })),
        Box::new(|args| {
            use sha2::{Sha256, Digest};
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let text = parsed["text"].as_str().unwrap_or("");
            let hash = hex::encode(Sha256::digest(text.as_bytes()));
            Ok(serde_json::json!({ "hash": hash }).to_string())
        }),
    );

    // ── regex_match ──
    registry.register(
        builtin_def("regex_match", "Tests a regex pattern against a string and returns matches.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern" },
                    "text": { "type": "string", "description": "Text to search" }
                },
                "required": ["pattern", "text"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let pattern = parsed["pattern"].as_str().unwrap_or("");
            let text = parsed["text"].as_str().unwrap_or("");
            let re = regex::Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
            let matches: Vec<String> = re.find_iter(text).map(|m| m.as_str().to_string()).collect();
            Ok(serde_json::json!({ "matches": matches, "count": matches.len() }).to_string())
        }),
    );

    // ── math_eval ──
    registry.register(
        builtin_def("math_eval", "Evaluates basic arithmetic expressions (+, -, *, /, %).",
            serde_json::json!({
                "type": "object",
                "properties": { "expression": { "type": "string" } },
                "required": ["expression"]
            })),
        Box::new(|args| {
            let parsed: serde_json::Value = serde_json::from_str(args).map_err(|e| format!("{}", e))?;
            let expr = parsed["expression"].as_str().unwrap_or("0");
            let result = simple_math_eval(expr)?;
            Ok(serde_json::json!({ "result": result, "expression": expr }).to_string())
        }),
    );

    // ── uuid_generate ──
    registry.register(
        builtin_def("uuid_generate", "Generates a new UUID v4.",
            serde_json::json!({ "type": "object", "properties": {}, "required": [] })),
        Box::new(|_args| {
            Ok(serde_json::json!({ "uuid": Uuid::new_v4().to_string() }).to_string())
        }),
    );
}

/// Dead-simple arithmetic evaluator (supports chained +, -, *, /, %).
fn simple_math_eval(expr: &str) -> Result<f64, String> {
    let expr = expr.replace(' ', "");
    let re = regex::Regex::new(r"(\d+\.?\d*)([+\-*/%])(\d+\.?\d*)").map_err(|e| format!("{}", e))?;
    if let Some(caps) = re.captures(&expr) {
        let a: f64 = caps[1].parse().map_err(|_| "Invalid number".to_string())?;
        let op = &caps[2];
        let b: f64 = caps[3].parse().map_err(|_| "Invalid number".to_string())?;
        match op {
            "+" => Ok(a + b),
            "-" => Ok(a - b),
            "*" => Ok(a * b),
            "/" => if b != 0.0 { Ok(a / b) } else { Err("Division by zero".into()) },
            "%" => if b != 0.0 { Ok(a % b) } else { Err("Modulo by zero".into()) },
            _ => Err(format!("Unknown operator: {}", op)),
        }
    } else {
        expr.parse::<f64>().map_err(|_| format!("Cannot evaluate: {}", expr))
    }
}

// ── Tool Result Formatting ───────────────────────────────────────────────────

/// Formats a ToolResult into a string suitable for inclusion in a chat message.
pub fn format_tool_result(result: &ToolResult) -> String {
    match &result.error {
        Some(err) => format!("[Tool Error] {}: {}", result.name, err),
        None => result.content.clone(),
    }
}

/// Converts tool results into ChatMessage instances for the LLM.
pub fn tool_results_to_messages(results: &[ToolResult]) -> Vec<ChatMessage> {
    results.iter().map(|r| {
        ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::Tool,
            content: vec![ContentBlock::Text { text: format_tool_result(r) }],
            tool_call_id: Some(r.tool_call_id.clone()),
            tool_calls: Vec::new(),
            name: Some(r.name.clone()),
            created_at: Utc::now(),
            token_count: None,
            metadata: HashMap::new(),
        }
    }).collect()
}
