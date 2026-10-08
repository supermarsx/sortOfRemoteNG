#![cfg(feature = "cef-host")]
//! Compile-only native public API contract. Does not initialize/control CEF.
#![allow(dead_code)]
use sorng_browser_host::cef_browser::{
    BrowserError, CefBrowserHost, NativeFindCompletion, NativeFindResult,
};
use sorng_protocols::origin_browser::BrowserIdentity;

fn tracked_find(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    callback: NativeFindCompletion,
) -> Result<(), BrowserError> {
    host.find_with_results(
        identity,
        "10000000-0000-4000-8000-000000000001",
        "needle",
        true,
        false,
        false,
        callback,
    )
}

#[test]
fn result_contains_only_correlated_native_counts() {
    let result = NativeFindResult {
        request_id: "10000000-0000-4000-8000-000000000001".into(),
        active_match_ordinal: 2,
        number_of_matches: 7,
        final_update: true,
    };
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value["activeMatchOrdinal"], 2);
    assert_eq!(value["numberOfMatches"], 7);
    assert_eq!(value.as_object().unwrap().len(), 4);
}
