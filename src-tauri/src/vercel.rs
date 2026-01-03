use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type VercelServiceState = Arc<Mutex<VercelService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelConnectionConfig {
    pub token: String,
    pub team_id: Option<String>,
    pub api_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelSession {
    pub id: String,
    pub config: VercelConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub user_info: Option<VercelUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelUser {
    pub id: String,
    pub username: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelProject {
    pub id: String,
    pub name: String,
    pub framework: Option<String>,
    pub git_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub domains: Vec<String>,
    pub environment_variables: Vec<VercelEnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelEnvVar {
    pub key: String,
    pub value: String,
    pub target: Vec<String>, // ["production", "preview", "development"]
    pub r#type: String, // "encrypted" or "plain"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelDeployment {
    pub id: String,
    pub name: String,
    pub url: String,
    pub state: String, // "READY", "BUILDING", "ERROR", etc.
    pub created_at: String,
    pub ready_at: Option<String>,
    pub building_at: Option<String>,
    pub error: Option<VercelError>,
    pub functions: Option<HashMap<String, VercelFunction>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelFunction {
    pub size: u64,
    pub ready_state: String,
    pub ready_state_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelDomain {
    pub id: String,
    pub name: String,
    pub verified: bool,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub cdn_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelTeam {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub members: Vec<VercelTeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelTeamMember {
    pub uid: String,
    pub username: String,
    pub email: String,
    pub role: String, // "OWNER", "MEMBER", "VIEWER"
}

pub struct VercelService {
    sessions: HashMap<String, VercelSession>,
    http_client: Client,
}

impl VercelService {
    pub fn new() -> VercelServiceState {
        Arc::new(Mutex::new(VercelService {
            sessions: HashMap::new(),
            http_client: Client::new(),
        }))
    }

    pub async fn connect_vercel(&mut self, config: VercelConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // In a real implementation, this would validate the Vercel token
        // For now, we'll create a mock session
        let session = VercelSession {
            id: session_id.clone(),
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            user_info: Some(VercelUser {
                id: "user_123".to_string(),
                username: "johndoe".to_string(),
                email: "john@example.com".to_string(),
                name: Some("John Doe".to_string()),
                avatar: Some("https://example.com/avatar.jpg".to_string()),
            }),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_vercel(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err(format!("Vercel session {} not found", session_id))
        }
    }

    pub async fn list_vercel_sessions(&self) -> Vec<VercelSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn get_vercel_session(&self, session_id: &str) -> Option<VercelSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_vercel_projects(&self, session_id: &str) -> Result<Vec<VercelProject>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock Vercel projects for demonstration
        Ok(vec![
            VercelProject {
                id: "prj_123".to_string(),
                name: "my-nextjs-app".to_string(),
                framework: Some("nextjs".to_string()),
                git_url: Some("https://github.com/user/my-nextjs-app".to_string()),
                created_at: "2024-01-01T00:00:00Z".to_string(),
                updated_at: "2024-01-03T12:00:00Z".to_string(),
                domains: vec!["my-app.vercel.app".to_string()],
                environment_variables: vec![
                    VercelEnvVar {
                        key: "DATABASE_URL".to_string(),
                        value: "postgresql://...".to_string(),
                        target: vec!["production".to_string()],
                        r#type: "encrypted".to_string(),
                    },
                ],
            },
        ])
    }

    pub async fn list_vercel_deployments(&self, session_id: &str, project_id: Option<String>) -> Result<Vec<VercelDeployment>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock Vercel deployments for demonstration
        Ok(vec![
            VercelDeployment {
                id: "dpl_123".to_string(),
                name: "my-nextjs-app-abc123".to_string(),
                url: "my-nextjs-app-abc123.vercel.app".to_string(),
                state: "READY".to_string(),
                created_at: "2024-01-03T12:00:00Z".to_string(),
                ready_at: Some("2024-01-03T12:05:00Z".to_string()),
                building_at: Some("2024-01-03T12:00:30Z".to_string()),
                error: None,
                functions: Some(HashMap::from([
                    ("api/hello".to_string(), VercelFunction {
                        size: 1024000,
                        ready_state: "READY".to_string(),
                        ready_state_at: "2024-01-03T12:04:00Z".to_string(),
                    }),
                ])),
            },
        ])
    }

    pub async fn list_vercel_domains(&self, session_id: &str) -> Result<Vec<VercelDomain>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock Vercel domains for demonstration
        Ok(vec![
            VercelDomain {
                id: "dom_123".to_string(),
                name: "my-app.vercel.app".to_string(),
                verified: true,
                created_at: "2024-01-01T00:00:00Z".to_string(),
                expires_at: None,
                cdn_enabled: true,
            },
            VercelDomain {
                id: "dom_456".to_string(),
                name: "api.my-app.com".to_string(),
                verified: true,
                created_at: "2024-01-02T00:00:00Z".to_string(),
                expires_at: Some("2025-01-02T00:00:00Z".to_string()),
                cdn_enabled: false,
            },
        ])
    }

    pub async fn list_vercel_teams(&self, session_id: &str) -> Result<Vec<VercelTeam>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock Vercel teams for demonstration
        Ok(vec![
            VercelTeam {
                id: "team_123".to_string(),
                name: "My Team".to_string(),
                slug: "my-team".to_string(),
                created_at: "2024-01-01T00:00:00Z".to_string(),
                members: vec![
                    VercelTeamMember {
                        uid: "user_123".to_string(),
                        username: "johndoe".to_string(),
                        email: "john@example.com".to_string(),
                        role: "OWNER".to_string(),
                    },
                    VercelTeamMember {
                        uid: "user_456".to_string(),
                        username: "janedoe".to_string(),
                        email: "jane@example.com".to_string(),
                        role: "MEMBER".to_string(),
                    },
                ],
            },
        ])
    }

    pub async fn create_vercel_deployment(&self, session_id: &str, project_id: &str, files: HashMap<String, String>) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock deployment creation
        Ok(format!("Deployment created for project {} with {} files", project_id, files.len()))
    }

    pub async fn redeploy_vercel_project(&self, session_id: &str, project_id: &str) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock project redeployment
        Ok(format!("Redeployment initiated for project {}", project_id))
    }

    pub async fn add_vercel_domain(&self, session_id: &str, domain_name: &str, project_id: Option<String>) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock domain addition
        let project_msg = project_id.map_or("".to_string(), |id| format!(" to project {}", id));
        Ok(format!("Domain {} added{}", domain_name, project_msg))
    }

    pub async fn set_vercel_env_var(&self, session_id: &str, project_id: &str, key: &str, value: &str, target: Vec<String>) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Vercel session {} not found", session_id));
        }

        // Mock environment variable setting
        Ok(format!("Environment variable {} set for project {} with target {:?}", key, project_id, target))
    }
}

