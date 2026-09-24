use crate::ssh_scripts::catalog::{self, CatalogResponse};

/// Anonymous, bounded public manifest read; never imports or executes its content.
#[tauri::command]
pub async fn script_catalog_fetch(url: String) -> Result<CatalogResponse, String> {
    catalog::fetch_catalog(&url).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_command_decodes_actual_ipc_and_refuses_private_urls_before_network() {
        assert!(crate::is_command("script_catalog_fetch"));
        let _production_handler = crate::build();
        assert_eq!(
            include_str!("tools_handler.rs")
                .matches("script_catalog_commands::script_catalog_fetch,")
                .count(),
            1
        );
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![script_catalog_fetch])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let view = tauri::WebviewWindowBuilder::new(&app, "catalog-fixture", Default::default())
            .build()
            .unwrap();
        for body in [
            json!({}),
            json!({"url":"https://127.0.0.1/private"}),
            json!({"url":"http://localhost/private"}),
        ] {
            let result = tauri::test::get_ipc_response(
                &view,
                tauri::webview::InvokeRequest {
                    cmd: "script_catalog_fetch".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: view.url().expect("fixture webview URL"),
                    body: tauri::ipc::InvokeBody::Json(body.clone()),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            );
            let error = result.unwrap_err().to_string();
            if body.get("url").is_none() {
                assert!(error.contains("url"));
            } else {
                assert!(error.contains("public HTTPS raw manifest"), "{error}");
            }
            assert!(!error.contains("not found"));
        }
    }
}
