// ── apache SSL management ────────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheSslManager;

impl ApacheSslManager {
    pub async fn get_config(client: &ApacheClient, vhost_name: &str) -> ApacheResult<Option<ApacheSslConfig>> {
        let path = format!("{}/{}", client.sites_available_dir(), vhost_name);
        let content = client.read_remote_file(&path).await?;
        Ok(parse_ssl_config(&content))
    }

    pub async fn list_certificates(client: &ApacheClient, cert_dir: &str) -> ApacheResult<Vec<String>> {
        let files = client.list_remote_dir(cert_dir).await?;
        Ok(files.into_iter().filter(|f| f.ends_with(".pem") || f.ends_with(".crt")).collect())
    }
}

fn parse_ssl_config(content: &str) -> Option<ApacheSslConfig> {
    let mut cert = None;
    let mut key = None;
    let mut chain = None;
    let mut protocol = None;
    let mut cipher_suite = None;

    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("SSLCertificateFile ") { cert = Some(t.split_whitespace().nth(1).unwrap_or("").to_string()); }
        if t.starts_with("SSLCertificateKeyFile ") { key = Some(t.split_whitespace().nth(1).unwrap_or("").to_string()); }
        if t.starts_with("SSLCertificateChainFile ") { chain = Some(t.split_whitespace().nth(1).unwrap_or("").to_string()); }
        if t.starts_with("SSLProtocol ") { protocol = Some(t.trim_start_matches("SSLProtocol ").to_string()); }
        if t.starts_with("SSLCipherSuite ") { cipher_suite = Some(t.trim_start_matches("SSLCipherSuite ").to_string()); }
    }

    if cert.is_some() || key.is_some() {
        Some(ApacheSslConfig {
            certificate_file: cert.unwrap_or_default(),
            certificate_key_file: key.unwrap_or_default(),
            certificate_chain_file: chain,
            ca_certificate_file: None,
            protocols: protocol.map(|p| vec![p]),
            cipher_suite,
            honor_cipher_order: None,
            hsts: None,
            hsts_max_age: None,
            stapling: None,
        })
    } else {
        None
    }
}
