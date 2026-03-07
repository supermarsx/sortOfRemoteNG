//! PPD (PostScript Printer Description) management.
//!
//! Provides operations for listing, searching, retrieving, parsing, uploading,
//! and assigning PPD files through the CUPS IPP and HTTP APIs:
//!
//! - `CUPS-Get-PPDs`   (0x400C) — enumerate available PPDs on the server
//! - PPD retrieval via HTTP GET `/ppd/{printer}`
//! - PPD upload via CUPS-Add-Modify-Printer with raw PPD data
//! - Basic PPD file parsing for UI rendering of options

use crate::error::CupsError;
use crate::ipp::{self, op, tag, IppRequestBuilder};
use crate::types::*;
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Attributes requested when listing PPDs.
const PPD_LIST_ATTRS: &[&str] = &[
    "ppd-name",
    "ppd-make",
    "ppd-make-and-model",
    "ppd-device-id",
    "ppd-natural-language",
    "ppd-type",
    "ppd-model-number",
];

/// Build a `PpdInfo` from an IPP printer-attributes group.
fn ppd_from_group(group: &ipp::IppAttributeGroup) -> PpdInfo {
    PpdInfo {
        name: group.get_string("ppd-name").unwrap_or("").to_string(),
        make: group.get_string("ppd-make").unwrap_or("").to_string(),
        make_model: group
            .get_string("ppd-make-and-model")
            .unwrap_or("")
            .to_string(),
        device_id: group.get_string("ppd-device-id").map(String::from),
        natural_language: group.get_string("ppd-natural-language").map(String::from),
        ppd_type: group.get_string("ppd-type").map(String::from),
        model_number: group.get_integer("ppd-model-number"),
    }
}

/// Parse a raw PPD file into a list of options.
///
/// This is a lightweight parser that extracts `*OpenUI` / `*CloseUI` blocks
/// and their `*Default<Key>` / `*<Key> <Choice>` entries. It does not aim
/// for full PPD spec compliance but covers the vast majority of real-world
/// PPD files produced by CUPS drivers and Foomatic.
fn parse_ppd_options(raw: &str) -> Vec<PpdOption> {
    let mut options: Vec<PpdOption> = Vec::new();
    let mut current_group = String::from("General");
    let mut current_option: Option<PpdOption> = None;
    let mut defaults: HashMap<String, String> = HashMap::new();

    // First pass: collect defaults.
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("*Default") {
            if let Some((key, value)) = rest.split_once(':') {
                let key = key.trim().to_string();
                let value = value.trim().to_string();
                defaults.insert(key, value);
            }
        }
    }

    // Second pass: extract OpenUI / CloseUI blocks.
    for line in raw.lines() {
        let trimmed = line.trim();

        // Track OpenGroup / CloseGroup.
        if let Some(rest) = trimmed.strip_prefix("*OpenGroup:") {
            let group_name = rest.split('/').next().unwrap_or(rest).trim();
            current_group = group_name.to_string();
            continue;
        }
        if trimmed.starts_with("*CloseGroup") {
            current_group = String::from("General");
            continue;
        }

        // Start a new option.
        if let Some(rest) = trimmed.strip_prefix("*OpenUI") {
            // Format: *OpenUI *PageSize/Page Size: PickOne
            let rest = rest.trim_start_matches(':').trim();
            let (raw_key, rest) = if let Some(idx) = rest.find('/') {
                (&rest[..idx], &rest[idx + 1..])
            } else if let Some(idx) = rest.find(':') {
                (&rest[..idx], &rest[idx + 1..])
            } else {
                (rest, "")
            };

            let keyword = raw_key.trim().trim_start_matches('*').to_string();

            let (text, ui_type) = if let Some(idx) = rest.find(':') {
                (
                    rest[..idx].trim().to_string(),
                    Some(rest[idx + 1..].trim().to_string()),
                )
            } else {
                (rest.trim().to_string(), None)
            };

            let text = if text.is_empty() {
                keyword.clone()
            } else {
                text
            };

            let default_choice = defaults
                .get(&keyword)
                .cloned()
                .unwrap_or_default();

            current_option = Some(PpdOption {
                keyword: keyword.clone(),
                text,
                group: current_group.clone(),
                choices: Vec::new(),
                default_choice,
                ui_type,
            });
            continue;
        }

        // Close the current option.
        if trimmed.starts_with("*CloseUI") {
            if let Some(opt) = current_option.take() {
                options.push(opt);
            }
            continue;
        }

        // Collect choices within the current option.
        if let Some(ref mut opt) = current_option {
            let prefix = format!("*{}", opt.keyword);
            if let Some(rest) = trimmed.strip_prefix(&prefix) {
                let rest = rest.trim();
                if rest.is_empty() || rest.starts_with('/') || !rest.starts_with(' ') {
                    // Parse: *PageSize Letter/US Letter: "<< ... >>"
                    if let Some(rest) = rest.strip_prefix(' ') {
                        if let Some((choice_part, _)) = rest.split_once(':') {
                            let (choice_key, choice_text) =
                                if let Some(idx) = choice_part.find('/') {
                                    (
                                        choice_part[..idx].trim().to_string(),
                                        choice_part[idx + 1..].trim().to_string(),
                                    )
                                } else {
                                    let ck = choice_part.trim().to_string();
                                    (ck.clone(), ck)
                                };

                            let is_default = opt.default_choice == choice_key;
                            opt.choices.push(PpdChoice {
                                keyword: choice_key,
                                text: choice_text,
                                is_default,
                            });
                        }
                    }
                }
            }
        }
    }

    // In case the PPD is missing a final CloseUI.
    if let Some(opt) = current_option.take() {
        options.push(opt);
    }

    options
}

