use serde::{Serialize, Deserialize};
use serde_json::Value;

use crate::types::{ToolDefinition, ToolCall, FunctionDefinition, FunctionCall, ToolChoice, ToolChoiceFunction};
use crate::error::{LlmError, LlmResult};

/// Normalized tool/function calling layer.
///
/// Different providers use different formats for tool definitions and calls.
/// This module normalizes between:
/// - OpenAI style (tools array with type=function)
/// - Anthropic style (tools array with input_schema)
/// - Google Gemini style (functionDeclarations)
/// - Cohere style (tools with parameterDefinitions)

/// Converts tool definitions to provider-specific format
pub fn tools_to_openai(tools: &[ToolDefinition]) -> Value {
    serde_json::to_value(tools).unwrap_or_default()
}

pub fn tools_to_anthropic(tools: &[ToolDefinition]) -> Value {
    let anthropic_tools: Vec<Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.function.name,
                "description": t.function.description,
                "input_schema": t.function.parameters,
            })
        })
        .collect();
    Value::Array(anthropic_tools)
}

pub fn tools_to_gemini(tools: &[ToolDefinition]) -> Value {
    let declarations: Vec<Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.function.name,
                "description": t.function.description,
                "parameters": t.function.parameters,
            })
        })
        .collect();
    serde_json::json!([{
        "functionDeclarations": declarations,
    }])
}

pub fn tools_to_cohere(tools: &[ToolDefinition]) -> Value {
    let cohere_tools: Vec<Value> = tools
        .iter()
        .map(|t| {
            // Convert JSON Schema properties to Cohere's parameterDefinitions
            let param_defs = if let Some(props) = t.function.parameters.get("properties") {
                let required: Vec<String> = t
                    .function
                    .parameters
                    .get("required")
                    .and_then(|r| serde_json::from_value(r.clone()).ok())
                    .unwrap_or_default();

                if let Some(obj) = props.as_object() {
                    let mut defs = serde_json::Map::new();
                    for (name, schema) in obj {
                        let mut def = serde_json::Map::new();
                        if let Some(desc) = schema.get("description") {
                            def.insert("description".to_string(), desc.clone());
                        }
                        if let Some(typ) = schema.get("type") {
                            def.insert("type".to_string(), typ.clone());
                        }
                        def.insert(
                            "required".to_string(),
                            Value::Bool(required.contains(name)),
                        );
                        defs.insert(name.clone(), Value::Object(def));
                    }
                    Value::Object(defs)
                } else {
                    Value::Object(serde_json::Map::new())
                }
            } else {
                Value::Object(serde_json::Map::new())
            };

            serde_json::json!({
                "name": t.function.name,
                "description": t.function.description,
                "parameterDefinitions": param_defs,
            })
        })
        .collect();
    Value::Array(cohere_tools)
}

/// Parse tool calls from Anthropic's response format
pub fn parse_anthropic_tool_calls(content: &[Value]) -> Vec<ToolCall> {
    content
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? == "tool_use" {
                Some(ToolCall {
                    id: block.get("id")?.as_str()?.to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: block.get("name")?.as_str()?.to_string(),
                        arguments: block.get("input")?.to_string(),
                    },
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse tool calls from Gemini's response format
pub fn parse_gemini_tool_calls(parts: &[Value]) -> Vec<ToolCall> {
    parts
        .iter()
        .filter_map(|part| {
            let fc = part.get("functionCall")?;
            Some(ToolCall {
                id: uuid::Uuid::new_v4().to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: fc.get("name")?.as_str()?.to_string(),
                    arguments: fc.get("args")?.to_string(),
                },
            })
        })
        .collect()
}

/// Parse Cohere tool calls
pub fn parse_cohere_tool_calls(tool_calls: &[Value]) -> Vec<ToolCall> {
    tool_calls
        .iter()
        .filter_map(|tc| {
            Some(ToolCall {
                id: uuid::Uuid::new_v4().to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: tc.get("name")?.as_str()?.to_string(),
                    arguments: tc.get("parameters")?.to_string(),
                },
            })
        })
        .collect()
}

/// Normalize tool_choice across providers
pub fn tool_choice_to_openai(choice: &ToolChoice) -> Value {
    serde_json::to_value(choice).unwrap_or(Value::String("auto".to_string()))
}

pub fn tool_choice_to_anthropic(choice: &ToolChoice) -> Value {
    match choice {
        ToolChoice::Mode(mode) => match mode.as_str() {
            "none" => serde_json::json!({"type": "any", "disable_parallel_tool_use": true}),
            "required" => serde_json::json!({"type": "any"}),
            _ => serde_json::json!({"type": "auto"}),
        },
        ToolChoice::Specific { function, .. } => {
            serde_json::json!({"type": "tool", "name": function.name})
        }
    }
}

/// Validate tool call arguments against a function definition
pub fn validate_tool_call(call: &ToolCall, definition: &ToolDefinition) -> LlmResult<()> {
    if call.function.name != definition.function.name {
        return Err(LlmError::tool_error(&format!(
            "Tool name mismatch: expected '{}', got '{}'",
            definition.function.name, call.function.name
        )));
    }

    // Try parsing arguments as JSON
    match serde_json::from_str::<Value>(&call.function.arguments) {
        Ok(args) => {
            // Check required parameters
            if let Some(required) = definition.function.parameters.get("required") {
                if let Some(required_arr) = required.as_array() {
                    for req in required_arr {
                        if let Some(name) = req.as_str() {
                            if args.get(name).is_none() {
                                return Err(LlmError::tool_error(&format!(
                                    "Missing required parameter '{}' in tool call '{}'",
                                    name, call.function.name
                                )));
                            }
                        }
                    }
                }
            }
            Ok(())
        }
        Err(e) => Err(LlmError::tool_error(&format!(
            "Invalid JSON in tool call arguments: {}",
            e
        ))),
    }
}
