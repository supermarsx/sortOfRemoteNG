// ── sorng-docker/src/containers.rs ────────────────────────────────────────────
//! Container lifecycle operations.

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;
use std::collections::HashMap;

pub struct ContainerManager;

impl ContainerManager {
    /// List containers.
    pub async fn list(
        client: &DockerClient,
        opts: &ListContainersOptions,
    ) -> DockerResult<Vec<ContainerSummary>> {
        let mut query = Vec::new();
        if opts.all.unwrap_or(false) {
            query.push(("all", "true".to_string()));
        }
        if let Some(limit) = opts.limit {
            query.push(("limit", limit.to_string()));
        }
        if opts.size.unwrap_or(false) {
            query.push(("size", "true".to_string()));
        }
        if let Some(ref filters) = opts.filters {
            let f = serde_json::to_string(filters).unwrap_or_default();
            query.push(("filters", f));
        }
        let path = if query.is_empty() {
            "/containers/json".to_string()
        } else {
            let qs: Vec<String> = query.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            format!("/containers/json?{}", qs.join("&"))
        };
        client.get(&path).await
    }

    /// Inspect a container.
    pub async fn inspect(client: &DockerClient, id: &str) -> DockerResult<ContainerInspect> {
        client.get(&format!("/containers/{}/json", id)).await
    }

    /// Create a container.
    pub async fn create(
        client: &DockerClient,
        config: &CreateContainerConfig,
    ) -> DockerResult<CreateContainerResponse> {
        let body = Self::build_create_body(config);
        let path = if let Some(ref name) = config.name {
            format!("/containers/create?name={}", name)
        } else {
            "/containers/create".to_string()
        };
        client.post_json(&path, &body).await
    }

    /// Create and start a container in one shot.
    pub async fn run(
        client: &DockerClient,
        config: &CreateContainerConfig,
    ) -> DockerResult<CreateContainerResponse> {
        let resp = Self::create(client, config).await?;
        Self::start(client, &resp.id).await?;
        Ok(resp)
    }

    /// Start a container.
    pub async fn start(client: &DockerClient, id: &str) -> DockerResult<()> {
        client
            .post_empty(&format!("/containers/{}/start", id))
            .await
    }

    /// Stop a container.
    pub async fn stop(client: &DockerClient, id: &str, timeout: Option<i32>) -> DockerResult<()> {
        let path = if let Some(t) = timeout {
            format!("/containers/{}/stop?t={}", id, t)
        } else {
            format!("/containers/{}/stop", id)
        };
        client.post_empty(&path).await
    }

    /// Restart a container.
    pub async fn restart(
        client: &DockerClient,
        id: &str,
        timeout: Option<i32>,
    ) -> DockerResult<()> {
        let path = if let Some(t) = timeout {
            format!("/containers/{}/restart?t={}", id, t)
        } else {
            format!("/containers/{}/restart", id)
        };
        client.post_empty(&path).await
    }

    /// Kill a container with an optional signal.
    pub async fn kill(client: &DockerClient, id: &str, signal: Option<&str>) -> DockerResult<()> {
        let path = if let Some(sig) = signal {
            format!("/containers/{}/kill?signal={}", id, sig)
        } else {
            format!("/containers/{}/kill", id)
        };
        client.post_empty(&path).await
    }

    /// Pause a container.
    pub async fn pause(client: &DockerClient, id: &str) -> DockerResult<()> {
        client
            .post_empty(&format!("/containers/{}/pause", id))
            .await
    }

    /// Unpause a container.
    pub async fn unpause(client: &DockerClient, id: &str) -> DockerResult<()> {
        client
            .post_empty(&format!("/containers/{}/unpause", id))
            .await
    }

    /// Remove a container.
    pub async fn remove(
        client: &DockerClient,
        id: &str,
        force: bool,
        volumes: bool,
    ) -> DockerResult<()> {
        let mut q = Vec::new();
        if force {
            q.push(("force", "true"));
        }
        if volumes {
            q.push(("v", "true"));
        }
        if q.is_empty() {
            client.delete(&format!("/containers/{}", id)).await
        } else {
            let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            client
                .delete(&format!("/containers/{}?{}", id, qs.join("&")))
                .await
        }
    }

