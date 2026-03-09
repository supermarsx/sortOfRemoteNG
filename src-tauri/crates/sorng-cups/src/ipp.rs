//! Low-level IPP (Internet Printing Protocol) request/response handling.
//!
//! Builds binary IPP requests conforming to RFC 8010/8011 and parses binary
//! IPP responses back into typed attribute groups.

use crate::error::CupsError;
use crate::types::*;
use std::sync::atomic::{AtomicI32, Ordering};

// ═══════════════════════════════════════════════════════════════════════
// Constants — Operation codes
// ═══════════════════════════════════════════════════════════════════════

/// IPP operation codes (RFC 8011 + CUPS extensions).
pub mod op {
    // Standard operations
    pub const PRINT_JOB: u16 = 0x0002;
    pub const PRINT_URI: u16 = 0x0003;
    pub const VALIDATE_JOB: u16 = 0x0004;
    pub const CREATE_JOB: u16 = 0x0005;
    pub const SEND_DOCUMENT: u16 = 0x0006;
    pub const SEND_URI: u16 = 0x0007;
    pub const CANCEL_JOB: u16 = 0x0008;
    pub const GET_JOB_ATTRIBUTES: u16 = 0x0009;
    pub const GET_JOBS: u16 = 0x000A;
    pub const GET_PRINTER_ATTRIBUTES: u16 = 0x000B;
    pub const HOLD_JOB: u16 = 0x000C;
    pub const RELEASE_JOB: u16 = 0x000D;
    pub const RESTART_JOB: u16 = 0x000E;
    pub const PAUSE_PRINTER: u16 = 0x0010;
    pub const RESUME_PRINTER: u16 = 0x0011;
    pub const PURGE_JOBS: u16 = 0x0012;
    pub const SET_PRINTER_ATTRIBUTES: u16 = 0x0013;
    pub const SET_JOB_ATTRIBUTES: u16 = 0x0014;
    pub const CREATE_PRINTER_SUBSCRIPTIONS: u16 = 0x0016;
    pub const CREATE_JOB_SUBSCRIPTIONS: u16 = 0x0017;
    pub const GET_SUBSCRIPTION_ATTRIBUTES: u16 = 0x0018;
    pub const GET_SUBSCRIPTIONS: u16 = 0x0019;
    pub const RENEW_SUBSCRIPTION: u16 = 0x001A;
    pub const CANCEL_SUBSCRIPTION: u16 = 0x001B;
    pub const GET_NOTIFICATIONS: u16 = 0x001C;

    // CUPS extension operations
    pub const CUPS_GET_DEFAULT: u16 = 0x4001;
    pub const CUPS_GET_PRINTERS: u16 = 0x4002;
    pub const CUPS_ADD_MODIFY_PRINTER: u16 = 0x4003;
    pub const CUPS_DELETE_PRINTER: u16 = 0x4004;
    pub const CUPS_GET_CLASSES: u16 = 0x4005;
    pub const CUPS_ADD_MODIFY_CLASS: u16 = 0x4006;
    pub const CUPS_DELETE_CLASS: u16 = 0x4007;
    pub const CUPS_ACCEPT_JOBS: u16 = 0x4008;
    pub const CUPS_REJECT_JOBS: u16 = 0x4009;
    pub const CUPS_SET_DEFAULT: u16 = 0x400A;
    pub const CUPS_GET_DEVICES: u16 = 0x400B;
    pub const CUPS_GET_PPDS: u16 = 0x400C;
    pub const CUPS_MOVE_JOB: u16 = 0x400D;
    pub const CUPS_GET_DOCUMENT: u16 = 0x4027;
}

// ── Attribute tags ──────────────────────────────────────────────────

pub mod tag {
    // Delimiter tags
    pub const OPERATION_ATTRIBUTES: u8 = 0x01;
    pub const JOB_ATTRIBUTES: u8 = 0x02;
    pub const END_OF_ATTRIBUTES: u8 = 0x03;
    pub const PRINTER_ATTRIBUTES: u8 = 0x04;
    pub const UNSUPPORTED_ATTRIBUTES: u8 = 0x05;
    pub const SUBSCRIPTION_ATTRIBUTES: u8 = 0x06;
    pub const EVENT_NOTIFICATION: u8 = 0x07;