// Tauri commands
#[tauri::command]
pub async fn connect_vercel(
    state: tauri::State<'_, VercelServiceState>,
    config: VercelConnectionConfig,
) -> Result<String, String> {
    let mut vercel = state.lock().await;
    vercel.connect_vercel(config).await
}

#[tauri::command]
pub async fn disconnect_vercel(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut vercel = state.lock().await;
    vercel.disconnect_vercel(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_sessions(
    state: tauri::State<'_, VercelServiceState>,
) -> Result<Vec<VercelSession>, String> {
    let vercel = state.lock().await;
    Ok(vercel.list_vercel_sessions().await)
}

#[tauri::command]
pub async fn get_vercel_session(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<VercelSession, String> {
    let vercel = state.lock().await;
    vercel.get_vercel_session(&session_id)
        .await
        .ok_or_else(|| format!("Vercel session {} not found", session_id))
}

#[tauri::command]
pub async fn list_vercel_projects(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelProject>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_projects(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_deployments(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: Option<String>,
) -> Result<Vec<VercelDeployment>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_deployments(&session_id, project_id).await
}

#[tauri::command]
pub async fn list_vercel_domains(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelDomain>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_domains(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_teams(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelTeam>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_teams(&session_id).await
}

#[tauri::command]
pub async fn create_vercel_deployment(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
    files: HashMap<String, String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel.create_vercel_deployment(&session_id, &project_id, files).await
}

#[tauri::command]
pub async fn redeploy_vercel_project(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel.redeploy_vercel_project(&session_id, &project_id).await
}

#[tauri::command]
pub async fn add_vercel_domain(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    domain_name: String,
    project_id: Option<String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel.add_vercel_domain(&session_id, &domain_name, project_id).await
}

#[tauri::command]
pub async fn set_vercel_env_var(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
    key: String,
    value: String,
    target: Vec<String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel.set_vercel_env_var(&session_id, &project_id, &key, &value, target).await
}