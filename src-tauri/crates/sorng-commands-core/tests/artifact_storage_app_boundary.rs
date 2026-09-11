//! Compile the actual shared adapter with app_lib's module/API boundary.
//! There is deliberately no `database_files` module in this crate. Internal
//! commands-core unit tests alone cannot detect that accidental dependency.

pub use sorng_commands_core::database_protection;

// This includes the production adapter and its existing filesystem safety
// fixtures, with the same protection facade re-export used by app_lib.
#[path = "../../../src/artifact_storage_adapters.rs"]
pub mod artifact_storage_adapters;

#[test]
fn public_protection_facade_preserves_plaintext_vault_rejection() {
    use serde_json::json;
    let guard = database_protection::reject_plaintext_credential_vault;
    assert!(guard(&json!({"connections": []})).is_ok());
    assert!(
        guard(&json!({"credentialVault": {"version": 1, "revision": 0, "entries": []}})).is_ok()
    );
    for vault in [
        json!(null),
        json!({"version": 2, "revision": 0, "entries": []}),
        json!({"version": 1, "revision": 0, "entries": [], "extra": true}),
        json!({"version": 1, "revision": 1, "entries": [{"facets": {"password": "SYNTHETIC_PRIVATE"}}]}),
    ] {
        let error = guard(&json!({"credentialVault": vault})).unwrap_err();
        assert!(error.contains("credential vault"));
        assert!(!error.contains("SYNTHETIC_PRIVATE"));
    }
}