/// Parse PPD options from raw PPD text (public re-export for other modules).
pub fn parse_ppd_options_from_raw(raw: &str) -> Vec<PpdOption> {
    parse_ppd_options(raw)
}

/// Extract nickname / manufacturer / model from PPD raw text.
fn parse_ppd_metadata(raw: &str) -> (Option<String>, Option<String>, Option<String>) {
    let mut nickname = None;
    let mut manufacturer = None;
    let mut model_name = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("*NickName:") {
            nickname = Some(rest.trim().trim_matches('"').to_string());
        } else if let Some(rest) = trimmed.strip_prefix("*Manufacturer:") {
            manufacturer = Some(rest.trim().trim_matches('"').to_string());
        } else if let Some(rest) = trimmed.strip_prefix("*ModelName:") {
            model_name = Some(rest.trim().trim_matches('"').to_string());
        }
    }

    (nickname, manufacturer, model_name)
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// List all PPDs available on the CUPS server.
///
/// Sends a CUPS-Get-PPDs (0x400C) request with an optional filter.
pub async fn list_ppds(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    filter: Option<&PpdFilter>,
) -> Result<Vec<PpdInfo>, CupsError> {
    let uri = config.ipp_uri();
    let mut req = ipp::standard_request(op::CUPS_GET_PPDS, &uri)
        .keywords("requested-attributes", PPD_LIST_ATTRS);

    if let Some(f) = filter {
        if let Some(ref make) = f.make {
            req = req.text("ppd-make", make);
        }
        if let Some(ref make_model) = f.make_model {
            req = req.text("ppd-make-and-model", make_model);
        }
        if let Some(ref device_id) = f.device_id {
            req = req.text("ppd-device-id", device_id);
        }
        if let Some(ref lang) = f.language {
            req = req.keyword("ppd-natural-language", lang);
        }
        if let Some(ref product) = f.product {
            req = req.text("ppd-product", product);
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

    let ppds = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| ppd_from_group(g))
        .collect();
    Ok(ppds)
}

/// Search PPDs by a free-text query (matched against make-and-model).
///
/// This is a convenience wrapper around `list_ppds` that sets the
/// `ppd-make-and-model` filter to the provided query string.
pub async fn search_ppds(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    query: &str,
) -> Result<Vec<PpdInfo>, CupsError> {
    let filter = PpdFilter {
        make_model: Some(query.to_string()),
        ..Default::default()
    };
    list_ppds(client, config, Some(&filter)).await
}

/// Retrieve the raw PPD file for a printer.
///
/// Downloads the PPD via an HTTP GET to `/ppd/{printer_name}` and returns
/// the raw text content.
pub async fn get_ppd(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: &str,
) -> Result<String, CupsError> {
    let url = format!("{}/ppd/{printer_name}", config.base_url());
    let mut req = client.get(&url);
    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }

    let response = req.send().await.map_err(|e| {
        CupsError::connection_failed(format!("Failed to fetch PPD for {printer_name}: {e}"))
    })?;

    if !response.status().is_success() {
        return Err(CupsError::ppd_error(format!(
            "HTTP {} fetching PPD for {printer_name}",
            response.status()
        )));
    }

    let text = response.text().await.map_err(|e| {
        CupsError::ppd_error(format!("Failed to read PPD body: {e}"))
    })?;

    if text.is_empty() {
        return Err(CupsError::ppd_error(format!(
            "Empty PPD returned for {printer_name}"
        )));
    }

    Ok(text)
}

