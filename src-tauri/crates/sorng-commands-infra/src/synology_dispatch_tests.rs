use super::synology_commands::*;
use serde_json::json;
use std::sync::Arc;

#[test]
fn registered_synology_commands_decode_scopes_and_use_managed_registry_state() {
    let _production_handler = crate::build();
    let state: crate::synology::service::SynologyServiceState =
        Arc::new(crate::synology::instances::SynologyInstances::new());
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            syn_fs_connect,
            syn_fs_cancel_connect,
            syn_fs_list,
            syn_fs_disconnect,
            syn_fs_create_share_link,
            syn_fs_list_share_links,
            syn_fs_delete_share_links,
            syn_fs_camera_snapshot,
            syn_get_config,
            syn_get_system_info,
            syn_reboot,
            syn_upload_file,
            syn_disconnect
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view =
        tauri::WebviewWindowBuilder::new(&app, "synology-dispatch-fixture", Default::default())
            .build()
            .unwrap();
    for (command, body, expected) in [
        (
            "syn_fs_cancel_connect",
            json!({"instanceId":"missing","requestId":"request"}),
            Ok(json!(false)),
        ),
        (
            "syn_fs_disconnect",
            json!({"instanceId":"missing","expectedSessionId":"receipt"}),
            Ok(json!(false)),
        ),
        (
            "syn_disconnect",
            json!({"instanceId":"missing","expectedSessionId":"receipt"}),
            Ok(json!(null)),
        ),
        ("syn_get_config", json!({}), Ok(json!(null))),
        (
            "syn_upload_file",
            json!({"instanceId":"missing","expectedSessionId":"receipt","destFolder":"/share","fileName":"fixture","content":[],"overwrite":false}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_list_share_links",
            json!({"instanceId":"a","expectedSessionId":"wrong","offset":0,"limit":50}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_delete_share_links",
            json!({"instanceId":"a","expectedSessionId":"wrong","ids":["link-1"]}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_camera_snapshot",
            json!({"instanceId":"a","expectedSessionId":"wrong","camId":"1"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_get_system_info",
            json!({"instanceId":"a","expectedSessionId":"wrong"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_reboot",
            json!({"instanceId":"a","expectedSessionId":"wrong"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_get_config",
            json!({"instanceId":"a"}),
            Err("Both Synology"),
        ),
        (
            "syn_fs_list",
            json!({"instanceId":"a","expectedSessionId":"wrong","folderPath":null,"offset":0,"limit":100,"sortBy":"name","sortDirection":"asc"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_create_share_link",
            json!({"instanceId":"a","expectedSessionId":"wrong","path":"/share/file","password":null,"expireDate":null}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"otpCode":null}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false}),
            Err("instanceId"),
        ),
    ] {
        assert!(
            crate::is_command(command),
            "{command} must be routed by the production facade"
        );
        let response = tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        match expected {
            Ok(value) => assert_eq!(
                response
                    .unwrap_or_else(|error| panic!("{command}: {error:?}"))
                    .deserialize::<serde_json::Value>()
                    .unwrap(),
                value,
                "{command}"
            ),
            Err(fragment) => {
                let error = response.unwrap_err().to_string();
                assert!(error.contains(fragment), "{command}: {error}");
                assert!(!error.contains("not managed"));
                assert!(!error.contains("not-real"));
            }
        }
    }
}