    /// Rename a container.
    pub async fn rename(client: &DockerClient, id: &str, new_name: &str) -> DockerResult<()> {
        client
            .post_empty(&format!("/containers/{}/rename?name={}", id, new_name))
            .await
    }

    /// Wait for container to stop.
    pub async fn wait(client: &DockerClient, id: &str) -> DockerResult<ContainerWaitResult> {
        client
            .post_json(&format!("/containers/{}/wait", id), &serde_json::json!({}))
            .await
    }

    /// Get container logs.
    pub async fn logs(
        client: &DockerClient,
        id: &str,
        opts: &ContainerLogOptions,
    ) -> DockerResult<String> {
        let mut q = Vec::new();
        q.push((
            "stdout",
            if opts.stdout.unwrap_or(true) {
                "true"
            } else {
                "false"
            },
        ));
        q.push((
            "stderr",
            if opts.stderr.unwrap_or(true) {
                "true"
            } else {
                "false"
            },
        ));
        if opts.timestamps.unwrap_or(false) {
            q.push(("timestamps", "true"));
        }
        if let Some(ref since) = opts.since {
            q.push(("since", since));
        }
        if let Some(ref until) = opts.until {
            q.push(("until", until));
        }
        if let Some(ref tail) = opts.tail {
            q.push(("tail", tail));
        }
        let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
        client
            .get_text(&format!("/containers/{}/logs?{}", id, qs.join("&")))
            .await
    }

    /// Get container stats (one-shot, not streaming).
    pub async fn stats(client: &DockerClient, id: &str) -> DockerResult<ContainerStats> {
        let raw: serde_json::Value = client
            .get(&format!("/containers/{}/stats?stream=false", id))
            .await?;
        parse_stats(id, &raw)
    }

    /// Get processes running in a container.
    pub async fn top(
        client: &DockerClient,
        id: &str,
        ps_args: Option<&str>,
    ) -> DockerResult<ContainerTop> {
        let path = if let Some(args) = ps_args {
            format!("/containers/{}/top?ps_args={}", id, args)
        } else {
            format!("/containers/{}/top", id)
        };
        client.get(&path).await
    }

    /// Get filesystem changes.
    pub async fn changes(client: &DockerClient, id: &str) -> DockerResult<Vec<ContainerChange>> {
        client.get(&format!("/containers/{}/changes", id)).await
    }

    /// Create an exec instance.
    pub async fn exec_create(
        client: &DockerClient,
        id: &str,
        config: &ExecConfig,
    ) -> DockerResult<ExecCreateResponse> {
        client
            .post_json(&format!("/containers/{}/exec", id), config)
            .await
    }

    /// Start an exec instance and get output.
    pub async fn exec_start(client: &DockerClient, exec_id: &str) -> DockerResult<String> {
        let _body = serde_json::json!({ "Detach": false, "Tty": false });
        client.post_text(&format!("/exec/{}/start", exec_id)).await
    }

    /// Inspect an exec instance.
    pub async fn exec_inspect(client: &DockerClient, exec_id: &str) -> DockerResult<ExecInspect> {
        client.get(&format!("/exec/{}/json", exec_id)).await
    }

    /// Update container resources.
    pub async fn update(
        client: &DockerClient,
        id: &str,
        update: &serde_json::Value,
    ) -> DockerResult<serde_json::Value> {
        client
            .post_json(&format!("/containers/{}/update", id), update)
            .await
    }

    /// Export a container's filesystem as a tar archive, streaming it to a file.
    pub async fn export(
        client: &DockerClient,
        id: &str,
        output_path: &std::path::Path,
    ) -> DockerResult<()> {
        use tokio::io::AsyncWriteExt;

        let url = format!(
            "{}/{}/containers/{}/export",
            client.base_url, client.api_version, id
        );
        let mut resp = client.http.get(&url).send().await?;
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(crate::error::DockerError::api(status, &body));
        }
        let mut file = tokio::fs::File::create(output_path).await?;
        while let Some(chunk) = resp.chunk().await? {
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        Ok(())
    }

