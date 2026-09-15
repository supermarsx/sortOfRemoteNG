//! Real-shape DSM wire fixtures (t84 addendum). Synthetic values only; see
//! .orchestration/scratch/t84/dsm-response-shapes.md for sources and licences.
//!
//! The helpers bypass discovery and login: a service gets a client with a
//! fixture SID and exactly the APIs a test lists, and the loopback `Nas`
//! answers the given responses in order, one per request (code 999 after the
//! last one). Signed requests, 2FA and discovery stay out of these tests.
//!
//! Conventions for every `<lane>_shapes.rs`:
//! - Export `pub(super) fn real_<field>() -> Value` for each panel read the lane
//!   owns, named after the snake_case READS field (`fileStationInfo` ->
//!   `real_file_station_info`). It returns DSM's `data` object only; wrap it
//!   with `ok(...)`. e12l's contract test consumes these.
//! - Head each fixture with a one-line source comment, e.g.
//!   `// shape: vcf-content-factory api-maps/synology-storage.md [observed DSM 7.3.2] (MIT)`.
//! - Values are synthetic: `192.0.2.x`/`198.51.100.x` addresses, `*.invalid`
//!   hosts, `SYNTH…` serials, zero-pattern UUIDs. GPL sources and Synology
//!   guides give field names and behaviour only, never copied text.
//! - Every exported fixture and helper must be used by a test (dead code warns).

pub(super) use crate::scoped_files_tests::{ok, Nas};
pub(super) use crate::{
    client::SynoClient,
    error::{SynologyError, SynologyErrorKind},
    service::SynologyService,
    types::*,
};
pub(super) use serde_json::{json, Value};

mod foundation_shapes;

mod docker_shapes;
mod downloads_backup_shapes;
mod integration_shapes;
mod logs_shapes;
mod network_shapes;
mod packages_services_shapes;
mod security_shapes;
mod shares_users_shapes;
mod storage_shapes;
mod system_hardware_shapes;
mod vmm_surveillance_shapes;

/// A connected service whose discovery lists exactly `apis` as
/// `(api, max_version)`: path `entry.cgi`, min version 1 and
/// `requestFormat: "JSON"` (DSM 7's usual declaration).
pub(super) async fn service_with(
    apis: &[(&str, u32)],
    responses: Vec<Value>,
) -> (SynologyService, Nas) {
    let apis: Vec<_> = apis
        .iter()
        .map(|(api, maximum)| (*api, *maximum, Some("JSON")))
        .collect();
    service_with_format(&apis, responses).await
}

/// Like `service_with`, with each API's `requestFormat` given explicitly
/// (`None` = a plain-form API such as `DownloadStation/task.cgi`).
pub(super) async fn service_with_format(
    apis: &[(&str, u32, Option<&str>)],
    responses: Vec<Value>,
) -> (SynologyService, Nas) {
    let nas = Nas::start(responses).await;
    let mut client = SynoClient::new(&nas.config()).unwrap();
    client.sid = Some("fixture-sid".into());
    for (api, maximum, request_format) in apis {
        client.api_info.insert(
            (*api).to_owned(),
            ApiInfoEntry {
                path: "entry.cgi".into(),
                min_version: 1,
                max_version: *maximum,
                request_format: request_format.map(String::from),
            },
        );
    }
    let mut service = SynologyService::new();
    service.client = Some(client);
    (service, nas)
}

/// Byte-exact DSM error body, e.g. 105 -> `{"error":{"code":105},"success":false}`
/// (38 bytes, as in the user's report). Pass it as a response, not via `ok`.
pub(super) fn dsm_error(code: i32) -> Value {
    json!({"error": {"code": code}, "success": false})
}

fn request_query(nas: &Nas, index: usize, key: &str) -> String {
    let requests = nas.requests();
    let request = requests.get(index).unwrap_or_else(|| {
        panic!(
            "request {index} was never sent ({} requests)",
            requests.len()
        )
    });
    url::Url::parse(&format!("http://fixture{}", request.target))
        .unwrap()
        .query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| panic!("request {index} has no `{key}` in its URL"))
}

/// The `method=` of request `index` (0-based, in send order).
pub(super) fn request_method(nas: &Nas, index: usize) -> String {
    request_query(nas, index, "method")
}

/// The `api=` of request `index`.
pub(super) fn request_api(nas: &Nas, index: usize) -> String {
    request_query(nas, index, "api")
}

/// The `version=` of request `index`.
pub(super) fn request_version(nas: &Nas, index: usize) -> u32 {
    request_query(nas, index, "version").parse().unwrap()
}

/// A POST form field of request `index`, exactly as sent (JSON-quoted strings
/// keep their quotes). `None` when the field was not sent.
pub(super) fn request_field(nas: &Nas, index: usize, key: &str) -> Option<String> {
    let requests = nas.requests();
    let request = requests.get(index).unwrap_or_else(|| {
        panic!(
            "request {index} was never sent ({} requests)",
            requests.len()
        )
    });
    request.fields.get(key).cloned()
}

fn diagnostic_facts(error: &SynologyError) -> Value {
    let diagnostic = error
        .diagnostic
        .unwrap_or_else(|| panic!("no response diagnostic on: {error}"));
    serde_json::to_value(diagnostic).unwrap()
}

/// The error is a decode failure of a successful DSM answer: `ParseError` with
/// a closed `json_schema` diagnostic and no DSM code.
pub(super) fn assert_schema_failure(error: &SynologyError) {
    assert!(
        matches!(error.kind, SynologyErrorKind::ParseError),
        "{error}"
    );
    let facts = diagnostic_facts(error);
    assert_eq!(facts["category"], "json_schema", "{error}");
    assert!(facts.get("dsmCode").is_none(), "{error}");
}

/// The error carries DSM's own answer `code` in a `dsm_api` diagnostic. The
/// kind is left to the caller (105 is `PermissionDenied`, most others
/// `ApiError(code)`).
pub(super) fn assert_dsm_failure(error: &SynologyError, code: i32) {
    let facts = diagnostic_facts(error);
    assert_eq!(facts["category"], "dsm_api", "{error}");
    assert_eq!(facts["dsmCode"], code, "{error}");
}