/// Retrieve and parse PPD options for a printer.
///
/// Downloads the raw PPD and then extracts the user-facing options
/// (`*OpenUI` / `*CloseUI` blocks) into a `PpdContent` structure.
pub async fn get_ppd_options(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: &str,
) -> Result<PpdContent, CupsError> {
    let raw = get_ppd(client, config, printer_name).await?;
    let options = parse_ppd_options(&raw);
    let (nickname, manufacturer, model_name) = parse_ppd_metadata(&raw);

    Ok(PpdContent {
        raw,
        options,
        nickname,
        manufacturer,
        model_name,
    })
}

/// Upload a custom PPD file and assign it to a printer.
///
/// Sends a CUPS-Add-Modify-Printer (0x4003) with the PPD contents
/// embedded as the document payload.
pub async fn upload_ppd(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: &str,
    ppd_content: &str,
) -> Result<(), CupsError> {
    if ppd_content.is_empty() {
        return Err(CupsError::ppd_error("PPD content must not be empty"));
    }

    let printer_uri = config.printer_uri(printer_name);

    // The CUPS server expects the PPD as the document body of the
    // CUPS-Add-Modify-Printer request, not as IPP attributes.
    let url = format!("{}/admin/", config.base_url());

    let mut http_req = client
        .put(&url)
        .header("Content-Type", "application/vnd.cups-ppd")
        .body(ppd_content.to_string());

    if let (Some(user), Some(pass)) = (config.username.as_deref(), config.password.as_deref()) {
        http_req = http_req.basic_auth(user, Some(pass));
    }

    // Build a minimal IPP header to identify the target printer.
    let ipp_body = ipp::standard_request(op::CUPS_ADD_MODIFY_PRINTER, &printer_uri)
        .end_of_attributes()
        .document_data(ppd_content.as_bytes())
        .build();

    let resp = ipp::send_ipp_request(
        client,
        &url,
        ipp_body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// Assign a server-side PPD (by ppd-name) to a printer.
///
/// Uses CUPS-Add-Modify-Printer with the `ppd-name` operation attribute
/// set to the PPD identifier (as returned by `list_ppds`).
pub async fn assign_ppd(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: &str,
    ppd_name: &str,
) -> Result<(), CupsError> {
    let printer_uri = config.printer_uri(printer_name);
    let body = ipp::standard_request(op::CUPS_ADD_MODIFY_PRINTER, &printer_uri)
        .name_without_language("ppd-name", ppd_name)
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
