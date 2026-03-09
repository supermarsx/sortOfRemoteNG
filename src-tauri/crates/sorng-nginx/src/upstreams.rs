// ── nginx upstream management ────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct UpstreamManager;

impl UpstreamManager {
    pub async fn list(client: &NginxClient) -> NginxResult<Vec<NginxUpstream>> {
        let files = client.list_remote_dir(client.conf_d_dir()).await?;
        let mut upstreams = Vec::new();
        for f in &files {
            if !f.ends_with(".conf") {
                continue;
            }
            let path = format!("{}/{}", client.conf_d_dir(), f);
            let content = client.read_remote_file(&path).await?;
            upstreams.extend(parse_upstreams(&content));
        }
        let main = client.read_remote_file(client.config_path()).await?;
        upstreams.extend(parse_upstreams(&main));
        Ok(upstreams)
    }

    pub async fn get(client: &NginxClient, name: &str) -> NginxResult<NginxUpstream> {
        let all = Self::list(client).await?;
        all.into_iter().find(|u| u.name == name).ok_or_else(|| {
            crate::error::NginxError::site_not_found(&format!("upstream '{}' not found", name))
        })
    }

    pub async fn create(
        client: &NginxClient,
        req: &CreateUpstreamRequest,
    ) -> NginxResult<NginxUpstream> {
        let content = generate_upstream(req);
        let path = format!("{}/upstream-{}.conf", client.conf_d_dir(), req.name);
        client.write_remote_file(&path, &content).await?;
        Ok(NginxUpstream {
            name: req.name.clone(),
            servers: req.servers.clone(),
            load_balancing: req.load_balancing.clone(),
            keepalive: req.keepalive,
            keepalive_requests: None,
            keepalive_timeout: None,
            zone: None,
            zone_size: None,
        })
    }

    pub async fn update(
        client: &NginxClient,
        name: &str,
        req: &UpdateUpstreamRequest,
    ) -> NginxResult<NginxUpstream> {
        let create_req = CreateUpstreamRequest {
            name: name.to_string(),
            servers: req.servers.clone().unwrap_or_default(),
            load_balancing: req.load_balancing.clone(),
            keepalive: req.keepalive,
        };
        let content = generate_upstream(&create_req);
        let path = format!("{}/upstream-{}.conf", client.conf_d_dir(), name);
        client.write_remote_file(&path, &content).await?;
        Self::get(client, name).await
    }

    pub async fn delete(client: &NginxClient, name: &str) -> NginxResult<()> {
        let path = format!("{}/upstream-{}.conf", client.conf_d_dir(), name);
        client.remove_file(&path).await
    }
}

fn parse_upstreams(content: &str) -> Vec<NginxUpstream> {
    let mut result = Vec::new();
    let mut in_upstream = false;
    let mut name = String::new();
    let mut servers = Vec::new();
    let mut method = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("upstream ") && trimmed.contains('{') {
            in_upstream = true;
            name = trimmed
                .trim_start_matches("upstream ")
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            servers.clear();
            method = None;
        } else if in_upstream && trimmed == "}" {
            result.push(NginxUpstream {
                name: name.clone(),
                servers: servers.clone(),
                load_balancing: method.clone(),
                keepalive: None,
                keepalive_requests: None,
                keepalive_timeout: None,
                zone: None,
                zone_size: None,
            });
            in_upstream = false;
        } else if in_upstream && trimmed.starts_with("server ") {
            let addr = trimmed
                .trim_start_matches("server ")
                .split(';')
                .next()
                .unwrap_or("")
                .trim();
            let parts: Vec<&str> = addr.split_whitespace().collect();
            let address = parts.first().unwrap_or(&"").to_string();
            let weight = parts
                .iter()
                .find_map(|p| p.strip_prefix("weight="))
                .and_then(|w| w.parse().ok());
            let backup = parts.contains(&"backup");
            let down = parts.contains(&"down");
            servers.push(UpstreamServer {
                address,
                port: None,
                weight,
                max_conns: None,
                max_fails: None,
                fail_timeout: None,
                backup,
                down,
                slow_start: None,
            });
        } else if in_upstream {
            for kw in &["least_conn", "ip_hash", "random", "hash"] {
                if trimmed.starts_with(kw) {
                    method = Some(kw.to_string());
                }
            }
        }
    }
    result
}

fn generate_upstream(req: &CreateUpstreamRequest) -> String {
    let mut out = format!("upstream {} {{\n", req.name);
    if let Some(ref m) = req.load_balancing {
        out.push_str(&format!("    {};\n", m));
    }
    for s in &req.servers {
        out.push_str(&format!("    server {}", s.address));
        if let Some(w) = s.weight {
            out.push_str(&format!(" weight={}", w));
        }
        if let Some(mf) = s.max_fails {
            out.push_str(&format!(" max_fails={}", mf));
        }
        if let Some(ref ft) = s.fail_timeout {
            out.push_str(&format!(" fail_timeout={}", ft));
        }
        if s.backup {
            out.push_str(" backup");
        }
        if s.down {
            out.push_str(" down");
        }
        out.push_str(";\n");
    }
    out.push_str("}\n");
    out
}
