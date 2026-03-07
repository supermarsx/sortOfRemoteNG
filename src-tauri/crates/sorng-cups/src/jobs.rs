//! Print job management — submit, cancel, hold, release, restart, list.

use crate::error::CupsError;
use crate::ipp::{self, op, tag, IppRequestBuilder};
use crate::types::*;
use chrono::{DateTime, TimeZone, Utc};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Extract a `JobInfo` from a job-attributes group.
fn job_from_group(group: &ipp::IppAttributeGroup) -> JobInfo {
    let id = group.get_integer("job-id").unwrap_or(0) as u32;
    let state_val = group.get_integer("job-state").unwrap_or(3);
    let state = JobState::from_ipp(state_val);

    let created_epoch = group.get_integer("time-at-creation").unwrap_or(0) as i64;
    let created_at = Utc.timestamp_opt(created_epoch, 0).single().unwrap_or_else(Utc::now);

    let processing_epoch = group.get_integer("time-at-processing").map(|v| v as i64);
    let processing_at = processing_epoch.and_then(|e| {
        if e > 0 { Utc.timestamp_opt(e, 0).single() } else { None }
    });

    let completed_epoch = group.get_integer("time-at-completed").map(|v| v as i64);
    let completed_at = completed_epoch.and_then(|e| {
        if e > 0 { Utc.timestamp_opt(e, 0).single() } else { None }
    });

    let sides_str = group.get_string("sides");
    let sides = sides_str.and_then(|s| match s {
        "one-sided" => Some(Sides::OneSided),
        "two-sided-long-edge" => Some(Sides::TwoSidedLongEdge),
        "two-sided-short-edge" => Some(Sides::TwoSidedShortEdge),
        _ => None,
    });

    let quality_val = group.get_integer("print-quality");
    let quality = quality_val.and_then(|v| match v {
        3 => Some(PrintQuality::Draft),
        4 => Some(PrintQuality::Normal),
        5 => Some(PrintQuality::High),
        _ => None,
    });

    JobInfo {
        id,
        name: group.get_string("job-name").unwrap_or("").to_string(),
        state,
        state_reasons: group
            .get_strings("job-state-reasons")
            .into_iter()
            .map(String::from)
            .collect(),
        user: group.get_string("job-originating-user-name").map(String::from),
        printer_uri: group.get_string("job-printer-uri").unwrap_or("").to_string(),
        printer_name: group
            .get_string("job-printer-uri")
            .and_then(|u| u.rsplit('/').next())
            .map(String::from),
        created_at,
        processing_at,
        completed_at,
        pages_completed: group.get_integer("job-media-sheets-completed").unwrap_or(0) as u32,
        copies: group.get_integer("copies").unwrap_or(1) as u32,
        priority: group.get_integer("job-priority").unwrap_or(50) as u32,
        size_bytes: group.get_integer("job-k-octets").unwrap_or(0) as u64 * 1024,
        media: group.get_string("media").map(String::from),
        sides,
        quality,
    }
}

/// Add print options to an IPP request builder.
fn apply_print_options(mut req: IppRequestBuilder, opts: &PrintOptions) -> IppRequestBuilder {
    req = req.job_attributes();

    if let Some(copies) = opts.copies {
        req = req.integer("copies", copies as i32);
    }
    if let Some(ref media) = opts.media {
        req = req.keyword("media", media);
    }
    if let Some(sides) = opts.sides {
        req = req.keyword("sides", sides.as_ipp_keyword());
    }
    if let Some(quality) = opts.print_quality {
        req = req.enum_value("print-quality", quality.as_ipp_enum());
    }
    if let Some(orient) = opts.orientation {
        req = req.enum_value("orientation-requested", orient.as_ipp_enum());
    }
    if let Some(color) = opts.color_mode {
        req = req.keyword("print-color-mode", color.as_ipp_keyword());
    }
    if let Some(ref ranges) = opts.page_ranges {
        // Parse "1-5,8,11-13" into IPP rangeOfInteger values
        for part in ranges.split(',') {
            let part = part.trim();
            if let Some((a, b)) = part.split_once('-') {
                if let (Ok(lo), Ok(hi)) = (a.trim().parse::<i32>(), b.trim().parse::<i32>()) {
                    req = req.range_of_integer("page-ranges", lo, hi);
                }
            } else if let Ok(p) = part.parse::<i32>() {
                req = req.range_of_integer("page-ranges", p, p);
            }
        }
    }
    if let Some(fit) = opts.fit_to_page {
        req = req.boolean("fit-to-page", fit);
    }
    if let Some(nup) = opts.number_up {
        req = req.integer("number-up", nup as i32);
    }
    if let Some(ref src) = opts.media_source {
        req = req.keyword("media-source", src);
    }
    if let Some(ref bin) = opts.output_bin {
        req = req.keyword("output-bin", bin);
    }
    for fin in &opts.finishings {
        req = req.enum_value("finishings", *fin as i32);
    }
    if let Some(pri) = opts.job_priority {
        req = req.integer("job-priority", pri.clamp(1, 100) as i32);
    }
    if let Some(ref name) = opts.job_name {
        req = req.name_without_language("job-name", name);
    }

    req
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// Submit a print job with inline document data.
pub async fn submit_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    document_data: &[u8],
    filename: &str,
    options: &PrintOptions,
) -> Result<u32, CupsError> {
    let printer_uri = config.printer_uri(printer);

    let mut req = ipp::standard_request(op::PRINT_JOB, &printer_uri)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .name_without_language("document-name", filename)
        .mime_media_type("document-format", &guess_mime(filename));

    req = apply_print_options(req, options);
    let body = req.end_of_attributes().document_data(document_data).build();

    let url = format!("{}/printers/{printer}", config.base_url());
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
        .ok_or_else(|| CupsError::parse_error("No job-id in response"))? as u32;
    Ok(job_id)
}

