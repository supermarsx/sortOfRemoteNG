// ── nginx SSL management ─────────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct SslManager;

impl SslManager {
    pub async fn get_config(
        client: &NginxClient,
        site_name: &str,
    ) -> NginxResult<Option<SslConfig>> {
        let path = format!("{}/{}", client.sites_available_dir(), site_name);
        let content = client.read_remote_file(&path).await?;
        Ok(parse_ssl_config(&content))
    }

    pub async fn update_config(
        client: &NginxClient,
        site_name: &str,
        ssl: &SslConfig,
    ) -> NginxResult<()> {
        let path = format!("{}/{}", client.sites_available_dir(), site_name);
        let content = client.read_remote_file(&path).await?;
        let updated = inject_ssl_directives(&content, ssl);
        client.write_remote_file(&path, &updated).await
    }

    pub async fn list_certificates(
        client: &NginxClient,
        cert_dir: &str,
    ) -> NginxResult<Vec<String>> {
        let files = client.list_remote_dir(cert_dir).await?;
        Ok(files
            .into_iter()
            .filter(|f| f.ends_with(".pem") || f.ends_with(".crt"))
            .collect())
    }
}

fn parse_ssl_config(content: &str) -> Option<SslConfig> {
    let mut cert = None;
    let mut key = None;
    let mut protocols = None;
    let mut ciphers = None;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("ssl_certificate ") && !t.starts_with("ssl_certificate_key") {
            cert = Some(
                t.trim_start_matches("ssl_certificate ")
                    .trim_end_matches(';')
                    .trim()
                    .to_string(),
            );
        } else if t.starts_with("ssl_certificate_key ") {
            key = Some(
                t.trim_start_matches("ssl_certificate_key ")
                    .trim_end_matches(';')
                    .trim()
                    .to_string(),
            );
        } else if t.starts_with("ssl_protocols ") {
            protocols = Some(
                t.trim_start_matches("ssl_protocols ")
                    .trim_end_matches(';')
                    .trim()
                    .to_string(),
            );
        } else if t.starts_with("ssl_ciphers ") {
            ciphers = Some(
                t.trim_start_matches("ssl_ciphers ")
                    .trim_end_matches(';')
                    .trim()
                    .to_string(),
            );
        }
    }
    if cert.is_some() || key.is_some() {
        Some(SslConfig {
            certificate: cert.unwrap_or_default(),
            certificate_key: key.unwrap_or_default(),
            protocols: protocols.map(|p| p.split_whitespace().map(String::from).collect()),
            ciphers,
            prefer_server_ciphers: None,
            session_cache: None,
            session_timeout: None,
            stapling: None,
            stapling_verify: None,
            trusted_certificate: None,
            dhparam: None,
            hsts: None,
            hsts_max_age: None,
        })
    } else {
        None
    }
}

fn inject_ssl_directives(content: &str, ssl: &SslConfig) -> String {
    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    let directives = vec![
        Some(format!("    ssl_certificate {};", ssl.certificate)),
        Some(format!("    ssl_certificate_key {};", ssl.certificate_key)),
        ssl.protocols
            .as_ref()
            .map(|v| format!("    ssl_protocols {};", v.join(" "))),
        ssl.ciphers
            .as_ref()
            .map(|v| format!("    ssl_ciphers {};", v)),
    ];
    // Remove existing SSL directives
    lines.retain(|l| {
        let t = l.trim();
        !t.starts_with("ssl_certificate ")
            && !t.starts_with("ssl_certificate_key ")
            && !t.starts_with("ssl_protocols ")
            && !t.starts_with("ssl_ciphers ")
    });
    // Insert before closing brace of first server block
    if let Some(pos) = lines.iter().rposition(|l| l.trim() == "}") {
        for d in directives.into_iter().flatten().rev() {
            lines.insert(pos, d);
        }
    }
    lines.join("\n")
}
