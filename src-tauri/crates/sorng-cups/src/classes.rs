//! Printer class management — list, get, create, modify, delete, membership.
//!
//! CUPS printer classes are logical groups of printers. Jobs sent to a class
//! are dispatched to any available member printer. This module wraps the
//! CUPS-specific IPP operations:
//!
//! - `CUPS-Get-Classes`       (0x4005)
//! - `Get-Printer-Attributes` (0x000B) on a class URI
//! - `CUPS-Add-Modify-Class`  (0x4006)
//! - `CUPS-Delete-Class`      (0x4007)

use crate::error::CupsError;
use crate::ipp::{self, op, tag};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Requested attributes for class listing.
const CLASS_LIST_ATTRS: &[&str] = &[
    "printer-name",
    "member-names",
    "member-uris",
    "printer-info",
    "printer-location",
    "printer-state",
    "printer-state-message",
    "printer-is-accepting-jobs",
    "printer-is-shared",
    "printer-type",
];

/// Extract a `PrinterClass` from an IPP printer-attributes group.
fn class_from_group(group: &ipp::IppAttributeGroup) -> PrinterClass {
    let name = group
        .get_string("printer-name")
        .unwrap_or("")
        .to_string();

    let state_val = group.get_integer("printer-state").unwrap_or(3);
    let state = PrinterState::from_ipp(state_val);

    let member_names: Vec<String> = group
        .get_strings("member-names")
        .into_iter()
        .map(String::from)
        .collect();

    let member_uris: Vec<String> = group
        .get_strings("member-uris")
        .into_iter()
        .map(String::from)
        .collect();

    PrinterClass {
        name,
        member_names,
        member_uris,
        description: group.get_string("printer-info").map(String::from),
        location: group.get_string("printer-location").map(String::from),
        state,
        state_message: group.get_string("printer-state-message").map(String::from),
        is_accepting: group.get_boolean("printer-is-accepting-jobs").unwrap_or(true),
        is_shared: group.get_boolean("printer-is-shared").unwrap_or(false),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// List all printer classes on the CUPS server.
///
/// Sends a CUPS-Get-Classes (0x4005) request and returns a vector of
/// `PrinterClass` structs, one per class defined on the server.
pub async fn list_classes(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
) -> Result<Vec<PrinterClass>, CupsError> {
    let uri = config.ipp_uri();
    let body = ipp::standard_request(op::CUPS_GET_CLASSES, &uri)
        .keywords("requested-attributes", CLASS_LIST_ATTRS)
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

    let classes = resp
        .groups(tag::PRINTER_ATTRIBUTES)
        .into_iter()
        .map(|g| class_from_group(g))
        .collect();
    Ok(classes)
}

/// Get a single printer class by name.
///
/// Uses Get-Printer-Attributes on the class URI and parses the response
/// into a `PrinterClass`.
pub async fn get_class(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<PrinterClass, CupsError> {
    let class_uri = config.class_uri(name);
    let body = ipp::standard_request(op::GET_PRINTER_ATTRIBUTES, &class_uri)
        .keywords("requested-attributes", CLASS_LIST_ATTRS)
        .end_of_attributes()
        .build();

    let url = format!("{}/classes/{name}", config.base_url());
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
        .map(|g| class_from_group(g))
        .ok_or_else(|| CupsError::class_not_found(name))
}

/// Create a new printer class.
///
/// Sends a CUPS-Add-Modify-Class (0x4006) request with the given member
/// printers and optional metadata. If the class already exists this will
/// overwrite its configuration (behaves like an upsert).
///
/// # Arguments
///
/// * `name` — The class name (alphanumeric + hyphens).
/// * `members` — Slice of printer names to include in the class.
/// * `description` — Optional human-readable description.
/// * `location` — Optional physical location string.
/// * `shared` — Whether the class should be shared on the network.
pub async fn create_class(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
    members: &[&str],
    description: Option<&str>,
    location: Option<&str>,
    shared: bool,
) -> Result<(), CupsError> {
    if members.is_empty() {
        return Err(CupsError::new(
            crate::error::CupsErrorKind::InvalidConfig,
            "A printer class must have at least one member",
        ));
    }

    let class_uri = config.class_uri(name);
    let mut req = ipp::standard_request(op::CUPS_ADD_MODIFY_CLASS, &class_uri);

    // Add member URIs as a multi-valued attribute.
    let member_uris: Vec<String> = members
        .iter()
        .map(|m| config.printer_uri(m))
        .collect();
    let member_uri_refs: Vec<&str> = member_uris.iter().map(|s| s.as_str()).collect();
    req = req.keywords("member-uris", &member_uri_refs);

    if let Some(desc) = description {
        req = req.text("printer-info", desc);
    }
    if let Some(loc) = location {
        req = req.text("printer-location", loc);
    }

    req = req
        .printer_attributes()
        .boolean("printer-is-shared", shared)
        .boolean("printer-is-accepting-jobs", true)
        .enum_value("printer-state", PrinterState::Idle as i32);

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

/// Modify an existing printer class.
///
/// Any field in `changes` that is `Some` will be applied; `None` fields are
/// left unchanged on the server.
pub async fn modify_class(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
    changes: &ModifyClassArgs,
) -> Result<(), CupsError> {
    let class_uri = config.class_uri(name);
    let mut req = ipp::standard_request(op::CUPS_ADD_MODIFY_CLASS, &class_uri);

    if let Some(ref member_names) = changes.member_names {
        let member_uris: Vec<String> = member_names
            .iter()
            .map(|m| config.printer_uri(m))
            .collect();
        let member_uri_refs: Vec<&str> = member_uris.iter().map(|s| s.as_str()).collect();
        req = req.keywords("member-uris", &member_uri_refs);
    }

    if let Some(ref desc) = changes.description {
        req = req.text("printer-info", desc);
    }
    if let Some(ref loc) = changes.location {
        req = req.text("printer-location", loc);
    }

    req = req.printer_attributes();

    if let Some(shared) = changes.shared {
        req = req.boolean("printer-is-shared", shared);
    }
    if let Some(accepting) = changes.accepting {
        req = req.boolean("printer-is-accepting-jobs", accepting);
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

/// Delete a printer class.
///
/// Sends CUPS-Delete-Class (0x4007). All queued jobs for the class are
/// canceled.
pub async fn delete_class(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    name: &str,
) -> Result<(), CupsError> {
    let class_uri = config.class_uri(name);
    let body = ipp::standard_request(op::CUPS_DELETE_CLASS, &class_uri)
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

/// Add a printer to an existing class.
///
/// Fetches the current member list, appends `printer_name` (if not already
/// present), then sends a CUPS-Add-Modify-Class to update.
pub async fn add_member(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    class_name: &str,
    printer_name: &str,
) -> Result<(), CupsError> {
    let existing = get_class(client, config, class_name).await?;
    let mut members = existing.member_names.clone();

    if members.iter().any(|m| m == printer_name) {
        // Already a member — nothing to do.
        return Ok(());
    }
    members.push(printer_name.to_string());

    let class_uri = config.class_uri(class_name);
    let member_uris: Vec<String> = members
        .iter()
        .map(|m| config.printer_uri(m))
        .collect();
    let member_uri_refs: Vec<&str> = member_uris.iter().map(|s| s.as_str()).collect();

    let body = ipp::standard_request(op::CUPS_ADD_MODIFY_CLASS, &class_uri)
        .keywords("member-uris", &member_uri_refs)
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

/// Remove a printer from an existing class.
///
/// Fetches the current member list, removes `printer_name`, and sends a
/// CUPS-Add-Modify-Class. Returns an error if removing the printer would
/// leave the class with zero members.
pub async fn remove_member(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    class_name: &str,
    printer_name: &str,
) -> Result<(), CupsError> {
    let existing = get_class(client, config, class_name).await?;
    let mut members = existing.member_names.clone();

    let before = members.len();
    members.retain(|m| m != printer_name);
    if members.len() == before {
        // Printer was not a member — no-op.
        return Ok(());
    }
    if members.is_empty() {
        return Err(CupsError::new(
            crate::error::CupsErrorKind::InvalidConfig,
            format!(
                "Cannot remove {printer_name}: it is the last member of class {class_name}"
            ),
        ));
    }

    let class_uri = config.class_uri(class_name);
    let member_uris: Vec<String> = members
        .iter()
        .map(|m| config.printer_uri(m))
        .collect();
    let member_uri_refs: Vec<&str> = member_uris.iter().map(|s| s.as_str()).collect();

    let body = ipp::standard_request(op::CUPS_ADD_MODIFY_CLASS, &class_uri)
        .keywords("member-uris", &member_uri_refs)
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
