use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, TcpListener};
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::net::TcpStream as AsyncTcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use ssh2::{Session, KeyboardInteractivePrompt, Prompt};
use uuid::Uuid;
use chrono::Utc;
use tauri::Emitter;

use super::types::*;
use super::recording::{record_output, record_input, record_resize};
use super::automation::process_automation_output;
use super::{TERMINAL_BUFFERS, MAX_BUFFER_SIZE};

/// Generate a TOTP code from a secret
pub fn generate_totp_code(secret: &str) -> Result<String, String> {
    use totp_rs::{Algorithm, TOTP};

    // Try to decode the secret (it might be base32 encoded)
    let secret_bytes = if secret.chars().all(|c| c.is_ascii_alphanumeric()) {
        // Likely base32 encoded
        data_encoding::BASE32_NOPAD.decode(secret.to_uppercase().as_bytes())
            .unwrap_or_else(|_| secret.as_bytes().to_vec())
    } else {
        secret.as_bytes().to_vec()
    };

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,  // 6 digits
        1,  // 1 step
        30, // 30 second period
        secret_bytes,
    ).map_err(|e| format!("Failed to create TOTP: {}", e))?;

    Ok(totp.generate_current().map_err(|e| format!("Failed to generate TOTP: {}", e))?)
}

pub struct SshService {
    pub(crate) sessions: HashMap<String, SshSession>,
    #[allow(dead_code)]
    connection_pool: HashMap<String, Vec<SshSession>>,
    #[allow(dead_code)]
    known_hosts: HashMap<String, String>,
    pub(crate) shells: HashMap<String, SshShellHandle>,
}

impl SshService {
    pub fn new() -> SshServiceState {
        std::sync::Arc::new(tokio::sync::Mutex::new(SshService {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
        }))
    }

    pub async fn connect_ssh(&mut self, config: SshConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Determine connection method in priority order:
        // 1. Proxy chain (if specified)
        // 2. Single proxy (if specified)
        // 3. OpenVPN (if specified)
        // 4. Jump hosts (if specified)
        // 5. Direct connection
        let final_stream = if let Some(ref proxy_chain) = config.proxy_chain {
            self.establish_proxy_chain_connection(&config, proxy_chain).await?
        } else if let Some(ref proxy_config) = config.proxy_config {
            self.establish_proxy_connection(&config, proxy_config).await?
        } else if let Some(ref openvpn_config) = config.openvpn_config {
            self.establish_openvpn_connection(&config, openvpn_config).await?
        } else if !config.jump_hosts.is_empty() {
            self.establish_jump_connection(&config).await?
        } else {
            self.establish_direct_connection(&config).await?
        };

        // Apply TCP options to the stream for optimal performance
        final_stream.set_nodelay(config.tcp_no_delay).ok();

        let timeout_secs = config.connect_timeout.unwrap_or(15);
        final_stream.set_read_timeout(Some(Duration::from_secs(timeout_secs * 2))).ok();
        final_stream.set_write_timeout(Some(Duration::from_secs(timeout_secs))).ok();

        let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
        sess.set_tcp_stream(final_stream);

        if config.compression {
            sess.set_compress(true);
        }

        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        if config.strict_host_key_checking {
            self.verify_host_key(&mut sess, &config)?;
        }

        self.authenticate_session(&mut sess, &config)?;

        let mut session = SshSession {
            id: session_id.clone(),
            session: sess,
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            port_forwards: HashMap::new(),
            keep_alive_handle: None,
        };

        if let Some(interval) = config.keep_alive_interval {
            session.keep_alive_handle = Some(self.start_keep_alive(session_id.clone(), interval));
        }

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub(crate) async fn establish_direct_connection(&self, config: &SshConnectionConfig) -> Result<TcpStream, String> {
        if let Some(openvpn_config) = &config.openvpn_config {
            return self.establish_openvpn_connection(config, openvpn_config).await;
        }

        if let Some(proxy_config) = &config.proxy_config {
            return self.establish_proxy_connection(config, proxy_config).await;
        }

        let addr = format!("{}:{}", config.host, config.port);
        let timeout = config.connect_timeout.unwrap_or(15);

        let async_stream = tokio::time::timeout(
            Duration::from_secs(timeout),
            AsyncTcpStream::connect(&addr)
        ).await
        .map_err(|_| format!("Connection timeout after {} seconds - host may be unreachable", timeout))?
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

        let std_stream = async_stream.into_std()
            .map_err(|e| format!("Failed to convert async stream: {}", e))?;

        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    pub(crate) async fn establish_proxy_connection(&self, config: &SshConnectionConfig, proxy_config: &ProxyConfig) -> Result<TcpStream, String> {
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));

        let proxy_addr = format!("{}:{}", proxy_config.host, proxy_config.port);
        let proxy_stream = tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| format!("Proxy connection timeout to {}", proxy_addr))?
            .map_err(|e| format!("Failed to connect to proxy {}: {}", proxy_addr, e))?;

        let target = format!("{}:{}", config.host, config.port);

