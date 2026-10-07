//! Explicit, bounded, read-only diagnostics. No probe starts during discovery/UI mount.
mod dns;
mod local;
mod protocols;
mod system;
pub mod types;
mod web;

use futures::future::{AbortHandle, Abortable};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    process::Stdio,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
pub use types::{ToolkitReport, ToolkitRequest};

pub const TOOLS: &[&str] = &[
    "ping",
    "traceroute",
    "dns",
    "pingSweep",
    "interfaces",
    "iperf",
    "whois",
    "rdap",
    "tls",
    "ipCalculator",
    "portCheck",
    "bonjour",
    "smtp",
    "reverseIp",
    "rbl",
    "http",
    "publicIp",
    "hash",
    "dnsPropagation",
    "dnsBlocklist",
    "ntp",
    "website",
    "netstat",
    "routes",
    "arp",
    "dhcp",
];
const OUTPUT_LIMIT: usize = 512 * 1024;
static JOBS: OnceLock<Mutex<HashMap<String, AbortHandle>>> = OnceLock::new();
static EARLY_CANCELS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, AbortHandle>> {
    JOBS.get_or_init(Mutex::default)
}
struct JobGuard(String);
impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = jobs().lock() {
            jobs.remove(&self.0);
        }
    }
}

pub fn validate_host(host: &str) -> Result<(), String> {
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if host.is_empty()
        || host.len() > 253
        || host.starts_with('-')
        || !host.trim_end_matches('.').split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return Err(
            "Enter a hostname or IP address, without a URL, credentials or command options.".into(),
        );
    }
    Ok(())
}

pub async fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    validate_host(host)?;
    if port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    let addresses: Vec<_> = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| "Host resolution timed out")?
    .map_err(|e| format!("Host resolution failed: {e}"))?
    .take(16)
    .collect();
    if addresses.is_empty() {
        return Err("Host resolution returned no addresses".into());
    }
    Ok(addresses)
}

async fn read_bounded(
    reader: &mut (impl AsyncRead + Unpin),
    output: &mut Vec<u8>,
) -> Result<(), String> {
    let mut chunk = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Tool output could not be read: {e}"))?;
        if count == 0 {
            return Ok(());
        }
        if output.len() + count > OUTPUT_LIMIT {
            return Err("Tool output exceeded the 512 KiB limit; narrow the request.".into());
        }
        output.extend_from_slice(&chunk[..count]);
    }
}

/// Never invokes a shell; cancelling/dropping this future terminates its child.
/// Deadline output is retained for bounded continuous tools such as DNS-SD.
pub async fn run_command(program: &str, args: &[String], timeout_ms: u64) -> Result<Value, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        format!("{program} is not installed or not on PATH. Install it on this computer to use this tool.")
    } else { format!("Could not start {program}: {e}") })?;
    let mut stdout = child.stdout.take().ok_or("Tool stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Tool stderr unavailable")?;
    let mut out = Vec::new();
    let mut err = Vec::new();
    let outcome = tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        let (_, _, status) = tokio::try_join!(
            read_bounded(&mut stdout, &mut out),
            read_bounded(&mut stderr, &mut err),
            async {
                child
                    .wait()
                    .await
                    .map_err(|e| format!("Tool process failed: {e}"))
            }
        )?;
        Ok::<_, String>(status)
    })
    .await;
    let (code, timed_out) = match outcome {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(error)) => {
            let _ = child.kill().await;
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill().await;
            (None, true)
        }
    };
    Ok(
        json!({"program": program, "exitCode": code, "timedOut": timed_out,
        "stdout": String::from_utf8_lossy(&out), "stderr": String::from_utf8_lossy(&err)}),
    )
}

fn validate(request: &ToolkitRequest) -> Result<(), String> {
    if request.job_id.len() > 80
        || request.job_id.is_empty()
        || !request
            .job_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid diagnostic job identifier".into());
    }
    if !TOOLS.contains(&request.tool.as_str()) {
        return Err("Unknown network tool".into());
    }
    if !(500..=60_000).contains(&request.timeout_ms) {
        return Err("Timeout must be between 500 and 60000 ms".into());
    }
    if request.target.len() > 1024 * 1024
        || request.options.len() > 24
        || request
            .options
            .iter()
            .any(|(k, v)| k.len() > 64 || v.len() > 4096)
    {
        return Err("Diagnostic input exceeds its size limit".into());
    }
    if !matches!(request.route.as_str(), "direct" | "httpProxy") {
        return Err("Choose an explicit network route".into());
    }
    if request.route == "httpProxy"
        && !matches!(
            request.tool.as_str(),
            "rdap" | "http" | "publicIp" | "website" | "tls"
        )
    {
        return Err("This protocol cannot use an HTTP proxy. Choose direct/local networking explicitly; no fallback was attempted.".into());
    }
    if request.route == "direct" && request.proxy_url.as_deref().is_some_and(|s| !s.is_empty()) {
        return Err("A proxy address cannot be combined with the direct route".into());
    }
    if request.proxy_url.as_ref().is_some_and(|s| s.len() > 2048) {
        return Err("Proxy address is too long".into());
    }
    Ok(())
}

