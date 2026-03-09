//! # SNMP Client
//!
//! UDP-based SNMP client supporting v1, v2c, and v3.
//! Handles request serialisation, response parsing, timeouts, and retries.

use crate::error::{SnmpError, SnmpResult};
use crate::pdu;
use crate::types::*;
use crate::v3::UsmProcessor;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

/// SNMP client with UDP transport.
pub struct SnmpClient {
    /// USM processor for SNMPv3.
    usm: Arc<Mutex<UsmProcessor>>,
    /// Request counter for generating unique IDs.
    next_request_id: std::sync::atomic::AtomicI32,
}

impl Default for SnmpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl SnmpClient {
    pub fn new() -> Self {
        Self {
            usm: Arc::new(Mutex::new(UsmProcessor::new())),
            next_request_id: std::sync::atomic::AtomicI32::new(1),
        }
    }

    pub fn with_usm(usm: Arc<Mutex<UsmProcessor>>) -> Self {
        Self {
            usm,
            next_request_id: std::sync::atomic::AtomicI32::new(1),
        }
    }

    /// Get the USM processor reference.
    pub fn usm(&self) -> &Arc<Mutex<UsmProcessor>> {
        &self.usm
    }

    /// Generate the next request ID.
    fn next_id(&self) -> i32 {
        self.next_request_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// Send a raw SNMP message and receive the response.
    async fn send_recv(&self, target: &SnmpTarget, message: &[u8]) -> SnmpResult<Vec<u8>> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| SnmpError::connection(format!("Failed to bind UDP socket: {}", e)))?;

        let addr = target.addr();
        socket
            .send_to(message, &addr)
            .await
            .map_err(|e| SnmpError::connection(format!("Failed to send to {}: {}", addr, e)))?;

        let mut buf = vec![0u8; 65535];
        let mut last_err = None;

        for _attempt in 0..=target.retries {
            match timeout(
                Duration::from_millis(target.timeout_ms),
                socket.recv_from(&mut buf),
            )
            .await
            {
                Ok(Ok((len, _src))) => return Ok(buf[..len].to_vec()),
                Ok(Err(e)) => {
                    last_err = Some(SnmpError::connection(format!("UDP recv error: {}", e)));
                }
                Err(_) => {
                    last_err = Some(SnmpError::timeout(format!(
                        "Timeout after {}ms to {}",
                        target.timeout_ms, addr
                    )));
                }
            }
        }

