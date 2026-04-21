// ── ClamAV scan management ───────────────────────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::{ClamavError, ClamavResult};
use crate::types::*;

pub struct ScanManager;

impl ScanManager {
    /// Full scan with options from ScanRequest.
    pub async fn scan(client: &ClamavClient, req: &ScanRequest) -> ClamavResult<ScanSummary> {
        let mut args = Vec::new();
        if req.recursive.unwrap_or(true) {
            args.push("-r".to_string());
        }
        for pat in &req.exclude_patterns {
            args.push(format!("--exclude={}", shell_escape(pat)));
        }
        if let Some(max_fs) = req.max_filesize_mb {
            args.push(format!("--max-filesize={}M", max_fs));
        }
        if let Some(max_ss) = req.max_scansize_mb {
            args.push(format!("--max-scansize={}M", max_ss));
        }
        if let Some(max_f) = req.max_files {
            args.push(format!("--max-files={}", max_f));
        }
        args.push("--stdout".to_string());
        args.push("--no-summary".to_string());

        let cmd = format!(
            "{} {} {} 2>&1; echo \"EXIT_CODE:$?\"",
            client.clamscan_bin(),
            args.join(" "),
            shell_escape(&req.path)
        );

        let out = client.exec_ssh(&cmd).await?;
        parse_scan_output(&out.stdout)
    }

    /// Quick scan of a single path (non-recursive).
    pub async fn quick_scan(client: &ClamavClient, path: &str) -> ClamavResult<ScanResult> {
        let cmd = format!(
            "{} --stdout --no-summary {} 2>&1; echo \"EXIT_CODE:$?\"",
            client.clamscan_bin(),
            shell_escape(path)
        );
        let out = client.exec_ssh(&cmd).await?;
        let summary = parse_scan_output(&out.stdout)?;
        summary
            .results
            .into_iter()
            .next()
            .ok_or_else(|| ClamavError::scan_error("No scan result returned"))
    }

    /// Stream-based scan via clamd INSTREAM protocol.
    pub async fn scan_stream(client: &ClamavClient, data: &str) -> ClamavResult<ScanResult> {
        let escaped = data.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | {} --stream --stdout --no-summary - 2>&1",
            escaped,
            client.clamdscan_bin()
        );
        let out = client.exec_ssh(&cmd).await?;
        let result_str = out.stdout.trim();
        if result_str.contains("FOUND") {
            let virus_name = result_str
                .split(':')
                .nth(1)
                .map(|s| s.trim().replace(" FOUND", ""))
                .unwrap_or_default();
            Ok(ScanResult {
                file_path: "stream".to_string(),
                result: "infected".to_string(),
                virus_name: Some(virus_name),
                scan_time_ms: 0,
                size_bytes: Some(data.len() as u64),
            })
        } else {
            Ok(ScanResult {
                file_path: "stream".to_string(),
                result: "clean".to_string(),
                virus_name: None,
                scan_time_ms: 0,
                size_bytes: Some(data.len() as u64),
            })
        }
    }

    /// Multiscan via clamdscan --multiscan for parallel scanning.
    pub async fn multiscan(client: &ClamavClient, path: &str) -> ClamavResult<ScanSummary> {
        let cmd = format!(
            "{} --multiscan --stdout --no-summary {} 2>&1; echo \"EXIT_CODE:$?\"",
            client.clamdscan_bin(),
            shell_escape(path)
        );
        let out = client.exec_ssh(&cmd).await?;
        parse_scan_output(&out.stdout)
    }

    /// Continuous scan via clamdscan --stream for directory.
    pub async fn contscan(client: &ClamavClient, path: &str) -> ClamavResult<ScanSummary> {
        let cmd = format!(
            "echo 'CONTSCAN {}' | socat - UNIX-CONNECT:{} 2>&1",
            shell_escape(path),
            shell_escape(client.clamd_socket())
        );
        let out = client.exec_ssh(&cmd).await?;
        parse_clamd_scan_output(&out.stdout)
    }

    /// Allmatchscan – report all matches, not just the first.
    pub async fn allmatchscan(client: &ClamavClient, path: &str) -> ClamavResult<ScanSummary> {
        let cmd = format!(
            "echo 'ALLMATCHSCAN {}' | socat - UNIX-CONNECT:{} 2>&1",
            shell_escape(path),
            shell_escape(client.clamd_socket())
        );
        let out = client.exec_ssh(&cmd).await?;
        parse_clamd_scan_output(&out.stdout)
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_scan_output(output: &str) -> ClamavResult<ScanSummary> {
    let mut results = Vec::new();
    let mut files_scanned: u64 = 0;
    let mut infected_files: u64 = 0;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("EXIT_CODE:") {
            continue;
        }
        if let Some((path_part, status_part)) = line.rsplit_once(':') {
            let status = status_part.trim();
            let file_path = path_part.trim().to_string();
            files_scanned += 1;

            if status == "OK" || status.contains("OK") {
                results.push(ScanResult {
                    file_path,
                    result: "clean".to_string(),
                    virus_name: None,
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            } else if status.contains("FOUND") {
                infected_files += 1;
                let virus_name = status.replace("FOUND", "").trim().to_string();
                results.push(ScanResult {
                    file_path,
                    result: "infected".to_string(),
                    virus_name: Some(virus_name),
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            } else if status.contains("ERROR") {
                results.push(ScanResult {
                    file_path,
                    result: "error".to_string(),
                    virus_name: None,
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            }
        }
    }

    Ok(ScanSummary {
        files_scanned,
        infected_files,
        data_scanned_mb: 0.0,
        scan_time_secs: 0.0,
        results,
    })
}

fn parse_clamd_scan_output(output: &str) -> ClamavResult<ScanSummary> {
    let mut results = Vec::new();
    let mut files_scanned: u64 = 0;
    let mut infected_files: u64 = 0;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((path_part, status_part)) = line.rsplit_once(':') {
            let status = status_part.trim();
            let file_path = path_part.trim().to_string();
            files_scanned += 1;

            if status == "OK" {
                results.push(ScanResult {
                    file_path,
                    result: "clean".to_string(),
                    virus_name: None,
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            } else if status.contains("FOUND") {
                infected_files += 1;
                let virus_name = status.replace("FOUND", "").trim().to_string();
                results.push(ScanResult {
                    file_path,
                    result: "infected".to_string(),
                    virus_name: Some(virus_name),
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            } else {
                results.push(ScanResult {
                    file_path,
                    result: "error".to_string(),
                    virus_name: None,
                    scan_time_ms: 0,
                    size_bytes: None,
                });
            }
        }
    }

    Ok(ScanSummary {
        files_scanned,
        infected_files,
        data_scanned_mb: 0.0,
        scan_time_secs: 0.0,
        results,
    })
}
