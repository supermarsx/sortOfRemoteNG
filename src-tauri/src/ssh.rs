use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use ssh2::Session;
use std::net::TcpStream;
use std::io::Read;
use std::path::Path;

pub type SshServiceState = Arc<Mutex<SshService>>;

pub struct SshService {
    sessions: HashMap<String, Session>,
}

impl SshService {
    pub fn new() -> SshServiceState {
        Arc::new(Mutex::new(SshService {
            sessions: HashMap::new(),
        }))
    }

    pub async fn connect_ssh(&mut self, host: String, port: u16, username: String, password: Option<String>, key_path: Option<String>) -> Result<String, String> {
        let session_id = format!("ssh_{}_{}_{}", username, host, port);
        let tcp = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
        let mut sess = Session::new().map_err(|e| e.to_string())?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| e.to_string())?;
        
        if let Some(pass) = password {
            sess.userauth_password(&username, &pass).map_err(|e| e.to_string())?;
        } else if let Some(key) = key_path {
            sess.userauth_pubkey_file(&username, None, Path::new(&key), None).map_err(|e| e.to_string())?;
        } else {
            return Err("No authentication method provided".to_string());
        }
        
        self.sessions.insert(session_id.clone(), sess);
        Ok(session_id)
    }

    pub async fn execute_command(&mut self, session_id: String, command: String) -> Result<String, String> {
        if let Some(sess) = self.sessions.get_mut(&session_id) {
            let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
            channel.exec(&command).map_err(|e| e.to_string())?;
            let mut output = String::new();
            channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
            channel.wait_close().map_err(|e| e.to_string())?;
            Ok(output)
        } else {
            Err("Session not found".to_string())
        }
    }

    pub async fn disconnect_ssh(&mut self, session_id: String) -> Result<(), String> {
        self.sessions.remove(&session_id);
        Ok(())
    }
}

#[tauri::command]
pub async fn connect_ssh(state: tauri::State<'_, SshServiceState>, host: String, port: u16, username: String, password: Option<String>, key_path: Option<String>) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.connect_ssh(host, port, username, password, key_path).await
}

#[tauri::command]
pub async fn execute_command(state: tauri::State<'_, SshServiceState>, session_id: String, command: String) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_command(session_id, command).await
}

#[tauri::command]
pub async fn disconnect_ssh(state: tauri::State<'_, SshServiceState>, session_id: String) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.disconnect_ssh(session_id).await
}