        Err(last_err.unwrap_or_else(|| SnmpError::timeout(format!("No response from {}", addr))))
    }

    /// Perform an SNMP GET request.
    pub async fn get(&self, target: &SnmpTarget, oids: &[String]) -> SnmpResult<SnmpResponse> {
        let request_id = self.next_id();
        let start = std::time::Instant::now();

        let varbinds = pdu::null_varbinds(oids);

        let message = match target.version {
            SnmpVersion::V1 | SnmpVersion::V2c => {
                let community = target.community.as_deref().unwrap_or("public");
                pdu::build_v1v2c_message(
                    target.version,
                    community,
                    PduType::GetRequest,
                    request_id,
                    &varbinds,
                )?
            }
            SnmpVersion::V3 => {
                let creds = target
                    .v3_credentials
                    .as_ref()
                    .ok_or_else(|| SnmpError::auth("V3 credentials required"))?;
                let usm = self.usm.lock().await;
                usm.build_v3_message(
                    request_id,
                    &creds.username,
                    &target.addr(),
                    PduType::GetRequest,
                    request_id,
                    &varbinds,
                )?
            }
        };

        let resp_bytes = self.send_recv(target, &message).await?;
        let (_, _, mut response) = pdu::parse_v1v2c_message(&resp_bytes)?;
        response.rtt_ms = start.elapsed().as_millis() as u64;

        if response.error_status.is_error() {
            log::warn!(
                "SNMP GET error from {}: {} (index {})",
                target.addr(),
                response.error_status.as_str(),
                response.error_index
            );
        }

        Ok(response)
    }

    /// Perform an SNMP GET-NEXT request.
    pub async fn get_next(&self, target: &SnmpTarget, oids: &[String]) -> SnmpResult<SnmpResponse> {
        let request_id = self.next_id();
        let start = std::time::Instant::now();
        let varbinds = pdu::null_varbinds(oids);

        let message = match target.version {
            SnmpVersion::V1 | SnmpVersion::V2c => {
                let community = target.community.as_deref().unwrap_or("public");
                pdu::build_v1v2c_message(
                    target.version,
                    community,
                    PduType::GetNextRequest,
                    request_id,
                    &varbinds,
                )?
            }
            SnmpVersion::V3 => {
                let creds = target
                    .v3_credentials
                    .as_ref()
                    .ok_or_else(|| SnmpError::auth("V3 credentials required"))?;
                let usm = self.usm.lock().await;
                usm.build_v3_message(
                    request_id,
                    &creds.username,
                    &target.addr(),
                    PduType::GetNextRequest,
                    request_id,
                    &varbinds,
                )?
            }
        };

        let resp_bytes = self.send_recv(target, &message).await?;
        let (_, _, mut response) = pdu::parse_v1v2c_message(&resp_bytes)?;
        response.rtt_ms = start.elapsed().as_millis() as u64;
        Ok(response)
    }

    /// Perform an SNMP GET-BULK request (v2c/v3 only).
    pub async fn get_bulk(
        &self,
        target: &SnmpTarget,
        oids: &[String],
        non_repeaters: i32,
        max_repetitions: i32,
    ) -> SnmpResult<SnmpResponse> {
        if target.version == SnmpVersion::V1 {
            return Err(SnmpError::config("GET-BULK not supported in SNMPv1"));
        }
        let request_id = self.next_id();
        let start = std::time::Instant::now();
        let varbinds = pdu::null_varbinds(oids);

        let community = target.community.as_deref().unwrap_or("public");
        let message = pdu::build_getbulk_message(
            target.version,
            community,
            request_id,
            non_repeaters,
            max_repetitions,
            &varbinds,
        )?;

        let resp_bytes = self.send_recv(target, &message).await?;
        let (_, _, mut response) = pdu::parse_v1v2c_message(&resp_bytes)?;
        response.rtt_ms = start.elapsed().as_millis() as u64;
        Ok(response)
    }

    /// Perform an SNMP SET request.
    pub async fn set(
        &self,
        target: &SnmpTarget,
        varbinds: &[(String, SnmpValue)],
    ) -> SnmpResult<SnmpResponse> {
        let request_id = self.next_id();
        let start = std::time::Instant::now();

        let message = match target.version {
            SnmpVersion::V1 | SnmpVersion::V2c => {
                let community = target.community.as_deref().unwrap_or("private");
                pdu::build_v1v2c_message(
                    target.version,
                    community,
                    PduType::SetRequest,
                    request_id,
                    varbinds,
                )?
            }
            SnmpVersion::V3 => {
                let creds = target
                    .v3_credentials
                    .as_ref()
                    .ok_or_else(|| SnmpError::auth("V3 credentials required"))?;
                let usm = self.usm.lock().await;
                usm.build_v3_message(
                    request_id,
                    &creds.username,
                    &target.addr(),
                    PduType::SetRequest,
                    request_id,
                    varbinds,
                )?
            }
        };

        let resp_bytes = self.send_recv(target, &message).await?;
        let (_, _, mut response) = pdu::parse_v1v2c_message(&resp_bytes)?;
        response.rtt_ms = start.elapsed().as_millis() as u64;

        if response.error_status.is_error() {
            return Err(SnmpError::set_rejected(format!(
                "SET rejected: {} (index {})",
                response.error_status.as_str(),
                response.error_index
            )));
        }

        Ok(response)
    }

    /// Simple GET of a single OID, returning just the value.
    pub async fn get_value(&self, target: &SnmpTarget, oid: &str) -> SnmpResult<SnmpValue> {
        let response = self.get(target, &[oid.to_string()]).await?;
        response
            .first_value()
            .cloned()
            .ok_or_else(|| SnmpError::no_such_object(format!("No value for OID {}", oid)))
    }

    /// GET a single OID and return as string.
    pub async fn get_string(&self, target: &SnmpTarget, oid: &str) -> SnmpResult<String> {
        let value = self.get_value(target, oid).await?;
        Ok(value.display_value())
    }

    /// Perform SNMPv3 engine discovery.
    pub async fn discover_engine(&self, target: &SnmpTarget) -> SnmpResult<EngineInfo> {
        let msg_id = self.next_id();
        let discovery_msg = UsmProcessor::build_discovery_message(msg_id)?;
        let resp_bytes = self.send_recv(target, &discovery_msg).await?;

        // Parse the response to extract engine parameters
        // For now return a placeholder — full v3 parsing would decode the USM params
        let _ = resp_bytes;
        Ok(EngineInfo {
            engine_id: String::new(),
            engine_boots: 0,
            engine_time: 0,
            max_message_size: 65507,
        })
    }
}
