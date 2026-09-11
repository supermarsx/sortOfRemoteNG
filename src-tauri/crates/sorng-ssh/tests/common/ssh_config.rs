use secrecy::SecretString;
use sorng_ssh::ssh::types::{SshCompressionConfig, SshConnectionConfig};
use std::collections::HashMap;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

pub fn test_config() -> SshConnectionConfig {
    SshConnectionConfig {
        host: env_or("SSH_HOST", "127.0.0.1"),
        port: env_or("SSH_PORT", "2222").parse().unwrap_or(2222),
        username: env_or("SSH_USER", "testuser"),
        password: Some(SecretString::from(env_or("SSH_PASSWORD", "testpass"))),
        private_key_path: None,
        private_key_content: None,
        totp_options: None,
        allow_agent_auth: true,
        private_key_passphrase: None,
        jump_hosts: Vec::new(),
        proxy_config: None,
        proxy_chain: None,
        mixed_chain: None,
        openvpn_config: None,
        connect_timeout: Some(15),
        keep_alive_interval: None,
        strict_host_key_checking: false,
        accept_new_host_keys: false,
        known_hosts_path: None,
        also_write_known_hosts: true,
        totp_secret: None,
        keyboard_interactive_responses: Vec::new(),
        agent_forwarding: false,
        tcp_no_delay: true,
        tcp_keepalive: true,
        keepalive_probes: 3,
        ip_protocol: "any".to_string(),
        compression: false,
        compression_level: 6,
        compression_config: SshCompressionConfig::default(),
        ssh_version: "2".to_string(),
        preferred_ciphers: Vec::new(),
        preferred_macs: Vec::new(),
        preferred_kex: Vec::new(),
        preferred_host_key_algorithms: Vec::new(),
        x11_forwarding: None,
        proxy_command: None,
        pty_type: None,
        environment: HashMap::new(),
        sk_auth: false,
        sk_device_path: None,
        sk_pin: None,
        sk_application: None,
    }
}
