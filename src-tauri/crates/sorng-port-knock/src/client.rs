use chrono::Utc;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::*;

const MAX_HOST_LENGTH: usize = 253;
const MAX_SOCKET_ADDRESSES: usize = 16;
const MAX_NETWORK_TIMEOUT_MS: u64 = 30_000;

/// Validate renderer-provided hosts before DNS resolution or command generation.
pub fn validate_host(host: &str) -> Result<(), PortKnockError> {
    if host.is_empty() || host.len() > MAX_HOST_LENGTH || host.trim() != host {
        return Err(PortKnockError::ConfigError(
            "Host is empty, too long, or contains surrounding whitespace".to_string(),
        ));
    }

    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if unbracketed.parse::<IpAddr>().is_ok() {
        return Ok(());
    }

    if host.starts_with('[')
        || host.ends_with(']')
        || host.ends_with('.')
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err(PortKnockError::ConfigError(
            "Host must be a canonical IP address or DNS hostname".to_string(),
        ));
    }
    Ok(())
}

/// Validate renderer-provided network ports before use.
pub fn validate_port(port: u16) -> Result<(), PortKnockError> {
    if port == 0 {
        return Err(PortKnockError::ConfigError(
            "Port must be between 1 and 65535".to_string(),
        ));
    }
    Ok(())
}

fn resolve_target(host: &str, port: u16) -> Result<Vec<SocketAddr>, PortKnockError> {
    validate_host(host)?;
    validate_port(port)?;
    let lookup_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let addresses: Vec<_> = (lookup_host, port)
        .to_socket_addrs()
        .map_err(|error| PortKnockError::IoError(format!("Host resolution failed: {error}")))?
        .take(MAX_SOCKET_ADDRESSES)
        .collect();
    if addresses.is_empty() {
        return Err(PortKnockError::IoError(
            "Host resolution returned no addresses".to_string(),
        ));
    }
    Ok(addresses)
}

fn bounded_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms.clamp(1, MAX_NETWORK_TIMEOUT_MS))
}