    /// Prune stopped containers.
    pub async fn prune(
        client: &DockerClient,
        filters: Option<&HashMap<String, Vec<String>>>,
    ) -> DockerResult<PruneResult> {
        let path = if let Some(f) = filters {
            let fs = serde_json::to_string(f).unwrap_or_default();
            format!("/containers/prune?filters={}", fs)
        } else {
            "/containers/prune".to_string()
        };
        let resp: serde_json::Value = client.post_json(&path, &serde_json::json!({})).await?;
        let deleted = resp
            .get("ContainersDeleted")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let space = resp
            .get("SpaceReclaimed")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        Ok(PruneResult {
            deleted_items: deleted,
            space_reclaimed: space,
        })
    }

    // ── Private helpers ───────────────────────────────────────────

    fn build_create_body(config: &CreateContainerConfig) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        map.insert("Image".into(), serde_json::json!(config.image));

        if let Some(ref cmd) = config.cmd {
            map.insert("Cmd".into(), serde_json::json!(cmd));
        }
        if let Some(ref ep) = config.entrypoint {
            map.insert("Entrypoint".into(), serde_json::json!(ep));
        }
        if let Some(ref env) = config.env {
            map.insert("Env".into(), serde_json::json!(env));
        }
        if let Some(ref wd) = config.working_dir {
            map.insert("WorkingDir".into(), serde_json::json!(wd));
        }
        if let Some(ref user) = config.user {
            map.insert("User".into(), serde_json::json!(user));
        }
        if let Some(ref h) = config.hostname {
            map.insert("Hostname".into(), serde_json::json!(h));
        }
        if let Some(ref d) = config.domainname {
            map.insert("Domainname".into(), serde_json::json!(d));
        }
        if let Some(ref labels) = config.labels {
            map.insert("Labels".into(), serde_json::json!(labels));
        }
        if let Some(ref ep) = config.exposed_ports {
            map.insert("ExposedPorts".into(), serde_json::json!(ep));
        }
        if let Some(ref v) = config.volumes {
            map.insert("Volumes".into(), serde_json::json!(v));
        }
        if let Some(tty) = config.tty {
            map.insert("Tty".into(), serde_json::json!(tty));
        }
        if let Some(os) = config.open_stdin {
            map.insert("OpenStdin".into(), serde_json::json!(os));
        }
        if let Some(ref ss) = config.stop_signal {
            map.insert("StopSignal".into(), serde_json::json!(ss));
        }
        if let Some(st) = config.stop_timeout {
            map.insert("StopTimeout".into(), serde_json::json!(st));
        }
        if let Some(ref hc) = config.health_check {
            map.insert("Healthcheck".into(), serde_json::json!(hc));
        }

        // Build HostConfig
        let mut hc = serde_json::Map::new();
        if let Some(ref pb) = config.port_bindings {
            hc.insert("PortBindings".into(), serde_json::json!(pb));
        }
        if let Some(ref b) = config.binds {
            hc.insert("Binds".into(), serde_json::json!(b));
        }
        if let Some(ref nm) = config.network_mode {
            hc.insert("NetworkMode".into(), serde_json::json!(nm));
        }
        if let Some(ref rp) = config.restart_policy {
            hc.insert("RestartPolicy".into(), serde_json::json!(rp));
        }
        if let Some(m) = config.memory {
            hc.insert("Memory".into(), serde_json::json!(m));
        }
        if let Some(ms) = config.memory_swap {
            hc.insert("MemorySwap".into(), serde_json::json!(ms));
        }
        if let Some(nc) = config.nano_cpus {
            hc.insert("NanoCPUs".into(), serde_json::json!(nc));
        }
        if let Some(cs) = config.cpu_shares {
            hc.insert("CpuShares".into(), serde_json::json!(cs));
        }
        if let Some(p) = config.privileged {
            hc.insert("Privileged".into(), serde_json::json!(p));
        }
        if let Some(ro) = config.read_only_rootfs {
            hc.insert("ReadonlyRootfs".into(), serde_json::json!(ro));
        }
        if let Some(ar) = config.auto_remove {
            hc.insert("AutoRemove".into(), serde_json::json!(ar));
        }
        if let Some(ref ca) = config.cap_add {
            hc.insert("CapAdd".into(), serde_json::json!(ca));
        }
        if let Some(ref cd) = config.cap_drop {
            hc.insert("CapDrop".into(), serde_json::json!(cd));
        }
        if let Some(ref so) = config.security_opt {
            hc.insert("SecurityOpt".into(), serde_json::json!(so));
        }
        if let Some(ref dns) = config.dns {
            hc.insert("Dns".into(), serde_json::json!(dns));
        }
        if let Some(ref eh) = config.extra_hosts {
            hc.insert("ExtraHosts".into(), serde_json::json!(eh));
        }
        if let Some(ref tf) = config.tmpfs {
            hc.insert("Tmpfs".into(), serde_json::json!(tf));
        }
        if let Some(ref dv) = config.devices {
            hc.insert("Devices".into(), serde_json::json!(dv));
        }
        if let Some(ref lc) = config.log_config {
            hc.insert("LogConfig".into(), serde_json::json!(lc));
        }
        if let Some(ref rt) = config.runtime {
            hc.insert("Runtime".into(), serde_json::json!(rt));
        }
        if let Some(shm) = config.shm_size {
            hc.insert("ShmSize".into(), serde_json::json!(shm));
        }
        if let Some(ref sc) = config.sysctls {
            hc.insert("Sysctls".into(), serde_json::json!(sc));
        }
        if let Some(ref ul) = config.ulimits {
            hc.insert("Ulimits".into(), serde_json::json!(ul));
        }
        if let Some(i) = config.init {
            hc.insert("Init".into(), serde_json::json!(i));
        }