    // Value tags
    pub const UNSUPPORTED_VALUE: u8 = 0x10;
    pub const UNKNOWN_VALUE: u8 = 0x12;
    pub const NO_VALUE: u8 = 0x13;
    pub const INTEGER: u8 = 0x21;
    pub const BOOLEAN: u8 = 0x22;
    pub const ENUM: u8 = 0x23;
    pub const OCTET_STRING: u8 = 0x30;
    pub const DATE_TIME: u8 = 0x31;
    pub const RESOLUTION: u8 = 0x32;
    pub const RANGE_OF_INTEGER: u8 = 0x33;
    pub const BEG_COLLECTION: u8 = 0x34;
    pub const TEXT_WITH_LANG: u8 = 0x35;
    pub const NAME_WITH_LANG: u8 = 0x36;
    pub const END_COLLECTION: u8 = 0x37;
    pub const TEXT_WITHOUT_LANG: u8 = 0x41;
    pub const NAME_WITHOUT_LANG: u8 = 0x42;
    pub const KEYWORD: u8 = 0x44;
    pub const URI: u8 = 0x45;
    pub const URI_SCHEME: u8 = 0x46;
    pub const CHARSET: u8 = 0x47;
    pub const NATURAL_LANGUAGE: u8 = 0x48;
    pub const MIME_MEDIA_TYPE: u8 = 0x49;
    pub const MEMBER_ATTR_NAME: u8 = 0x4A;
}

// ═══════════════════════════════════════════════════════════════════════
// Request ID tracking
// ═══════════════════════════════════════════════════════════════════════

static NEXT_REQUEST_ID: AtomicI32 = AtomicI32::new(1);