fn connect_tcp(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, PortKnockError> {
    let addresses = resolve_target(host, port)?;
    let started = Instant::now();
    let mut last_error = None;
    for address in addresses {
        let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
            break;
        };
        match TcpStream::connect_timeout(&address, remaining) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(PortKnockError::IoError(format!(
        "TCP connection failed: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "operation timed out".to_string())
    )))
}

fn send_tcp_knock(host: &str, port: u16, timeout: Duration) -> Result<(), PortKnockError> {
    let address = resolve_target(host, port)?
        .into_iter()
        .next()
        .ok_or_else(|| PortKnockError::IoError("No target address available".to_string()))?;
    match TcpStream::connect_timeout(&address, timeout) {
        Ok(_) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::TimedOut
                    | std::io::ErrorKind::WouldBlock
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(PortKnockError::IoError(format!(
            "TCP knock could not be sent: {error}"
        ))),
    }
}

fn send_udp_knock(host: &str, port: u16, timeout: Duration) -> Result<(), PortKnockError> {
    let address = resolve_target(host, port)?
        .into_iter()
        .next()
        .ok_or_else(|| PortKnockError::IoError("No target address available".to_string()))?;
    let bind_address = if address.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let socket = UdpSocket::bind(bind_address)
        .map_err(|error| PortKnockError::IoError(format!("UDP bind failed: {error}")))?;
    socket
        .set_write_timeout(Some(timeout))
        .map_err(|error| PortKnockError::IoError(format!("UDP timeout setup failed: {error}")))?;
    socket
        .connect(address)
        .map_err(|error| PortKnockError::IoError(format!("UDP connect failed: {error}")))?;
    socket
        .send(&[])
        .map_err(|error| PortKnockError::IoError(format!("UDP knock failed: {error}")))?;
    Ok(())
}

/// Port knock client that sends bounded TCP/UDP packets without a command shell.
pub struct KnockClient {
    /// Default timeout for individual knock steps in milliseconds.
    pub default_step_timeout_ms: u64,
    /// Default timeout for port verification in milliseconds.
    pub default_verify_timeout_ms: u64,
}

impl KnockClient {
    pub fn new() -> Self {
        Self {
            default_step_timeout_ms: 2000,
            default_verify_timeout_ms: 5000,
        }
    }

    /// Execute a full knock sequence against a host, processing each step in order
    /// and recording timing information for every step.
    pub fn execute_knock(
        &self,
        host: &str,
        sequence: &KnockSequence,
        options: &KnockOptions,
    ) -> Result<KnockResult, PortKnockError> {
        validate_host(host)?;

        info!(
            "Executing knock sequence '{}' ({} steps) against {}",
            sequence.name,
            sequence.steps.len(),
            host
        );

        let start = std::time::Instant::now();
        let knock_id = Uuid::new_v4().to_string();
        let mut step_results: Vec<KnockStepResult> = Vec::new();
        let mut all_succeeded = true;

        for (idx, step) in sequence.steps.iter().enumerate() {
            debug!(
                "Knock step {}/{}: port {} ({})",
                idx + 1,
                sequence.steps.len(),
                step.port,
                step.protocol
            );

            let step_result = self.execute_knock_step(host, step)?;

            if !step_result.success {
                warn!(
                    "Knock step {} failed for {}:{} ({})",
                    idx + 1,
                    host,
                    step.port,
                    step_result.error.as_deref().unwrap_or("unknown")
                );
                all_succeeded = false;
            }

            step_results.push(step_result);

            // Apply inter-knock delay if configured and not the last step
            if step.delay_after_ms > 0 && idx < sequence.steps.len() - 1 {
                debug!("Waiting {}ms before next knock step", step.delay_after_ms);
                std::thread::sleep(std::time::Duration::from_millis(step.delay_after_ms));
            }
        }

        let total_elapsed_ms = start.elapsed().as_millis() as u64;

        // Optionally verify the target port opened
        let target_port_opened = if options.verify_after_knock && all_succeeded {
            let mut opened = false;
            for attempt in 0..options.verify_retries.max(1) {
                if attempt > 0 {
                    debug!(
                        "Verification retry {}/{} for {}:{}",
                        attempt + 1,
                        options.verify_retries,
                        host,
                        sequence.target_port
                    );
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }

                opened = self.verify_port(
                    host,
                    sequence.target_port,
                    sequence.target_protocol,
                    options.verify_timeout_ms,
                );

                if opened {
                    break;
                }
            }
            opened
        } else {
            false
        };

        let status = if !all_succeeded {
            let success_count = step_results.iter().filter(|r| r.success).count();
            if success_count == 0 {
                KnockStatus::Failed
            } else {
                KnockStatus::PartialSuccess
            }
        } else if options.verify_after_knock && !target_port_opened {
            KnockStatus::Failed
        } else {
            KnockStatus::Success
        };

        info!(
            "Knock sequence '{}' against {} completed: {:?} ({}ms)",
            sequence.name, host, status, total_elapsed_ms
        );

        Ok(KnockResult {
            id: knock_id,
            host: host.to_string(),
            sequence_id: sequence.id.clone(),
            status,
            step_results,
            target_port_opened,
            total_elapsed_ms,
            attempt_number: 1,
            timestamp: Utc::now(),
            error: None,
        })
    }

    /// Execute a single bounded TCP SYN or UDP knock without invoking a shell.
    pub fn execute_knock_step(
        &self,
        host: &str,
        step: &KnockStep,
    ) -> Result<KnockStepResult, PortKnockError> {
        validate_host(host)?;
        validate_port(step.port)?;
        let start = std::time::Instant::now();
        let timeout = bounded_timeout(self.default_step_timeout_ms);
        let attempt = match step.protocol {
            KnockProtocol::Tcp => send_tcp_knock(host, step.port, timeout),
            KnockProtocol::Udp => send_udp_knock(host, step.port, timeout),
        };

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let success = attempt.is_ok();
        let error = attempt.err().map(|error| error.to_string());

        Ok(KnockStepResult {
            step_index: 0, // caller should set the correct index contextually
            port: step.port,
            protocol: step.protocol,
            success,
            elapsed_ms,
            error,
        })
    }

    /// Verify whether a port is open on a host after knocking.
    pub fn verify_port(
        &self,
        host: &str,
        port: u16,
        protocol: KnockProtocol,
        timeout_ms: u64,
    ) -> bool {
        if validate_host(host).is_err() {
            warn!("Port verification rejected: invalid host '{}'", host);
            return false;
        }
        let timeout = bounded_timeout(timeout_ms);
        let is_open = match protocol {
            KnockProtocol::Tcp => connect_tcp(host, port, timeout).is_ok(),
            KnockProtocol::Udp => send_udp_knock(host, port, timeout).is_ok(),
        };
        debug!(
            "Port verification {}:{} ({}): {}",
            host,
            port,
            protocol,
            if is_open { "OPEN" } else { "CLOSED" }
        );
        is_open
    }

    /// Perform a full port scan returning detailed results including banner grab.
    pub fn scan_port(
        &self,
        host: &str,
        port: u16,
        protocol: KnockProtocol,
    ) -> Result<PortScanResult, PortKnockError> {
        validate_host(host)?;
        validate_port(port)?;
        let start = std::time::Instant::now();
        let (state, mut tcp_stream) = match protocol {
            KnockProtocol::Tcp => match connect_tcp(host, port, bounded_timeout(5_000)) {
                Ok(stream) => (PortState::Open, Some(stream)),
                Err(_) => (PortState::Closed, None),
            },
            KnockProtocol::Udp => match send_udp_knock(host, port, bounded_timeout(2_000)) {
                Ok(()) => (PortState::Open, None),
                Err(_) => (PortState::Filtered, None),
            },
        };

        // Banner grab for open TCP ports
        let banner = if state == PortState::Open && protocol == KnockProtocol::Tcp {
            tcp_stream.as_mut().and_then(|stream| {
                let _ = stream.set_read_timeout(Some(bounded_timeout(3_000)));
                let mut bytes = [0_u8; 256];
                let read = stream.read(&mut bytes).ok()?;
                let text = String::from_utf8_lossy(&bytes[..read]).trim().to_string();
                (!text.is_empty()).then_some(text)
            })
        } else {
            None
        };

        let elapsed_ms = start.elapsed().as_millis() as u64;

        Ok(PortScanResult {
            host: host.to_string(),
            port,
            protocol,
            state,
            banner,
            elapsed_ms,
            timestamp: Utc::now(),
        })
    }

    /// Verify a knock by checking the port state before and after a knock sequence
    /// would have been executed. This only captures the state; the caller is
    /// responsible for executing the knock between calls.
    pub fn verify_knock(
        &self,
        host: &str,
        port: u16,
        protocol: KnockProtocol,
    ) -> Result<KnockVerification, PortKnockError> {
        let start = std::time::Instant::now();

        // Check current port state (before knock)
        let before_scan = self.scan_port(host, port, protocol)?;
        let before_knock = before_scan.state;

        // Brief pause to allow any firewall state transitions
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Check port state again (after knock)
        let after_scan = self.scan_port(host, port, protocol)?;
        let after_knock = after_scan.state;

        let port_opened = before_knock != PortState::Open && after_knock == PortState::Open;
        let elapsed_ms = start.elapsed().as_millis() as u64;

        Ok(KnockVerification {
            host: host.to_string(),
            port,
            before_knock,
            after_knock,
            port_opened,
            banner: after_scan.banner,
            elapsed_ms,
            timestamp: Utc::now(),
        })
    }

    /// Execute a knock sequence against multiple hosts, optionally in parallel.
    pub fn bulk_knock(
        &self,
        request: &BulkKnockRequest,
        hosts_map: &HashMap<String, KnockSequence>,
    ) -> Result<BulkKnockResult, PortKnockError> {
        let start = std::time::Instant::now();
        let total_hosts = request.hosts.len() as u32;
        let mut results: Vec<KnockResult> = Vec::new();

        if request.parallel {
            std::thread::scope(|s| {
                let mut handles = Vec::new();

                for host in &request.hosts {
                    let sequence = match hosts_map.get(host) {
                        Some(seq) => seq.clone(),
                        None => {
                            results.push(KnockResult {
                                id: Uuid::new_v4().to_string(),
                                host: host.clone(),
                                sequence_id: String::new(),
                                status: KnockStatus::Failed,
                                step_results: Vec::new(),
                                target_port_opened: false,
                                total_elapsed_ms: 0,
                                attempt_number: 1,
                                timestamp: Utc::now(),
                                error: Some(format!("No sequence found for host {}", host)),
                            });
                            continue;
                        }
                    };

                    let host = host.clone();
                    let options = request.options.clone();

                    handles.push(s.spawn(move || {
                        let client = KnockClient::new();
                        client.execute_knock(&host, &sequence, &options)
                    }));
                }

                for handle in handles {
                    match handle.join() {
                        Ok(Ok(result)) => results.push(result),
                        Ok(Err(e)) => {
                            error!("Bulk knock task failed: {}", e);
                            results.push(KnockResult {
                                id: Uuid::new_v4().to_string(),
                                host: String::new(),
                                sequence_id: String::new(),
                                status: KnockStatus::Failed,
                                step_results: Vec::new(),
                                target_port_opened: false,
                                total_elapsed_ms: 0,
                                attempt_number: 1,
                                timestamp: Utc::now(),
                                error: Some(e.to_string()),
                            });
                        }
                        Err(_) => {
                            error!("Bulk knock task panicked");
                            results.push(KnockResult {
                                id: Uuid::new_v4().to_string(),
                                host: String::new(),
                                sequence_id: String::new(),
                                status: KnockStatus::Failed,
                                step_results: Vec::new(),
                                target_port_opened: false,
                                total_elapsed_ms: 0,
                                attempt_number: 1,
                                timestamp: Utc::now(),
                                error: Some("Task panicked".to_string()),
                            });
                        }
                    }
                }
            });
        } else {
            // Sequential execution
            for host in &request.hosts {
                let sequence = match hosts_map.get(host) {
                    Some(seq) => seq,
                    None => {
                        results.push(KnockResult {
                            id: Uuid::new_v4().to_string(),
                            host: host.clone(),
                            sequence_id: String::new(),
                            status: KnockStatus::Failed,
                            step_results: Vec::new(),
                            target_port_opened: false,
                            total_elapsed_ms: 0,
                            attempt_number: 1,
                            timestamp: Utc::now(),
                            error: Some(format!("No sequence found for host {}", host)),
                        });
                        continue;
                    }
                };

                match self.execute_knock(host, sequence, &request.options) {
                    Ok(result) => results.push(result),
                    Err(e) => {
                        error!("Knock failed for {}: {}", host, e);
                        results.push(KnockResult {
                            id: Uuid::new_v4().to_string(),
                            host: host.clone(),
                            sequence_id: String::new(),
                            status: KnockStatus::Failed,
                            step_results: Vec::new(),
                            target_port_opened: false,
                            total_elapsed_ms: 0,
                            attempt_number: 1,
                            timestamp: Utc::now(),
                            error: Some(e.to_string()),
                        });
                    }
                }
            }
        }

        let successful = results
            .iter()
            .filter(|r| r.status == KnockStatus::Success)
            .count() as u32;
        let failed = total_hosts - successful;
        let total_elapsed_ms = start.elapsed().as_millis() as u64;

        info!(
            "Bulk knock completed: {}/{} successful ({}ms)",
            successful, total_hosts, total_elapsed_ms
        );

        Ok(BulkKnockResult {
            results,
            total_hosts,
            successful,
            failed,
            total_elapsed_ms,
        })
    }
}

impl Default for KnockClient {
    fn default() -> Self {
        Self::new()
    }
}
