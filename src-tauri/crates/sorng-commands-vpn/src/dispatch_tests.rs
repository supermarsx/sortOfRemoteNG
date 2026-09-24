use serde_json::json;
use std::any::TypeId;

#[test]
fn moved_adapters_preserve_managed_service_type_identity() {
    macro_rules! same_state {
        ($module:ident, $state:ident) => {
            assert_eq!(
                TypeId::of::<crate::$module::$state>(),
                TypeId::of::<sorng_vpn::$module::$state>()
            );
        };
    }
    same_state!(chaining, ChainingServiceState);
    same_state!(ikev2, IKEv2ServiceState);
    same_state!(ipsec, IPsecServiceState);
    same_state!(l2tp, L2TPServiceState);
    same_state!(openvpn, OpenVPNServiceState);
    same_state!(pptp, PPTPServiceState);
    same_state!(proxy, ProxyServiceState);
    same_state!(sstp, SSTPServiceState);
    same_state!(tailscale, TailscaleServiceState);
    same_state!(vpn_lifecycle, VpnLeaseServiceState);
    same_state!(wireguard, WireGuardServiceState);
    same_state!(zerotier, ZeroTierServiceState);
    #[cfg(feature = "vpn-softether")]
    same_state!(softether, SoftEtherServiceState);
}

#[test]
fn moved_ikev2_commands_decode_ipc_and_use_original_managed_state() {
    let _production_handler = crate::build();
    // Construct the state through its original service crate, as app startup does.
    let state = sorng_vpn::ikev2::IKEv2Service::new();
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::ikev2_commands::list_ikev2_connections,
            crate::ikev2_commands::get_ikev2_connection
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "vpn-dispatch-fixture", Default::default())
        .build()
        .unwrap();
    for (command, body, succeeds) in [
        ("list_ikev2_connections", json!({}), true),
        (
            "get_ikev2_connection",
            json!({"connectionId":"missing-fixture"}),
            false,
        ),
    ] {
        assert!(crate::is_command(command));
        let response = tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: view.url().expect("fixture webview URL"),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        if succeeds {
            assert_eq!(
                response
                    .unwrap()
                    .deserialize::<serde_json::Value>()
                    .unwrap(),
                json!([])
            );
        } else {
            let error = response.unwrap_err().to_string();
            assert!(error.contains("not found"), "{error}");
            assert!(!error.contains("not managed"), "{error}");
        }
    }
}
