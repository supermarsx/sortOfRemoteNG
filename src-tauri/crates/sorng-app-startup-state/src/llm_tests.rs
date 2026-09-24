//! Actual managed-state extraction and native command execution, with no network
//! provider calls, filesystem persistence, OS keychain or real WebView.
use super::*;
use serde_json::{json, Value};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

fn invoke(
    view: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        view,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: view.url().expect("fixture webview URL"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

#[test]
fn lean_llm_registrar_reuses_one_managed_router() {
    let fixture = mock_builder().build(mock_context(noop_assets())).unwrap();
    let first = security_data::register_llm(&fixture);
    let second = security_data::register_llm(&fixture);
    let managed = fixture.state::<LlmServiceState>();
    assert!(Arc::ptr_eq(&first.0, &second.0));
    assert!(Arc::ptr_eq(&first.0, &managed.0));
    assert_eq!(
        SECURITY_DATA_REGISTRATION_ORDER
            .iter()
            .filter(|name| **name == "LlmServiceState")
            .count(),
        1
    );
    assert!(!COLLAB_REGISTRATION_ORDER.contains(&"LlmServiceState"));
    let collab = include_str!("collab.rs");
    assert!(collab.contains("app.state::<LlmServiceState>().inner().clone()"));
    assert!(!collab.contains("create_llm_state"));
    assert!(!collab.contains("app.manage(llm_state"));
}

#[test]
fn all_twenty_llm_commands_execute_through_the_real_core_ipc_handler() {
    let fixture = mock_builder()
        .invoke_handler(sorng_commands_core::llm_handler::build())
        .build(mock_context(noop_assets()))
        .unwrap();
    security_data::register_llm(&fixture);
    let view = tauri::WebviewWindowBuilder::new(&fixture, "llm-fixture", Default::default())
        .build()
        .unwrap();
    let mut exercised = std::collections::HashSet::new();
    let mut call = |command, body| {
        exercised.insert(command);
        invoke(&view, command, body)
    };

    let config = call("llm_get_config", json!({})).unwrap();
    assert_eq!(config["default_provider"], Value::Null);
    assert_eq!(call("llm_list_providers", json!({})).unwrap(), json!([]));
    assert!(
        call("llm_list_models", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len()
            > 1
    );
    assert!(
        !call("llm_models_for_provider", json!({"provider":"openai"}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        call("llm_model_info", json!({"modelId":"gpt-4o"})).unwrap()["id"],
        "gpt-4o"
    );
    assert!(call("llm_status", json!({})).is_ok());
    assert!(call("llm_cache_stats", json!({})).is_ok());
    assert!(call("llm_clear_cache", json!({})).is_ok());
    assert_eq!(
        call("llm_usage_summary", json!({})).unwrap()["total_requests"],
        0
    );
    assert!(
        call("llm_estimate_tokens", json!({"text":"fixture text"}))
            .unwrap()
            .as_u64()
            .unwrap()
            > 0
    );
    assert_eq!(call("llm_health_check_all", json!({})).unwrap(), json!([]));
    // These three commands fail before reaching a provider, proving State<T> and
    // command deserialization work without making any external request.
    for (command, body) in [
        ("llm_health_check", json!({"providerId":"absent"})),
        (
            "llm_chat_completion",
            json!({"request":{"model":"fixture","messages":[],"provider_id":"absent"}}),
        ),
        (
            "llm_create_embedding",
            json!({"request":{"model":"fixture","input":[],"provider_id":"absent"}}),
        ),
    ] {
        let error = call(command, body).unwrap_err();
        assert_eq!(error["code"], "PROVIDER_NOT_FOUND", "{command}: {error}");
    }
    let mut provider = serde_json::to_value(sorng_llm::config::ProviderConfig {
        id: "fixture".into(),
        display_name: "Fixture".into(),
        base_url: Some("http://fixture.invalid/v1".into()),
        ..Default::default()
    })
    .unwrap();
    provider["api_key"] = json!("fixture-secret");
    call("llm_add_provider", json!({"config":provider})).unwrap();
    call("llm_set_default_provider", json!({"providerId":"fixture"})).unwrap();
    assert_eq!(
        call("llm_get_config", json!({})).unwrap()["default_provider"],
        "fixture"
    );
    provider["api_key"] = Value::Null;
    provider["display_name"] = json!("Renamed fixture");
    call("llm_update_provider", json!({"config":provider})).unwrap();
    let listed = call("llm_list_providers", json!({})).unwrap();
    assert_eq!(listed[0]["display_name"], "Renamed fixture");
    assert!(listed[0].get("api_key").is_none());
    assert!(!listed.to_string().contains("fixture-secret"));
    call(
        "llm_set_balancer_strategy",
        json!({"strategy":"round_robin"}),
    )
    .unwrap();
    assert_eq!(
        call("llm_get_config", json!({})).unwrap()["balancer"]["strategy"],
        "round_robin"
    );
    let mut updated = call("llm_get_config", json!({})).unwrap();
    updated["usage_tracking_enabled"] = json!(false);
    updated["balancer"]["failover_enabled"] = json!(false);
    call("llm_update_config", json!({"config":updated})).unwrap();
    assert_eq!(call("llm_get_config", json!({})).unwrap(), updated);
    assert_eq!(
        call("llm_remove_provider", json!({"providerId":"fixture"})).unwrap(),
        true
    );
    assert_eq!(
        call("llm_get_config", json!({})).unwrap()["default_provider"],
        Value::Null
    );
    assert_eq!(
        exercised,
        sorng_commands_core::llm_handler::COMMAND_NAMES
            .iter()
            .copied()
            .collect()
    );
}