/// Submit a print job by document URI (Print-URI).
pub async fn submit_job_uri(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    document_uri: &str,
    options: &PrintOptions,
) -> Result<u32, CupsError> {
    let printer_uri = config.printer_uri(printer);

    let mut req = ipp::standard_request(op::PRINT_URI, &printer_uri)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .uri("document-uri", document_uri);

    req = apply_print_options(req, options);
    let body = req.end_of_attributes().build();

    let url = format!("{}/printers/{printer}", config.base_url());
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
        .ok_or_else(|| CupsError::parse_error("No job-id in response"))? as u32;
    Ok(job_id)
}

/// Cancel a print job.
pub async fn cancel_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    job_id: u32,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer);
    let body = ipp::job_request(op::CANCEL_JOB, &printer_uri, job_id)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .end_of_attributes()
        .build();

    let url = format!("{}/jobs/{job_id}", config.base_url());
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

/// Hold a print job.
pub async fn hold_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    job_id: u32,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer);
    let body = ipp::job_request(op::HOLD_JOB, &printer_uri, job_id)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .end_of_attributes()
        .build();

    let url = format!("{}/jobs/{job_id}", config.base_url());
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

/// Release a held print job.
pub async fn release_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    job_id: u32,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer);
    let body = ipp::job_request(op::RELEASE_JOB, &printer_uri, job_id)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .end_of_attributes()
        .build();

    let url = format!("{}/jobs/{job_id}", config.base_url());
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

/// Restart a completed/failed print job.
pub async fn restart_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
    job_id: u32,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer);
    let body = ipp::job_request(op::RESTART_JOB, &printer_uri, job_id)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .end_of_attributes()
        .build();

    let url = format!("{}/jobs/{job_id}", config.base_url());
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

/// Get info about a single job.
pub async fn get_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    job_id: u32,
) -> Result<JobInfo, CupsError> {
    let job_uri = format!("{}/jobs/{job_id}", config.base_url());
    let body = ipp::standard_request(op::GET_JOB_ATTRIBUTES, &job_uri)
        .keywords("requested-attributes", &["all"])
        .end_of_attributes()
        .build();

    let resp = ipp::send_ipp_request(
        client,
        &job_uri,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    resp.group(tag::JOB_ATTRIBUTES)
        .map(|g| job_from_group(g))
        .ok_or_else(|| CupsError::job_not_found(job_id))
}

/// List jobs on a printer (or all printers if `printer` is None).
pub async fn list_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: Option<&str>,
    which: WhichJobs,
    my_jobs: bool,
    limit: Option<u32>,
) -> Result<Vec<JobInfo>, CupsError> {
    let target_uri = match printer {
        Some(name) => config.printer_uri(name),
        None => config.ipp_uri(),
    };

    let mut req = ipp::standard_request(op::GET_JOBS, &target_uri)
        .keyword("which-jobs", which.as_ipp_keyword());

    if my_jobs {
        req = req
            .boolean("my-jobs", true)
            .name_without_language(
                "requesting-user-name",
                config.username.as_deref().unwrap_or("anonymous"),
            );
    }

    if let Some(max) = limit {
        req = req.integer("limit", max as i32);
    }

    req = req.keywords("requested-attributes", &[
        "job-id",
        "job-name",
        "job-state",
        "job-state-reasons",
        "job-originating-user-name",
        "job-printer-uri",
        "time-at-creation",
        "time-at-processing",
        "time-at-completed",
        "job-media-sheets-completed",
        "copies",
        "job-priority",
        "job-k-octets",
        "media",
        "sides",
        "print-quality",
    ]);

    let body = req.end_of_attributes().build();
    let url = match printer {
        Some(name) => format!("{}/printers/{name}", config.base_url()),
        None => format!("{}/", config.base_url()),
    };

    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    let jobs = resp
        .groups(tag::JOB_ATTRIBUTES)
        .into_iter()
        .map(|g| job_from_group(g))
        .collect();
    Ok(jobs)
}

