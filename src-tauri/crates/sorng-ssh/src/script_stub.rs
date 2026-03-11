use crate::ssh::SshServiceState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type ScriptServiceState = Arc<Mutex<ScriptService>>;

const DISABLED_MESSAGE: &str =
    "SSH script execution is disabled. Rebuild with the `script-engine` feature enabled.";

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptContext {
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub trigger: String,
}

impl Default for ScriptContext {
    fn default() -> Self {
        Self {
            connection_id: None,
            session_id: None,
            trigger: "test".to_string(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub struct ScriptService {
    #[allow(dead_code)]
    ssh_service: SshServiceState,
}

impl ScriptService {
    pub fn new(ssh_service: SshServiceState) -> ScriptServiceState {
        Arc::new(Mutex::new(Self { ssh_service }))
    }

    pub async fn execute_script(
        &mut self,
        _code: String,
        _script_type: String,
        _context: ScriptContext,
    ) -> Result<ScriptResult, String> {
        Err(DISABLED_MESSAGE.to_string())
    }
}
