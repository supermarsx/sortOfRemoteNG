//! Driver listing, lookup, and recommendation.
//!
//! CUPS drivers are identified by their PPD names and additional metadata.
//! This module queries the CUPS server for available drivers, filters them
//! by device ID or make/model, and recommends the best match for a given
//! device.
//!
//! Under the hood this uses the same CUPS-Get-PPDs (0x400C) operation as
//! the `ppd` module but focuses on the "driver" abstraction the frontend
//! expects: a name, description, device-id match, and make/model string.

use crate::error::CupsError;
use crate::ipp::{self, op, tag};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Attributes we request from CUPS-Get-PPDs for driver metadata.
const DRIVER_ATTRS: &[&str] = &[
    "ppd-name",
    "ppd-make",
    "ppd-make-and-model",
    "ppd-device-id",
    "ppd-natural-language",
    "ppd-type",
    "ppd-model-number",
];

/// Convert a PPD attribute group into a `DriverInfo`.
fn driver_from_group(group: &ipp::IppAttributeGroup) -> DriverInfo {
    DriverInfo {
        name: group.get_string("ppd-name").unwrap_or("").to_string(),
        description: group
            .get_string("ppd-make-and-model")
            .unwrap_or("")
            .to_string(),
        device_id: group.get_string("ppd-device-id").map(String::from),
        make_model: group.get_string("ppd-make-and-model").map(String::from),
    }
}

/// Parse a IEEE 1284 device ID string into key-value pairs.
///
/// Example: `MFG:HP;MDL:LaserJet Pro;CMD:PJL,PCL;`
fn parse_device_id(device_id: &str) -> Vec<(String, String)> {
    device_id
        .split(';')
        .filter(|s| !s.is_empty())
        .filter_map(|kv| {
            let (k, v) = kv.split_once(':')?;
            Some((k.trim().to_uppercase(), v.trim().to_string()))
        })
        .collect()
}

/// Compute a rough similarity score between a driver's device-id and the
/// target device-id. Returns a value between 0 and 100.
fn device_id_score(driver_did: Option<&str>, target_did: &str) -> u32 {
    let target_parts = parse_device_id(target_did);
    let Some(driver_raw) = driver_did else {
        return 0;
    };
    let driver_parts = parse_device_id(driver_raw);
    if target_parts.is_empty() || driver_parts.is_empty() {
        return 0;
    }

    let driver_map: std::collections::HashMap<String, String> =
        driver_parts.into_iter().collect();

    let mut matched = 0u32;
    let mut total = 0u32;

    for (key, target_val) in &target_parts {
        // MFG and MDL are the most important keys.
        let weight = match key.as_str() {
            "MFG" | "MANUFACTURER" => 30,
            "MDL" | "MODEL" => 50,
            "CMD" | "COMMAND SET" => 10,
            _ => 5,
        };
        total += weight;

        if let Some(driver_val) = driver_map.get(key) {
            if driver_val.eq_ignore_ascii_case(target_val) {
                matched += weight;
            } else if driver_val
                .to_ascii_lowercase()
                .contains(&target_val.to_ascii_lowercase())
            {
                matched += weight / 2;
            }
        }
    }

    if total == 0 {
        return 0;
    }
    (matched * 100) / total
}

/// Compute a simple make-model text similarity score (0–100).
fn make_model_score(driver_mm: Option<&str>, target_mm: &str) -> u32 {
    let Some(driver) = driver_mm else { return 0 };
    let driver_lower = driver.to_ascii_lowercase();
    let target_lower = target_mm.to_ascii_lowercase();

    if driver_lower == target_lower {
        return 100;
    }
    if driver_lower.contains(&target_lower) || target_lower.contains(&driver_lower) {
        return 70;
    }

    // Word overlap.
    let target_words: Vec<&str> = target_lower.split_whitespace().collect();
    let driver_words: Vec<&str> = driver_lower.split_whitespace().collect();
    if target_words.is_empty() {
        return 0;
    }
    let matching = target_words
        .iter()
        .filter(|w| driver_words.contains(w))
        .count();
    ((matching as u32) * 100) / (target_words.len() as u32)
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// List all available drivers on the CUPS server.
///
/// This is equivalent to `CUPS-Get-PPDs` with no filters and returns each
/// PPD entry re-packaged as a `DriverInfo`.
pub async fn list_drivers(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<Vec<DriverInfo>, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_PPDS, &uri)
        .keywords("requested-attributes", DRIVER_ATTRS)
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

    let drivers = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| driver_from_group(g))
        .collect();
    Ok(drivers)
}

