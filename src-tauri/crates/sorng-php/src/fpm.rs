// ── sorng-php – PHP-FPM pool management ─────────────────────────────────────
//! Create, update, delete, enable/disable FPM pools and query their runtime
//! status on remote Linux servers.

use crate::client::{PhpClient, shell_escape};
use crate::error::{PhpError, PhpResult};
use crate::types::*;
use std::collections::HashMap;

pub struct FpmManager;

impl FpmManager {
    /// List all FPM pools for a PHP version by reading its `pool.d` directory.
    pub async fn list_pools(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<Vec<PhpFpmPool>> {
        let pool_dir = client.fpm_pool_dir(version);
        let files = client.list_dir(&pool_dir).await?;

        let mut pools = Vec::new();
        for file in &files {
            if !file.ends_with(".conf") && !file.ends_with(".conf.disabled") {
                continue;
            }
            let path = format!("{}/{}", pool_dir, file);
            let content = client.read_remote_file(&path).await?;
            let enabled = file.ends_with(".conf");
            if let Some(pool) = parse_pool_config(&content, version, &path, enabled) {
                pools.push(pool);
            }
        }

        Ok(pools)
    }

    /// Get a specific FPM pool by name.
    pub async fn get_pool(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<PhpFpmPool> {
        let pool_dir = client.fpm_pool_dir(version);

        // Try enabled first, then disabled
        let conf_path = format!("{}/{}.conf", pool_dir, name);
        let disabled_path = format!("{}/{}.conf.disabled", pool_dir, name);

        if client.file_exists(&conf_path).await? {
            let content = client.read_remote_file(&conf_path).await?;
            parse_pool_config(&content, version, &conf_path, true)
                .ok_or_else(|| PhpError::parse(format!("failed to parse pool config: {}", name)))
        } else if client.file_exists(&disabled_path).await? {
            let content = client.read_remote_file(&disabled_path).await?;
            parse_pool_config(&content, version, &disabled_path, false)
                .ok_or_else(|| PhpError::parse(format!("failed to parse pool config: {}", name)))
        } else {
            Err(PhpError::pool_not_found(name))
        }
    }

    /// Create a new FPM pool from a request.
    pub async fn create_pool(
        client: &PhpClient,
        req: &CreateFpmPoolRequest,
    ) -> PhpResult<PhpFpmPool> {
        let pool_dir = client.fpm_pool_dir(&req.version);
        let conf_path = format!("{}/{}.conf", pool_dir, req.name);

        if client.file_exists(&conf_path).await? {
            return Err(PhpError::new(
                crate::error::PhpErrorKind::InternalError,
                format!("pool already exists: {}", req.name),
            ));
        }

        let config_content = Self::generate_pool_config(req);
        client.write_remote_file(&conf_path, &config_content).await?;

        Self::get_pool(client, &req.version, &req.name).await
    }

    /// Update an existing FPM pool.
    pub async fn update_pool(
        client: &PhpClient,
        version: &str,
        name: &str,
        req: &UpdateFpmPoolRequest,
    ) -> PhpResult<PhpFpmPool> {
        let mut pool = Self::get_pool(client, version, name).await?;

        if let Some(ref user) = req.user {
            pool.user = Some(user.clone());
        }
        if let Some(ref group) = req.group {
            pool.group = Some(group.clone());
        }
        if let Some(ref listen) = req.listen {
            pool.listen = listen.clone();
        }
        if let Some(ref pm) = req.pm {
            pool.pm = pm.clone();
        }
        if let Some(v) = req.max_children {
            pool.max_children = Some(v);
        }
        if let Some(v) = req.start_servers {
            pool.start_servers = Some(v);
        }
        if let Some(v) = req.min_spare_servers {
            pool.min_spare_servers = Some(v);
        }
        if let Some(v) = req.max_spare_servers {
            pool.max_spare_servers = Some(v);
        }
        if let Some(v) = req.max_requests {
            pool.max_requests = Some(v);
        }
        if let Some(v) = req.process_idle_timeout {
            pool.process_idle_timeout = Some(v);
        }
        if let Some(ref v) = req.status_path {
            pool.status_path = Some(v.clone());
        }
        if let Some(ref v) = req.ping_path {
            pool.ping_path = Some(v.clone());
        }
        if let Some(v) = req.request_terminate_timeout {
            pool.request_terminate_timeout = Some(v);
        }
        if let Some(v) = req.request_slowlog_timeout {
            pool.request_slowlog_timeout = Some(v);
        }
        if let Some(ref vals) = req.php_admin_values {
            pool.php_admin_values = vals.clone();
        }
        if let Some(ref vals) = req.php_values {
            pool.php_values = vals.clone();
        }
        if let Some(ref vals) = req.env_vars {
            pool.env_vars = vals.clone();
        }

        let config_content = pool_to_config(&pool);
        client
            .write_remote_file(&pool.config_file, &config_content)
            .await?;

        Ok(pool)
    }

    /// Delete an FPM pool config file.
    pub async fn delete_pool(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<()> {
        let pool_dir = client.fpm_pool_dir(version);
        let conf_path = format!("{}/{}.conf", pool_dir, name);
        let disabled_path = format!("{}/{}.conf.disabled", pool_dir, name);

        if client.file_exists(&conf_path).await? {
            client.remove_file(&conf_path).await?;
        } else if client.file_exists(&disabled_path).await? {
            client.remove_file(&disabled_path).await?;
        } else {
            return Err(PhpError::pool_not_found(name));
        }
        Ok(())
    }

    /// Enable a disabled pool by renaming `.conf.disabled` → `.conf`.
    pub async fn enable_pool(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<()> {
        let pool_dir = client.fpm_pool_dir(version);
        let conf_path = format!("{}/{}.conf", pool_dir, name);
        let disabled_path = format!("{}/{}.conf.disabled", pool_dir, name);

        if client.file_exists(&conf_path).await? {
            return Ok(()); // already enabled
        }
        if !client.file_exists(&disabled_path).await? {
            return Err(PhpError::pool_not_found(name));
        }

        let cmd = format!(
            "sudo mv {} {}",
            shell_escape(&disabled_path),
            shell_escape(&conf_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "failed to enable pool {}: {}",
                name,
                out.stderr.trim()
            )));
        }
        Ok(())
    }

    /// Disable a pool without deleting it (rename `.conf` → `.conf.disabled`).
    pub async fn disable_pool(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<()> {
        let pool_dir = client.fpm_pool_dir(version);
        let conf_path = format!("{}/{}.conf", pool_dir, name);
        let disabled_path = format!("{}/{}.conf.disabled", pool_dir, name);

        if client.file_exists(&disabled_path).await? {
            return Ok(()); // already disabled
        }
        if !client.file_exists(&conf_path).await? {
            return Err(PhpError::pool_not_found(name));
        }

        let cmd = format!(
            "sudo mv {} {}",
            shell_escape(&conf_path),
            shell_escape(&disabled_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "failed to disable pool {}: {}",
                name,
                out.stderr.trim()
            )));
        }
        Ok(())
    }

    /// Get runtime status of an FPM pool via its status page or socket.
    pub async fn get_pool_status(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<PhpFpmPoolStatus> {
        let pool = Self::get_pool(client, version, name).await?;
        let listen = &pool.listen;

        // Query the FPM status page via cgi-fcgi or curl over the socket
        let cmd = if listen.starts_with('/') {
            // Unix socket
            format!(
                "SCRIPT_NAME=/status SCRIPT_FILENAME=/status REQUEST_METHOD=GET QUERY_STRING=json \
                 cgi-fcgi -bind -connect {} 2>/dev/null || \
                 curl -s --unix-socket {} http://localhost/status?json 2>/dev/null",
                shell_escape(listen),
                shell_escape(listen)
            )
        } else {
            // TCP
            format!(
                "SCRIPT_NAME=/status SCRIPT_FILENAME=/status REQUEST_METHOD=GET QUERY_STRING=json \
                 cgi-fcgi -bind -connect {} 2>/dev/null || \
                 curl -s http://{}/status?json 2>/dev/null",
                shell_escape(listen),
                listen
            )
        };

        let out = client.exec_ssh(&cmd).await?;
        parse_pool_status(&out.stdout, name)
    }

    /// List worker processes for a specific FPM pool.
    pub async fn list_pool_processes(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<Vec<FpmWorkerProcess>> {
        let pool = Self::get_pool(client, version, name).await?;
        let listen = &pool.listen;

        let cmd = if listen.starts_with('/') {
            format!(
                "SCRIPT_NAME=/status SCRIPT_FILENAME=/status REQUEST_METHOD=GET QUERY_STRING=json&full \
                 cgi-fcgi -bind -connect {} 2>/dev/null || \
                 curl -s --unix-socket {} 'http://localhost/status?json&full' 2>/dev/null",
                shell_escape(listen),
                shell_escape(listen)
            )
        } else {
            format!(
                "SCRIPT_NAME=/status SCRIPT_FILENAME=/status REQUEST_METHOD=GET QUERY_STRING=json&full \
                 cgi-fcgi -bind -connect {} 2>/dev/null || \
                 curl -s 'http://{}/status?json&full' 2>/dev/null",
                shell_escape(listen),
                listen
            )
        };

        let out = client.exec_ssh(&cmd).await?;
        parse_worker_processes(&out.stdout)
    }

    /// Generate the content of an FPM pool `.conf` file from a creation request.
    pub fn generate_pool_config(pool: &CreateFpmPoolRequest) -> String {
        let mut lines = Vec::new();
        lines.push(format!("[{}]", pool.name));

        let user = pool.user.as_deref().unwrap_or("www-data");
        let group = pool.group.as_deref().unwrap_or("www-data");
        lines.push(format!("user = {}", user));
        lines.push(format!("group = {}", group));

        let listen = pool
            .listen
            .as_deref()
            .unwrap_or_else(|| "/run/php/php-fpm.sock");
        lines.push(format!("listen = {}", listen));
        lines.push("listen.owner = www-data".to_string());
        lines.push("listen.group = www-data".to_string());

        let pm = match pool.pm {
            Some(FpmProcessManager::Static) => "static",
            Some(FpmProcessManager::Ondemand) => "ondemand",
            _ => "dynamic",
        };
        lines.push(format!("pm = {}", pm));

        lines.push(format!(
            "pm.max_children = {}",
            pool.max_children.unwrap_or(5)
        ));

        if pm == "dynamic" {
            lines.push(format!(
                "pm.start_servers = {}",
                pool.start_servers.unwrap_or(2)
            ));
            lines.push(format!(
                "pm.min_spare_servers = {}",
                pool.min_spare_servers.unwrap_or(1)
            ));
            lines.push(format!(
                "pm.max_spare_servers = {}",
                pool.max_spare_servers.unwrap_or(3)
            ));
        }

        if let Some(v) = pool.max_requests {
            lines.push(format!("pm.max_requests = {}", v));
        }
        if let Some(v) = pool.process_idle_timeout {
            lines.push(format!("pm.process_idle_timeout = {}s", v));
        }

        if let Some(ref path) = pool.status_path {
            lines.push(format!("pm.status_path = {}", path));
        }
        if let Some(ref path) = pool.ping_path {
            lines.push(format!("ping.path = {}", path));
            lines.push("ping.response = pong".to_string());
        }

        if let Some(v) = pool.request_terminate_timeout {
            lines.push(format!("request_terminate_timeout = {}s", v));
        }
        if let Some(v) = pool.request_slowlog_timeout {
            lines.push(format!("request_slowlog_timeout = {}s", v));
            lines.push(format!(
                "slowlog = /var/log/php{}-fpm-{}-slow.log",
                pool.version, pool.name
            ));
        }

        if let Some(ref vals) = pool.php_admin_values {
            for (k, v) in vals {
                lines.push(format!("php_admin_value[{}] = {}", k, v));
            }
        }
        if let Some(ref vals) = pool.php_values {
            for (k, v) in vals {
                lines.push(format!("php_value[{}] = {}", k, v));
            }
        }
        if let Some(ref vals) = pool.env_vars {
            for (k, v) in vals {
                lines.push(format!("env[{}] = {}", k, v));
            }
        }

        lines.push(String::new());
        lines.join("\n")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parsing helpers
// ═══════════════════════════════════════════════════════════════════════════════

/// Parse an FPM pool `.conf` file into a `PhpFpmPool`.
fn parse_pool_config(
    content: &str,
    version: &str,
    config_file: &str,
    enabled: bool,
) -> Option<PhpFpmPool> {
    let mut name = None;
    let mut user = None;
    let mut group = None;
    let mut listen = String::new();
    let mut pm = FpmProcessManager::Dynamic;
    let mut max_children = None;
    let mut start_servers = None;
    let mut min_spare_servers = None;
    let mut max_spare_servers = None;
    let mut max_requests = None;
    let mut process_idle_timeout = None;
    let mut status_path = None;
    let mut ping_path = None;
    let mut ping_response = None;
    let mut slowlog = None;
    let mut request_slowlog_timeout = None;
    let mut request_terminate_timeout = None;
    let mut php_admin_values = HashMap::new();
    let mut php_values = HashMap::new();
    let mut env_vars = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }

        // Section header e.g. [www]
        if line.starts_with('[') && line.ends_with(']') {
            name = Some(line[1..line.len() - 1].to_string());
            continue;
        }

        // Key = value pairs
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            // Handle php_admin_value[key] = value
            if let Some(inner) = key
                .strip_prefix("php_admin_value[")
                .and_then(|s| s.strip_suffix(']'))
            {
                php_admin_values.insert(inner.to_string(), value.to_string());
                continue;
            }
            if let Some(inner) = key
                .strip_prefix("php_value[")
                .and_then(|s| s.strip_suffix(']'))
            {
                php_values.insert(inner.to_string(), value.to_string());
                continue;
            }
            if let Some(inner) = key
                .strip_prefix("env[")
                .and_then(|s| s.strip_suffix(']'))
            {
                env_vars.insert(inner.to_string(), value.to_string());
                continue;
            }

            match key {
                "user" => user = Some(value.to_string()),
                "group" => group = Some(value.to_string()),
                "listen" => listen = value.to_string(),
                "pm" => {
                    pm = match value {
                        "static" => FpmProcessManager::Static,
                        "ondemand" => FpmProcessManager::Ondemand,
                        _ => FpmProcessManager::Dynamic,
                    };
                }
                "pm.max_children" => max_children = value.parse().ok(),
                "pm.start_servers" => start_servers = value.parse().ok(),
                "pm.min_spare_servers" => min_spare_servers = value.parse().ok(),
                "pm.max_spare_servers" => max_spare_servers = value.parse().ok(),
                "pm.max_requests" => max_requests = value.parse().ok(),
                "pm.process_idle_timeout" => {
                    process_idle_timeout = value.trim_end_matches('s').parse().ok();
                }
                "pm.status_path" => status_path = Some(value.to_string()),
                "ping.path" => ping_path = Some(value.to_string()),
                "ping.response" => ping_response = Some(value.to_string()),
                "slowlog" => slowlog = Some(value.to_string()),
                "request_slowlog_timeout" => {
                    request_slowlog_timeout = value.trim_end_matches('s').parse().ok();
                }
                "request_terminate_timeout" => {
                    request_terminate_timeout = value.trim_end_matches('s').parse().ok();
                }
                _ => {}
            }
        }
    }

    Some(PhpFpmPool {
        name: name?,
        version: version.to_string(),
        user,
        group,
        listen,
        pm,
        max_children,
        start_servers,
        min_spare_servers,
        max_spare_servers,
        max_requests,
        process_idle_timeout,
        status_path,
        ping_path,
        ping_response,
        slowlog,
        request_slowlog_timeout,
        request_terminate_timeout,
        config_file: config_file.to_string(),
        enabled,
        php_admin_values,
        php_values,
        env_vars,
    })
}

/// Serialize a `PhpFpmPool` back into `.conf` format.
fn pool_to_config(pool: &PhpFpmPool) -> String {
    let mut lines = Vec::new();
    lines.push(format!("[{}]", pool.name));

    if let Some(ref u) = pool.user {
        lines.push(format!("user = {}", u));
    }
    if let Some(ref g) = pool.group {
        lines.push(format!("group = {}", g));
    }
    lines.push(format!("listen = {}", pool.listen));

    let pm_str = match pool.pm {
        FpmProcessManager::Static => "static",
        FpmProcessManager::Ondemand => "ondemand",
        FpmProcessManager::Dynamic => "dynamic",
    };
    lines.push(format!("pm = {}", pm_str));

    if let Some(v) = pool.max_children {
        lines.push(format!("pm.max_children = {}", v));
    }
    if let Some(v) = pool.start_servers {
        lines.push(format!("pm.start_servers = {}", v));
    }
    if let Some(v) = pool.min_spare_servers {
        lines.push(format!("pm.min_spare_servers = {}", v));
    }
    if let Some(v) = pool.max_spare_servers {
        lines.push(format!("pm.max_spare_servers = {}", v));
    }
    if let Some(v) = pool.max_requests {
        lines.push(format!("pm.max_requests = {}", v));
    }
    if let Some(v) = pool.process_idle_timeout {
        lines.push(format!("pm.process_idle_timeout = {}s", v));
    }
    if let Some(ref p) = pool.status_path {
        lines.push(format!("pm.status_path = {}", p));
    }
    if let Some(ref p) = pool.ping_path {
        lines.push(format!("ping.path = {}", p));
    }
    if let Some(ref p) = pool.ping_response {
        lines.push(format!("ping.response = {}", p));
    }
    if let Some(ref p) = pool.slowlog {
        lines.push(format!("slowlog = {}", p));
    }
    if let Some(v) = pool.request_slowlog_timeout {
        lines.push(format!("request_slowlog_timeout = {}s", v));
    }
    if let Some(v) = pool.request_terminate_timeout {
        lines.push(format!("request_terminate_timeout = {}s", v));
    }

    for (k, v) in &pool.php_admin_values {
        lines.push(format!("php_admin_value[{}] = {}", k, v));
    }
    for (k, v) in &pool.php_values {
        lines.push(format!("php_value[{}] = {}", k, v));
    }
    for (k, v) in &pool.env_vars {
        lines.push(format!("env[{}] = {}", k, v));
    }

    lines.push(String::new());
    lines.join("\n")
}

/// Parse FPM status JSON output into `PhpFpmPoolStatus`.
fn parse_pool_status(output: &str, pool_name: &str) -> PhpResult<PhpFpmPoolStatus> {
    // Strip any HTTP headers (cgi-fcgi includes them)
    let json_start = output.find('{').ok_or_else(|| {
        PhpError::fpm_not_running(format!("no status response for pool {}", pool_name))
    })?;
    let json_str = &output[json_start..];

    let val: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| PhpError::parse(format!("status JSON: {}", e)))?;

    Ok(PhpFpmPoolStatus {
        pool: val["pool"].as_str().unwrap_or(pool_name).to_string(),
        process_manager: val["process manager"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        start_time: val["start time"].as_str().map(|s| s.to_string()),
        start_since: val["start since"].as_u64(),
        accepted_conn: val["accepted conn"].as_u64().unwrap_or(0),
        listen_queue: val["listen queue"].as_u64().unwrap_or(0) as u32,
        max_listen_queue: val["max listen queue"].as_u64().unwrap_or(0) as u32,
        listen_queue_len: val["listen queue len"].as_u64().unwrap_or(0) as u32,
        idle_processes: val["idle processes"].as_u64().unwrap_or(0) as u32,
        active_processes: val["active processes"].as_u64().unwrap_or(0) as u32,
        total_processes: val["total processes"].as_u64().unwrap_or(0) as u32,
        max_active_processes: val["max active processes"].as_u64().unwrap_or(0) as u32,
        max_children_reached: val["max children reached"].as_u64().unwrap_or(0) as u32,
        slow_requests: val["slow requests"].as_u64().unwrap_or(0),
    })
}

/// Parse FPM full-status JSON output into worker process list.
fn parse_worker_processes(output: &str) -> PhpResult<Vec<FpmWorkerProcess>> {
    let json_start = output
        .find('{')
        .ok_or_else(|| PhpError::fpm_not_running("no status response for worker list"))?;
    let json_str = &output[json_start..];

    let val: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| PhpError::parse(format!("status JSON: {}", e)))?;

    let procs = val["processes"]
        .as_array()
        .ok_or_else(|| PhpError::parse("missing 'processes' array in status output"))?;

    let mut workers = Vec::new();
    for p in procs {
        workers.push(FpmWorkerProcess {
            pid: p["pid"].as_u64().unwrap_or(0) as u32,
            state: p["state"].as_str().unwrap_or("unknown").to_string(),
            start_time: p["start time"].as_str().map(|s| s.to_string()),
            start_since: p["start since"].as_u64(),
            requests: p["requests"].as_u64().unwrap_or(0),
            request_duration: p["request duration"].as_u64(),
            request_method: p["request method"].as_str().map(|s| s.to_string()),
            request_uri: p["request URI"].as_str().map(|s| s.to_string()),
            content_length: p["content length"].as_u64(),
            user: p["user"].as_str().map(|s| s.to_string()),
            script: p["script"].as_str().map(|s| s.to_string()),
            last_request_cpu: p["last request cpu"].as_f64(),
            last_request_memory: p["last request memory"].as_u64(),
        });
    }

    Ok(workers)
}
