// ── OpenDKIM process management ──────────────────────────────────────────────

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::{ConfigTestResult, OpendkimInfo};

pub struct OpendkimProcessManager;

impl OpendkimProcessManager {
    pub async fn start(client: &OpendkimClient) -> OpendkimResult<()> {
        let out = client
            .exec_ssh("sudo systemctl start opendkim 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(OpendkimError::process(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn stop(client: &OpendkimClient) -> OpendkimResult<()> {
        let out = client.exec_ssh("sudo systemctl stop opendkim 2>&1").await?;
        if out.exit_code != 0 {
            return Err(OpendkimError::process(format!(
                "stop failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn restart(client: &OpendkimClient) -> OpendkimResult<()> {
        let out = client
            .exec_ssh("sudo systemctl restart opendkim 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(OpendkimError::process(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn reload(client: &OpendkimClient) -> OpendkimResult<()> {
        client.reload().await
    }

    pub async fn status(client: &OpendkimClient) -> OpendkimResult<String> {
        client.status().await
    }

    pub async fn version(client: &OpendkimClient) -> OpendkimResult<String> {
        client.version().await
    }

    pub async fn info(client: &OpendkimClient) -> OpendkimResult<OpendkimInfo> {
        let version_raw = client.version().await.unwrap_or_default();
        // Parse version string: "opendkim: OpenDKIM Filter v2.11.0"
        let version = version_raw
            .split('v')
            .next_back()
            .unwrap_or(&version_raw)
            .trim()
            .to_string();
        // Read config to extract mode/socket/pid
        let conf_raw = client
            .read_remote_file(client.config_path())
            .await
            .unwrap_or_default();
        let mut mode = None;
        let mut socket = None;
        let mut pid_file = None;
        for line in conf_raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if parts.len() < 2 {
                continue;
            }
            match parts[0] {
                "Mode" => mode = Some(Self::expand_mode(parts[1].trim())),
                "Socket" => socket = Some(parts[1].trim().to_string()),
                "PidFile" => pid_file = Some(parts[1].trim().to_string()),
                _ => {}
            }
        }
        Ok(OpendkimInfo {
            version,
            mode,
            socket,
            pid_file,
            config_path: client.config_path().to_string(),
        })
    }

    pub async fn test_config(client: &OpendkimClient) -> OpendkimResult<ConfigTestResult> {
        let bin = client.opendkim_bin();
        let conf = client.config_path();
        let out = client
            .exec_ssh(&format!("sudo {} -n -x {} 2>&1", bin, conf))
            .await;
        match out {
            Ok(o) => Ok(ConfigTestResult {
                success: o.exit_code == 0,
                output: format!("{}{}", o.stdout, o.stderr),
                errors: if o.exit_code != 0 {
                    o.stderr
                        .lines()
                        .filter(|l| !l.is_empty())
                        .map(String::from)
                        .collect()
                } else {
                    vec![]
                },
            }),
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute opendkim -n".into()],
            }),
        }
    }

    /// Expand short mode codes to human-readable strings.
    fn expand_mode(mode: &str) -> String {
        match mode {
            "s" => "sign".to_string(),
            "v" => "verify".to_string(),
            "sv" | "vs" => "both".to_string(),
            other => other.to_string(),
        }
    }
}
