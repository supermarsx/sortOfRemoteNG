// ── apache vhost management ──────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct VhostManager;

impl VhostManager {
    pub async fn list(client: &ApacheClient) -> ApacheResult<Vec<ApacheVhost>> {
        let available = client.list_remote_dir(client.sites_available_dir()).await?;
        let enabled_files = client.list_remote_dir(client.sites_enabled_dir()).await.unwrap_or_default();
        let mut vhosts = Vec::new();
        for filename in &available {
            let path = format!("{}/{}", client.sites_available_dir(), filename);
            let raw = client.read_remote_file(&path).await.unwrap_or_default();
            let enabled = enabled_files.iter().any(|e| e.contains(filename.trim_end_matches(".conf")));
            let vhost = parse_vhost(filename, &raw, enabled);
            vhosts.push(vhost);
        }
        Ok(vhosts)
    }

    pub async fn get(client: &ApacheClient, name: &str) -> ApacheResult<ApacheVhost> {
        let path = format!("{}/{}", client.sites_available_dir(), name);
        let raw = client.read_remote_file(&path).await?;
        let enabled_path = format!("{}/{}", client.sites_enabled_dir(), name);
        let enabled = client.file_exists(&enabled_path).await.unwrap_or(false);
        Ok(parse_vhost(name, &raw, enabled))
    }

    pub async fn create(client: &ApacheClient, req: &CreateVhostRequest) -> ApacheResult<ApacheVhost> {
        let content = generate_vhost_config(req);
        let filename = if req.name.ends_with(".conf") { req.name.clone() } else { format!("{}.conf", req.name) };
        let path = format!("{}/{}", client.sites_available_dir(), filename);
        client.write_remote_file(&path, &content).await?;
        if req.enabled.unwrap_or(true) {
            client.enable_site(&req.name).await?;
        }
        Self::get(client, &filename).await
    }

    pub async fn update(client: &ApacheClient, name: &str, req: &UpdateVhostRequest) -> ApacheResult<ApacheVhost> {
        if let Some(ref content) = req.raw_content {
            let path = format!("{}/{}", client.sites_available_dir(), name);
            client.write_remote_file(&path, content).await?;
        }
        if let Some(enabled) = req.enabled {
            let site = name.trim_end_matches(".conf");
            if enabled {
                client.enable_site(site).await?;
            } else {
                client.disable_site(site).await?;
            }
        }
        Self::get(client, name).await
    }

    pub async fn delete(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        let site = name.trim_end_matches(".conf");
        let _ = client.disable_site(site).await;
        let path = format!("{}/{}", client.sites_available_dir(), name);
        client.remove_file(&path).await
    }

    pub async fn enable(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.enable_site(name).await
    }

    pub async fn disable(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.disable_site(name).await
    }
}

fn parse_vhost(filename: &str, raw: &str, enabled: bool) -> ApacheVhost {
    let mut server_name = None;
    let mut server_aliases = Vec::new();
    let mut document_root = None;
    let mut listen = None;

    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with("ServerName ") {
            server_name = Some(t.trim_start_matches("ServerName ").trim().to_string());
        } else if t.starts_with("ServerAlias ") {
            let aliases = t.trim_start_matches("ServerAlias ").split_whitespace().map(String::from);
            server_aliases.extend(aliases);
        } else if t.starts_with("DocumentRoot ") {
            document_root = Some(t.trim_start_matches("DocumentRoot ").trim().trim_matches('"').to_string());
        } else if t.starts_with("<VirtualHost ") {
            listen = Some(t.trim_start_matches("<VirtualHost ").trim_end_matches('>').trim().to_string());
        }
    }

    ApacheVhost {
        name: filename.to_string(),
        filename: filename.to_string(),
        enabled,
        server_name,
        server_aliases,
        listen,
        document_root,
        proxy_pass_rules: vec![],
        directory_blocks: vec![],
        location_blocks: vec![],
        rewrite_rules: vec![],
        ssl: None,
        raw_content: Some(raw.to_string()),
    }
}

fn generate_vhost_config(req: &CreateVhostRequest) -> String {
    let listen = req.listen.as_deref().unwrap_or("*:80");
    let mut out = format!("<VirtualHost {}>\n", listen);
    if let Some(ref sn) = req.server_name {
        out.push_str(&format!("    ServerName {}\n", sn));
    }
    for alias in req.server_aliases.as_deref().unwrap_or(&[]) {
        out.push_str(&format!("    ServerAlias {}\n", alias));
    }
    if let Some(ref dr) = req.document_root {
        out.push_str(&format!("    DocumentRoot {}\n", dr));
    }
    for pp in req.proxy_pass_rules.as_deref().unwrap_or(&[]) {
        out.push_str(&format!("    ProxyPass {} {}\n", pp.path, pp.url));
        out.push_str(&format!("    ProxyPassReverse {} {}\n", pp.path, pp.url));
    }
    out.push_str("</VirtualHost>\n");
    out
}
