//! Printer management — list, add, modify, delete, pause, resume, discover.

use crate::error::CupsError;
use crate::ipp::{self, op, tag};
use crate::types::*;

/// Extract a `PrinterInfo` from a single printer-attributes group.
fn printer_from_group(
    group: &ipp::IppAttributeGroup,
    _config: &CupsConnectionConfig,
) -> PrinterInfo {
    let name = group.get_string("printer-name").unwrap_or("").to_string();

    let state_val = group.get_integer("printer-state").unwrap_or(3);
    let state = PrinterState::from_ipp(state_val);

    let printer_type_bits = group.get_integer("printer-type").unwrap_or(0) as u32;

    let default_printer = get_default_printer_name(group);
    let is_default = default_printer.as_deref() == Some(name.as_str());

    PrinterInfo {
        name: name.clone(),
        uri: group
            .get_string("printer-uri-supported")
            .or_else(|| group.get_string("printer-uri"))
            .unwrap_or("")
            .to_string(),
        state,
        state_message: group.get_string("printer-state-message").map(String::from),
        state_reasons: group
            .get_strings("printer-state-reasons")
            .into_iter()
            .map(String::from)
            .collect(),
        location: group.get_string("printer-location").map(String::from),
        description: group.get_string("printer-info").map(String::from),
        make_model: group.get_string("printer-make-and-model").map(String::from),
        device_uri: group.get_string("device-uri").map(String::from),
        printer_type: PrinterTypeFlags(printer_type_bits),
        is_shared: group.get_boolean("printer-is-shared").unwrap_or(false),
        is_accepting: group
            .get_boolean("printer-is-accepting-jobs")
            .unwrap_or(true),
        is_default,
        color_supported: group.get_boolean("color-supported").unwrap_or(false),
        duplex_supported: group
            .get_strings("sides-supported")
            .iter()
            .any(|s| s.contains("two-sided")),
        media_supported: group
            .get_strings("media-supported")
            .into_iter()
            .map(String::from)
            .collect(),
        resolution_supported: group
            .get_strings("printer-resolution-supported")
            .into_iter()
            .map(String::from)
            .collect(),
        job_count: group.get_integer("queued-job-count").unwrap_or(0) as u32,
        total_page_count: group.get_integer("printer-up-time").unwrap_or(0) as u64, // rough proxy
        info: group.get_string("printer-info").map(String::from),
    }
}

fn get_default_printer_name(group: &ipp::IppAttributeGroup) -> Option<String> {
    group.get_string("printer-is-default").and_then(|v| {
        if v == "true" {
            group.get_string("printer-name").map(String::from)
        } else {
            None
        }
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// List all printers on the CUPS server.
pub async fn list_printers(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<Vec<PrinterInfo>, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_PRINTERS, &uri)
        .keywords(
            "requested-attributes",
            &[
                "printer-name",
                "printer-uri-supported",
                "printer-state",
                "printer-state-message",
                "printer-state-reasons",
                "printer-location",
                "printer-info",
                "printer-make-and-model",
                "device-uri",
                "printer-type",
                "printer-is-shared",
                "printer-is-accepting-jobs",
                "color-supported",
                "sides-supported",
                "media-supported",
                "queued-job-count",
            ],
        )
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
    ipp::check_response(&resp)?;

    let printers = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| printer_from_group(g, config))
        .collect();
    Ok(printers)
}

/// Get a single printer by name.
pub async fn get_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<PrinterInfo, CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::GET_PRINTER_ATTRIBUTES, &printer_uri)
        .keywords("requested-attributes", &["all"])
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{name}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    resp.group(tag::PRINTER_ATTRIBUTES)
        .map(|g| printer_from_group(g, config))
        .ok_or_else(|| CupsError::printer_not_found(name))
}

/// Add a new printer.
#[allow(clippy::too_many_arguments)]
pub async fn add_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
    device_uri: &str,
    ppd_name: Option<&str>,
    location: Option<&str>,
    description: Option<&str>,
    shared: bool,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let mut req = ipp::standard_request(op::CUPS_ADD_MODIFY_PRINTER, &printer_uri)
        .uri("device-uri", device_uri)
        .boolean("printer-is-shared", shared);

    if let Some(ppd) = ppd_name {
        req = req.name_without_language("ppd-name", ppd);
    }
    if let Some(loc) = location {
        req = req.text("printer-location", loc);
    }
    if let Some(desc) = description {
        req = req.text("printer-info", desc);
    }

    let body = req
        .printer_attributes()
        .boolean("printer-is-accepting-jobs", true)
        .enum_value("printer-state", PrinterState::Idle as i32)
        .end_of_attributes()
        .build();

    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Modify an existing printer's attributes.
pub async fn modify_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
    changes: &ModifyPrinterArgs,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let mut req = ipp::standard_request(op::CUPS_ADD_MODIFY_PRINTER, &printer_uri);

    if let Some(ref device) = changes.device_uri {
        req = req.uri("device-uri", device);
    }
    if let Some(ref ppd) = changes.ppd_name {
        req = req.name_without_language("ppd-name", ppd);
    }
    if let Some(ref loc) = changes.location {
        req = req.text("printer-location", loc);
    }
    if let Some(ref desc) = changes.description {
        req = req.text("printer-info", desc);
    }

    req = req.printer_attributes();

    if let Some(shared) = changes.shared {
        req = req.boolean("printer-is-shared", shared);
    }
    if let Some(accept) = changes.accepting {
        req = req.boolean("printer-is-accepting-jobs", accept);
    }
    if let Some(ref policy) = changes.error_policy {
        req = req.name_without_language("printer-error-policy", policy);
    }
    if let Some(ref policy) = changes.op_policy {
        req = req.name_without_language("printer-op-policy", policy);
    }

    let body = req.end_of_attributes().build();
    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Delete a printer.
