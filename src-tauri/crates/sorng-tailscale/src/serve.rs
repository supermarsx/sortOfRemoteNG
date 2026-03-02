//! # Tailscale Serve
//!
//! Expose local services to the tailnet. Configure TCP forwarding,
//! web handlers, HTTPS proxy endpoints, and file servers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Local serve configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeConfig {
    pub services: Vec<ServeEntry>,
    pub https_enabled: bool,
}

/// A single serve entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeEntry {
    pub id: String,
    pub protocol: ServeProtocol,
    pub listen_port: u16,
    pub backend: ServeBackend,
    pub mount_path: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServeProtocol {
    Https,
    Http,
    Tcp,
    Tls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServeBackend {
    /// Reverse proxy to local address.
    Proxy {
        target: String,
        insecure_skip_verify: bool,
    },
    /// Serve static files from a directory.
    FileServer {
        path: String,
        browse: bool,
    },
    /// Respond with static text.
    Text {
        content: String,
        content_type: Option<String>,
    },
}

/// Build serve command.
pub fn serve_command(config: &ServeEntry) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "serve".to_string()];

    match config.protocol {
        ServeProtocol::Https => cmd.push("--https".to_string()),
        ServeProtocol::Http => cmd.push("--http".to_string()),
        ServeProtocol::Tcp => cmd.push("--tcp".to_string()),
        ServeProtocol::Tls => cmd.push("--tls-terminated-tcp".to_string()),
    }

    cmd.push(format!("{}", config.listen_port));

    if let Some(path) = &config.mount_path {
        cmd.push("--set-path".to_string());
        cmd.push(path.clone());
    }

    match &config.backend {
        ServeBackend::Proxy { target, insecure_skip_verify } => {
            if *insecure_skip_verify {
                cmd.push("--insecure".to_string());
            }
            cmd.push(target.clone());
        }
        ServeBackend::FileServer { path, .. } => {
            cmd.push(format!("path:{}", path));
        }
        ServeBackend::Text { content, .. } => {
            cmd.push(format!("text:{}", content));
        }
    }

    cmd.push("--bg".to_string());

    cmd
}

/// Build serve off command.
pub fn serve_off_command(protocol: ServeProtocol, port: u16) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "serve".to_string(), "off".to_string()];
    match protocol {
        ServeProtocol::Https => cmd.push("--https".to_string()),
        ServeProtocol::Http => cmd.push("--http".to_string()),
        ServeProtocol::Tcp => cmd.push("--tcp".to_string()),
        ServeProtocol::Tls => cmd.push("--tls-terminated-tcp".to_string()),
    }
    cmd.push(format!("{}", port));
    cmd
}

/// Build serve status command.
pub fn serve_status_command(json: bool) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "serve".to_string(), "status".to_string()];
    if json {
        cmd.push("--json".to_string());
    }
    cmd
}

/// Build serve reset command (removes all serve config).
pub fn serve_reset_command() -> Vec<String> {
    vec!["tailscale".to_string(), "serve".to_string(), "reset".to_string()]
}

/// Parse serve entries from the JSON status.
pub fn parse_serve_entries(status: &super::funnel::ServeStatusJson) -> Vec<ServeEntry> {
    let mut entries = Vec::new();
    let mut counter = 0u32;

    // Parse TCP entries
    if let Some(tcp) = &status.tcp {
        for (port_str, entry) in tcp {
            let port = port_str.parse::<u16>().unwrap_or(0);
            if let Some(forward) = &entry.tcp_forward {
                counter += 1;
                entries.push(ServeEntry {
                    id: format!("tcp-{}", counter),
                    protocol: if entry.terminate_tls.is_some() {
                        ServeProtocol::Tls
                    } else {
                        ServeProtocol::Tcp
                    },
                    listen_port: port,
                    backend: ServeBackend::Proxy {
                        target: forward.clone(),
                        insecure_skip_verify: false,
                    },
                    mount_path: None,
                    active: true,
                });
            }
        }
    }

    // Parse web/HTTPS entries
    if let Some(web) = &status.web {
        for (addr, web_entry) in web {
            let port = addr
                .rsplit(':')
                .next()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(443);

            if let Some(handlers) = &web_entry.handlers {
                for (path, handler) in handlers {
                    counter += 1;
                    let backend = if let Some(proxy) = &handler.proxy {
                        ServeBackend::Proxy {
                            target: proxy.clone(),
                            insecure_skip_verify: false,
                        }
                    } else if let Some(file_path) = &handler.path {
                        ServeBackend::FileServer {
                            path: file_path.clone(),
                            browse: false,
                        }
                    } else if let Some(text) = &handler.text {
                        ServeBackend::Text {
                            content: text.clone(),
                            content_type: None,
                        }
                    } else {
                        continue;
                    };

                    entries.push(ServeEntry {
                        id: format!("web-{}", counter),
                        protocol: ServeProtocol::Https,
                        listen_port: port,
                        backend,
                        mount_path: Some(path.clone()),
                        active: true,
                    });
                }
            }
        }
    }

    entries
}

/// Validate a serve entry before applying.
pub fn validate_serve_entry(entry: &ServeEntry) -> Vec<String> {
    let mut errors = Vec::new();

    if entry.listen_port == 0 {
        errors.push("Listen port cannot be 0".to_string());
    }

    match &entry.backend {
        ServeBackend::Proxy { target, .. } => {
            if target.is_empty() {
                errors.push("Proxy target cannot be empty".to_string());
            }
        }
        ServeBackend::FileServer { path, .. } => {
            if path.is_empty() {
                errors.push("File server path cannot be empty".to_string());
            }
        }
        ServeBackend::Text { content, .. } => {
            if content.is_empty() {
                errors.push("Text content cannot be empty".to_string());
            }
        }
    }

    // Validate mount path for web protocols
    if matches!(entry.protocol, ServeProtocol::Https | ServeProtocol::Http) {
        if let Some(path) = &entry.mount_path {
            if !path.starts_with('/') {
                errors.push(format!("Mount path must start with '/': {}", path));
            }
        }
    }

    errors
}
