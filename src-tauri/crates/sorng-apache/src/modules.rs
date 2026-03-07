// ── apache module management ─────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ModuleManager;

impl ModuleManager {
    pub async fn list(client: &ApacheClient) -> ApacheResult<Vec<ApacheModule>> {
        let out = client.exec_ssh(&format!("{} -M 2>&1", client.apache_bin())).await?;
        Ok(parse_modules(&out.stdout))
    }

    pub async fn list_available(client: &ApacheClient) -> ApacheResult<Vec<String>> {
        let files = client.list_remote_dir(client.mods_available_dir()).await?;
        Ok(files.into_iter().filter(|f| f.ends_with(".load")).map(|f| f.trim_end_matches(".load").to_string()).collect())
    }

    pub async fn list_enabled(client: &ApacheClient) -> ApacheResult<Vec<String>> {
        let files = client.list_remote_dir(client.mods_enabled_dir()).await?;
        Ok(files.into_iter().filter(|f| f.ends_with(".load")).map(|f| f.trim_end_matches(".load").to_string()).collect())
    }

    pub async fn enable(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.enable_module(name).await
    }

    pub async fn disable(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.disable_module(name).await
    }
}

fn parse_modules(output: &str) -> Vec<ApacheModule> {
    output.lines().filter_map(|line| {
        let t = line.trim();
        if !t.ends_with("(static)") && !t.ends_with("(shared)") { return None; }
        let parts: Vec<&str> = t.split_whitespace().collect();
        if parts.len() < 2 { return None; }
        let name = parts[0].to_string();
        let module_type = if t.ends_with("(static)") { ModuleType::Static } else { ModuleType::Shared };
        Some(ApacheModule { name, module_type, filename: None, enabled: true, description: None })
    }).collect()
}