fn next_request_id() -> i32 {
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

// ═══════════════════════════════════════════════════════════════════════
// IPP Request Builder
// ═══════════════════════════════════════════════════════════════════════

/// A builder for constructing IPP binary requests.
pub struct IppRequestBuilder {
    buf: Vec<u8>,
    request_id: i32,
}

impl IppRequestBuilder {
    /// Start a new IPP 1.1 request.
    pub fn new(operation: u16) -> Self {
        Self::with_version(1, 1, operation)
    }

    /// Start a new IPP request with an explicit version.
    pub fn with_version(major: u8, minor: u8, operation: u16) -> Self {
        let request_id = next_request_id();
        let mut buf = Vec::with_capacity(256);
        // Version
        buf.push(major);
        buf.push(minor);
        // Operation-id
        buf.extend_from_slice(&operation.to_be_bytes());
        // Request-id
        buf.extend_from_slice(&request_id.to_be_bytes());
        Self { buf, request_id }
    }

    pub fn request_id(&self) -> i32 {
        self.request_id
    }

    // ── Delimiter tags ──────────────────────────────────────────

    pub fn operation_attributes(mut self) -> Self {
        self.buf.push(tag::OPERATION_ATTRIBUTES);
        self
    }

    pub fn job_attributes(mut self) -> Self {
        self.buf.push(tag::JOB_ATTRIBUTES);
        self
    }

    pub fn printer_attributes(mut self) -> Self {
        self.buf.push(tag::PRINTER_ATTRIBUTES);
        self
    }

    pub fn subscription_attributes(mut self) -> Self {
        self.buf.push(tag::SUBSCRIPTION_ATTRIBUTES);
        self
    }

    pub fn end_of_attributes(mut self) -> Self {
        self.buf.push(tag::END_OF_ATTRIBUTES);
        self
    }

    // ── Value encoding ──────────────────────────────────────────

    fn write_attr_header(&mut self, value_tag: u8, name: &str) {
        self.buf.push(value_tag);
        self.buf
            .extend_from_slice(&(name.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(name.as_bytes());
    }

    fn write_additional_value_header(&mut self, value_tag: u8) {
        self.buf.push(value_tag);
        // name-length = 0 → additional value for the same attribute
        self.buf.extend_from_slice(&0u16.to_be_bytes());
    }

    pub fn charset(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::CHARSET, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn natural_language(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::NATURAL_LANGUAGE, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn uri(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::URI, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn keyword(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::KEYWORD, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn keywords(mut self, name: &str, values: &[&str]) -> Self {
        if let Some((first, rest)) = values.split_first() {
            self.write_attr_header(tag::KEYWORD, name);
            self.buf
                .extend_from_slice(&(first.len() as u16).to_be_bytes());
            self.buf.extend_from_slice(first.as_bytes());
            for v in rest {
                self.write_additional_value_header(tag::KEYWORD);
                self.buf.extend_from_slice(&(v.len() as u16).to_be_bytes());
                self.buf.extend_from_slice(v.as_bytes());
            }
        }
        self
    }

    pub fn text(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::TEXT_WITHOUT_LANG, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn name_without_language(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::NAME_WITHOUT_LANG, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    pub fn integer(mut self, name: &str, value: i32) -> Self {
        self.write_attr_header(tag::INTEGER, name);
        self.buf.extend_from_slice(&4u16.to_be_bytes());
        self.buf.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub fn enum_value(mut self, name: &str, value: i32) -> Self {
        self.write_attr_header(tag::ENUM, name);
        self.buf.extend_from_slice(&4u16.to_be_bytes());
        self.buf.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub fn boolean(mut self, name: &str, value: bool) -> Self {
        self.write_attr_header(tag::BOOLEAN, name);
        self.buf.extend_from_slice(&1u16.to_be_bytes());
        self.buf.push(if value { 1 } else { 0 });
        self
    }

    pub fn range_of_integer(mut self, name: &str, lower: i32, upper: i32) -> Self {
        self.write_attr_header(tag::RANGE_OF_INTEGER, name);
        self.buf.extend_from_slice(&8u16.to_be_bytes());
        self.buf.extend_from_slice(&lower.to_be_bytes());
        self.buf.extend_from_slice(&upper.to_be_bytes());
        self
    }

    pub fn resolution(mut self, name: &str, cross_feed: i32, feed: i32, units: i32) -> Self {
        self.write_attr_header(tag::RESOLUTION, name);
        self.buf.extend_from_slice(&9u16.to_be_bytes());
        self.buf.extend_from_slice(&cross_feed.to_be_bytes());
        self.buf.extend_from_slice(&feed.to_be_bytes());
        self.buf.push(units as u8);
        self
    }

    pub fn octet_string(mut self, name: &str, value: &[u8]) -> Self {
        self.write_attr_header(tag::OCTET_STRING, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value);
        self
    }

    pub fn mime_media_type(mut self, name: &str, value: &str) -> Self {
        self.write_attr_header(tag::MIME_MEDIA_TYPE, name);
        self.buf
            .extend_from_slice(&(value.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(value.as_bytes());
        self
    }

    /// Append raw document data after the end-of-attributes tag.
    pub fn document_data(mut self, data: &[u8]) -> Self {
        self.buf.extend_from_slice(data);
        self
    }

    /// Consume the builder and produce the final IPP binary payload.
    pub fn build(self) -> Vec<u8> {
        self.buf
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Standard operation-attributes preamble
// ═══════════════════════════════════════════════════════════════════════

/// Build a standard operation-attributes preamble for most requests:
///   attributes-charset = utf-8
///   attributes-natural-language = en
///   printer-uri | job-uri = ...
pub fn standard_request(operation: u16, target_uri: &str) -> IppRequestBuilder {
    let target_attr = if operation == op::GET_JOB_ATTRIBUTES
        || operation == op::CANCEL_JOB
        || operation == op::HOLD_JOB
        || operation == op::RELEASE_JOB
        || operation == op::RESTART_JOB
        || operation == op::SET_JOB_ATTRIBUTES
    {
        "job-uri"
    } else {
        "printer-uri"
    };

    IppRequestBuilder::new(operation)
        .operation_attributes()
        .charset("attributes-charset", "utf-8")
        .natural_language("attributes-natural-language", "en")
        .uri(target_attr, target_uri)
}

/// Build a request targeting a job by id on a printer URI.
pub fn job_request(operation: u16, printer_uri: &str, job_id: u32) -> IppRequestBuilder {
    let job_uri = format!("{}/jobs/{job_id}", printer_uri.trim_end_matches('/'));
    standard_request(operation, &job_uri)
}

// ═══════════════════════════════════════════════════════════════════════
// IPP Response Parser
// ═══════════════════════════════════════════════════════════════════════

/// Parsed IPP response.
#[derive(Debug, Clone)]
pub struct IppResponse {
    pub version_major: u8,
    pub version_minor: u8,
    pub status_code: u16,
    pub request_id: i32,
    /// Attribute groups keyed by group tag (1=operation, 2=job, 4=printer, …).
    /// Each group is a vector because printer-attributes groups repeat per printer.
    pub attribute_groups: Vec<IppAttributeGroup>,
}

#[derive(Debug, Clone)]
pub struct IppAttributeGroup {
    pub tag: u8,
    pub attributes: Vec<IppAttribute>,
}

impl IppResponse {
    /// Get the first attribute group with the given tag.
    pub fn group(&self, tag: u8) -> Option<&IppAttributeGroup> {
        self.attribute_groups.iter().find(|g| g.tag == tag)
    }

    /// Get all attribute groups with the given tag.
    pub fn groups(&self, tag: u8) -> Vec<&IppAttributeGroup> {
        self.attribute_groups
            .iter()
            .filter(|g| g.tag == tag)
            .collect()
    }

    /// Whether the status code indicates success.
    pub fn is_success(&self) -> bool {
        IppStatusCode::is_success(self.status_code)
    }
}

impl IppAttributeGroup {
    /// Find an attribute by name.
    pub fn get(&self, name: &str) -> Option<&IppAttribute> {
        self.attributes.iter().find(|a| a.name == name)
    }

    /// Get a string value for an attribute.
    pub fn get_string(&self, name: &str) -> Option<&str> {
        self.get(name).and_then(|a| a.first_string())
    }

    /// Get an integer value for an attribute.
    pub fn get_integer(&self, name: &str) -> Option<i32> {
        self.get(name).and_then(|a| a.first_integer())
    }

    /// Get a boolean value for an attribute.
    pub fn get_boolean(&self, name: &str) -> Option<bool> {
        self.get(name).and_then(|a| a.first_boolean())
    }

    /// Get all string values of a set-of attribute.
    pub fn get_strings(&self, name: &str) -> Vec<&str> {
        self.get(name).map(|a| a.all_strings()).unwrap_or_default()
    }
}

impl IppAttribute {
    pub fn first_string(&self) -> Option<&str> {
        self.values.first().and_then(|v| match v {
            IppAttributeValue::Text(s)
            | IppAttributeValue::Name(s)
            | IppAttributeValue::Keyword(s)
            | IppAttributeValue::Uri(s)
            | IppAttributeValue::Charset(s)
            | IppAttributeValue::NaturalLanguage(s) => Some(s.as_str()),
            _ => None,
        })
    }

    pub fn first_integer(&self) -> Option<i32> {
        self.values.first().and_then(|v| match v {
            IppAttributeValue::Integer(n) | IppAttributeValue::Enum(n) => Some(*n),
            _ => None,
        })
    }

    pub fn first_boolean(&self) -> Option<bool> {
        self.values.first().and_then(|v| match v {
            IppAttributeValue::Boolean(b) => Some(*b),
            _ => None,
        })
    }

    pub fn all_strings(&self) -> Vec<&str> {
        self.values
            .iter()
            .filter_map(|v| match v {
                IppAttributeValue::Text(s)
                | IppAttributeValue::Name(s)
                | IppAttributeValue::Keyword(s)
                | IppAttributeValue::Uri(s)
                | IppAttributeValue::Charset(s)
                | IppAttributeValue::NaturalLanguage(s) => Some(s.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// Parse a binary IPP response into an `IppResponse`.
pub fn parse_response(data: &[u8]) -> Result<IppResponse, CupsError> {
    if data.len() < 8 {
        return Err(CupsError::parse_error("IPP response too short"));
    }

    let version_major = data[0];
    let version_minor = data[1];
    let status_code = u16::from_be_bytes([data[2], data[3]]);
    let request_id = i32::from_be_bytes([data[4], data[5], data[6], data[7]]);

    let mut pos = 8;
    let mut attribute_groups: Vec<IppAttributeGroup> = Vec::new();
    let mut current_group: Option<IppAttributeGroup> = None;
    let mut current_attr_name: Option<String> = None;

    while pos < data.len() {
        let tag_byte = data[pos];
        pos += 1;

        // End-of-attributes tag
        if tag_byte == tag::END_OF_ATTRIBUTES {
            if let Some(group) = current_group.take() {
                attribute_groups.push(group);
            }
            break;
        }

        // Delimiter tag → start a new group
        if tag_byte <= 0x0F {
            if let Some(group) = current_group.take() {
                attribute_groups.push(group);
            }
            current_group = Some(IppAttributeGroup {
                tag: tag_byte,
                attributes: Vec::new(),
            });
            current_attr_name = None;
            continue;
        }

        // Value tag → parse attribute
        if pos + 2 > data.len() {
            break;
        }
        let name_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;

        let attr_name = if name_len > 0 {
            if pos + name_len > data.len() {
                break;
            }
            let name = String::from_utf8_lossy(&data[pos..pos + name_len]).to_string();
            pos += name_len;
            current_attr_name = Some(name.clone());
            Some(name)
        } else {
            // Additional value for the same attribute
            None
        };

        if pos + 2 > data.len() {
            break;
        }
        let value_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;

        if pos + value_len > data.len() {
            break;
        }
        let value_bytes = &data[pos..pos + value_len];
        pos += value_len;

        let value = decode_value(tag_byte, value_bytes);

        if let Some(group) = current_group.as_mut() {
            if let Some(name) = attr_name {
                // New attribute
                group.attributes.push(IppAttribute {
                    name,
                    values: vec![value],
                });
            } else if let Some(ref name) = current_attr_name {
                // Additional value for the current attribute
                if let Some(attr) = group.attributes.iter_mut().rev().find(|a| a.name == *name) {
                    attr.values.push(value);
                }
            }
        }
    }

    // If we never hit end-of-attributes, flush last group
    if let Some(group) = current_group.take() {
        attribute_groups.push(group);
    }

    Ok(IppResponse {
        version_major,
        version_minor,
        status_code,
        request_id,
        attribute_groups,
    })
}

/// Decode a raw IPP value based on its tag.
fn decode_value(value_tag: u8, data: &[u8]) -> IppAttributeValue {
    match value_tag {
        tag::INTEGER => {
            if data.len() >= 4 {
                IppAttributeValue::Integer(i32::from_be_bytes([data[0], data[1], data[2], data[3]]))
            } else {
                IppAttributeValue::Unknown(data.to_vec())
            }
        }
        tag::BOOLEAN => IppAttributeValue::Boolean(data.first().copied().unwrap_or(0) != 0),
        tag::ENUM => {
            if data.len() >= 4 {
                IppAttributeValue::Enum(i32::from_be_bytes([data[0], data[1], data[2], data[3]]))
            } else {
                IppAttributeValue::Unknown(data.to_vec())
            }
        }
        tag::TEXT_WITHOUT_LANG | tag::TEXT_WITH_LANG => {
            IppAttributeValue::Text(String::from_utf8_lossy(data).to_string())
        }
        tag::NAME_WITHOUT_LANG | tag::NAME_WITH_LANG => {
            IppAttributeValue::Name(String::from_utf8_lossy(data).to_string())
        }
        tag::KEYWORD => IppAttributeValue::Keyword(String::from_utf8_lossy(data).to_string()),
        tag::URI => IppAttributeValue::Uri(String::from_utf8_lossy(data).to_string()),
        tag::URI_SCHEME => IppAttributeValue::Text(String::from_utf8_lossy(data).to_string()),
        tag::CHARSET => IppAttributeValue::Charset(String::from_utf8_lossy(data).to_string()),
        tag::NATURAL_LANGUAGE => {
            IppAttributeValue::NaturalLanguage(String::from_utf8_lossy(data).to_string())
        }
        tag::MIME_MEDIA_TYPE => IppAttributeValue::Text(String::from_utf8_lossy(data).to_string()),
        tag::DATE_TIME => IppAttributeValue::DateTime(String::from_utf8_lossy(data).to_string()),
        tag::RESOLUTION => {
            if data.len() >= 9 {
                let cross_feed = i32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                let feed = i32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                let units = data[8] as i32;
                IppAttributeValue::Resolution {
                    cross_feed,
                    feed,
                    units,
                }
            } else {
                IppAttributeValue::Unknown(data.to_vec())
            }
        }
        tag::RANGE_OF_INTEGER => {
            if data.len() >= 8 {
                let lower = i32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                let upper = i32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                IppAttributeValue::RangeOfInteger { lower, upper }
            } else {
                IppAttributeValue::Unknown(data.to_vec())
            }
        }
        tag::OCTET_STRING => IppAttributeValue::OctetString(data.to_vec()),
        _ => IppAttributeValue::Unknown(data.to_vec()),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP transport
// ═══════════════════════════════════════════════════════════════════════

/// Send an IPP request over HTTP and parse the response.
pub async fn send_ipp_request(
    client: &reqwest::Client,
    url: &str,
    body: Vec<u8>,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<IppResponse, CupsError> {
    let mut req = client
        .post(url)
        .header("Content-Type", "application/ipp")
        .body(body);

    if let (Some(user), Some(pass)) = (username, password) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req.send().await?;
    let status = resp.status();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(CupsError::auth_failed(format!(
            "HTTP {status} — authentication required"
        )));
    }

    if !status.is_success() {
        return Err(CupsError::server_error(format!("HTTP {status}")));
    }

    let data = resp.bytes().await?;
    parse_response(&data)
}

/// Check the IPP response status and return an error if it indicates failure.
pub fn check_response(resp: &IppResponse) -> Result<(), CupsError> {
    if resp.is_success() {
        Ok(())
    } else {
        let detail = resp
            .group(tag::OPERATION_ATTRIBUTES)
            .and_then(|g| g.get_string("status-message"))
            .unwrap_or("unknown error")
            .to_string();
        Err(CupsError::ipp_error(resp.status_code, detail))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_builder_basic() {
        let body = IppRequestBuilder::new(op::GET_PRINTER_ATTRIBUTES)
            .operation_attributes()
            .charset("attributes-charset", "utf-8")
            .natural_language("attributes-natural-language", "en")
            .uri("printer-uri", "ipp://localhost/printers/test")
            .end_of_attributes()
            .build();

        assert_eq!(body[0], 1); // version major
        assert_eq!(body[1], 1); // version minor
        assert_eq!(
            u16::from_be_bytes([body[2], body[3]]),
            op::GET_PRINTER_ATTRIBUTES
        );
        // Must contain the end-of-attributes tag
        assert!(body.contains(&tag::END_OF_ATTRIBUTES));
    }

    #[test]
    fn test_parse_empty_response() {
        // Minimal valid IPP response: version 1.1, successful-ok, request-id 1, end-of-attrs
        let data = vec![
            1, 1, // version 1.1
            0, 0, // status: successful-ok
            0, 0, 0, 1,    // request-id 1
            0x03, // end-of-attributes
        ];
        let resp = parse_response(&data).unwrap();
        assert_eq!(resp.version_major, 1);
        assert_eq!(resp.version_minor, 1);
        assert_eq!(resp.status_code, 0);
        assert!(resp.is_success());
    }

    #[test]
    fn test_parse_response_with_attrs() {
        // Build a tiny response with one printer-attributes group
        let mut data = vec![
            1, 1, // version
            0, 0, // success
            0, 0, 0, 2, // request-id 2
        ];
        // Printer-attributes group
        data.push(tag::PRINTER_ATTRIBUTES);
        // keyword "printer-state-reasons" = "none"
        data.push(tag::KEYWORD);
        let name = b"printer-state-reasons";
        data.extend_from_slice(&(name.len() as u16).to_be_bytes());
        data.extend_from_slice(name);
        let val = b"none";
        data.extend_from_slice(&(val.len() as u16).to_be_bytes());
        data.extend_from_slice(val);
        data.push(tag::END_OF_ATTRIBUTES);

        let resp = parse_response(&data).unwrap();
        let groups = resp.groups(tag::PRINTER_ATTRIBUTES);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].get_string("printer-state-reasons"), Some("none"));
    }
}