pub async fn delete_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::CUPS_DELETE_PRINTER, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Pause (stop) a printer.
pub async fn pause_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::PAUSE_PRINTER, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{name}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Resume a paused printer.
pub async fn resume_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::RESUME_PRINTER, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{name}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Set the server-wide default printer.
pub async fn set_default_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::CUPS_SET_DEFAULT, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Get the default printer.
pub async fn get_default_printer(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<PrinterInfo, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_DEFAULT, &uri)
        .keywords("requested-attributes", &["all"])
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
    ipp::check_response(&resp)?;

    resp.group(tag::PRINTER_ATTRIBUTES)
        .map(|g| {
            let mut p = printer_from_group(g, config);
            p.is_default = true;
            p
        })
        .ok_or_else(|| CupsError::printer_not_found("<default>"))
}

/// Tell the printer to accept incoming jobs (CUPS-Accept-Jobs).
pub async fn accept_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::CUPS_ACCEPT_JOBS, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Tell the printer to reject incoming jobs (CUPS-Reject-Jobs).
pub async fn reject_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::CUPS_REJECT_JOBS, &printer_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/admin/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Get raw IPP attributes for a printer.
pub async fn get_printer_attributes(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
    attributes: &[&str],
) -> Result<Vec<IppAttribute>, CupsError> {
    let printer_uri = config.printer_uri(name);
    let body = ipp::standard_request(op::GET_PRINTER_ATTRIBUTES, &printer_uri)
        .keywords("requested-attributes", attributes)
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{name}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    Ok(resp
        .group(tag::PRINTER_ATTRIBUTES)
        .map(|g| g.attributes.clone())
        .unwrap_or_default())
}

/// Discover available devices via CUPS-Get-Devices.
pub async fn discover_printers(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<Vec<DiscoveredDevice>, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_DEVICES, &uri)
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
    ipp::check_response(&resp)?;

    let devices = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| DiscoveredDevice {
            device_class: g
                .get_string("device-class")
                .unwrap_or("unknown")
                .to_string(),
            device_uri: g.get_string("device-uri").unwrap_or("").to_string(),
            device_make_model: g.get_string("device-make-and-model").map(String::from),
            device_info: g.get_string("device-info").map(String::from),
            device_id: g.get_string("device-id").map(String::from),
            device_location: g.get_string("device-location").map(String::from),
        })
        .collect();
    Ok(devices)
}

/// Move all jobs from one printer to another (CUPS-Move-Job with all jobs).
pub async fn move_printer_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    from: &str,
    to: &str,
) -> Result<(), CupsError> {
    let from_uri = config.printer_uri(from);
    let to_uri = config.printer_uri(to);

    let body = ipp::standard_request(op::CUPS_MOVE_JOB, &from_uri)
        .job_attributes()
        .uri("job-printer-uri", &to_uri)
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{from}", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Gather printer statistics by querying completed/active jobs.
pub async fn get_printer_statistics(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<PrinterStatistics, CupsError> {
    use crate::jobs;

    let completed = jobs::list_jobs(
        client,
        config,
        Some(name),
        WhichJobs::Completed,
        false,
        Some(10_000),
    )
    .await
    .unwrap_or_default();
    let active = jobs::list_jobs(
        client,
        config,
        Some(name),
        WhichJobs::NotCompleted,
        false,
        None,
    )
    .await
    .unwrap_or_default();

    let total_jobs = completed.len() as u64 + active.len() as u64;
    let completed_count = completed.len() as u64;
    let canceled = completed
        .iter()
        .filter(|j| j.state == JobState::Canceled)
        .count() as u64;
    let aborted = completed
        .iter()
        .filter(|j| j.state == JobState::Aborted)
        .count() as u64;
    let total_pages: u64 = completed
        .iter()
        .map(|j| j.pages_completed as u64)
        .sum::<u64>()
        + active.iter().map(|j| j.pages_completed as u64).sum::<u64>();
    let total_bytes: u64 = completed.iter().map(|j| j.size_bytes).sum::<u64>()
        + active.iter().map(|j| j.size_bytes).sum::<u64>();
    let avg = if total_jobs > 0 {
        total_pages as f64 / total_jobs as f64
    } else {
        0.0
    };

    // Get uptime from printer attributes
    let uptime = get_printer_attributes(client, config, name, &["printer-up-time"])
        .await
        .ok()
        .and_then(|attrs| attrs.first().and_then(|a| a.first_integer()))
        .unwrap_or(0) as u64;

    Ok(PrinterStatistics {
        total_pages,
        total_jobs,
        avg_pages_per_job: avg,
        total_bytes,
        uptime_secs: uptime,
        completed_jobs: completed_count,
        canceled_jobs: canceled,
        aborted_jobs: aborted,
    })
}
