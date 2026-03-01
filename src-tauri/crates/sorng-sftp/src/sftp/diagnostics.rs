// ── SFTP connection diagnostics ──────────────────────────────────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use std::time::Instant;

impl SftpService {
    /// Run a comprehensive diagnostic against an existing session.
    pub async fn diagnose(
        &mut self,
        session_id: &str,
    ) -> Result<SftpDiagnosticReport, String> {
        let mut steps: Vec<SftpDiagnosticStep> = Vec::new();

        // 1. Session liveness
        let t = Instant::now();
        let alive = self.ping(session_id).await.unwrap_or(false);
        steps.push(SftpDiagnosticStep {
            name: "Session keepalive".into(),
            passed: alive,
            message: if alive {
                "Session is alive".into()
            } else {
                "Session appears disconnected".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        if !alive {
            let info = self
                .sessions
                .get(session_id)
                .map(|h| h.info.clone())
                .ok_or("Session not found")?;
            return Ok(SftpDiagnosticReport {
                session_id: session_id.to_string(),
                host: info.host,
                protocol_version: String::new(),
                server_extensions: Vec::new(),
                max_packet_size: 0,
                latency_ms: steps[0].duration_ms,
                throughput_test: None,
                steps,
            });
        }

        // 2. SFTP channel open
        let t = Instant::now();
        let sftp_ok = {
            let res = self.sftp_channel(session_id);
            res.is_ok()
        };
        steps.push(SftpDiagnosticStep {
            name: "Open SFTP channel".into(),
            passed: sftp_ok,
            message: if sftp_ok {
                "SFTP subsystem available".into()
            } else {
                "Failed to open SFTP subsystem".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        // 3. Realpath test
        let t = Instant::now();
        let realpath_ok = self.realpath(session_id, ".").await.is_ok();
        steps.push(SftpDiagnosticStep {
            name: "Realpath resolution".into(),
            passed: realpath_ok,
            message: if realpath_ok {
                "Path resolution works".into()
            } else {
                "realpath(\".\") failed".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        // 4. Directory listing
        let t = Instant::now();
        let list_ok = {
            let opts = SftpListOptions {
                include_hidden: false,
                sort_by: SftpSortField::Name,
                ascending: true,
                filter_glob: None,
                filter_type: None,
                recursive: false,
                max_depth: None,
            };
            self.list_directory(session_id, ".", opts).await.is_ok()
        };
        steps.push(SftpDiagnosticStep {
            name: "Directory listing".into(),
            passed: list_ok,
            message: if list_ok {
                "readdir works".into()
            } else {
                "Failed to list directory".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        // 5. Write + read test (small temp file)
        let test_path = "/tmp/.sorng_sftp_diag_test";
        let test_data = "sorng-sftp-diagnostic-probe";

        let t = Instant::now();
        let write_ok = self
            .write_text_file(session_id, test_path, test_data)
            .await
            .is_ok();
        steps.push(SftpDiagnosticStep {
            name: "Write test file".into(),
            passed: write_ok,
            message: if write_ok {
                "Write succeeded".into()
            } else {
                "Write failed (permission issue?)".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        if write_ok {
            let t = Instant::now();
            let read_result = self
                .read_text_file(session_id, test_path, Some(1024))
                .await;
            let read_ok = read_result
                .as_ref()
                .map(|s| s == test_data)
                .unwrap_or(false);
            steps.push(SftpDiagnosticStep {
                name: "Read test file".into(),
                passed: read_ok,
                message: if read_ok {
                    "Read-back matches".into()
                } else {
                    "Read-back mismatch or error".into()
                },
                duration_ms: t.elapsed().as_secs_f64() * 1000.0,
            });

            // Cleanup
            let _ = self.delete_file(session_id, test_path).await;
        }

        // 6. Stat test
        let t = Instant::now();
        let stat_ok = self.stat(session_id, "/").await.is_ok();
        steps.push(SftpDiagnosticStep {
            name: "Stat root".into(),
            passed: stat_ok,
            message: if stat_ok {
                "stat(\"/\") OK".into()
            } else {
                "stat(\"/\") failed".into()
            },
            duration_ms: t.elapsed().as_secs_f64() * 1000.0,
        });

        // 7. Throughput test (optional, 64 KiB)
        let throughput = self.throughput_test(session_id, 65536).await.ok();

        // Compute latency as average step time
        let latency = if !steps.is_empty() {
            steps.iter().map(|s| s.duration_ms).sum::<f64>() / steps.len() as f64
        } else {
            0.0
        };

        let info = self
            .sessions
            .get(session_id)
            .map(|h| h.info.clone())
            .ok_or("Session not found")?;

        Ok(SftpDiagnosticReport {
            session_id: session_id.to_string(),
            host: info.host,
            protocol_version: "SFTP v3 (ssh2)".to_string(),
            server_extensions: Vec::new(),
            max_packet_size: 34000, // ssh2 default
            latency_ms: latency,
            throughput_test: throughput,
            steps,
        })
    }

    /// Quick throughput benchmark: upload + download N bytes.
    async fn throughput_test(
        &mut self,
        session_id: &str,
        size: u64,
    ) -> Result<ThroughputResult, String> {
        let data: String = "X".repeat(size as usize);
        let path = "/tmp/.sorng_sftp_throughput_test";

        // Upload
        let t = Instant::now();
        self.write_text_file(session_id, path, &data).await?;
        let upload_elapsed = t.elapsed().as_secs_f64();
        let upload_bps = if upload_elapsed > 0.0 {
            size as f64 / upload_elapsed
        } else {
            0.0
        };

        // Download
        let t = Instant::now();
        self.read_text_file(session_id, path, Some(size + 1024))
            .await?;
        let download_elapsed = t.elapsed().as_secs_f64();
        let download_bps = if download_elapsed > 0.0 {
            size as f64 / download_elapsed
        } else {
            0.0
        };

        // Cleanup
        let _ = self.delete_file(session_id, path).await;

        Ok(ThroughputResult {
            upload_bps,
            download_bps,
            test_size_bytes: size,
        })
    }
}
