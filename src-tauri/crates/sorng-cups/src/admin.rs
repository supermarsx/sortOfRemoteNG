//! CUPS server administration — settings, logs, test pages, job cleanup.
//!
//! This module provides privileged server-level operations that typically
//! require admin credentials:
//!
//! - Reading and updating CUPS server settings (cupsd.conf directives)
//! - Fetching server log files (access, error, page)
//! - Printing a test page to a printer
//! - Cleaning up old completed/canceled jobs
//! - Querying subscription health status
//! - Restarting the CUPS scheduler

use crate::error::CupsError;
use crate::ipp::{self, op, tag};
use crate::types::*;
use chrono;

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Known cupsd.conf boolean directives that we map to the `CupsServerInfo`
/// fields.
#[allow(dead_code)]
const BOOL_SETTINGS: &[(&str, &str)] = &[
    ("share-printers", "Browsing"),
    ("remote-admin", "RemoteAdmin"),
    ("remote-any", "RemoteAny"),
    ("user-cancel-any", "UserCancelAny"),
    ("preserve-job-history", "PreserveJobHistory"),
    ("preserve-job-files", "PreserveJobFiles"),
];

/// Parse the CUPS admin HTTP API settings response into a `CupsServerInfo`.
#[allow(dead_code)]
fn parse_server_info(group: &ipp::IppAttributeGroup) -> CupsServerInfo {
    let bool_val = |name: &str| -> bool {
        group
            .get_string(name)
            .map(|v| v == "1" || v.eq_ignore_ascii_case("yes") || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    };

    CupsServerInfo {
        version: group.get_string("cups-version").map(String::from),
        default_auth_type: group.get_string("default-auth-type").map(String::from),
        default_encryption: group.get_string("default-encryption").map(String::from),
        share_printers: bool_val("share-printers"),
        remote_admin: bool_val("remote-admin"),
        remote_any: bool_val("remote-any"),
        user_cancel_any: bool_val("user-cancel-any"),
        log_level: group.get_string("log-level").map(String::from),
        max_clients: group.get_integer("max-clients").unwrap_or(100) as u32,
        max_jobs: group.get_integer("max-jobs").unwrap_or(500) as u32,
        preserve_job_history: bool_val("preserve-job-history"),
        preserve_job_files: bool_val("preserve-job-files"),
        server_name: group.get_string("server-name").map(String::from),
        default_paper_size: group.get_string("default-paper-size").map(String::from),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// Retrieve the current CUPS server settings.
///
/// Sends a CUPS-Get-Printer-Attributes on the admin URI with the
/// `server-settings` attribute group to fetch cupsd.conf directives.
pub async fn get_server_settings(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<CupsServerInfo, CupsError> {
    // CUPS exposes server settings through a GET on /admin/conf/cupsd.conf
    // or via a special IPP request. We use the HTTP admin API.
    let url = format!("{}/admin/conf/cupsd.conf", config.base_url());
    let mut req = client.get(&url);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let response = req.send().await.map_err(|e| {
        CupsError::connection_failed(format!("Failed to fetch server settings: {e}"))
    })?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CupsError::auth_failed(
            "Admin credentials required to read server settings",
        ));
    }

    if !response.status().is_success() {
        return Err(CupsError::server_error(format!(
            "HTTP {} fetching server settings",
            response.status()
        )));
    }

    let body = response
        .text()
        .await
        .map_err(|e| CupsError::parse_error(format!("Failed to read settings body: {e}")))?;

    // Parse the cupsd.conf key-value pairs.
    let info = parse_cupsd_conf(&body);
    Ok(info)
}

/// Parse cupsd.conf-style text into a `CupsServerInfo`.
fn parse_cupsd_conf(body: &str) -> CupsServerInfo {
    let mut info = CupsServerInfo {
        version: None,
        default_auth_type: None,
        default_encryption: None,
        share_printers: false,
        remote_admin: false,
        remote_any: false,
        user_cancel_any: false,
        log_level: None,
        max_clients: 100,
        max_jobs: 500,
        preserve_job_history: true,
        preserve_job_files: false,
        server_name: None,
        default_paper_size: None,
    };

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
        if parts.len() < 2 {
            continue;
        }
        let key = parts[0];
        let value = parts[1].trim();

        let is_yes =
            value.eq_ignore_ascii_case("yes") || value == "1" || value.eq_ignore_ascii_case("true");

        match key {
            "DefaultAuthType" => info.default_auth_type = Some(value.to_string()),
            "DefaultEncryption" => info.default_encryption = Some(value.to_string()),
            "Browsing" => info.share_printers = is_yes,
            "BrowseRemoteProtocols" if !value.is_empty() => info.share_printers = true,
            "ServerName" => info.server_name = Some(value.to_string()),
            "LogLevel" => info.log_level = Some(value.to_string()),
            "MaxClients" => {
                if let Ok(n) = value.parse::<u32>() {
                    info.max_clients = n;
                }
            }
            "MaxJobs" => {
                if let Ok(n) = value.parse::<u32>() {
                    info.max_jobs = n;
                }
            }
            "PreserveJobHistory" => info.preserve_job_history = is_yes,
            "PreserveJobFiles" => info.preserve_job_files = is_yes,
            "DefaultPaperSize" => info.default_paper_size = Some(value.to_string()),
            _ => {}
        }
    }

    info
}

/// Update CUPS server settings.
///
/// Sends a PUT to `/admin/conf/cupsd.conf` with the modified directives.
/// This is a destructive operation — the entire configuration file is replaced.
///
/// # Arguments
///
/// * `settings` — A map of cupsd.conf directive names to values. Only the
///   directives present in the map will be changed; others retain their
///   current values.
pub async fn update_server_settings(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    settings: &std::collections::HashMap<String, String>,
) -> Result<(), CupsError> {
    if settings.is_empty() {
        return Ok(());
    }

    // 1. Fetch the current config.
    let url = format!("{}/admin/conf/cupsd.conf", config.base_url());
    let mut req = client.get(&url);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req.send().await.map_err(|e| {
        CupsError::connection_failed(format!("Failed to fetch current config: {e}"))
    })?;
    if !resp.status().is_success() {
        return Err(CupsError::server_error(format!(
            "HTTP {} fetching current config",
            resp.status()
        )));
    }
    let current = resp
        .text()
        .await
        .map_err(|e| CupsError::parse_error(format!("Failed to read config body: {e}")))?;

    // 2. Merge settings into the current config.
    let mut remaining: std::collections::HashMap<String, String> = settings.clone();
    let mut new_lines: Vec<String> = Vec::new();

    for line in current.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            new_lines.push(line.to_string());
            continue;
        }
        let key = trimmed.split_whitespace().next().unwrap_or("");
        if let Some(value) = remaining.remove(key) {
            new_lines.push(format!("{key} {value}"));
        } else {
            new_lines.push(line.to_string());
        }
    }

    // Append any new directives that weren't already in the file.
    for (key, value) in &remaining {
        new_lines.push(format!("{key} {value}"));
    }

    let new_body = new_lines.join("\n") + "\n";

    // 3. PUT the new config.
    let mut put_req = client
        .put(&url)
        .header("Content-Type", "application/cupsd.conf")
        .body(new_body);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        put_req = put_req.basic_auth(user, Some(pass));
    }

    let put_resp = put_req
        .send()
        .await
        .map_err(|e| CupsError::connection_failed(format!("Failed to upload config: {e}")))?;

    if put_resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || put_resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CupsError::permission_denied(
            "Admin credentials required to update server settings",
        ));
    }

    if !put_resp.status().is_success() {
        return Err(CupsError::server_error(format!(
            "HTTP {} updating server settings",
            put_resp.status()
        )));
    }

    Ok(())
}

