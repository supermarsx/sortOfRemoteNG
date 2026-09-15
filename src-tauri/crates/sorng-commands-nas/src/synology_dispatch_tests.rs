use super::synology_commands::*;
use serde_json::json;
use std::sync::Arc;

#[test]
fn isolated_viewer_paths_cover_installed_and_portable_without_search_or_arch_fallback() {
    let directory = std::env::temp_dir().join("synthetic-viewer-install");
    for (architecture, folder) in [("x86_64", "windows-amd64"), ("aarch64", "windows-arm64")] {
        let relative = std::path::Path::new(folder).join("sorng-file-viewer-host.exe");
        assert_eq!(
            isolated_viewer_candidates(&directory, architecture).unwrap(),
            [
                directory.join("file-viewer").join(&relative),
                directory.join("resources/file-viewer").join(&relative)
            ]
        );
    }
    assert!(isolated_viewer_candidates(&directory, "x86").is_err());
    assert!(isolated_viewer_candidates(&directory, "../../foreign").is_err());
    assert!(isolated_viewer_candidates(std::path::Path::new("relative"), "x86_64").is_err());
}

#[test]
fn registered_synology_commands_decode_scopes_and_use_managed_registry_state() {
    let _production_handler = crate::build();
    let state: crate::synology::service::SynologyServiceState =
        Arc::new(crate::synology::instances::SynologyInstances::new());
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            syn_fs_connect,
            syn_fs_transport_capabilities,
            syn_fs_cancel_connect,
            syn_fs_list,
            syn_fs_disconnect,
            syn_fs_session_health,
            syn_fs_create_share_link,
            syn_fs_list_share_links,
            syn_fs_delete_share_links,
            syn_fs_camera_snapshot,
            syn_get_section_access,
            syn_fs_preview_file,
            syn_fs_close_preview,
            syn_fs_open_external,
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
            "syn_fs_transport_capabilities",
            json!({}),
            Ok(json!({"version":1,"httpProxy":true,"quickConnect":true})),
        ),
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
            "syn_fs_session_health",
            json!({"instanceId":"a","expectedSessionId":"wrong"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
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
            "syn_get_section_access",
            json!({"instanceId":"a","expectedSessionId":"wrong","section":"system"}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_preview_file",
            json!({"instanceId":"a","expectedSessionId":"wrong","path":"/share/file.txt","kind":"text","maxBytes":1024,"viewerOptions":{"textWrap":true,"textFontSize":14,"imageFit":"contain"}}),
            Err("SYNOLOGY_SESSION_EXPIRED"),
        ),
        (
            "syn_fs_preview_file",
            json!({"instanceId":"a","expectedSessionId":"wrong","path":"/share/file.txt","kind":"text","maxBytes":1024,"viewerOptions":{"textWrap":"yes","textFontSize":14,"imageFit":"contain"}}),
            Err("viewerOptions"),
        ),
        (
            "syn_fs_close_preview",
            json!({"instanceId":"old-instance","expectedSessionId":"old-receipt","viewerId":"missing-viewer"}),
            Ok(json!(false)),
        ),
        (
            "syn_fs_open_external",
            json!({"instanceId":"a","expectedSessionId":"wrong","path":"/share/file.txt","kind":"text","maxBytes":1024,"application":"choose","retentionMinutes":30}),
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
        // `sessionProfile` is optional and closed. Reaching the instance-id
        // check proves the value decoded; old payloads above are unchanged.
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":"file_station"}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":"dsm_desktop"}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":null}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":"webui"}),
            Err("sessionProfile"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":"FileStation"}),
            Err("sessionProfile"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"sessionProfile":7}),
            Err("sessionProfile"),
        ),
        // Trusted-device arguments are optional. Well-formed values decode
        // and pass the device check, so the instance id is what fails.
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"otpCode":"123456","trustDevice":true}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"otpCode":null,"deviceId":"private-device-valid","deviceName":"SortOfRemoteNG · FIXTURE"}),
            Err("Invalid Synology instance"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"trustDevice":false,"deviceId":null,"deviceName":null}),
            Err("Invalid Synology instance"),
        ),
        // Bad values are refused before the instance id or any request, and
        // the error never repeats them.
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":"private-device\u{7}id","deviceName":"SortOfRemoteNG · FIXTURE"}),
            Err("trusted device is invalid"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":format!("private-device-{}", "x".repeat(1024)),"deviceName":"SortOfRemoteNG · FIXTURE"}),
            Err("trusted device is invalid"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":"private-device-unnamed"}),
            Err("trusted device is invalid"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":"private-device-valid","deviceName":"private-device-name\u{1b}"}),
            Err("trusted device is invalid"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":"private-device-valid","deviceName":format!("private-device-{}", "n".repeat(64))}),
            Err("trusted device is invalid"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"otpCode":"123456","trustDevice":"yes"}),
            Err("trustDevice"),
        ),
        (
            "syn_fs_connect",
            json!({"instanceId":"bad/id","requestId":"request","host":"127.0.0.1","port":1,"username":"synthetic","password":"not-real","useHttps":false,"deviceId":7,"deviceName":"SortOfRemoteNG · FIXTURE"}),
            Err("deviceId"),
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
                assert!(!error.contains("private-device"), "{command}: {error}");
            }
        }
    }
}
