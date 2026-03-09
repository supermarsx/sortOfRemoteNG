// ── nginx site management ────────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct SiteManager;

impl SiteManager {
    pub async fn list(client: &NginxClient) -> NginxResult<Vec<NginxSite>> {
        let available = client.list_remote_dir(client.sites_available_dir()).await?;
        let enabled_files = client
            .list_remote_dir(client.sites_enabled_dir())
            .await
            .unwrap_or_default();
        let mut sites = Vec::new();
        for filename in &available {
            let path = format!("{}/{}", client.sites_available_dir(), filename);
            let raw_content = client.read_remote_file(&path).await.unwrap_or_default();
            let enabled = enabled_files.contains(filename);
            let site = parse_site(filename, &raw_content, enabled);
            sites.push(site);
        }
        Ok(sites)
    }

    pub async fn get(client: &NginxClient, name: &str) -> NginxResult<NginxSite> {
        let path = format!("{}/{}", client.sites_available_dir(), name);
        let raw_content = client.read_remote_file(&path).await?;
        let enabled_path = format!("{}/{}", client.sites_enabled_dir(), name);
        let enabled = client.file_exists(&enabled_path).await.unwrap_or(false);
        Ok(parse_site(name, &raw_content, enabled))
    }

    pub async fn create(client: &NginxClient, req: &CreateSiteRequest) -> NginxResult<NginxSite> {
        let content = generate_site_config(req);
        let path = format!("{}/{}", client.sites_available_dir(), req.name);
        client.write_remote_file(&path, &content).await?;
        if req.enable.unwrap_or(true) {
            let src = format!("{}/{}", client.sites_available_dir(), req.name);
            let dst = format!("{}/{}", client.sites_enabled_dir(), req.name);
            client.create_symlink(&src, &dst).await?;
        }
        Self::get(client, &req.name).await
    }

    pub async fn update(
        client: &NginxClient,
        name: &str,
        req: &UpdateSiteRequest,
    ) -> NginxResult<NginxSite> {
        let path = format!("{}/{}", client.sites_available_dir(), name);
        client.write_remote_file(&path, &req.content).await?;
        Self::get(client, name).await
    }

    pub async fn delete(client: &NginxClient, name: &str) -> NginxResult<()> {
        let link = format!("{}/{}", client.sites_enabled_dir(), name);
        let _ = client.remove_file(&link).await;
        let file = format!("{}/{}", client.sites_available_dir(), name);
        client.remove_file(&file).await
    }

    pub async fn enable(client: &NginxClient, name: &str) -> NginxResult<()> {
        let src = format!("{}/{}", client.sites_available_dir(), name);
        let dst = format!("{}/{}", client.sites_enabled_dir(), name);
        client.create_symlink(&src, &dst).await
    }

    pub async fn disable(client: &NginxClient, name: &str) -> NginxResult<()> {
        let link = format!("{}/{}", client.sites_enabled_dir(), name);
        client.remove_file(&link).await
    }
}

fn parse_site(filename: &str, raw: &str, enabled: bool) -> NginxSite {
    let mut server_names = Vec::new();
    let mut listen = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("server_name ") {
            let names = trimmed
                .trim_start_matches("server_name ")
                .trim_end_matches(';')
                .split_whitespace()
                .map(String::from)
                .collect::<Vec<_>>();
            server_names.extend(names);
        }
        if trimmed.starts_with("listen ") {
            let val = trimmed
                .trim_start_matches("listen ")
                .trim_end_matches(';')
                .trim()
                .to_string();
            let ssl = val.contains("ssl");
            listen.push(ListenDirective {
                address: Some(val),
                ssl,
                http2: false,
                port: 80,
                default_server: false,
                ipv6only: false,
            });
        }
    }
    NginxSite {
        name: filename.to_string(),
        filename: filename.to_string(),
        enabled,
        server_names,
        listen_directives: listen,
        root: None,
        index: None,
        locations: vec![],
        ssl: None,
        upstream_ref: None,
        raw_content: raw.to_string(),
    }
}

fn generate_site_config(req: &CreateSiteRequest) -> String {
    let mut out = String::new();
    out.push_str("server {\n");
    let port = req.listen_port.unwrap_or(80);
    out.push_str(&format!("    listen {};\n", port));
    if !req.server_names.is_empty() {
        out.push_str(&format!(
            "    server_name {};\n",
            req.server_names.join(" ")
        ));
    }
    for loc in &req.locations {
        out.push_str(&format!("    location {} {{\n", loc.path));
        if let Some(ref pp) = loc.proxy_pass {
            out.push_str(&format!("        proxy_pass {};\n", pp));
        }
        if let Some(ref root) = loc.root {
            out.push_str(&format!("        root {};\n", root));
        }
        out.push_str("    }\n");
    }
    out.push_str("}\n");
    out
}
