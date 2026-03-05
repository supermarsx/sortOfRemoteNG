// ─── LXD – Profile management ───────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0/profiles?recursion=1
pub async fn list_profiles(client: &LxdClient) -> LxdResult<Vec<LxdProfile>> {
    client.list_recursion("/profiles").await
}

/// GET /1.0/profiles/<name>
pub async fn get_profile(client: &LxdClient, name: &str) -> LxdResult<LxdProfile> {
    client.get(&format!("/profiles/{name}")).await
}

/// POST /1.0/profiles — create a profile
pub async fn create_profile(client: &LxdClient, req: &CreateProfileRequest) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: &'a Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        config: &'a Option<std::collections::HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        devices: &'a Option<
            std::collections::HashMap<String, std::collections::HashMap<String, String>>,
        >,
    }
    client
        .put(
            "/profiles",
            &Body {
                name: &req.name,
                description: &req.description,
                config: &req.config,
                devices: &req.devices,
            },
        )
        .await
}

/// PUT /1.0/profiles/<name> — replace profile
pub async fn update_profile(
    client: &LxdClient,
    req: &UpdateProfileRequest,
) -> LxdResult<()> {
    client
        .put(&format!("/profiles/{}", req.name), req)
        .await
}

/// PATCH /1.0/profiles/<name> — partial update
pub async fn patch_profile(
    client: &LxdClient,
    name: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client.patch(&format!("/profiles/{name}"), patch).await
}

/// DELETE /1.0/profiles/<name>
pub async fn delete_profile(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/profiles/{name}")).await
}

/// POST /1.0/profiles/<name> — rename profile
pub async fn rename_profile(
    client: &LxdClient,
    name: &str,
    new_name: &str,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }

    let url = format!("/profiles/{name}");
    // rename returns sync 200
    let _: serde_json::Value = client
        .post_sync(&url, &Body { name: new_name })
        .await?;
    Ok(())
}