/// Get a single driver by its PPD name.
///
/// Filters the CUPS-Get-PPDs response to the exact `ppd-name` match.
pub async fn get_driver(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    ppd_name: &str,
) -> Result<DriverInfo, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_PPDS, &uri)
        .keywords("requested-attributes", DRIVER_ATTRS)
        .text("ppd-make-and-model", ppd_name)
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

    // Search for an exact ppd-name match among the results.
    for group in resp.groups(tag::PRINTER_ATTRIBUTES) {
        let name = group.get_string("ppd-name").unwrap_or("");
        if name == ppd_name {
            return Ok(driver_from_group(group));
        }
    }

    // Fallback: return the first result if any.
    resp.groups(tag::PRINTER_ATTRIBUTES)
        .first()
        .map(|g| driver_from_group(g))
        .ok_or_else(|| CupsError::driver_error(format!("Driver not found: {ppd_name}")))
}

/// Recommend the best driver for a given device.
///
/// The recommendation is based on matching the IEEE 1284 device ID and/or
/// the make-and-model string against all available PPDs. Returns a list
/// sorted by descending relevance score.
///
/// # Arguments
///
/// * `device_id` — Optional IEEE 1284 device ID string (e.g. `MFG:HP;MDL:...`).
/// * `make_model` — Optional human-readable make/model string.
/// * `limit` — Maximum number of results to return (default 10).
pub async fn recommend_driver(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    device_id: Option<&str>,
    make_model: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<DriverInfo>, CupsError> {
    if device_id.is_none() && make_model.is_none() {
        return Err(CupsError::driver_error(
            "At least one of device_id or make_model must be provided",
        ));
    }

    // Fetch ALL drivers; we need the full list to score against.
    let uri = config.ipp_uri();
    let mut req = ipp::standard_request(op::CUPS_GET_PPDS, &uri)
        .keywords("requested-attributes", DRIVER_ATTRS);

    // If we have a make/model hint, add it as a filter to reduce response size.
    if let Some(mm) = make_model {
        // Extract the manufacturer (first word) as a coarse filter.
        if let Some(make) = mm.split_whitespace().next() {
            req = req.text("ppd-make", make);
        }
    }

    let body = req.end_of_attributes().build();
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

    let max_results = limit.unwrap_or(10);

    // Score each driver.
    let mut scored: Vec<(u32, DriverInfo)> = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| {
            let driver = driver_from_group(g);
            let did_score = device_id
                .map(|did| device_id_score(driver.device_id.as_deref(), did))
                .unwrap_or(0);
            let mm_score = make_model
                .map(|mm| make_model_score(driver.make_model.as_deref(), mm))
                .unwrap_or(0);
            // Weighted combination: device-id is more precise.
            let combined = (did_score * 3 + mm_score * 2) / 5;
            (combined, driver)
        })
        .filter(|(score, _)| *score > 0)
        .collect();

    // Sort descending by score.
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(max_results);

    let drivers = scored.into_iter().map(|(_, d)| d).collect();
    Ok(drivers)
}

/// Get the driver options (PPD options) for a specific driver by ppd-name.
///
/// This downloads the PPD identified by `ppd_name` and parses its options.
/// Note: the server must have the PPD installed (it must appear in
/// `list_drivers`). The PPD is retrieved by first assigning it to a
/// temporary query and downloading via the HTTP PPD endpoint.
pub async fn get_driver_options(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    ppd_name: &str,
) -> Result<Vec<PpdOption>, CupsError> {
    // The most reliable way to get PPD options for a driver that isn't
    // currently assigned to a printer is to query the PPD file directly
    // from the CUPS HTTP API.  CUPS exposes `/ppd.cgi?ppd-name=<name>` or
    // we can use the ppd-name attribute.
    let url = format!(
        "{}/ppd.cgi?ppd-name={}",
        config.base_url(),
        urlencoding_encode(ppd_name)
    );

    let mut req = client.get(&url);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let response = req.send().await.map_err(|e| {
        CupsError::driver_error(format!("Failed to fetch driver PPD {ppd_name}: {e}"))
    })?;

    if !response.status().is_success() {
        return Err(CupsError::driver_error(format!(
            "HTTP {} fetching PPD for driver {ppd_name}",
            response.status()
        )));
    }

    let raw = response.text().await.map_err(|e| {
        CupsError::driver_error(format!("Failed to read driver PPD body: {e}"))
    })?;

    Ok(crate::ppd::parse_ppd_options_from_raw(&raw))
}

/// Minimal percent-encoding for URL query parameters.
fn urlencoding_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => out.push(b as char),
            _ => {
                out.push('%');
                out.push(char::from(HEX_DIGITS[(b >> 4) as usize]));
                out.push(char::from(HEX_DIGITS[(b & 0x0F) as usize]));
            }
        }
    }
    out
}

static HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";
