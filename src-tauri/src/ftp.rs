use std::sync::Arc;
use tokio::sync::Mutex;
use suppaftp::FtpStream;
use std::path::Path;
use tokio::fs;

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

    pub async fn upload_file(&mut self, local_path: String, remote_path: String) -> Result<String, String> {
        if let Some(stream) = &mut self.stream {
            // Read local file
            let data = fs::read(&local_path).await
                .map_err(|e| format!("Failed to read local file: {}", e))?;

            // Upload to FTP server
            let mut reader = std::io::Cursor::new(data);
            stream.put_file(&remote_path, &mut reader)
                .map_err(|e| format!("Failed to upload file: {}", e))?;

            Ok(format!("File uploaded successfully: {} -> {}", local_path, remote_path))
        } else {
            Err("No FTP connection".to_string())
        }
    }

    pub async fn download_file(&mut self, remote_path: String, local_path: String) -> Result<String, String> {
        if let Some(stream) = &mut self.stream {
            // Download from FTP server
            let cursor = stream.retr_as_buffer(&remote_path)
                .map_err(|e| format!("Failed to download file: {}", e))?;

            // Get the data from the cursor
            let data = cursor.into_inner();

            // Write to local file
            fs::write(&local_path, data).await
                .map_err(|e| format!("Failed to write local file: {}", e))?;

            Ok(format!("File downloaded successfully: {} -> {}", remote_path, local_path))
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
pub async fn ftp_upload_file(state: tauri::State<'_, FtpServiceState>, local_path: String, remote_path: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.upload_file(local_path, remote_path).await
}

#[tauri::command]
pub async fn ftp_download_file(state: tauri::State<'_, FtpServiceState>, remote_path: String, local_path: String) -> Result<String, String> {
    let mut ftp = state.lock().await;
    ftp.download_file(remote_path, local_path).await
}

#[tauri::command]
pub async fn disconnect_ftp(state: tauri::State<'_, FtpServiceState>) -> Result<(), String> {
    let mut ftp = state.lock().await;
    ftp.disconnect_ftp().await
}