        match &proxy_config.proxy_type {
            ProxyType::Socks5 => {
                self.connect_through_socks5(proxy_stream, &target, proxy_config).await
            }
            ProxyType::Socks4 => {
                self.connect_through_socks4(proxy_stream, &target, proxy_config).await
            }
            ProxyType::Http | ProxyType::Https => {
                self.connect_through_http_proxy(proxy_stream, &target, proxy_config).await
            }
        }
    }

    pub(crate) async fn connect_through_socks5(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]
        } else {
            vec![0x05, 0x01, 0x00]
        };

        stream.write_all(&greeting).await
            .map_err(|e| format!("Failed to send SOCKS5 greeting: {}", e))?;

        let mut response = [0u8; 2];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS5 greeting response: {}", e))?;

        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 response version".to_string());
        }

        if response[1] == 0x02 {
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config.password.as_deref().unwrap_or("");

            let mut auth_request = vec![0x01];
            auth_request.push(username.len() as u8);
            auth_request.extend_from_slice(username.as_bytes());
            auth_request.push(password.len() as u8);
            auth_request.extend_from_slice(password.as_bytes());

            stream.write_all(&auth_request).await
                .map_err(|e| format!("Failed to send SOCKS5 auth: {}", e))?;

            let mut auth_response = [0u8; 2];
            stream.read_exact(&mut auth_response).await
                .map_err(|e| format!("Failed to read SOCKS5 auth response: {}", e))?;

            if auth_response[1] != 0x00 {
                return Err("SOCKS5 authentication failed".to_string());
            }
        } else if response[1] != 0x00 {
            return Err(format!("SOCKS5 server requires unsupported auth method: {}", response[1]));
        }

        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1].parse()
            .map_err(|_| "Invalid port number".to_string())?;

        let mut request = vec![0x05, 0x01, 0x00];

        if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
            request.push(0x01);
            request.extend_from_slice(&ip.octets());
        } else if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
            request.push(0x04);
            request.extend_from_slice(&ip.octets());
        } else {
            request.push(0x03);
            request.push(host.len() as u8);
            request.extend_from_slice(host.as_bytes());
        }

        request.extend_from_slice(&port.to_be_bytes());

        stream.write_all(&request).await
            .map_err(|e| format!("Failed to send SOCKS5 connect request: {}", e))?;

        let mut connect_response = [0u8; 10];
        stream.read_exact(&mut connect_response).await
            .map_err(|e| format!("Failed to read SOCKS5 connect response: {}", e))?;

        if connect_response[1] != 0x00 {
            let error_msg = match connect_response[1] {
                0x01 => "General SOCKS server failure",
                0x02 => "Connection not allowed by ruleset",
                0x03 => "Network unreachable",
                0x04 => "Host unreachable",
                0x05 => "Connection refused",
                0x06 => "TTL expired",
                0x07 => "Command not supported",
                0x08 => "Address type not supported",
                _ => "Unknown SOCKS5 error",
            };
            return Err(format!("SOCKS5 connect failed: {}", error_msg));
        }

        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    async fn connect_through_socks4(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1].parse()
            .map_err(|_| "Invalid port number".to_string())?;

        let ip: std::net::Ipv4Addr = host.parse()
            .map_err(|_| "SOCKS4 only supports IPv4 addresses, not domain names".to_string())?;

        let mut request = vec![0x04, 0x01];
        request.extend_from_slice(&port.to_be_bytes());
        request.extend_from_slice(&ip.octets());

        if let Some(username) = &proxy_config.username {
            request.extend_from_slice(username.as_bytes());
        }
        request.push(0x00);

        stream.write_all(&request).await
            .map_err(|e| format!("Failed to send SOCKS4 request: {}", e))?;

        let mut response = [0u8; 8];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS4 response: {}", e))?;

        if response[1] != 0x5A {
            let error_msg = match response[1] {
                0x5B => "Request rejected or failed",
                0x5C => "Request failed (no identd)",
                0x5D => "Request failed (identd mismatch)",
                _ => "Unknown SOCKS4 error",
            };
            return Err(format!("SOCKS4 connect failed: {}", error_msg));
        }

        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    async fn connect_through_http_proxy(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let mut request = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\n", target, target);

        if let (Some(username), Some(password)) = (&proxy_config.username, &proxy_config.password) {
            let credentials = format!("{}:{}", username, password);
            let encoded = data_encoding::BASE64.encode(credentials.as_bytes());
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
        }

        request.push_str("\r\n");

        stream.write_all(request.as_bytes()).await
            .map_err(|e| format!("Failed to send HTTP CONNECT: {}", e))?;

        let mut reader = BufReader::new(&mut stream);
        let mut response_line = String::new();
        reader.read_line(&mut response_line).await
            .map_err(|e| format!("Failed to read HTTP response: {}", e))?;

        let parts: Vec<&str> = response_line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err("Invalid HTTP proxy response".to_string());
        }

        let status_code: u16 = parts[1].parse()
            .map_err(|_| "Invalid HTTP status code".to_string())?;

        if status_code != 200 {
            return Err(format!("HTTP proxy returned status {}", status_code));
        }

        loop {
            let mut header_line = String::new();
            reader.read_line(&mut header_line).await
                .map_err(|e| format!("Failed to read HTTP headers: {}", e))?;
            if header_line.trim().is_empty() {
                break;
            }
        }

        drop(reader);
        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        Ok(std_stream)
    }

    /// Establish connection through a proxy chain
    pub(crate) async fn establish_proxy_chain_connection(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        if chain_config.proxies.is_empty() {
            return Err("Proxy chain is empty".to_string());
        }

        match chain_config.mode {
            ProxyChainMode::Strict => {
                self.establish_strict_proxy_chain(config, chain_config).await
            }
            ProxyChainMode::Dynamic => {
                self.establish_dynamic_proxy_chain(config, chain_config).await
            }
            ProxyChainMode::Random => {
                self.establish_random_proxy(config, chain_config).await
            }
        }
    }

    async fn establish_strict_proxy_chain(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        if chain_config.proxies.len() == 1 {
            return self.establish_proxy_connection(config, &chain_config.proxies[0]).await;
        }

        let first_proxy = &chain_config.proxies[0];
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));

        let proxy_addr = format!("{}:{}", first_proxy.host, first_proxy.port);
        let mut current_stream = tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| format!("Proxy chain timeout connecting to {}", proxy_addr))?
            .map_err(|e| format!("Failed to connect to first proxy {}: {}", proxy_addr, e))?;

        for (i, proxy) in chain_config.proxies.iter().skip(1).enumerate() {
            let target = if i == chain_config.proxies.len() - 2 {
                format!("{}:{}", config.host, config.port)
            } else {
                format!("{}:{}", proxy.host, proxy.port)
            };

            current_stream = self.socks5_connect_internal(current_stream, &target, first_proxy).await
                .map_err(|e| format!("Chain hop {} failed: {}", i + 1, e))?
                .0;
        }

        let final_target = format!("{}:{}", config.host, config.port);
        let last_proxy = chain_config.proxies.last().unwrap();

        let std_stream = self.connect_through_socks5(current_stream, &final_target, last_proxy).await?;
        Ok(std_stream)
    }

    async fn socks5_connect_internal(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<(AsyncTcpStream, ()), String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]
        } else {
            vec![0x05, 0x01, 0x00]
        };

        stream.write_all(&greeting).await
            .map_err(|e| format!("SOCKS5 greeting failed: {}", e))?;

        let mut response = [0u8; 2];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("SOCKS5 response failed: {}", e))?;

        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 version".to_string());
        }

        if response[1] == 0x02 {
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config.password.as_deref().unwrap_or("");

            let mut auth = vec![0x01];
            auth.push(username.len() as u8);
            auth.extend_from_slice(username.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());

            stream.write_all(&auth).await.map_err(|e| format!("Auth failed: {}", e))?;

            let mut auth_resp = [0u8; 2];
            stream.read_exact(&mut auth_resp).await.map_err(|e| format!("Auth response failed: {}", e))?;

            if auth_resp[1] != 0x00 {
                return Err("SOCKS5 auth rejected".to_string());
            }
        } else if response[1] != 0x00 {
            return Err("Unsupported auth method".to_string());
        }

        let parts: Vec<&str> = target.split(':').collect();
        let host = parts[0];
        let port: u16 = parts[1].parse().unwrap_or(22);

        let mut request = vec![0x05, 0x01, 0x00, 0x03];
        request.push(host.len() as u8);
        request.extend_from_slice(host.as_bytes());
        request.extend_from_slice(&port.to_be_bytes());

        stream.write_all(&request).await.map_err(|e| format!("Connect request failed: {}", e))?;

        let mut resp = [0u8; 10];
        stream.read_exact(&mut resp).await.map_err(|e| format!("Connect response failed: {}", e))?;

        if resp[1] != 0x00 {
            return Err(format!("SOCKS5 connect failed with code {}", resp[1]));
        }

        Ok((stream, ()))
    }

    async fn establish_dynamic_proxy_chain(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        let mut last_error = String::from("No proxies available");

        for proxy in &chain_config.proxies {
            match self.establish_proxy_connection(config, proxy).await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    log::warn!("Proxy {}:{} failed: {}, trying next", proxy.host, proxy.port, e);
                    last_error = e;
                }
            }
        }

        Err(format!("All proxies in chain failed. Last error: {}", last_error))
    }

    async fn establish_random_proxy(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        use rand::Rng;

        let index = {
            let mut rng = rand::rngs::OsRng;
            rng.gen_range(0..chain_config.proxies.len())
        };

        let proxy = &chain_config.proxies[index];
        self.establish_proxy_connection(config, proxy).await
    }

    async fn establish_openvpn_connection(&self, _config: &SshConnectionConfig, _openvpn_config: &OpenVPNConfig) -> Result<TcpStream, String> {
        Err("OpenVPN connections not yet implemented for SSH".to_string())
    }

    async fn establish_jump_connection(&self, config: &SshConnectionConfig) -> Result<TcpStream, String> {
        let mut current_stream = self.establish_direct_connection(config).await?;

        for jump_host in &config.jump_hosts {
            let local_addr = current_stream.local_addr()
                .map_err(|e| format!("Failed to get local address: {}", e))?;
            let _local_port = local_addr.port();

            let mut jump_session = Session::new()
                .map_err(|e| format!("Failed to create jump session: {}", e))?;
            jump_session.set_tcp_stream(current_stream);
            jump_session.handshake()
                .map_err(|e| format!("Jump host handshake failed: {}", e))?;

            self.authenticate_jump_session(&mut jump_session, jump_host)?;

            current_stream = TcpStream::connect((jump_host.host.as_str(), jump_host.port))
                .map_err(|e| format!("Failed to connect to jump host: {}", e))?;
        }

        Ok(current_stream)
    }

    fn authenticate_session(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        // Try public key authentication first if key is provided
        if let Some(private_key_path) = &config.private_key_path {
            if let Ok(_private_key_content) = std::fs::read_to_string(private_key_path) {
                let passphrase = config.private_key_passphrase.as_deref();

                if session.userauth_pubkey_file(
                    &config.username,
                    None,
                    Path::new(private_key_path),
                    passphrase,
                ).is_ok() {
                    return Ok(());
                }
            }
        }

        // Try password authentication if password is provided
        if let Some(password) = &config.password {
            if session.userauth_password(&config.username, password).is_ok() {
                return Ok(());
            }
        }

        // Try keyboard-interactive authentication (for MFA/2FA)
        if config.password.is_some() || config.totp_secret.is_some() || !config.keyboard_interactive_responses.is_empty() {
            struct KeyboardInteractiveHandler {
                password: Option<String>,
                totp_secret: Option<String>,
                responses: Vec<String>,
            }

            impl KeyboardInteractivePrompt for KeyboardInteractiveHandler {
                fn prompt(&mut self, _username: &str, _instructions: &str, prompts: &[Prompt]) -> Vec<String> {
                    prompts.iter().map(|prompt| {
                        let prompt_lower = prompt.text.to_lowercase();

                        if prompt_lower.contains("verification") || prompt_lower.contains("code")
                            || prompt_lower.contains("token") || prompt_lower.contains("otp")
                            || prompt_lower.contains("2fa") || prompt_lower.contains("mfa") {
                            if let Some(ref secret) = self.totp_secret {
                                if let Ok(code) = generate_totp_code(secret) {
                                    return code;
                                }
                            }
                            for resp in &self.responses {
                                if !resp.is_empty() {
                                    return resp.clone();
                                }
                            }
                        }

                        if prompt_lower.contains("password") {
                            if let Some(ref pwd) = self.password {
                                return pwd.clone();
                            }
                        }

                        if let Some(ref pwd) = self.password {
                            return pwd.clone();
                        }

                        String::new()
                    }).collect()
                }
            }

            let mut handler = KeyboardInteractiveHandler {
                password: config.password.clone(),
                totp_secret: config.totp_secret.clone(),
                responses: config.keyboard_interactive_responses.clone(),
            };

            if session.userauth_keyboard_interactive(&config.username, &mut handler).is_ok() {
                return Ok(());
            }
        }

        // Try agent authentication
        if session.userauth_agent(&config.username).is_ok() {
            return Ok(());
        }

        Err("All authentication methods failed".to_string())
    }

    fn authenticate_jump_session(&self, session: &mut Session, jump_config: &JumpHostConfig) -> Result<(), String> {
        if let Some(private_key_path) = &jump_config.private_key_path {
            if session.userauth_pubkey_file(
                &jump_config.username,
                None,
                Path::new(private_key_path),
                None,
                ).is_ok() {
                    return Ok(());
                }
        }

        if let Some(password) = &jump_config.password {
            if session.userauth_password(&jump_config.username, password).is_ok() {
                return Ok(());
            }
        }

        if session.userauth_agent(&jump_config.username).is_ok() {
            return Ok(());
        }

        Err("All jump host authentication methods failed".to_string())
    }

    pub async fn update_session_auth(&mut self, session_id: &str, password: Option<String>, private_key_path: Option<String>, private_key_passphrase: Option<String>) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        if let Some(password) = password {
            session.config.password = Some(password);
        }

        if let Some(private_key_path) = private_key_path {
            session.config.private_key_path = Some(private_key_path);
        }

        if let Some(passphrase) = private_key_passphrase {
            session.config.private_key_passphrase = Some(passphrase);
        }

        Ok(())
    }

    fn verify_host_key(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        let _known_hosts_path = config.known_hosts_path.clone()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|p| p.join(".ssh").join("known_hosts"))
                    .unwrap_or_else(|| Path::new("/dev/null").to_path_buf())
                    .to_string_lossy()
                    .to_string()
            });

        session.host_key()
            .ok_or("No host key available")?;

        log::info!("Host key verification would be performed here for {}", config.host);
        Ok(())
    }

    fn start_keep_alive(&self, session_id: String, interval: u64) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval));
            loop {
                interval.tick().await;
                log::debug!("Sending keep-alive for session {}", session_id);
            }
        })
    }

    pub async fn validate_key_file(&self, key_path: &str, _passphrase: Option<&str>) -> Result<bool, String> {
        if !Path::new(key_path).exists() {
            return Err(format!("Key file does not exist: {}", key_path));
        }

        let key_content = std::fs::read_to_string(key_path)
            .map_err(|e| format!("Failed to read key file: {}", e))?;

        if !key_content.contains("-----BEGIN") || !key_content.contains("PRIVATE KEY-----") {
            return Err("File does not appear to be a valid private key".to_string());
        }

        Ok(true)
    }

    pub async fn generate_ssh_key(&self, key_type: &str, bits: Option<usize>, passphrase: Option<String>) -> Result<(String, String), String> {
        use ssh_key::{Algorithm, PrivateKey};
        use ssh_key::rand_core::OsRng;
        use ssh_key::LineEnding;

        let private_key = match key_type.to_lowercase().as_str() {
            "rsa" => {
                let bit_size = bits.unwrap_or(3072);
                use rsa::RsaPrivateKey;
                let mut rng = OsRng;
                let _priv_key = RsaPrivateKey::new(&mut rng, bit_size)
                    .map_err(|e| format!("Failed to generate RSA key: {}", e))?;

                return Err("RSA generation not fully implemented yet, use Ed25519".to_string());
            }
            "ed25519" => {
                PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
                    .map_err(|e| format!("Failed to generate Ed25519 key: {}", e))?
            }
            _ => return Err(format!("Unsupported key type: {}", key_type)),
        };

        let final_priv_key = if let Some(_pass) = passphrase {
             private_key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?.to_string()
        } else {
            private_key.to_openssh(LineEnding::LF)
                .map_err(|e| format!("Failed to encode private key: {}", e))?
                .to_string()
        };

        let public_key = private_key.public_key();
        let public_key_str = public_key.to_openssh().map_err(|e| format!("Failed to encode public key: {}", e))?;

        Ok((final_priv_key, public_key_str))
    }

    pub async fn test_ssh_connection(&self, config: SshConnectionConfig) -> Result<String, String> {
        let final_stream = if config.jump_hosts.is_empty() {
            self.establish_direct_connection(&config).await?
        } else {
            self.establish_jump_connection(&config).await?
        };

        let mut sess = Session::new().map_err(|e| format!("Failed to create test session: {}", e))?;
        sess.set_tcp_stream(final_stream);
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        self.authenticate_session(&mut sess, &config)?;

        Ok("SSH connection test successful".to_string())
    }

    pub async fn execute_command(&mut self, session_id: &str, command: String, _timeout: Option<u64>) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        channel.exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = Vec::new();
        channel.read_to_end(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel.wait_close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;

        let exit_status = channel.exit_status()
            .map_err(|e| format!("Failed to get exit status: {}", e))?;

        if exit_status != 0 {
            return Err(format!("Command failed with exit code {}", exit_status));
        }

        String::from_utf8(output)
            .map_err(|e| format!("Invalid UTF-8 output: {}", e))
    }

    pub async fn execute_command_interactive(&mut self, session_id: &str, command: String) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel.wait_close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;

        Ok(output)
    }

    pub async fn start_shell(
        &mut self,
        session_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<String, String> {
        if let Some(existing) = self.shells.get(session_id) {
            return Ok(existing.id.clone());
        }

        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        session.session.set_blocking(true);

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        if session.config.agent_forwarding {
            if let Err(e) = channel.request_auth_agent_forwarding() {
                log::warn!("Failed to request agent forwarding: {} (continuing without)", e);
            }
        }

        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        session.session.set_blocking(false);

        let (tx, mut rx) = mpsc::unbounded_channel::<SshShellCommand>();
        let shell_id = Uuid::new_v4().to_string();
        let session_id_owned = session_id.to_string();
        let app_handle_clone = app_handle.clone();

        let thread = std::thread::spawn(move || {
            let mut buffer = [0u8; 16384];
            let mut running = true;
            let mut idle_count: u32 = 0;
            const MIN_SLEEP_MS: u64 = 1;
            const MAX_SLEEP_MS: u64 = 10;
            const IDLE_THRESHOLD: u32 = 10;

            while running {
                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        SshShellCommand::Input(data) => {
                            record_input(&session_id_owned, &data);

                            if let Err(error) = channel.write_all(data.as_bytes()) {
                                let _ = app_handle_clone.emit(
                                    "ssh-error",
                                    SshShellError {
                                        session_id: session_id_owned.clone(),
                                        message: error.to_string(),
                                    },
                                );
                                running = false;
                                break;
                            }
                            let _ = channel.flush();
                            idle_count = 0;
                        }
                        SshShellCommand::Resize(cols, rows) => {
                            record_resize(&session_id_owned, cols, rows);
                            let _ = channel.request_pty_size(cols, rows, None, None);
                        }
                        SshShellCommand::Close => {
                            let _ = channel.close();
                            let _ = channel.wait_close();
                            running = false;
                        }
                    }
                }

                match channel.read(&mut buffer) {
                    Ok(bytes) if bytes > 0 => {
                        let output = String::from_utf8_lossy(&buffer[..bytes]).to_string();
                        idle_count = 0;

                        record_output(&session_id_owned, &output);

                        process_automation_output(&session_id_owned, &output);

                        if let Ok(mut buffers) = TERMINAL_BUFFERS.lock() {
                            let session_buffer = buffers.entry(session_id_owned.clone()).or_insert_with(String::new);
                            session_buffer.push_str(&output);
                            if session_buffer.len() > MAX_BUFFER_SIZE {
                                let excess = session_buffer.len() - MAX_BUFFER_SIZE;
                                *session_buffer = session_buffer[excess..].to_string();
                            }
                        }

                        let _ = app_handle_clone.emit(
                            "ssh-output",
                            SshShellOutput {
                                session_id: session_id_owned.clone(),
                                data: output,
                            },
                        );
                    }
                    Ok(_) => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) => {
                        let _ = app_handle_clone.emit(
                            "ssh-error",
                            SshShellError {
                                session_id: session_id_owned.clone(),
                                message: error.to_string(),
                            },
                        );
                        running = false;
                    }
                }

                if channel.eof() {
                    running = false;
                }

                let sleep_ms = if idle_count > IDLE_THRESHOLD {
                    MAX_SLEEP_MS
                } else {
                    MIN_SLEEP_MS
                };
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }

            let _ = app_handle_clone.emit(
                "ssh-shell-closed",
                SshShellClosed {
                    session_id: session_id_owned,
                },
            );
        });

        self.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: shell_id.clone(),
                sender: tx,
                thread,
            },
        );

        Ok(shell_id)
    }

    pub async fn send_shell_input(&mut self, session_id: &str, data: String) -> Result<(), String> {
        let shell = self.shells.get(session_id)
            .ok_or("Shell not started")?;
        shell.sender.send(SshShellCommand::Input(data))
            .map_err(|_| "Failed to send input to shell".to_string())
    }

    pub async fn resize_shell(&mut self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let shell = self.shells.get(session_id)
            .ok_or("Shell not started")?;
        shell.sender.send(SshShellCommand::Resize(cols, rows))
            .map_err(|_| "Failed to resize shell".to_string())
    }

    pub async fn stop_shell(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(shell) = self.shells.remove(session_id) {
            let _ = shell.sender.send(SshShellCommand::Close);
        }
        Ok(())
    }

    pub async fn stop_port_forward(&mut self, session_id: &str, forward_id: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        if let Some(handle) = session.port_forwards.remove(forward_id) {
            handle.handle.abort();
            log::info!("Port forward {} stopped for session {}", forward_id, session_id);
            Ok(())
        } else {
            Err(format!("Port forward {} not found", forward_id))
        }
    }

    pub async fn setup_port_forward(&mut self, session_id: &str, config: PortForwardConfig) -> Result<String, String> {
        let forward_id = Uuid::new_v4().to_string();

        let handle = match config.direction {
            PortForwardDirection::Local => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_local_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Remote => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_remote_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Dynamic => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_dynamic_port_forward(session, &config, forward_id.clone()).await?
            }
        };

        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;
        session.last_activity = Utc::now();
        session.port_forwards.insert(forward_id.clone(), handle);
        Ok(forward_id)
    }

    async fn setup_local_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        let listener = std::net::TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        listener.set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                    format!("Failed to convert listener: {}", e).into()
                })?;

            log::info!("Local port forward started on {}:{} -> {}:{}",
                config_clone.local_host, config_clone.local_port,
                config_clone.remote_host, config_clone.remote_port);

            loop {
                match listener.accept().await {
                    Ok((local_stream, peer_addr)) => {
                        log::debug!("Accepted local connection from {}", peer_addr);

                        let session = session_clone.clone();
                        let remote_host = config_clone.remote_host.clone();
                        let remote_port = config_clone.remote_port;
                        let id = id_clone.clone();

                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_local_forward_connection(
                                local_stream, session, &remote_host, remote_port
                            ).await {
                                log::error!("[{}] Local forward connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("Failed to accept connection: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_local_forward_connection(
        local_stream: tokio::net::TcpStream,
        session: Session,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut channel = tokio::task::spawn_blocking({
            let session = session.clone();
            let remote_host = remote_host.to_string();
            move || {
                session.channel_direct_tcpip(&remote_host, remote_port, None)
                    .map_err(|e| format!("Failed to create channel: {}", e))
            }
        }).await??;

        let (mut local_read, mut local_write) = local_stream.into_split();

        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_local, mut rx_to_local) = mpsc::unbounded_channel::<Vec<u8>>();

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SSH channel write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_local.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                std::thread::sleep(Duration::from_millis(5));
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;

        Ok(())
    }

    async fn setup_remote_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        let (listener, actual_port) = session.session.channel_forward_listen(config.remote_port, Some(&config.remote_host), None)
            .map_err(|e| format!("Failed to setup remote port forward: {}", e))?;

        let config_clone = config.clone();
        let id_clone = id.clone();

        let bound_port = if actual_port > 0 { actual_port } else { config.remote_port };
        if actual_port > 0 && actual_port != config.remote_port {
            log::info!("Remote port forward bound to {} (requested {})", actual_port, config.remote_port);
        }

        let handle = tokio::spawn(async move {
            log::info!("Remote port forward listening on {}:{} -> {}:{}",
                config_clone.remote_host, bound_port,
                config_clone.local_host, config_clone.local_port);

            let listener = std::sync::Arc::new(std::sync::Mutex::new(listener));

            loop {
                let channel = match tokio::task::spawn_blocking({
                    let listener = listener.clone();
                    move || {
                        let mut listener = listener.lock().map_err(|e| format!("Lock error: {}", e))?;
                        listener.accept()
                            .map_err(|e| format!("Accept error: {}", e))
                    }
                }).await {
                    Ok(Ok(channel)) => channel,
                    Ok(Err(e)) => {
                        log::debug!("[{}] Forward accept error: {}", id_clone, e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                        continue;
                    }
                    Err(e) => {
                        log::error!("[{}] Task error: {}", id_clone, e);
                        break Err(format!("Task join error: {}", e).into());
                    }
                };

                log::debug!("[{}] Accepted remote forward connection", id_clone);

                let local_host = config_clone.local_host.clone();
                let local_port = config_clone.local_port;
                let id = id_clone.clone();

                tokio::spawn(async move {
                    if let Err(e) = Self::handle_remote_forward_connection(
                        channel, &local_host, local_port
                    ).await {
                        log::error!("[{}] Remote forward connection error: {}", id, e);
                    }
                });
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_remote_forward_connection(
        mut channel: ssh2::Channel,
        local_host: &str,
        local_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let local_stream = tokio::net::TcpStream::connect(format!("{}:{}", local_host, local_port))
            .await
            .map_err(|e| format!("Failed to connect to local target: {}", e))?;

        let (mut local_read, mut local_write) = local_stream.into_split();

        let (tx_to_local, mut rx_to_local) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("Remote forward SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_local.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                std::thread::sleep(Duration::from_millis(5));
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;

        Ok(())
    }

    async fn setup_dynamic_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        let listener = TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind SOCKS port: {}", e))?;

        listener.set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                    format!("Failed to convert listener: {}", e).into()
                })?;

            log::info!("SOCKS5 proxy started on {}:{}", config_clone.local_host, config_clone.local_port);

            loop {
                match listener.accept().await {
                    Ok((client_stream, peer_addr)) => {
                        log::debug!("[{}] SOCKS5 client connected from {}", id_clone, peer_addr);

                        let session = session_clone.clone();
                        let id = id_clone.clone();

                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_socks5_connection(client_stream, session).await {
                                log::debug!("[{}] SOCKS5 connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("SOCKS5 accept error: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_socks5_connection(
        mut client_stream: tokio::net::TcpStream,
        session: Session,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut buf = [0u8; 258];
        let n = client_stream.read(&mut buf).await?;

        if n < 2 || buf[0] != 0x05 {
            return Err("Invalid SOCKS version".into());
        }

        let n_methods = buf[1] as usize;
        if n < 2 + n_methods {
            return Err("Invalid SOCKS auth methods".into());
        }

        let methods = &buf[2..2 + n_methods];
        if !methods.contains(&0x00) {
            client_stream.write_all(&[0x05, 0xFF]).await?;
            return Err("No acceptable auth method".into());
        }

        client_stream.write_all(&[0x05, 0x00]).await?;

        let n = client_stream.read(&mut buf).await?;
        if n < 4 {
            return Err("Invalid SOCKS request".into());
        }

        if buf[0] != 0x05 {
            return Err("Invalid SOCKS version in request".into());
        }

        let cmd = buf[1];
        let atype = buf[3];

        if cmd != 0x01 {
            client_stream.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
            return Err(format!("Unsupported SOCKS command: {}", cmd).into());
        }

        let (target_host, target_port, _addr_end) = match atype {
            0x01 => {
                if n < 10 {
                    return Err("Invalid IPv4 address length".into());
                }
                let addr = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
                let port = u16::from_be_bytes([buf[8], buf[9]]);
                (addr, port, 10)
            }
            0x03 => {
                let domain_len = buf[4] as usize;
                if n < 5 + domain_len + 2 {
                    return Err("Invalid domain name length".into());
                }
                let domain = String::from_utf8_lossy(&buf[5..5 + domain_len]).to_string();
                let port = u16::from_be_bytes([buf[5 + domain_len], buf[6 + domain_len]]);
                (domain, port, 7 + domain_len)
            }
            0x04 => {
                if n < 22 {
                    return Err("Invalid IPv6 address length".into());
                }
                let addr = format!(
                    "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
                    u16::from_be_bytes([buf[4], buf[5]]),
                    u16::from_be_bytes([buf[6], buf[7]]),
                    u16::from_be_bytes([buf[8], buf[9]]),
                    u16::from_be_bytes([buf[10], buf[11]]),
                    u16::from_be_bytes([buf[12], buf[13]]),
                    u16::from_be_bytes([buf[14], buf[15]]),
                    u16::from_be_bytes([buf[16], buf[17]]),
                    u16::from_be_bytes([buf[18], buf[19]])
                );
                let port = u16::from_be_bytes([buf[20], buf[21]]);
                (addr, port, 22)
            }
            _ => {
                client_stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
                return Err(format!("Unsupported address type: {}", atype).into());
            }
        };

        log::debug!("SOCKS5 CONNECT to {}:{}", target_host, target_port);

        let channel = match tokio::task::spawn_blocking({
            let session = session.clone();
            let host = target_host.clone();
            move || {
                session.channel_direct_tcpip(&host, target_port, None)
            }
        }).await? {
            Ok(ch) => ch,
            Err(e) => {
                client_stream.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
                return Err(format!("Failed to connect via SSH: {}", e).into());
            }
        };

        let response = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        client_stream.write_all(&response).await?;

        Self::forward_socks5_traffic(client_stream, channel).await
    }

    async fn forward_socks5_traffic(
        client_stream: tokio::net::TcpStream,
        mut channel: ssh2::Channel,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (mut client_read, mut client_write) = client_stream.into_split();

        let (tx_to_client, mut rx_to_client) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();

        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];

            loop {
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SOCKS5 SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_client.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                std::thread::sleep(Duration::from_millis(5));
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        let client_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match client_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let remote_to_client = tokio::spawn(async move {
            while let Some(data) = rx_to_client.recv().await {
                if client_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = client_to_remote => {}
            _ = remote_to_client => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;

        Ok(())
    }

    pub async fn list_directory(&mut self, session_id: &str, path: &str) -> Result<Vec<SftpDirEntry>, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let entries = sftp.readdir(Path::new(path))
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        Ok(entries.into_iter().map(|(path, stat)| {
            SftpDirEntry {
                path: path.to_string_lossy().to_string(),
                file_type: if stat.is_dir() { "directory" } else { "file" }.to_string(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0) as u64,
            }
        }).collect())
    }

    pub async fn upload_file(&mut self, session_id: &str, local_path: &str, remote_path: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut local_file = std::fs::File::open(local_path)
            .map_err(|e| format!("Failed to open local file: {}", e))?;

        let mut remote_file = sftp.create(Path::new(remote_path))
            .map_err(|e| format!("Failed to create remote file: {}", e))?;

        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn download_file(&mut self, session_id: &str, remote_path: &str, local_path: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut remote_file = sftp.open(Path::new(remote_path))
            .map_err(|e| format!("Failed to open remote file: {}", e))?;

        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| format!("Failed to create local file: {}", e))?;

        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn disconnect_ssh(&mut self, session_id: &str) -> Result<(), String> {
        let _ = self.stop_shell(session_id).await;
        if let Some(mut session) = self.sessions.remove(session_id) {
            if let Some(handle) = session.keep_alive_handle.take() {
                handle.abort();
            }

            for (_, forward) in session.port_forwards.drain() {
                forward.handle.abort();
            }

            // Session will be dropped automatically
        }
        Ok(())
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<SshSessionInfo, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Session not found")?;

        Ok(SshSessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            is_alive: true,
        })
    }

    pub async fn list_sessions(&self) -> Vec<SshSessionInfo> {
        self.sessions.values().map(|session| SshSessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            is_alive: true,
        }).collect()
    }

    // Advanced SSH features
    pub async fn execute_script(&mut self, session_id: &str, script: &str, interpreter: Option<&str>) -> Result<String, String> {
        let interpreter = interpreter.unwrap_or("bash");
        let escaped_script = shell_escape::escape(script.into());
        let command = format!("echo {} | {}", escaped_script, interpreter);

        self.execute_command(session_id, command, Some(300)).await
    }

    pub async fn transfer_file_scp(&mut self, session_id: &str, local_path: &str, remote_path: &str, direction: TransferDirection) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        match direction {
            TransferDirection::Upload => {
                let _scp_command = format!("scp -t {}", remote_path);
                let file_size = std::fs::metadata(local_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .len() as u64;
                let mut channel = session.session.scp_send(Path::new(remote_path), 0o644, file_size, None)
                    .map_err(|e| format!("Failed to initiate SCP upload: {}", e))?;

                let content = std::fs::read(local_path)
                    .map_err(|e| format!("Failed to read local file: {}", e))?;

                channel.write_all(&content)
                    .map_err(|e| format!("Failed to write file content: {}", e))?;

                channel.send_eof()
                    .map_err(|e| format!("Failed to send EOF: {}", e))?;

                channel.wait_eof()
                    .map_err(|e| format!("Failed to wait for EOF: {}", e))?;

                channel.close()
                    .map_err(|e| format!("Failed to close channel: {}", e))?;

                channel.wait_close()
                    .map_err(|e| format!("Failed to wait for close: {}", e))?;
            }
            TransferDirection::Download => {
                let (mut channel, stat) = session.session.scp_recv(Path::new(remote_path))
                    .map_err(|e| format!("Failed to initiate SCP download: {}", e))?;

                let file_size = stat.size();
                let mut content = Vec::with_capacity(file_size as usize);

                std::io::copy(&mut channel, &mut content)
                    .map_err(|e| format!("Failed to read file content: {}", e))?;

                std::fs::write(local_path, content)
                    .map_err(|e| format!("Failed to write local file: {}", e))?;
            }
        }

        Ok(())
    }

    pub async fn monitor_process(&mut self, session_id: &str, process_name: &str) -> Result<Vec<ProcessInfo>, String> {
        let command = format!("ps aux | grep {} | grep -v grep", shell_escape::escape(process_name.into()));
        let output = self.execute_command(session_id, command, None).await?;

        let mut processes = Vec::new();
        for line in output.lines().skip(1) {
            if let Ok(process) = self.parse_process_line(line) {
                processes.push(process);
            }
        }

        Ok(processes)
    }

    fn parse_process_line(&self, line: &str) -> Result<ProcessInfo, String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 11 {
            return Err("Invalid process line format".to_string());
        }

        Ok(ProcessInfo {
            user: parts[0].to_string(),
            pid: parts[1].parse().map_err(|_| "Invalid PID")?,
            cpu_percent: parts[2].parse().unwrap_or(0.0),
            mem_percent: parts[3].parse().unwrap_or(0.0),
            command: parts[10..].join(" "),
        })
    }

    pub async fn get_system_info(&mut self, session_id: &str) -> Result<SystemInfo, String> {
        let uname_output = self.execute_command(session_id, "uname -a".to_string(), None).await?;
        let cpu_info = self.execute_command(session_id, "cat /proc/cpuinfo | head -5".to_string(), None).await?;
        let mem_info = self.execute_command(session_id, "free -h".to_string(), None).await?;
        let disk_info = self.execute_command(session_id, "df -h".to_string(), None).await?;

        Ok(SystemInfo {
            uname: uname_output.trim().to_string(),
            cpu_info: cpu_info.trim().to_string(),
            memory_info: mem_info.trim().to_string(),
            disk_info: disk_info.trim().to_string(),
        })
    }
}