pub fn cancel(job_id: &str) -> Result<bool, String> {
    if job_id.len() > 80
        || job_id.is_empty()
        || !job_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid diagnostic job identifier".into());
    }
    let jobs = jobs()
        .lock()
        .map_err(|_| "Diagnostic job registry is unavailable")?;
    if let Some(handle) = jobs.get(job_id) {
        handle.abort();
        Ok(true)
    } else {
        // IPC commands can be scheduled out of order. Do not start a probe if
        // its cancellation arrived just before registration.
        let mut cancelled = EARLY_CANCELS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| "Cancellation registry unavailable")?;
        cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(90));
        if cancelled.len() >= 256 {
            if let Some(oldest) = cancelled
                .iter()
                .min_by_key(|(_, at)| *at)
                .map(|(id, _)| id.clone())
            {
                cancelled.remove(&oldest);
            }
        }
        cancelled.insert(job_id.into(), Instant::now());
        Ok(false)
    }
}

pub async fn run(request: ToolkitRequest) -> Result<ToolkitReport, String> {
    validate(&request)?;
    let (handle, registration) = AbortHandle::new_pair();
    {
        let mut jobs = jobs()
            .lock()
            .map_err(|_| "Diagnostic job registry is unavailable")?;
        let mut cancelled = EARLY_CANCELS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| "Cancellation registry unavailable")?;
        cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(90));
        if cancelled.remove(&request.job_id).is_some() {
            return Err("Diagnostic cancelled".into());
        }
        if jobs.contains_key(&request.job_id) {
            return Err("This diagnostic job is already running".into());
        }
        if jobs.len() >= 4 {
            return Err(
                "Four diagnostics are already running. Stop one or wait for it to finish.".into(),
            );
        }
        jobs.insert(request.job_id.clone(), handle);
    }
    let _guard = JobGuard(request.job_id.clone());
    let started_at = chrono::Utc::now().to_rfc3339();
    let start = Instant::now();
    let task = async {
        match request.tool.as_str() {
            "hash" | "ipCalculator" => local::run(&request),
            "ping" | "traceroute" | "pingSweep" | "interfaces" | "iperf" | "bonjour"
            | "netstat" | "routes" | "arp" => system::run(&request).await,
            "portCheck" | "smtp" | "ntp" | "dhcp" => protocols::run(&request).await,
            "dns" | "dnsPropagation" | "reverseIp" | "rbl" | "dnsBlocklist" => {
                dns::run(&request).await
            }
            _ => web::run(&request).await,
        }
    };
    let data = Abortable::new(
        tokio::time::timeout(Duration::from_secs(90), task),
        registration,
    )
    .await
    .map_err(|_| "Diagnostic cancelled")?
    .map_err(|_| "Diagnostic exceeded the 90-second total limit")??;
    Ok(ToolkitReport {
        job_id: request.job_id,
        tool: request.tool,
        started_at,
        duration_ms: start.elapsed().as_millis() as u64,
        route: request.route,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_flags_and_urls() {
        for value in [
            "-n",
            "x;echo",
            "a b",
            "https://host",
            "user@host",
            "a\nb",
            ".",
            "host/thing",
        ] {
            assert!(validate_host(value).is_err(), "{value}");
        }
        for value in [
            "localhost",
            "example.org.",
            "127.0.0.1",
            "::1",
            "2001:db8::1",
        ] {
            assert!(validate_host(value).is_ok());
        }
    }
    #[test]
    fn bounds_and_no_route_fallback() {
        let mut request = ToolkitRequest {
            job_id: "test-job".into(),
            tool: "ping".into(),
            target: "localhost".into(),
            timeout_ms: 5000,
            route: "httpProxy".into(),
            proxy_url: Some("http://localhost:8080".into()),
            options: Default::default(),
        };
        assert!(validate(&request).unwrap_err().contains("no fallback"));
        request.route = "direct".into();
        assert!(validate(&request).is_err());
        request.proxy_url = None;
        assert!(validate(&request).is_ok());
        request.timeout_ms = 0;
        assert!(validate(&request).is_err());
        request.timeout_ms = 5000;
        request.tool = "unknown".into();
        assert!(validate(&request).is_err());
    }
    #[tokio::test]
    async fn cancellation_before_registration_prevents_work() {
        let job_id = uuid::Uuid::new_v4().to_string();
        assert!(!cancel(&job_id).unwrap());
        let request = ToolkitRequest {
            job_id,
            tool: "hash".into(),
            target: "do not run".into(),
            timeout_ms: 5000,
            route: "direct".into(),
            proxy_url: None,
            options: Default::default(),
        };
        assert_eq!(run(request).await.unwrap_err(), "Diagnostic cancelled");
    }
    #[tokio::test]
    async fn output_reader_enforces_byte_budget() {
        let bytes = vec![b'x'; OUTPUT_LIMIT + 1];
        let mut input = bytes.as_slice();
        let mut output = Vec::new();
        assert!(read_bounded(&mut input, &mut output).await.is_err());
        assert!(output.len() <= OUTPUT_LIMIT);
    }
}
