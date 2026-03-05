// ─── LXD – Instance (container / VM) management ────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// List / Get
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/instances?recursion=1 — list instances with full metadata
pub async fn list_instances(client: &LxdClient) -> LxdResult<Vec<Instance>> {
    client.list_recursion("/instances").await
}

/// GET /1.0/instances?recursion=1&filter=type+eq+container
pub async fn list_containers(client: &LxdClient) -> LxdResult<Vec<Instance>> {
    let all = list_instances(client).await?;
    Ok(all
        .into_iter()
        .filter(|i| {
            i.instance_type
                .as_deref()
                .map(|t| t == "container")
                .unwrap_or(true)
        })
        .collect())
}

/// GET /1.0/instances?recursion=1&filter=type+eq+virtual-machine
pub async fn list_virtual_machines(client: &LxdClient) -> LxdResult<Vec<Instance>> {
    let all = list_instances(client).await?;
    Ok(all
        .into_iter()
        .filter(|i| {
            i.instance_type
                .as_deref()
                .map(|t| t == "virtual-machine")
                .unwrap_or(false)
        })
        .collect())
}

/// GET /1.0/instances/<name>
pub async fn get_instance(client: &LxdClient, name: &str) -> LxdResult<Instance> {
    client.get(&format!("/instances/{name}")).await
}

/// GET /1.0/instances/<name>/state — runtime state (CPU, memory, network, disk)
pub async fn get_instance_state(client: &LxdClient, name: &str) -> LxdResult<InstanceState> {
    client.get(&format!("/instances/{name}/state")).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

/// POST /1.0/instances — create a new instance
pub async fn create_instance(
    client: &LxdClient,
    req: &CreateInstanceRequest,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: &'a Option<String>,
        #[serde(rename = "type")]
        #[serde(skip_serializing_if = "Option::is_none")]
        instance_type: &'a Option<String>,
        source: &'a InstanceSource,
        #[serde(skip_serializing_if = "Option::is_none")]
        profiles: &'a Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        config: &'a Option<std::collections::HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        devices: &'a Option<std::collections::HashMap<String, std::collections::HashMap<String, String>>>,
        ephemeral: bool,
    }

    client
        .post_async(
            "/instances",
            &Body {
                name: &req.name,
                description: &req.description,
                instance_type: &req.instance_type,
                source: &req.source,
                profiles: &req.profiles,
                config: &req.config,
                devices: &req.devices,
                ephemeral: req.ephemeral,
            },
        )
        .await
}

/// PUT /1.0/instances/<name> — replace instance config
pub async fn update_instance(
    client: &LxdClient,
    req: &UpdateInstanceRequest,
) -> LxdResult<()> {
    client
        .put(&format!("/instances/{}", req.name), req)
        .await
}

/// PATCH /1.0/instances/<name> — partial update
pub async fn patch_instance(
    client: &LxdClient,
    name: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client.patch(&format!("/instances/{name}"), patch).await
}

/// DELETE /1.0/instances/<name>
pub async fn delete_instance(
    client: &LxdClient,
    name: &str,
) -> LxdResult<LxdOperation> {
    client.delete_async(&format!("/instances/{name}")).await
}

/// POST /1.0/instances/<name> — rename / migrate
pub async fn rename_instance(
    client: &LxdClient,
    name: &str,
    new_name: &str,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
    }
    client
        .post_async(&format!("/instances/{name}"), &Body { name: new_name })
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// State changes (start, stop, restart, freeze, unfreeze)
// ═══════════════════════════════════════════════════════════════════════════════

async fn change_state(
    client: &LxdClient,
    name: &str,
    action: &str,
    force: bool,
    stateful: bool,
    timeout: Option<i32>,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        action: &'a str,
        force: bool,
        stateful: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        timeout: Option<i32>,
    }
    client
        .post_async(
            &format!("/instances/{name}/state"),
            &Body {
                action,
                force,
                stateful,
                timeout,
            },
        )
        .await
}

pub async fn start_instance(
    client: &LxdClient,
    name: &str,
    stateful: bool,
) -> LxdResult<LxdOperation> {
    change_state(client, name, "start", false, stateful, None).await
}