/// Get raw IPP attributes for a job.
pub async fn get_job_attributes(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    job_id: u32,
    attributes: &[&str],
) -> Result<Vec<IppAttribute>, CupsError> {
    let job_uri = format!("{}/jobs/{job_id}", config.base_url());
    let body = ipp::standard_request(op::GET_JOB_ATTRIBUTES, &job_uri)
        .keywords("requested-attributes", attributes)
        .end_of_attributes()
        .build();

    let resp = ipp::send_ipp_request(
        client,
        &job_uri,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    Ok(resp
        .group(tag::JOB_ATTRIBUTES)
        .map(|g| g.attributes.clone())
        .unwrap_or_default())
}

/// Set attributes on an existing job.
pub async fn set_job_attributes(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    job_id: u32,
    attributes: Vec<(String, String)>,
) -> Result<(), CupsError> {
    let job_uri = format!("{}/jobs/{job_id}", config.base_url());
    let mut req = ipp::standard_request(op::SET_JOB_ATTRIBUTES, &job_uri)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"));

    req = req.job_attributes();
    for (name, value) in &attributes {
        req = req.keyword(name, value);
    }

    let body = req.end_of_attributes().build();
    let resp = ipp::send_ipp_request(
        client,
        &job_uri,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Cancel all jobs on a printer (Purge-Jobs).
pub async fn cancel_all_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer);
    let body = ipp::standard_request(op::PURGE_JOBS, &printer_uri)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .end_of_attributes()
        .build();

    let url = format!("{}/printers/{printer}", config.base_url());
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

/// Move a single job to a different printer (CUPS-Move-Job).
pub async fn move_job(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    job_id: u32,
    target_printer: &str,
) -> Result<(), CupsError> {
    let job_uri = format!("{}/jobs/{job_id}", config.base_url());
    let target_uri = config.printer_uri(target_printer);

    let body = ipp::standard_request(op::CUPS_MOVE_JOB, &job_uri)
        .name_without_language("requesting-user-name", config.username.as_deref().unwrap_or("anonymous"))
        .job_attributes()
        .uri("job-printer-uri", &target_uri)
        .end_of_attributes()
        .build();

    let resp = ipp::send_ipp_request(
        client,
        &job_uri,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Convenience: get only completed jobs.
pub async fn get_completed_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<JobInfo>, CupsError> {
    list_jobs(client, config, printer, WhichJobs::Completed, false, limit).await
}

/// Convenience: get only active (non-completed) jobs.
pub async fn get_active_jobs(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer: Option<&str>,
) -> Result<Vec<JobInfo>, CupsError> {
    list_jobs(client, config, printer, WhichJobs::NotCompleted, false, None).await
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Guess MIME type from filename extension.
fn guess_mime(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf"  => "application/pdf",
        "ps"   => "application/postscript",
        "txt"  => "text/plain",
        "html" | "htm" => "text/html",
        "jpg"  | "jpeg" => "image/jpeg",
        "png"  => "image/png",
        "tiff" | "tif" => "image/tiff",
        "gif"  => "image/gif",
        "bmp"  => "image/bmp",
        "svg"  => "image/svg+xml",
        "doc"  => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls"  => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt"  => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt"  => "application/vnd.oasis.opendocument.text",
        "ods"  => "application/vnd.oasis.opendocument.spreadsheet",
        "odp"  => "application/vnd.oasis.opendocument.presentation",
        _      => "application/octet-stream",
    }
    .to_string()
}
