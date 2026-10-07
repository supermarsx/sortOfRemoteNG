use sorng_network::toolkit::{self, ToolkitReport, ToolkitRequest};

#[tauri::command]
pub async fn network_toolkit_run(request: ToolkitRequest) -> Result<ToolkitReport, String> {
    toolkit::run(request).await
}

#[tauri::command]
pub fn network_toolkit_cancel(job_id: String) -> Result<bool, String> {
    toolkit::cancel(&job_id)
}
