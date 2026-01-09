#[cfg(test)]
mod tests {
    use crate::ssh::*;
    use crate::ssh::{
        default_true, default_keepalive_probes, default_rdp_port, default_vnc_port, default_ftp_port,
        generate_totp_code, RDP_TUNNELS, VNC_TUNNELS, FTP_TUNNELS
    };
    use chrono::Utc;
    use uuid::Uuid;

    // ===== RDP Tunnel Config Tests =====

    #[test]
    fn test_rdp_tunnel_config_defaults() {
        let json = r#"{"remote_rdp_host": "192.168.1.100"}"#;
        let config: RdpTunnelConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.remote_rdp_host, "192.168.1.100");
        assert_eq!(config.remote_rdp_port, 3389);
        assert!(config.local_port.is_none());
        assert!(!config.enable_udp);
        assert!(config.nla_enabled);
    }

    #[test]
    fn test_rdp_tunnel_config_full() {
        let config = RdpTunnelConfig {
            local_port: Some(13389),
            remote_rdp_host: "dc01.internal.corp".to_string(),
            remote_rdp_port: 3389,
            enable_udp: true,
            bind_interface: Some("0.0.0.0".to_string()),
            nla_enabled: true,
            label: Some("Domain Controller".to_string()),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: RdpTunnelConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.local_port, Some(13389));
        assert_eq!(deserialized.remote_rdp_host, "dc01.internal.corp");
        assert!(deserialized.enable_udp);
    }

    #[test]
    fn test_rdp_tunnel_status_serialization() {
        let status = RdpTunnelStatus {
            tunnel_id: "rdp_12345".to_string(),
            session_id: "ssh_session_1".to_string(),
            local_port: 13389,
            remote_rdp_host: "192.168.1.50".to_string(),
            remote_rdp_port: 3389,
            forward_id: "fwd_abc123".to_string(),
            bind_address: "127.0.0.1".to_string(),
            label: Some("Test Server".to_string()),
            nla_enabled: true,
            enable_udp: false,
            connection_string: "localhost:13389".to_string(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: RdpTunnelStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.tunnel_id, "rdp_12345");
        assert_eq!(deserialized.local_port, 13389);
        assert_eq!(deserialized.connection_string, "localhost:13389");
    }

    // ===== VNC Tunnel Config Tests =====

    #[test]
    fn test_vnc_tunnel_config_defaults() {
        let json = r#"{"remote_vnc_host": "192.168.1.200"}"#;
        let config: VncTunnelConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.remote_vnc_host, "192.168.1.200");
        assert_eq!(config.remote_vnc_port, 5900);
        assert!(config.display_number.is_none());
    }

    #[test]
    fn test_vnc_tunnel_config_with_display() {
        let config = VncTunnelConfig {
            local_port: Some(15901),
            remote_vnc_host: "vnc-server.local".to_string(),
            remote_vnc_port: 5900,
            display_number: Some(1),
            bind_interface: None,
            label: Some("Display :1".to_string()),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: VncTunnelConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.display_number, Some(1));
    }

    #[test]
    fn test_vnc_tunnel_status_serialization() {
        let status = VncTunnelStatus {
            tunnel_id: "vnc_67890".to_string(),
            session_id: "ssh_session_2".to_string(),
            local_port: 15900,
            remote_vnc_host: "10.0.0.50".to_string(),
            remote_vnc_port: 5900,
            forward_id: "fwd_xyz789".to_string(),
            bind_address: "127.0.0.1".to_string(),
            label: None,
            connection_string: "localhost:15900".to_string(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: VncTunnelStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.tunnel_id, "vnc_67890");
        assert_eq!(deserialized.local_port, 15900);
    }

    // ===== RDP File Generation Tests =====

    #[test]
    fn test_rdp_file_options_defaults() {
        let opts = RdpFileOptions::default();
        assert!(opts.username.is_none());
        assert!(opts.fullscreen.is_none());
    }

    #[test]
    fn test_generate_rdp_file_basic() {
        let tid = format!("rdp_test_{}", Uuid::new_v4());
        {
            let mut tunnels = RDP_TUNNELS.lock().unwrap();
            tunnels.insert(tid.clone(), RdpTunnelStatus {
                tunnel_id: tid.clone(),
                session_id: "test_session".to_string(),
                local_port: 13389,
                remote_rdp_host: "192.168.1.100".to_string(),
                remote_rdp_port: 3389,
                forward_id: "fwd_test".to_string(),
                bind_address: "127.0.0.1".to_string(),
                label: None,
                nla_enabled: true,
                enable_udp: false,
                connection_string: "localhost:13389".to_string(),
                created_at: Utc::now(),
            });
        }
        let result = generate_rdp_file(tid.clone(), None);
        assert!(result.is_ok());
        let rdp = result.unwrap();
        assert!(rdp.contains("full address:s:localhost:13389"));
        assert!(rdp.contains("enablecredsspsupport:i:1"));
        { RDP_TUNNELS.lock().unwrap().remove(&tid); }
    }

    #[test]
    fn test_generate_rdp_file_not_found() {
        let result = generate_rdp_file("nonexistent".to_string(), None);
        assert!(result.is_err());
    }

    // ===== FTP Tunnel Tests =====

    #[test]
    fn test_ftp_tunnel_config_defaults() {
        let json = r#"{"remote_ftp_host": "ftp.example.com"}"#;
        let config: FtpTunnelConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.remote_ftp_port, 21);
        assert!(config.passive_mode);
        assert_eq!(config.passive_port_count, 10);
    }

    #[test]
    fn test_ftp_tunnel_status_serialization() {
        let status = FtpTunnelStatus {
            tunnel_id: "ftp_test".to_string(),
            session_id: "ssh_ftp".to_string(),
            local_control_port: 2121,
            remote_ftp_host: "ftp.internal.com".to_string(),
            remote_ftp_port: 21,
            passive_mode: true,
            passive_ports: vec![50000, 50001],
            control_forward_id: "ctrl".to_string(),
            data_forward_ids: vec!["data1".to_string()],
        };
        let json = serde_json::to_string(&status).unwrap();
        let de: FtpTunnelStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(de.local_control_port, 2121);
    }

    // ===== Proxy Chain Tests =====

    #[test]
    fn test_proxy_chain_mode_serialization() {
        let strict = ProxyChainMode::Strict;
        let dynamic = ProxyChainMode::Dynamic;
        let random = ProxyChainMode::Random;
        assert!(serde_json::to_string(&strict).is_ok());
        assert!(serde_json::to_string(&dynamic).is_ok());
        assert!(serde_json::to_string(&random).is_ok());
    }

    #[test]
    fn test_proxy_chain_config() {
        let config = ProxyChainConfig {
            proxies: vec![ProxyConfig {
                proxy_type: ProxyType::Socks5,
                host: "proxy.example.com".to_string(),
                port: 1080,
                username: Some("user".to_string()),
                password: Some("pass".to_string()),
            }],
            mode: ProxyChainMode::Strict,
            hop_timeout_ms: 10000,
        };
        let json = serde_json::to_string(&config).unwrap();
        let de: ProxyChainConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(de.proxies.len(), 1);
    }

    // ===== Recording Tests =====

    #[test]
    fn test_recording_entry_type() {
        let output = RecordingEntryType::Output;
        let input = RecordingEntryType::Input;
        let resize = RecordingEntryType::Resize { cols: 120, rows: 40 };
        assert!(serde_json::to_string(&output).unwrap().contains("Output"));
        assert!(serde_json::to_string(&input).unwrap().contains("Input"));
        assert!(serde_json::to_string(&resize).unwrap().contains("120"));
    }

    #[test]
    fn test_session_recording_entry() {
        let entry = SessionRecordingEntry {
            timestamp_ms: 1234,
            data: "test".to_string(),
            entry_type: RecordingEntryType::Output,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let de: SessionRecordingEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(de.timestamp_ms, 1234);
    }

    // ===== Automation Tests =====

    #[test]
    fn test_expect_pattern() {
        let pattern = ExpectPattern {
            pattern: "password:".to_string(),
            response: "secret".to_string(),
            send_newline: true,
            label: Some("Login".to_string()),
        };
        let json = serde_json::to_string(&pattern).unwrap();
        let de: ExpectPattern = serde_json::from_str(&json).unwrap();
        assert_eq!(de.pattern, "password:");
        assert!(de.send_newline);
    }

    #[test]
    fn test_automation_script() {
        let script = AutomationScript {
            id: "script1".to_string(),
            name: "Login".to_string(),
            patterns: vec![ExpectPattern {
                pattern: "login:".to_string(),
                response: "admin".to_string(),
                send_newline: true,
                label: None,
            }],
            timeout_ms: 30000,
            max_matches: 0,
            stop_on_no_match: false,
        };
        let json = serde_json::to_string(&script).unwrap();
        let de: AutomationScript = serde_json::from_str(&json).unwrap();
        assert_eq!(de.name, "Login");
        assert_eq!(de.patterns.len(), 1);
    }

    // ===== SSH Config Tests =====

    #[test]
    fn test_ssh_config_minimal() {
        let json = r#"{"host":"srv","port":22,"username":"root","jump_hosts":[],"strict_host_key_checking":false}"#;
        let config: SshConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.host, "srv");
        assert!(!config.agent_forwarding);
        assert!(config.tcp_no_delay);
    }

    #[test]
    fn test_port_forward_config() {
        let config = PortForwardConfig {
            local_host: "127.0.0.1".to_string(),
            local_port: 8080,
            remote_host: "db.local".to_string(),
            remote_port: 3306,
            direction: PortForwardDirection::Local,
        };
        let json = serde_json::to_string(&config).unwrap();
        let de: PortForwardConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(de.local_port, 8080);
    }

    // ===== TOTP Tests =====

    #[test]
    fn test_totp_code_format() {
        let secret = "GEZDGNBVGY3TQOJQ";
        if let Ok(code) = generate_totp_code(secret) {
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    // ===== Tunnel Storage Tests =====

    #[test]
    fn test_rdp_tunnel_storage() {
        let tid = format!("rdp_st_{}", Uuid::new_v4());
        {
            RDP_TUNNELS.lock().unwrap().insert(tid.clone(), RdpTunnelStatus {
                tunnel_id: tid.clone(),
                session_id: "s1".to_string(),
                local_port: 33389,
                remote_rdp_host: "h".to_string(),
                remote_rdp_port: 3389,
                forward_id: "f".to_string(),
                bind_address: "127.0.0.1".to_string(),
                label: None,
                nla_enabled: true,
                enable_udp: false,
                connection_string: "localhost:33389".to_string(),
                created_at: Utc::now(),
            });
        }
        assert!(get_rdp_tunnel_status(tid.clone()).unwrap().is_some());
        assert!(list_rdp_tunnels().unwrap().iter().any(|t| t.tunnel_id == tid));
        { RDP_TUNNELS.lock().unwrap().remove(&tid); }
    }

    #[test]
    fn test_vnc_tunnel_storage() {
        let tid = format!("vnc_st_{}", Uuid::new_v4());
        {
            VNC_TUNNELS.lock().unwrap().insert(tid.clone(), VncTunnelStatus {
                tunnel_id: tid.clone(),
                session_id: "s2".to_string(),
                local_port: 25900,
                remote_vnc_host: "h".to_string(),
                remote_vnc_port: 5900,
                forward_id: "f".to_string(),
                bind_address: "127.0.0.1".to_string(),
                label: None,
                connection_string: "localhost:25900".to_string(),
                created_at: Utc::now(),
            });
        }
        assert!(get_vnc_tunnel_status(tid.clone()).unwrap().is_some());
        { VNC_TUNNELS.lock().unwrap().remove(&tid); }
    }

    #[test]
    fn test_ftp_tunnel_storage() {
        let tid = format!("ftp_st_{}", Uuid::new_v4());
        {
            FTP_TUNNELS.lock().unwrap().insert(tid.clone(), FtpTunnelStatus {
                tunnel_id: tid.clone(),
                session_id: "s3".to_string(),
                local_control_port: 2121,
                remote_ftp_host: "h".to_string(),
                remote_ftp_port: 21,
                passive_mode: true,
                passive_ports: vec![],
                control_forward_id: "c".to_string(),
                data_forward_ids: vec![],
            });
        }
        assert!(get_ftp_tunnel_status(tid.clone()).unwrap().is_some());
        { FTP_TUNNELS.lock().unwrap().remove(&tid); }
    }

    // ===== Default Tests =====

    #[test]
    fn test_default_ports() {
        assert_eq!(default_rdp_port(), 3389);
        assert_eq!(default_vnc_port(), 5900);
        assert_eq!(default_ftp_port(), 21);
    }

    #[test]
    fn test_default_ssh_settings() {
        assert!(default_true());
        assert_eq!(default_keepalive_probes(), 2);
    }
}
