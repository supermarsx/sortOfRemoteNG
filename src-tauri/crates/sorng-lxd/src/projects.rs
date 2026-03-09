// ─── LXD – Project management ───────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0/projects?recursion=1
pub async fn list_projects(client: &LxdClient) -> LxdResult<Vec<LxdProject>> {
    client.list_recursion("/projects").await
}

/// GET /1.0/projects/<name>
pub async fn get_project(client: &LxdClient, name: &str) -> LxdResult<LxdProject> {
    client.get(&format!("/projects/{name}")).await
}

/// POST /1.0/projects — create project
pub async fn create_project(client: &LxdClient, req: &CreateProjectRequest) -> LxdResult<()> {
    client.put("/projects", req).await
}

/// PUT /1.0/projects/<name> — replace project config
pub async fn update_project(
    client: &LxdClient,
    name: &str,
    req: &serde_json::Value,
) -> LxdResult<()> {
    client.put(&format!("/projects/{name}"), req).await
}

/// PATCH /1.0/projects/<name>
pub async fn patch_project(
    client: &LxdClient,
    name: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client.patch(&format!("/projects/{name}"), patch).await
}

/// DELETE /1.0/projects/<name>
pub async fn delete_project(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/projects/{name}")).await
}

/// POST /1.0/projects/<name> — rename project
pub async fn rename_project(client: &LxdClient, name: &str, new_name: &str) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }
    let _: serde_json::Value = client
        .post_sync(&format!("/projects/{name}"), &Body { name: new_name })
        .await?;
    Ok(())
}
