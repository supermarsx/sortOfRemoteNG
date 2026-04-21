//! # SNMP Trap Receiver
//!
//! Async UDP listener for SNMP trap notifications (v1 Trap, v2c Trap2, v3 InformRequest).

use crate::error::{SnmpError, SnmpResult};
use crate::pdu;
use crate::types::*;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::Mutex;

/// In-memory trap receiver that buffers received traps.
pub struct TrapReceiver {
    /// Configuration.
    config: TrapReceiverConfig,
    /// Buffered traps (ring buffer).
    buffer: Vec<SnmpTrap>,
    /// Total traps received since start.
    total_received: u64,
    /// Whether the receiver is running.
    running: bool,
    /// Cancel token for the listener task.
    cancel: Option<tokio::sync::watch::Sender<bool>>,
    /// Timestamp when started.
    started_at: Option<String>,
}

impl TrapReceiver {
    pub fn new(config: TrapReceiverConfig) -> Self {
        Self {
            config,
            buffer: vec![],
            total_received: 0,
            running: false,
            cancel: None,
            started_at: None,
        }
    }

    pub fn with_default_config() -> Self {
        Self::new(TrapReceiverConfig::default())
    }

    /// Start listening for traps in the background.
    pub async fn start(&mut self) -> SnmpResult<()> {
        if self.running {
            return Err(SnmpError::trap_error("Trap receiver already running"));
        }

        let bind_addr = format!("{}:{}", self.config.bind_addr, self.config.port);
        let socket = UdpSocket::bind(&bind_addr)
            .await
            .map_err(|e| SnmpError::trap_error(format!("Failed to bind {}: {}", bind_addr, e)))?;

        let (tx, rx) = tokio::sync::watch::channel(false);
        self.cancel = Some(tx);
        self.running = true;
        self.started_at = Some(chrono::Utc::now().to_rfc3339());

        let buffer = Arc::new(Mutex::new(Vec::<SnmpTrap>::new()));
        let config = self.config.clone();
        let buffer_clone = buffer.clone();

        tokio::spawn(async move {
            let mut buf = vec![0u8; 65535];
            let mut rx = rx;
            loop {
                tokio::select! {
                    result = socket.recv_from(&mut buf) => {
                        match result {
                            Ok((len, src)) => {
                                let data = &buf[..len];
                                // Check source filter
                                if !config.allowed_sources.is_empty() {
                                    let src_ip = src.ip().to_string();
                                    if !config.allowed_sources.contains(&src_ip) {
                                        continue;
                                    }
                                }

                                // Try to parse the trap
                                if let Ok(trap) = parse_trap_message(data, &src) {
                                    let mut buffer = buffer_clone.lock().await;
                                    if buffer.len() >= config.max_buffer_size {
                                        buffer.remove(0); // Remove oldest
                                    }
                                    buffer.push(trap);
                                }
                            }
                            Err(e) => {
                                log::error!("Trap receiver recv error: {}", e);
                            }
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });

        log::info!("SNMP trap receiver started on {}", bind_addr);
        Ok(())
    }

    /// Stop the trap receiver.
    pub fn stop(&mut self) {
        if let Some(cancel) = self.cancel.take() {
            let _ = cancel.send(true);
        }
        self.running = false;
        log::info!("SNMP trap receiver stopped");
    }

    /// Get the current status.
    pub fn status(&self) -> TrapReceiverStatus {
        TrapReceiverStatus {
            running: self.running,
            bind_addr: self.config.bind_addr.clone(),
            port: self.config.port,
            total_received: self.total_received,
            buffer_size: self.buffer.len(),
            started_at: self.started_at.clone(),
        }
    }

    /// Get all buffered traps.
    pub fn get_traps(&self) -> &[SnmpTrap] {
        &self.buffer
    }

    /// Get buffered traps since a given timestamp.
    pub fn get_traps_since(&self, since: &str) -> Vec<&SnmpTrap> {
        self.buffer
            .iter()
            .filter(|t| t.received_at.as_str() > since)
            .collect()
    }

    /// Clear the trap buffer.
    pub fn clear_buffer(&mut self) {
        self.buffer.clear();
    }

    /// Update configuration (requires restart to take effect).
    pub fn update_config(&mut self, config: TrapReceiverConfig) {
        self.config = config;
    }

    /// Get current configuration.
    pub fn get_config(&self) -> &TrapReceiverConfig {
        &self.config
    }
}

/// Parse a raw SNMP trap message.
fn parse_trap_message(data: &[u8], src: &std::net::SocketAddr) -> SnmpResult<SnmpTrap> {
    let (version, community, response) = pdu::parse_v1v2c_message(data)?;

    // Extract snmpTrapOID from varbinds (v2c/v3)
    let trap_oid = response
        .varbinds
        .iter()
        .find(|vb| vb.oid == crate::oid::well_known::SNMP_TRAP_OID)
        .and_then(|vb| match &vb.value {
            SnmpValue::ObjectIdentifier(oid) => Some(oid.clone()),
            _ => None,
        })
        .unwrap_or_default();

    // Extract sysUpTime
    let uptime = response
        .varbinds
        .iter()
        .find(|vb| vb.oid == crate::oid::well_known::SYS_UPTIME)
        .and_then(|vb| vb.value.as_u32());

    Ok(SnmpTrap {
        id: uuid::Uuid::new_v4().to_string(),
        source_ip: src.ip().to_string(),
        source_port: src.port(),
        version,
        community: Some(community),
        trap_oid,
        trap_name: None,
        generic_trap: None,
        specific_trap: None,
        agent_addr: None,
        uptime,
        varbinds: response.varbinds,
        received_at: chrono::Utc::now().to_rfc3339(),
        severity: TrapSeverity::Unknown,
    })
}