pub async fn stop_instance(
    client: &LxdClient,
    name: &str,
    force: bool,
    stateful: bool,
    timeout: Option<i32>,
) -> LxdResult<LxdOperation> {
    change_state(client, name, "stop", force, stateful, timeout).await
}

pub async fn restart_instance(
    client: &LxdClient,
    name: &str,
    force: bool,
    timeout: Option<i32>,
) -> LxdResult<LxdOperation> {
    change_state(client, name, "restart", force, false, timeout).await
}

pub async fn freeze_instance(client: &LxdClient, name: &str) -> LxdResult<LxdOperation> {
    change_state(client, name, "freeze", false, false, None).await
}

pub async fn unfreeze_instance(client: &LxdClient, name: &str) -> LxdResult<LxdOperation> {
    change_state(client, name, "unfreeze", false, false, None).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exec
// ═══════════════════════════════════════════════════════════════════════════════

/// POST /1.0/instances/<name>/exec — execute a command inside the instance
pub async fn exec_instance(
    client: &LxdClient,
    name: &str,
    req: &InstanceExecRequest,
) -> LxdResult<LxdOperation> {
    client
        .post_async(&format!("/instances/{name}/exec"), req)
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Console
// ═══════════════════════════════════════════════════════════════════════════════

/// POST /1.0/instances/<name>/console — open a console session
pub async fn console_instance(
    client: &LxdClient,
    name: &str,
    req: &InstanceConsoleRequest,
) -> LxdResult<LxdOperation> {
    client
        .post_async(&format!("/instances/{name}/console"), req)
        .await
}

/// DELETE /1.0/instances/<name>/console — clear console log buffer
pub async fn clear_console_log(client: &LxdClient, name: &str) -> LxdResult<()> {
    client.delete(&format!("/instances/{name}/console")).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/instances/<name>/logs — list log files
pub async fn list_instance_logs(client: &LxdClient, name: &str) -> LxdResult<Vec<String>> {
    client.list_names(&format!("/instances/{name}/logs")).await
}

/// GET /1.0/instances/<name>/logs/<filename> — download log content
pub async fn get_instance_log(
    client: &LxdClient,
    name: &str,
    filename: &str,
) -> LxdResult<String> {
    client
        .get_raw(&format!("/instances/{name}/logs/{filename}"))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Files
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/instances/<name>/files?path=<path> — read file content
pub async fn get_instance_file(
    client: &LxdClient,
    name: &str,
    path: &str,
) -> LxdResult<String> {
    let encoded = urlencoding::encode(path);
    client
        .get_raw(&format!("/instances/{name}/files?path={encoded}"))
        .await
}

/// POST /1.0/instances/<name>/files?path=<path> — push file content
pub async fn push_instance_file(
    client: &LxdClient,
    name: &str,
    path: &str,
    content: &str,
    uid: Option<u32>,
    gid: Option<u32>,
    mode: Option<&str>,
) -> LxdResult<()> {
    let encoded = urlencoding::encode(path);
    let url = format!(
        "{}/1.0/instances/{name}/files?path={encoded}",
        client.config.url.trim_end_matches('/')
    );

    let mut req = client
        .http
        .post(&url)
        .header("Content-Type", "application/octet-stream")
        .body(content.to_string());

    if let Some(u) = uid {
        req = req.header("X-LXD-uid", u.to_string());
    }
    if let Some(g) = gid {
        req = req.header("X-LXD-gid", g.to_string());
    }
    if let Some(m) = mode {
        req = req.header("X-LXD-mode", m);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| LxdError::connection(format!("push file: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(LxdError::api(format!("push file failed: {body}")));
    }
    Ok(())
}

/// DELETE /1.0/instances/<name>/files?path=<path> — delete file
pub async fn delete_instance_file(
    client: &LxdClient,
    name: &str,
    path: &str,
) -> LxdResult<()> {
    let encoded = urlencoding::encode(path);
    client
        .delete(&format!("/instances/{name}/files?path={encoded}"))
        .await
}

// We need urlencoding
mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(b as char);
                }
                b'/' => out.push('/'),
                _ => {
                    out.push('%');
                    out.push_str(&format!("{:02X}", b));
                }
            }
        }
        out
    }
}
