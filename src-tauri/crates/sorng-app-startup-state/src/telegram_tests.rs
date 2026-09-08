//! Real lean IPC and managed registry fixtures. No real tokens, bot requests,
//! polling, OS credential storage or user configuration are involved.
use super::*;
use serde_json::{json, Value};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

fn fixture() -> (tauri::App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .invoke_handler(sorng_commands_core::telegram_handler::build())
        .build(mock_context(noop_assets()))
        .unwrap();
    security_data::register_telegram(&app);
    let view = tauri::WebviewWindowBuilder::new(&app, "telegram-fixture", Default::default())
        .build()
        .unwrap();
    (app, view)
}

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
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

#[test]
fn lean_telegram_has_one_managed_registry_and_all_78_real_routes() {
    let (app, view) = fixture();
    let first = security_data::register_telegram(&app);
    let second = app.state::<sorng_telegram::TelegramServiceState>();
    assert!(Arc::ptr_eq(&first, second.inner()));
    assert_eq!(
        SECURITY_DATA_REGISTRATION_ORDER
            .iter()
            .filter(|name| **name == "TelegramServiceState")
            .count(),
        1
    );
    assert!(!COLLAB_REGISTRATION_ORDER.contains(&"TelegramServiceState"));
    assert!(!include_str!("collab.rs").contains("TelegramService::new"));
    assert_eq!(
        invoke(&view, "telegram_list_bots", json!({})).unwrap(),
        json!([])
    );

    // On an empty registry, no-argument commands perform local reads/empty work.
    // Parameterized commands must reach the actual argument decoder, not a
    // missing-command or unmanaged-state failure. Successful bot/settings
    // operations with complete arguments are exercised in the other fixtures.
    for command in sorng_commands_core::telegram_handler::COMMAND_NAMES {
        if let Err(error) = invoke(&view, command, json!({})) {
            assert!(
                error
                    .as_str()
                    .is_some_and(|message| message.starts_with("invalid args")),
                "{command} did not reach its real command argument decoder: {error}"
            );
        }
    }
}

#[test]
fn lean_bot_settings_round_trip_without_external_validation_or_token_readback() {
    let (app, view) = fixture();
    invoke(
        &view,
        "telegram_add_bot",
        json!({"config":{
            "name":"fixture", "token":"disabled-fixture-secret", "enabled":false,
            "apiBaseUrl":"http://fixture.invalid"
        }}),
    )
    .unwrap();
    let bots = invoke(&view, "telegram_list_bots", json!({})).unwrap();
    assert_eq!(bots[0]["name"], "fixture");
    assert_eq!(bots[0]["enabled"], false);
    assert!(bots[0].get("token").is_none());
    assert!(!bots.to_string().contains("disabled-fixture-secret"));

    invoke(
        &view,
        "telegram_update_bot_token",
        json!({"name":"fixture","token":"replacement-fixture-secret"}),
    )
    .unwrap();
    let state = security_data::register_telegram(&app);
    tauri::async_runtime::block_on(async {
        assert_eq!(
            state.lock().await.bots.config("fixture").unwrap().token,
            "replacement-fixture-secret"
        );
    });
    // Enabling constructs only the HTTP client. Neither toggling nor listing
    // validates/sends; the test disables again before invoking remote commands.
    invoke(
        &view,
        "telegram_set_bot_enabled",
        json!({"name":"fixture","enabled":true}),
    )
    .unwrap();
    assert_eq!(
        invoke(&view, "telegram_list_bots", json!({})).unwrap()[0]["enabled"],
        true
    );
    invoke(
        &view,
        "telegram_set_bot_enabled",
        json!({"name":"fixture","enabled":false}),
    )
    .unwrap();
    for (command, body) in [
        ("telegram_validate_bot", json!({"name":"fixture"})),
        (
            "telegram_send_message",
            json!({"botName":"fixture","req":{"chatId":1,"text":"fixture"}}),
        ),
        ("telegram_get_webhook_info", json!({"botName":"fixture"})),
    ] {
        let error = invoke(&view, command, body).unwrap_err();
        assert!(error.as_str().unwrap().contains("not found or not enabled"));
        assert!(!error.to_string().contains("replacement-fixture-secret"));
    }
    invoke(&view, "telegram_remove_bot", json!({"name":"fixture"})).unwrap();
    assert_eq!(
        invoke(&view, "telegram_list_bots", json!({})).unwrap(),
        json!([])
    );
}

#[test]
fn lean_telegram_local_settings_and_templates_use_the_registered_service() {
    let (_app, view) = fixture();
    for command in [
        "telegram_list_notification_rules",
        "telegram_list_monitoring_checks",
        "telegram_list_digests",
        "telegram_list_scheduled_messages",
        "telegram_message_log",
        "telegram_notification_history",
        "telegram_monitoring_history",
    ] {
        assert_eq!(invoke(&view, command, json!({})).unwrap(), json!([]));
    }
    assert_eq!(
        invoke(&view, "telegram_stats", json!({})).unwrap()["configuredBots"],
        0
    );
    assert!(invoke(&view, "telegram_monitoring_summary", json!({})).is_ok());
    let template = json!({"id":"fixture-template","name":"Fixture","body":"Hello {{name}}",
        "createdAt":"2026-01-01T00:00:00Z"});
    invoke(&view, "telegram_add_template", json!({"template":template})).unwrap();
    assert!(invoke(&view, "telegram_list_templates", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["id"] == "fixture-template"));
    assert_eq!(
        invoke(
            &view,
            "telegram_render_template",
            json!({"templateId":"fixture-template","variables":{"name":"World"}})
        )
        .unwrap(),
        "Hello World"
    );
    invoke(
        &view,
        "telegram_remove_template",
        json!({"templateId":"fixture-template"}),
    )
    .unwrap();
    assert!(!invoke(&view, "telegram_list_templates", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["id"] == "fixture-template"));
}
