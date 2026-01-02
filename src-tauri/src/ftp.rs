use std::sync::Arc;
use tokio::sync::Mutex;
use suppaftp::FtpStream;

pub type FtpServiceState = Arc<Mutex<FtpService>>;

pub struct FtpService {
    stream: Option<FtpStream>,
}

impl FtpService {
    pub fn new() -> FtpServiceState {
        Arc::new(Mutex::new(FtpService { stream: None }))
    }

    pub async fn connect_ftp(&mut self, host: String, port: u16, username: String, password: String) -> Result<String, String> {
        let mut ftp_stream = FtpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| e.to_string())?;
        ftp_stream.login(&username, &password)
            .map_err(|e| e.to_string())?;
        self.stream = Some(ftp_stream);
        Ok("Connected to FTP".to_string())
    }

    pub async fn list_files(&mut self, path: String) -> Result<Vec<String>, String> {
        if let Some(stream) = &mut self.stream {
            let files = stream.list(Some(&path))
                .map_err(|e| e.to_string())?;
            Ok(files)
        } else {
            Err("No FTP connection".to_string())
        }
    }

    pub async fn disconnect_ftp(&mut self) -> Result<(), String> {
        if let Some(mut stream) = self.stream.take() {
            stream.quit().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn connect_ftp(state: tauri::State<'_, FtpServiceState>, host: String, port: u16, username: String, password: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.connect_ftp(host, port, username, password).await
}

#[tauri::command]
pub async fn list_files(state: tauri::State<'_, FtpServiceState>, path: String) -> Result<Vec<String>, String> {
    let mut ftp = state.lock().await;
    ftp.list_files(path).await
}

#[tauri::command]
pub async fn disconnect_ftp(state: tauri::State<'_, FtpServiceState>) -> Result<(), String> {
    let mut ftp = state.lock().await;
    ftp.disconnect_ftp().await
}