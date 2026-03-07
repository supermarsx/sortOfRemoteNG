// ── nginx config management ──────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct ConfigManager;

impl ConfigManager {
    pub async fn get_main_config(client: &NginxClient) -> NginxResult<NginxMainConfig> {
        let raw = client.read_remote_file(client.config_path()).await?;
        Ok(NginxMainConfig {
            worker_processes: None,
            worker_connections: None,
            multi_accept: None,
            sendfile: None,
            tcp_nopush: None,
            tcp_nodelay: None,
            keepalive_timeout: None,
            types_hash_max_size: None,
            server_tokens: None,
            client_max_body_size: None,
            gzip: None,
            gzip_types: None,
            include_files: vec![],
            error_log: None,
            access_log: None,
            pid_file: None,
            raw_content: raw,
        })
    }

    pub async fn update_main_config(client: &NginxClient, content: &str) -> NginxResult<()> {
        client.write_remote_file(client.config_path(), content).await
    }

    pub async fn test(client: &NginxClient) -> NginxResult<ConfigTestResult> {
        client.test_config().await
    }

    pub async fn get_snippet(client: &NginxClient, name: &str) -> NginxResult<NginxSnippet> {
        let path = format!("{}/{}", client.conf_d_dir(), name);
        let content = client.read_remote_file(&path).await?;
        Ok(NginxSnippet { name: name.to_string(), path: format!("{}/{}", client.conf_d_dir(), name), content, description: None })
    }

    pub async fn list_snippets(client: &NginxClient) -> NginxResult<Vec<NginxSnippet>> {
        let files = client.list_remote_dir(client.conf_d_dir()).await?;
        let mut snippets = Vec::new();
        for f in &files {
            if !f.ends_with(".conf") { continue; }
            let path = format!("{}/{}", client.conf_d_dir(), f);
            let content = client.read_remote_file(&path).await?;
            snippets.push(NginxSnippet { name: f.clone(), path: format!("{}/{}", client.conf_d_dir(), f), content, description: None });
        }
        Ok(snippets)
    }

    pub async fn create_snippet(client: &NginxClient, req: &CreateSnippetRequest) -> NginxResult<NginxSnippet> {
        let filename = if req.name.ends_with(".conf") { req.name.clone() } else { format!("{}.conf", req.name) };
        let path = format!("{}/{}", client.conf_d_dir(), filename);
        client.write_remote_file(&path, &req.content).await?;
        Ok(NginxSnippet { name: req.name.clone(), path: format!("{}/{}", client.conf_d_dir(), filename), content: req.content.clone(), description: req.description.clone() })
    }

    pub async fn update_snippet(client: &NginxClient, name: &str, content: &str) -> NginxResult<NginxSnippet> {
        let path = format!("{}/{}", client.conf_d_dir(), name);
        client.write_remote_file(&path, content).await?;
        Ok(NginxSnippet { name: name.to_string(), path: format!("{}/{}", client.conf_d_dir(), name), content: content.to_string(), description: None })
    }

    pub async fn delete_snippet(client: &NginxClient, name: &str) -> NginxResult<()> {
        let path = format!("{}/{}", client.conf_d_dir(), name);
        client.remove_file(&path).await
    }
}