        if !hc.is_empty() {
            map.insert("HostConfig".into(), serde_json::Value::Object(hc));
        }

        serde_json::Value::Object(map)
    }
}

/// Parse stats JSON into our struct.
fn parse_stats(id: &str, raw: &serde_json::Value) -> DockerResult<ContainerStats> {
    let name = raw
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('/')
        .to_string();

    // CPU
    let cpu_delta = raw
        .pointer("/cpu_stats/cpu_usage/total_usage")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        - raw
            .pointer("/precpu_stats/cpu_usage/total_usage")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
    let system_delta = raw
        .pointer("/cpu_stats/system_cpu_usage")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        - raw
            .pointer("/precpu_stats/system_cpu_usage")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
    let online_cpus = raw
        .pointer("/cpu_stats/online_cpus")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let cpu_percent = if system_delta > 0.0 {
        (cpu_delta / system_delta) * online_cpus * 100.0
    } else {
        0.0
    };

    // Memory
    let mem_usage = raw
        .pointer("/memory_stats/usage")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let mem_cache = raw
        .pointer("/memory_stats/stats/cache")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let mem_limit = raw
        .pointer("/memory_stats/limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(1);
    let used = mem_usage - mem_cache;
    let mem_pct = if mem_limit > 0 {
        (used as f64 / mem_limit as f64) * 100.0
    } else {
        0.0
    };

    // Network
    let networks = raw.get("networks").and_then(|v| v.as_object());
    let (mut rx, mut tx) = (0i64, 0i64);
    if let Some(nets) = networks {
        for (_k, v) in nets {
            rx += v.get("rx_bytes").and_then(|b| b.as_i64()).unwrap_or(0);
            tx += v.get("tx_bytes").and_then(|b| b.as_i64()).unwrap_or(0);
        }
    }

    // Block I/O
    let (mut br, mut bw) = (0i64, 0i64);
    if let Some(entries) = raw
        .pointer("/blkio_stats/io_service_bytes_recursive")
        .and_then(|v| v.as_array())
    {
        for e in entries {
            let op = e.get("op").and_then(|v| v.as_str()).unwrap_or("");
            let val = e.get("value").and_then(|v| v.as_i64()).unwrap_or(0);
            match op {
                "read" | "Read" => br += val,
                "write" | "Write" => bw += val,
                _ => {}
            }
        }
    }

    let pids = raw
        .pointer("/pids_stats/current")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let ts = raw
        .get("read")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(ContainerStats {
        container_id: id.to_string(),
        name,
        cpu_percent,
        memory_usage: used,
        memory_limit: mem_limit,
        memory_percent: mem_pct,
        network_rx_bytes: rx,
        network_tx_bytes: tx,
        block_read_bytes: br,
        block_write_bytes: bw,
        pids,
        timestamp: ts,
    })
}
