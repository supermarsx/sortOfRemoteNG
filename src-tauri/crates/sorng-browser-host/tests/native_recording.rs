//! Focused metadata collector coverage without compiling/starting CEF.
use sorng_browser_host::ipc;
#[path = "../src/native_recording.rs"]
mod recording;
use recording::RecordingData;
#[path = "../../../src/origin_browser_recording_contract.rs"]
mod contract;
#[path = "../../../src/origin_browser_recording_har.rs"]
mod har;

use serde_json::json;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::sync::Arc;

fn identity() -> BrowserIdentity {
    OriginBrowserPolicy::new("owner", "connection", "session", "https://fixture.invalid")
        .unwrap()
        .identity()
        .clone()
}

#[test]
fn recording_command_rejects_hidden_payloads_and_requires_metadata_opt_in() {
    let identity = ipc::OriginBrowserIdentity::from_native(&identity());
    for operation in [
        json!({"kind":"status","headers":true}),
        json!({"kind":"start","metadataOnly":true,"body":"secret"}),
        json!({"kind":"start"}),
        json!({"kind":"export","recordingId":"abc","path":"C:/secret"}),
    ] {
        assert!(serde_json::from_value::<contract::Request>(
            json!({"identity":identity,"operation":operation})
        )
        .is_err());
    }
    for operation in [
        json!({"kind":"start","metadataOnly":false}),
        json!({"kind":"stop","recordingId":""}),
        json!({"kind":"discard","recordingId":"header:value"}),
    ] {
        let request: contract::Request =
            serde_json::from_value(json!({"identity":identity,"operation":operation})).unwrap();
        assert!(request.validate().is_err());
    }
    for operation in [
        json!({"kind":"status"}),
        json!({"kind":"start","metadataOnly":true}),
        json!({"kind":"stop","recordingId":"01234567-89ab-4cde-8fab-0123456789ab-1"}),
    ] {
        let request: contract::Request =
            serde_json::from_value(json!({"identity":identity,"operation":operation})).unwrap();
        request.validate().unwrap();
    }
}

struct Owner;
impl recording::RecordingOwner for Owner {
    fn current(&self, _: &BrowserIdentity) -> bool {
        true
    }
}

#[test]
fn recording_har_export_is_metadata_only_and_has_no_body_or_secret_fields() {
    let identity = identity();
    let record = recording::Recording::start(&identity, Arc::new(Owner)).unwrap();
    recording::begin(
        &identity,
        "https://user:password@fixture.invalid/secret?token=hidden#fragment",
        "POST",
    )
    .unwrap()
    .complete(200, 20, recording::Outcome::Success);
    record.stop().unwrap();
    let exported = har::export(&record.export().unwrap(), &|_| {
        "2026-10-08T12:00:00.000Z".into()
    });
    let entry = &exported["log"]["entries"][0];
    assert_eq!(exported["log"]["version"], "1.2");
    assert_eq!(exported["log"]["_metadataOnly"], true);
    assert_eq!(entry["request"]["url"], "https://fixture.invalid/");
    assert_eq!(entry["request"]["headers"], json!([]));
    assert_eq!(entry["response"]["cookies"], json!([]));
    assert_eq!(entry["response"]["content"]["size"], 20);
    assert!(entry["request"].get("postData").is_none());
    assert!(entry["response"]["content"].get("text").is_none());
    let text = exported.to_string();
    for secret in ["password", "token=", "hidden", "/secret", "#fragment"] {
        assert!(!text.contains(secret));
    }
    recording::discard(&identity);
}
