// ── sorng-php – PHP-FPM process/service control ─────────────────────────────

use crate::client::{shell_escape, PhpClient};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

pub struct ProcessManager;

impl ProcessManager {
    /// Get systemd service status for php{version}-fpm.
    pub async fn get_service_status(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<PhpFpmServiceStatus> {
        let svc = client.fpm_service_name(version);
        let cmd = format!(
            "systemctl show {} --no-pager --property=ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec,TasksCurrent,UnitFileState,ExecMainStartTimestampMonotonic 2>&1",
            shell_escape(&svc),
        );
        let out = client.exec_ssh(&cmd).await?;

        let mut active_state = None;
        let mut sub_state = None;
        let mut main_pid: Option<u32> = None;
        let mut memory_bytes: Option<u64> = None;
        let mut cpu_ns: Option<u64> = None;
        let mut tasks: Option<u32> = None;
        let mut unit_file_state = None;
        let mut uptime_mono: Option<u64> = None;

        for line in out.stdout.lines() {
            if let Some((key, val)) = line.split_once('=') {
                let val = val.trim();
                match key.trim() {
                    "ActiveState" => active_state = Some(val.to_string()),
                    "SubState" => sub_state = Some(val.to_string()),
                    "MainPID" => main_pid = val.parse().ok().filter(|&p: &u32| p > 0),
                    "MemoryCurrent" => memory_bytes = val.parse().ok().filter(|v| *v < u64::MAX),
                    "CPUUsageNSec" => cpu_ns = val.parse().ok(),
                    "TasksCurrent" => tasks = val.parse().ok().filter(|v| *v < u32::MAX),
                    "UnitFileState" => unit_file_state = Some(val.to_string()),
                    "ExecMainStartTimestampMonotonic" => {
                        uptime_mono = val.parse().ok().filter(|&v: &u64| v > 0)
                    }
                    _ => {}
                }
            }
        }

        let active = active_state.as_deref() == Some("active");
        let running = sub_state.as_deref() == Some("running");
        let enabled = unit_file_state.as_deref() == Some("enabled");

        // Convert CPU nanoseconds to a rough percentage (not meaningful without
        // a time window, but we store the raw value for the caller).
        let cpu_percent = cpu_ns.map(|ns| ns as f64 / 1_000_000_000.0);

        // Convert monotonic start timestamp (µs) to rough uptime seconds
        let uptime_secs = uptime_mono.and_then(|start_us| {
            if start_us == 0 {
                return None;
            }
            // Read system monotonic clock to compute elapsed time
            // We'll attempt a lightweight approach via /proc/uptime
            None // Populated below if we can get it
        });

        // Attempt to get uptime from systemctl (fallback)
        let uptime_secs = if running {
            let ts_out = client
                .exec_ssh(&format!(
                    "systemctl show {} --property=ActiveEnterTimestamp --value 2>/dev/null",
                    shell_escape(&svc),
                ))
                .await
                .ok();
            ts_out.and_then(|o| {
                let ts = o.stdout.trim().to_string();
                if ts.is_empty() {
                    return None;
                }
                // Parse timestamp and compute delta — simplified, return None
                // if we can't parse. The frontend can compute from timestamp.
                None
            })
        } else {
            uptime_secs
        };

        Ok(PhpFpmServiceStatus {
            version: version.to_string(),
            service_name: svc,
            active,
            running,
            enabled,
            pid: main_pid,
            main_pid,
            memory_bytes,
            cpu_percent,
            uptime_secs,
            tasks,
            active_state,
            sub_state,
        })
    }

    /// Start PHP-FPM service.
    pub async fn start(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl start {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::service(format!(
                "Failed to start {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Stop PHP-FPM service.
    pub async fn stop(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl stop {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::service(format!(
                "Failed to stop {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Restart PHP-FPM service.
    pub async fn restart(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl restart {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::service(format!(
                "Failed to restart {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Graceful reload via systemctl.
    pub async fn reload(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl reload {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::reload(format!(
                "Failed to reload {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Enable PHP-FPM service at boot.
    pub async fn enable(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl enable {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::service(format!(
                "Failed to enable {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Disable PHP-FPM service at boot.
    pub async fn disable(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let cmd = format!("sudo systemctl disable {}", shell_escape(&svc));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::service(format!(
                "Failed to disable {}: {}",
                svc, out.stderr
            )));
        }
        Ok(())
    }

    /// Test FPM configuration via `php-fpm{version} -t`.
    pub async fn test_config(client: &PhpClient, version: &str) -> PhpResult<ConfigTestResult> {
        let cmd = format!("php-fpm{} -t 2>&1", version);
        let out = client.exec_ssh(&cmd).await?;

        let errors: Vec<String> = out
            .stdout
            .lines()
            .chain(out.stderr.lines())
            .filter(|l| {
                let lower = l.to_lowercase();
                lower.contains("error") || lower.contains("failed")
            })
            .map(|l| l.to_string())
            .collect();

        Ok(ConfigTestResult {
            success: out.exit_code == 0,
            output: format!("{}{}", out.stdout, out.stderr),
            errors,
        })
    }

    /// Get FPM master process info (PID, memory, worker count).
    pub async fn get_master_process(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<PhpFpmMasterProcess> {
        let svc = client.fpm_service_name(version);

        // Get master PID from systemctl
        let pid_out = client
            .exec_ssh(&format!(
                "systemctl show {} --property=MainPID --value 2>/dev/null",
                shell_escape(&svc),
            ))
            .await?;
        let pid: u32 = pid_out
            .stdout
            .trim()
            .parse()
            .map_err(|_| PhpError::fpm_not_running(format!("{} not running", svc)))?;
        if pid == 0 {
            return Err(PhpError::fpm_not_running(format!("{} not running", svc)));
        }

        // Get memory RSS from /proc
        let mem_out = client
            .exec_ssh(&format!(
                "cat /proc/{}/status 2>/dev/null | grep VmRSS | awk '{{print $2}}'",
                pid,
            ))
            .await?;
        let memory_rss = mem_out
            .stdout
            .trim()
            .parse::<u64>()
            .ok()
            .map(|kb| kb * 1024);

        // Get config file from /proc cmdline
        let cmdline_out = client
            .exec_ssh(&format!(
                "cat /proc/{}/cmdline 2>/dev/null | tr '\\0' ' '",
                pid
            ))
            .await?;
        let config_file = cmdline_out
            .stdout
            .split_whitespace()
            .skip_while(|s| *s != "-y" && *s != "--fpm-config")
            .nth(1)
            .unwrap_or(&format!("/etc/php/{}/fpm/php-fpm.conf", version))
            .to_string();

        // Count worker processes
        let workers_out = client
            .exec_ssh(&format!("pgrep -P {} --count 2>/dev/null || echo 0", pid,))
            .await?;
        let worker_count: u32 = workers_out.stdout.trim().parse().unwrap_or(0);

        // Count pools by looking at pool.d directory
        let pool_dir = client.fpm_pool_dir(version);
        let pools_out = client
            .exec_ssh(&format!(
                "ls -1 {} 2>/dev/null | grep '\\.conf$' | wc -l",
                shell_escape(&pool_dir),
            ))
            .await?;
        let pool_count: u32 = pools_out.stdout.trim().parse().unwrap_or(0);

        // Get uptime from /proc/PID/stat
        let uptime_out = client
            .exec_ssh(&format!("ps -p {} -o etimes= 2>/dev/null || echo ''", pid,))
            .await?;
        let uptime_secs = uptime_out.stdout.trim().parse::<u64>().ok();

        Ok(PhpFpmMasterProcess {
            pid,
            version: version.to_string(),
            config_file,
            uptime_secs,
            memory_rss,
            worker_count,
            pool_count,
        })
    }

    /// List all FPM worker PIDs for a given version.
    pub async fn list_worker_pids(client: &PhpClient, version: &str) -> PhpResult<Vec<u32>> {
        let svc = client.fpm_service_name(version);

        // Get master PID
        let pid_out = client
            .exec_ssh(&format!(
                "systemctl show {} --property=MainPID --value 2>/dev/null",
                shell_escape(&svc),
            ))
            .await?;
        let master_pid: u32 = pid_out
            .stdout
            .trim()
            .parse()
            .map_err(|_| PhpError::fpm_not_running(format!("{} not running", svc)))?;
        if master_pid == 0 {
            return Err(PhpError::fpm_not_running(format!("{} not running", svc)));
        }

        // List child PIDs
        let out = client
            .exec_ssh(&format!("pgrep -P {} 2>/dev/null || true", master_pid))
            .await?;

        let pids: Vec<u32> = out
            .stdout
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect();

        Ok(pids)
    }

    /// Send USR2 signal to master process for graceful restart.
    pub async fn graceful_restart(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let pid_out = client
            .exec_ssh(&format!(
                "systemctl show {} --property=MainPID --value 2>/dev/null",
                shell_escape(&svc),
            ))
            .await?;
        let pid: u32 = pid_out
            .stdout
            .trim()
            .parse()
            .map_err(|_| PhpError::fpm_not_running(format!("{} not running", svc)))?;
        if pid == 0 {
            return Err(PhpError::fpm_not_running(format!("{} not running", svc)));
        }

        let out = client.exec_ssh(&format!("sudo kill -USR2 {}", pid)).await?;
        if out.exit_code != 0 {
            return Err(PhpError::process(format!(
                "Failed to send USR2 to PID {}: {}",
                pid, out.stderr
            )));
        }
        Ok(())
    }

    /// Send USR1 signal to master process to reopen log files.
    pub async fn reopen_logs(client: &PhpClient, version: &str) -> PhpResult<()> {
        let svc = client.fpm_service_name(version);
        let pid_out = client
            .exec_ssh(&format!(
                "systemctl show {} --property=MainPID --value 2>/dev/null",
                shell_escape(&svc),
            ))
            .await?;
        let pid: u32 = pid_out
            .stdout
            .trim()
            .parse()
            .map_err(|_| PhpError::fpm_not_running(format!("{} not running", svc)))?;
        if pid == 0 {
            return Err(PhpError::fpm_not_running(format!("{} not running", svc)));
        }

        let out = client.exec_ssh(&format!("sudo kill -USR1 {}", pid)).await?;
        if out.exit_code != 0 {
            return Err(PhpError::process(format!(
                "Failed to send USR1 to PID {}: {}",
                pid, out.stderr
            )));
        }
        Ok(())
    }

    /// List all installed php-fpm service versions and their statuses.
    pub async fn list_all_fpm_services(client: &PhpClient) -> PhpResult<Vec<PhpFpmServiceStatus>> {
        let out = client
            .exec_ssh(
                "systemctl list-unit-files --type=service --no-pager --no-legend 2>/dev/null | grep 'php.*fpm' || true",
            )
            .await?;

        let mut services = Vec::new();

        for line in out.stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }
            let service_file = parts[0];

            // Extract version from service name like "php8.3-fpm.service"
            let version = service_file
                .strip_prefix("php")
                .and_then(|s| s.strip_suffix("-fpm.service"))
                .unwrap_or_default();

            if version.is_empty() {
                continue;
            }

            match Self::get_service_status(client, version).await {
                Ok(status) => services.push(status),
                Err(_) => {
                    // Include a minimal entry for services we can't query
                    let enabled = parts.get(1).is_some_and(|s| *s == "enabled");
                    services.push(PhpFpmServiceStatus {
                        version: version.to_string(),
                        service_name: service_file
                            .strip_suffix(".service")
                            .unwrap_or(service_file)
                            .to_string(),
                        active: false,
                        running: false,
                        enabled,
                        pid: None,
                        main_pid: None,
                        memory_bytes: None,
                        cpu_percent: None,
                        uptime_secs: None,
                        tasks: None,
                        active_state: None,
                        sub_state: None,
                    });
                }
            }
        }

        Ok(services)
    }
}
