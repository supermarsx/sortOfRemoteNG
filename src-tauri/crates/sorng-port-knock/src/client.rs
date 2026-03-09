use chrono::Utc;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::*;

/// Port knock client that sends TCP/UDP knock packets via SSH command execution.
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

    /// Execute a single knock step by building and running an SSH command
    /// for either TCP SYN or UDP knock.
    pub fn execute_knock_step(
        &self,
        host: &str,
        step: &KnockStep,
    ) -> Result<KnockStepResult, PortKnockError> {
        let start = std::time::Instant::now();

        let cmd = self.build_knock_command(host, step);
        debug!("Knock command for {}:{}: {}", host, step.port, cmd);

        // Execute the knock command via subprocess
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(&cmd)
            .output()
            .map_err(|e| {
                PortKnockError::SshCommandFailed(format!("Failed to spawn knock command: {}", e))
            })?;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        // For knock packets, a connection-refused or timeout is expected — the important
        // thing is that the packet was sent. We only consider it a failure if the
        // command couldn't execute at all (e.g., bash not found).
        let success = output.status.code().is_some();
        let error = if !success {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Some(stderr.to_string())
        } else {
            None
        };

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
        let timeout_secs = (timeout_ms as f64 / 1000.0).ceil() as u64;

        let cmd = match protocol {
            KnockProtocol::Tcp => {
                format!(
                    "bash -c 'timeout {} bash -c \"echo > /dev/tcp/{}/{}\" 2>/dev/null && echo OPEN || echo CLOSED'",
                    timeout_secs, host, port
                )
            }
            KnockProtocol::Udp => {
                format!(
                    "bash -c 'echo \"\" | nc -u -w{} {} {} 2>/dev/null && echo OPEN || echo CLOSED'",
                    timeout_secs, host, port
                )
            }
        };

        debug!("Verify port command: {}", cmd);

        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(&cmd)
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let is_open = stdout.trim().contains("OPEN");
                debug!(
                    "Port verification {}:{} ({}): {}",
                    host,
                    port,
                    protocol,
                    if is_open { "OPEN" } else { "CLOSED" }
                );
                is_open
            }
            Err(e) => {
                warn!("Port verification failed for {}:{}: {}", host, port, e);
                false
            }
        }
    }

    /// Perform a full port scan returning detailed results including banner grab.
    pub fn scan_port(
        &self,
        host: &str,
        port: u16,
        protocol: KnockProtocol,
    ) -> Result<PortScanResult, PortKnockError> {
        let start = std::time::Instant::now();

        // First check if the port is open
        let state_cmd = match protocol {
            KnockProtocol::Tcp => {
                format!(
                    "bash -c 'timeout 5 bash -c \"echo > /dev/tcp/{}/{}\" 2>/dev/null && echo OPEN || echo CLOSED'",
                    host, port
                )
            }
            KnockProtocol::Udp => {
                format!(
                    "bash -c 'echo \"\" | nc -u -w2 {} {} 2>/dev/null && echo OPEN || echo CLOSED'",
                    host, port
                )
            }
        };

        let state_output = std::process::Command::new("bash")
            .arg("-c")
            .arg(&state_cmd)
            .output()
            .map_err(|e| PortKnockError::IoError(format!("Failed to run scan command: {}", e)))?;

        let stdout = String::from_utf8_lossy(&state_output.stdout);
        let state = if stdout.trim().contains("OPEN") {
            PortState::Open
        } else if state_output.status.success() {
            PortState::Closed
        } else {
            PortState::Filtered
        };

        // Banner grab for open TCP ports
        let banner = if state == PortState::Open && protocol == KnockProtocol::Tcp {
            let banner_cmd = format!(
                "bash -c 'echo \"\" | nc -w3 {} {} 2>/dev/null | head -c 256'",
                host, port
            );
            let banner_output = std::process::Command::new("bash")
                .arg("-c")
                .arg(&banner_cmd)
                .output()
                .ok();

            banner_output.and_then(|o| {
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b.is_empty() {
                    None
                } else {
                    Some(b)
                }
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

    // ─── Private helpers ───────────────────────────────────────────

    /// Build the shell command string for a single knock step.
    fn build_knock_command(&self, host: &str, step: &KnockStep) -> String {
        match step.protocol {
            KnockProtocol::Tcp => {
                // Use bash /dev/tcp for a lightweight TCP SYN knock
                // The timeout ensures we don't hang; connection-refused is expected.
                format!(
                    "timeout 2 bash -c 'echo \"\" > /dev/tcp/{}/{} 2>/dev/null' ; true",
                    host, step.port
                )
            }
            KnockProtocol::Udp => {
                // Use netcat for UDP knock
                format!(
                    "echo \"\" | nc -u -w1 {} {} 2>/dev/null ; true",
                    host, step.port
                )
            }
        }
    }
}

impl Default for KnockClient {
    fn default() -> Self {
        Self::new()
    }
}