/// Retrieve server log lines.
///
/// Fetches the last `max_lines` lines from the specified log type by
/// downloading from the CUPS HTTP admin API.
pub async fn get_error_log(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    log_type: LogType,
    max_lines: Option<usize>,
) -> Result<Vec<String>, CupsError> {
    let filename = log_type.filename();
    let url = format!("{}/admin/log/{filename}", config.base_url());

    let mut req = client.get(&url);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let response = req.send().await.map_err(|e| {
        CupsError::connection_failed(format!("Failed to fetch log {filename}: {e}"))
    })?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CupsError::permission_denied(
            "Admin credentials required to read logs",
        ));
    }

    if !response.status().is_success() {
        return Err(CupsError::server_error(format!(
            "HTTP {} fetching log {filename}",
            response.status()
        )));
    }

    let body = response
        .text()
        .await
        .map_err(|e| CupsError::parse_error(format!("Failed to read log body: {e}")))?;

    let lines: Vec<String> = body.lines().map(String::from).collect();

    match max_lines {
        Some(n) if n < lines.len() => Ok(lines[lines.len() - n..].to_vec()),
        _ => Ok(lines),
    }
}

/// Print a test page to a printer.
///
/// Sends a Print-Job request with the CUPS standard test page document.
pub async fn test_page(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: &str,
) -> Result<u32, CupsError> {
    let printer_uri = config.printer_uri(printer_name);

    // The CUPS test page is a simple PostScript document.
    let test_doc = b"%!PS-Adobe-3.0
%%Title: Test Page
%%Creator: SortOfRemote NG
%%Pages: 1
%%DocumentData: Clean7Bit
%%EndComments
%%Page: 1 1
/Courier findfont 24 scalefont setfont
72 720 moveto
(CUPS Test Page) show
72 680 moveto
/Courier findfont 14 scalefont setfont
(Printed from SortOfRemote NG) show
72 650 moveto
(If you can read this, the printer is working.) show
showpage
%%EOF
";

    let body = ipp::standard_request(op::PRINT_JOB, &printer_uri)
        .name_without_language(
            "requesting-user-name",
            config.username.as_deref().unwrap_or("anonymous"),
        )
        .name_without_language("job-name", "CUPS Test Page")
        .mime_media_type("document-format", "application/postscript")
        .end_of_attributes()
        .document_data(test_doc)
        .build();

    let url = format!("{}/printers/{printer_name}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    let job_id = resp
        .group(tag::JOB_ATTRIBUTES)
        .and_then(|g| g.get_integer("job-id"))
        .ok_or_else(|| CupsError::parse_error("No job-id in test page response"))?
        as u32;

    Ok(job_id)
}

/// Get a summary of active subscriptions for a health check.
///
/// Returns the count of active subscriptions on the server.
pub async fn get_subscriptions_status(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<u32, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::GET_SUBSCRIPTIONS, &uri)
        .keywords("requested-attributes", &["notify-subscription-id"])
        .end_of_attributes()
        .build();

    let url = format!("{}/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    // If there are no subscriptions the server may return a not-found status.
    if resp.is_success() {
        let count = resp.groups(tag::SUBSCRIPTION_ATTRIBUTES).len() as u32;
        Ok(count)
    } else {
        Ok(0)
    }
}

/// Purge completed/canceled jobs older than `max_age_secs`.
///
/// Lists completed jobs and cancels/purges those whose completion time is
/// older than the specified threshold.
pub async fn cleanup_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    max_age_secs: u64,
) -> Result<u32, CupsError> {
    let cutoff = chrono::Utc::now().timestamp() - max_age_secs as i64;
    let jobs =
        crate::jobs::list_jobs(client, config, None, WhichJobs::Completed, false, None).await?;

    let mut purged = 0u32;
    for job in &jobs {
        let completed_ts = job.completed_at.map(|dt| dt.timestamp()).unwrap_or(0);
        if completed_ts > 0 && completed_ts < cutoff {
            // Purge by canceling the completed job.
            let printer_name = job.printer_name.as_deref().unwrap_or("");
            if !printer_name.is_empty() {
                let _result = crate::jobs::cancel_job(client, config, printer_name, job.id).await;
                purged += 1;
            }
        }
    }

    Ok(purged)
}

/// Restart the CUPS scheduler.
///
/// Sends an IPP request to restart the CUPS service. Requires admin
/// privileges.
pub async fn restart_cups(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<(), CupsError> {
    // CUPS does not have a native IPP "restart" operation. The standard
    // approach is to POST to the admin API endpoint.
    let url = format!("{}/admin/", config.base_url());

    // We use the CUPS admin HTTP form interface which accepts an
    // `org.cups.admin` operation parameter.
    let form_body = "org.cups.admin.command=restart-cupsd";
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_body);

    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| CupsError::connection_failed(format!("Failed to restart CUPS: {e}")))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CupsError::permission_denied(
            "Admin credentials required to restart CUPS",
        ));
    }

    if !resp.status().is_success() {
        return Err(CupsError::server_error(format!(
            "HTTP {} restarting CUPS",
            resp.status()
        )));
    }

    Ok(())
}
