use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use rquickjs::{Context, Runtime};

pub type ScriptServiceState = Arc<Mutex<ScriptService>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptContext {
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub trigger: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub struct ScriptService {
    // For now, we'll implement basic script execution
    // In a full implementation, this would include proper sandboxing
}

impl ScriptService {
    pub fn new() -> ScriptServiceState {
        Arc::new(Mutex::new(ScriptService {}))
    }

    pub async fn execute_script(
        &mut self,
        code: String,
        script_type: String,
        _context: ScriptContext,
    ) -> Result<ScriptResult, String> {
        match script_type.as_str() {
            "javascript" => {
                // Basic security check
                if code.contains("eval(") || code.contains("Function(") || code.contains("require(") {
                    return Err("Potentially unsafe code detected".to_string());
                }

                // Execute JavaScript using rquickjs
                let rt = Runtime::new().map_err(|e| format!("Failed to create JavaScript runtime: {}", e))?;
                let ctx = Context::full(&rt).map_err(|e| format!("Failed to create JavaScript context: {}", e))?;

                ctx.with(|ctx| {
                    // Add basic globals for script context
                    let _ = ctx.globals().set("console", ctx.eval::<(), _>("({
                        log: (...args) => {},
                        warn: (...args) => {},
                        error: (...args) => {}
                    })").unwrap_or(()));

                    // Execute the script
                    match ctx.eval::<rquickjs::Value, _>(code.clone()) {
                        Ok(_result) => {
                            // For now, just return a success message
                            // TODO: Implement proper result extraction from JavaScript values
                            let result_str = "Script executed successfully".to_string();

                            Ok(ScriptResult {
                                success: true,
                                result: Some(result_str),
                                error: None,
                            })
                        }
                        Err(e) => {
                            Err(format!("JavaScript execution error: {}", e))
                        }
                    }
                })
            }
            "typescript" => {
                // For TypeScript, we would need a TypeScript compiler
                // For now, treat as JavaScript
                Err("TypeScript execution not yet implemented".to_string())
            }
            _ => Err(format!("Unsupported script type: {}", script_type)),
        }
    }
}

#[tauri::command]
pub async fn execute_user_script(
    state: tauri::State<'_, ScriptServiceState>,
    code: String,
    script_type: String,
    context: ScriptContext,
) -> Result<ScriptResult, String> {
    let mut service = state.lock().await;
    service.execute_script(code, script_type, context).await
}