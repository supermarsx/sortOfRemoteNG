use super::http::*;

/// Fetch a URL with credentials and custom configuration
#[tauri::command]
pub async fn http_fetch(
    config: HttpConnectionConfig,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let service = service.lock().await;
    service.fetch(config).await
}

/// Simple GET request with optional basic auth
#[tauri::command]
pub async fn http_get(
    url: String,
    username: Option<String>,
    password: Option<String>,
    headers: Option<HashMap<String, String>>,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let config = HttpConnectionConfig {
        url,
        method: "GET".to_string(),
        auth_type: if username.is_some() {
            Some("basic".to_string())
        } else {
            None
        },
        username,
        password,
        bearer_token: None,
        headers: headers.unwrap_or_default(),
        body: None,
        timeout: 30,
        follow_redirects: true,
        verify_ssl: true,
        min_tls_version: "1.2".to_string(),
    };

    let service = service.lock().await;
    service.fetch(config).await
}

/// POST request with optional authentication
#[tauri::command]
pub async fn http_post(
    url: String,
    body: Option<String>,
    username: Option<String>,
    password: Option<String>,
    headers: Option<HashMap<String, String>>,
    service: tauri::State<'_, HttpServiceState>,
) -> Result<HttpResponse, String> {
    let config = HttpConnectionConfig {
        url,
        method: "POST".to_string(),
        auth_type: if username.is_some() {
            Some("basic".to_string())
        } else {
            None
        },
        username,
        password,
        bearer_token: None,
        headers: headers.unwrap_or_default(),
        body,
        timeout: 30,
        follow_redirects: true,
        verify_ssl: true,
        min_tls_version: "1.2".to_string(),
    };

    let service = service.lock().await;
    service.fetch(config).await
}

/// Start a basic auth proxy mediator.
///
/// Spawns a local TCP server on `127.0.0.1:0` (OS auto-assigns a free port)
/// that proxies all requests to the target URL with basic authentication
/// headers injected. The returned `proxy_url` should be loaded in the iframe.
#[tauri::command]
pub async fn start_basic_auth_proxy(
    config: BasicAuthProxyConfig,
    _service: tauri::State<'_, HttpServiceState>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<ProxyMediatorResponse, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let target_url = config.target_url.clone();
    let verify_ssl = config.verify_ssl;
    let min_tls = config.min_tls_version.clone();
    let connection_id = config.connection_id.clone();

    // ---- Per-connection isolation ----
    // If a proxy already exists for this connection_id, shut it down first so
    // we never have duplicate proxies for the same connection.
    if !connection_id.is_empty() {
        let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        let stale_ids: Vec<String> = mgr
            .sessions
            .iter()
            .filter(|(_, entry)| entry.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect();
        for stale in stale_ids {
            if let Some(mut entry) = mgr.sessions.remove(&stale) {
                if let Some(tx) = entry.shutdown_tx.take() {
                    let _ = tx.send(());
                }
            }
        }
    }

    // Extract origin (scheme://host:port) for URL rewriting in responses.
    let target_origin = {
        if let Some(scheme_end) = target_url.find("://") {
            let after_scheme = &target_url[scheme_end + 3..];
            match after_scheme.find('/') {
                Some(i) => target_url[..scheme_end + 3 + i].to_string(),
                None => target_url.clone(),
            }
        } else {
            target_url.clone()
        }
    };

    // Build an async reqwest client for this session with connection keep-alive
    // and reasonable timeouts to avoid stale-connection errors.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(!verify_ssl)
        .min_tls_version(resolve_min_tls_version(&min_tls))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to create proxy HTTP client: {}", e))?;

    // Bind to a random free port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy listener: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    let request_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let last_error: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));

    // Shared state for the axum handler.
    let proxy_state = Arc::new(AxumProxyState {
        session_id: session_id.clone(),
        target_url: target_url.clone(),
        username: config.username.clone(),
        password: config.password.clone(),
        target_origin: target_origin.clone(),
        client,
        request_count: request_count.clone(),
        error_count: error_count.clone(),
        last_error: last_error.clone(),
        global_sessions: (*sessions).clone(),
    });

    let app = axum::Router::new()
        .fallback(axum_proxy_handler)
        .with_state(proxy_state);

    // Shutdown channel.
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Spawn the server.
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
            })
            .await
            .ok();
    });

    // Store the session.
    {
        let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        mgr.sessions.insert(
            session_id.clone(),
            ProxySessionEntry {
                target_url: target_url.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                target_origin,
                connection_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                local_port,
                min_tls_version: min_tls,
                verify_ssl,
                request_count,
                error_count,
                last_error,
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    Ok(ProxyMediatorResponse {
        local_port,
        session_id: session_id.clone(),
        proxy_url: format!("http://127.0.0.1:{}/", local_port),
    })
}

/// Stop a running basic auth proxy session.
#[tauri::command]
pub fn stop_basic_auth_proxy(
    session_id: String,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(mut entry) = mgr.sessions.remove(&session_id) {
        // Signal the axum server to shut down.
        if let Some(tx) = entry.shutdown_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    } else {
        Err(format!("Proxy session {} not found", session_id))
    }
}

/// List all active proxy sessions.
#[tauri::command]
pub fn list_proxy_sessions(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyMediatorResponse>, String> {
    let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr
        .sessions
        .iter()
        .map(|(id, entry)| ProxyMediatorResponse {
            local_port: entry.local_port,
            session_id: id.clone(),
            proxy_url: format!("http://127.0.0.1:{}/", entry.local_port),
        })
        .collect())
}

/// Get detailed information about all proxy sessions.
#[tauri::command]
pub fn get_proxy_session_details(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxySessionDetail>, String> {
    let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr
        .sessions
        .iter()
        .map(|(id, entry)| ProxySessionDetail {
            session_id: id.clone(),
            target_url: entry.target_url.clone(),
            username: entry.username.clone(),
            connection_id: entry.connection_id.clone(),
            proxy_url: format!("http://127.0.0.1:{}/", entry.local_port),
            created_at: entry.created_at.clone(),
            request_count: entry.request_count.load(Ordering::Relaxed),
            error_count: entry.error_count.load(Ordering::Relaxed),
            last_error: entry.last_error.lock().ok().and_then(|g| g.clone()),
        })
        .collect())
}

/// Get the request log from the proxy manager.
#[tauri::command]
pub fn get_proxy_request_log(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyRequestLogEntry>, String> {
    let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(mgr.request_log.clone())
}

/// Clear the proxy request log.
#[tauri::command]
pub fn clear_proxy_request_log(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    mgr.request_log.clear();
    Ok(())
}

/// Stop all active proxy sessions.
#[tauri::command]
pub fn stop_all_proxy_sessions(
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<u32, String> {
    let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    let count = mgr.sessions.len() as u32;
    for (_id, mut entry) in mgr.sessions.drain() {
        if let Some(tx) = entry.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
    Ok(count)
}

/// Check whether a proxy session's local TCP port is still accepting
/// connections.  Returns a health status for each requested session ID.
#[tauri::command]
pub async fn check_proxy_health(
    session_ids: Vec<String>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<Vec<ProxyHealthResult>, String> {
    // Collect info while holding the lock briefly.
    let entries: Vec<(String, u16)> = {
        let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        session_ids
            .iter()
            .filter_map(|id| mgr.sessions.get(id).map(|e| (id.clone(), e.local_port)))
            .collect()
    };

    let mut results: Vec<ProxyHealthResult> = Vec::new();

    // For sessions that are no longer in the manager at all, report dead.
    for id in &session_ids {
        if !entries.iter().any(|(eid, _)| eid == id) {
            results.push(ProxyHealthResult {
                session_id: id.clone(),
                alive: false,
                port: 0,
                error: Some("Session not found in manager".into()),
            });
        }
    }

    // Probe each known port with a quick TCP connect.
    for (id, port) in entries {
        let addr = format!("127.0.0.1:{}", port);
        let alive = tokio::time::timeout(
            std::time::Duration::from_millis(1500),
            tokio::net::TcpStream::connect(&addr),
        )
        .await;
        match alive {
            Ok(Ok(_stream)) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: true,
                    port,
                    error: None,
                });
            }
            Ok(Err(e)) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: false,
                    port,
                    error: Some(format!("Connect failed: {}", e)),
                });
            }
            Err(_) => {
                results.push(ProxyHealthResult {
                    session_id: id,
                    alive: false,
                    port,
                    error: Some("Health check timed out".into()),
                });
            }
        }
    }

    Ok(results)
}

/// Restart a dead proxy session.  Uses the stored credentials and target_url
/// from the original session to spin up a fresh axum server (potentially on a
/// different local port).  Returns the new proxy URL.
#[tauri::command]
pub async fn restart_proxy_session(
    session_id: String,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<ProxyMediatorResponse, String> {
    // Extract the config from the existing (dead) session entry.
    let (target_url, username, password, target_origin, connection_id, verify_ssl, min_tls) = {
        let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        let entry = mgr
            .sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        (
            entry.target_url.clone(),
            entry.username.clone(),
            entry.password.clone(),
            entry.target_origin.clone(),
            entry.connection_id.clone(),
            entry.verify_ssl,
            entry.min_tls_version.clone(),
        )
    };

    // Shut down the old axum server (may already be dead).
    {
        let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        if let Some(mut entry) = mgr.sessions.remove(&session_id) {
            if let Some(tx) = entry.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    // Build a fresh reqwest client.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(!verify_ssl)
        .min_tls_version(resolve_min_tls_version(&min_tls))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to create proxy HTTP client: {}", e))?;

    // Bind to a new random free port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy listener: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    let new_session_id = uuid::Uuid::new_v4().to_string();
    let request_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let last_error: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));

    let proxy_state = Arc::new(AxumProxyState {
        session_id: new_session_id.clone(),
        target_url: target_url.clone(),
        username: username.clone(),
        password: password.clone(),
        target_origin: target_origin.clone(),
        client,
        request_count: request_count.clone(),
        error_count: error_count.clone(),
        last_error: last_error.clone(),
        global_sessions: (*sessions).clone(),
    });

    let app = axum::Router::new()
        .fallback(axum_proxy_handler)
        .with_state(proxy_state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
            })
            .await
            .ok();
    });

    // Store the new session.
    {
        let mut mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        mgr.sessions.insert(
            new_session_id.clone(),
            ProxySessionEntry {
                target_url,
                username,
                password,
                target_origin,
                connection_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                local_port,
                min_tls_version: min_tls,
                verify_ssl,
                request_count,
                error_count,
                last_error,
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    Ok(ProxyMediatorResponse {
        local_port,
        session_id: new_session_id,
        proxy_url: format!("http://127.0.0.1:{}/", local_port),
    })
}

/// Fetch the TLS certificate presented by a remote server.
/// Connects using rustls with verification disabled so we can inspect
/// self-signed / untrusted certificates as well.
#[tauri::command]
pub async fn get_tls_certificate_info(
    host: String,
    port: u16,
) -> Result<TlsCertificateInfo, String> {
    let addr = format!("{}:{}", host, port);
    let connector = tokio_rustls::TlsConnector::from(build_tls_config(false)?);

    let tcp = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP connect failed: {}", e))?;

    let tls = connector
        .connect(tls_server_name(&host)?, tcp)
        .await
        .map_err(|e| format!("TLS handshake failed: {}", e))?;

    let der = peer_certificate_der(&tls)?;

    // SHA-256 fingerprint
    let mut hasher = Sha256::new();
    hasher.update(&der);
    let fingerprint = hex::encode(hasher.finalize());
    let parsed = parse_tls_certificate_details(&der, &fingerprint);

    // Build PEM
    let pem = {
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &der);
        let mut pem_str = String::from("-----BEGIN CERTIFICATE-----\n");
        for chunk in b64.as_bytes().chunks(64) {
            pem_str.push_str(std::str::from_utf8(chunk).unwrap_or_default());
            pem_str.push('\n');
        }
        pem_str.push_str("-----END CERTIFICATE-----\n");
        Some(pem_str)
    };

    Ok(TlsCertificateInfo {
        fingerprint,
        subject: parsed.subject,
        issuer: parsed.issuer,
        pem,
        valid_from: parsed.valid_from,
        valid_to: parsed.valid_to,
        serial: parsed.serial,
        signature_algorithm: parsed.signature_algorithm,
        san: parsed.san,
    })
}

/// Run a deep diagnostic probe against an HTTP/HTTPS endpoint.
///
/// Steps:
///   1. DNS Resolution (multi-address)
///   2. TCP Connect
///   3. TLS Handshake + Certificate (HTTPS only)
///   4. HTTP Request (GET/HEAD with status code, headers, timing)
///   5. Redirect Chain (if any)
///   6. Response Body Probe (first bytes, content-type, size)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn diagnose_http_connection(
    host: String,
    port: u16,
    use_tls: bool,
    path: Option<String>,
    method: Option<String>,
    expected_status: Option<u16>,
    connect_timeout_secs: Option<u64>,
    verify_ssl: Option<bool>,
) -> Result<DiagnosticReport, String> {
    let run_start = std::time::Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;
    let timeout_secs = connect_timeout_secs.unwrap_or(15);
    let timeout = std::time::Duration::from_secs(timeout_secs);
    let protocol = if use_tls { "https" } else { "http" };
    let req_path = path.unwrap_or_else(|| "/".to_string());
    let req_method = method.unwrap_or_else(|| "GET".to_string());
    let verify = verify_ssl.unwrap_or(true);

    // ── Step 1: DNS Resolution ──────────────────────────────────────────

    let (socket_addr, ip_str, _all_ips) = diagnostics::probe_dns(&host, port, &mut steps);
    let socket_addr = match socket_addr {
        Some(a) => {
            resolved_ip = ip_str;
            a
        }
        None => {
            return Ok(diagnostics::finish_report(
                &host,
                port,
                protocol,
                resolved_ip,
                steps,
                run_start,
            ));
        }
    };

    // ── Step 2: TCP Connect ─────────────────────────────────────────────
    // We use the shared probe for consistency
    let tcp_ok = diagnostics::probe_tcp(socket_addr, timeout, true, &mut steps).is_some();
    if !tcp_ok {
        return Ok(diagnostics::finish_report(
            &host,
            port,
            protocol,
            resolved_ip,
            steps,
            run_start,
        ));
    }

    // ── Step 3: TLS Handshake + Certificate (HTTPS only) ────────────────

    if use_tls {
        let h = host.clone();
        let t = std::time::Instant::now();

        match build_tls_config(verify) {
            Ok(config) => {
                let tls_connector = tokio_rustls::TlsConnector::from(config);
                let tcp = match tokio::net::TcpStream::connect(&socket_addr).await {
                    Ok(s) => s,
                    Err(e) => {
                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "fail".into(),
                            message: format!("TCP reconnect for TLS failed: {e}"),
                            duration_ms: t.elapsed().as_millis() as u64,
                            detail: None,
                        });
                        return Ok(diagnostics::finish_report(
                            &host,
                            port,
                            protocol,
                            resolved_ip,
                            steps,
                            run_start,
                        ));
                    }
                };

                match tls_connector.connect(tls_server_name(&h)?, tcp).await {
                    Ok(tls_stream) => {
                        let elapsed = t.elapsed().as_millis() as u64;

                        // Extract certificate info
                        let cert_detail = peer_certificate_der(&tls_stream).ok().and_then(|der| {
                            let mut hasher = Sha256::new();
                            hasher.update(&der);
                            let fp = hex::encode(hasher.finalize());
                            parse_tls_certificate_details(&der, &fp).diagnostic_detail
                        });

                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "pass".into(),
                            message: "TLS handshake completed, certificate obtained".into(),
                            duration_ms: elapsed,
                            detail: cert_detail,
                        });
                    }
                    Err(e) => {
                        let msg = format!("{e}");
                        let hint = if msg.contains("certificate") {
                            Some("Certificate verification failed. The server may use a self-signed, expired, or mismatched certificate.".into())
                        } else if msg.contains("handshake") || msg.contains("alert") {
                            Some("TLS protocol negotiation failed. Check the server supports modern TLS versions (1.2+).".into())
                        } else {
                            None
                        };
                        steps.push(DiagnosticStep {
                            name: "TLS Handshake".into(),
                            status: "fail".into(),
                            message: format!("TLS handshake failed: {}", msg),
                            duration_ms: t.elapsed().as_millis() as u64,
                            detail: hint,
                        });
                        // Don't return yet — we can still try HTTP (useful for diagnostic info)
                    }
                }
            }
            Err(e) => {
                steps.push(DiagnosticStep {
                    name: "TLS Handshake".into(),
                    status: "fail".into(),
                    message: format!("Failed to create TLS config: {e}"),
                    duration_ms: t.elapsed().as_millis() as u64,
                    detail: None,
                });
            }
        }
    }

    // ── Step 4: HTTP Request ────────────────────────────────────────────

    let t = std::time::Instant::now();
    let url = format!("{}://{}:{}{}", protocol, host, port, req_path);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(!verify)
        .redirect(reqwest::redirect::Policy::none()) // we'll handle redirects manually
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "HTTP Request".into(),
                status: "fail".into(),
                message: format!("Failed to create HTTP client: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            return Ok(diagnostics::finish_report(
                &host,
                port,
                protocol,
                resolved_ip,
                steps,
                run_start,
            ));
        }
    };

    let request = match req_method.to_uppercase().as_str() {
        "HEAD" => client.head(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let headers = response.headers().clone();
            let elapsed = t.elapsed().as_millis() as u64;

            // Gather header info
            let server = headers
                .get("server")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("(not reported)")
                .to_string();
            let content_type = headers
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("(not reported)")
                .to_string();
            let content_length = headers
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_string());

            // Check expected status
            let status_ok = expected_status
                .map(|exp| exp == status_code)
                .unwrap_or(status.is_success() || status.is_redirection());

            steps.push(DiagnosticStep {
                name: "HTTP Response".into(),
                status: if status_ok { "pass" } else { "warn" }.into(),
                message: format!(
                    "{} {} → {} {} ({}ms)",
                    req_method,
                    req_path,
                    status_code,
                    status.canonical_reason().unwrap_or(""),
                    elapsed
                ),
                duration_ms: elapsed,
                detail: Some(format!(
                    "Server: {}\nContent-Type: {}\nContent-Length: {}\nHeaders: {}",
                    server,
                    content_type,
                    content_length.unwrap_or_else(|| "(not reported)".into()),
                    headers.len()
                )),
            });

            // ── Step 5: Redirect check ──────────────────────────────────
            if status.is_redirection() {
                let location = headers
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("(missing)");

                steps.push(DiagnosticStep {
                    name: "Redirect".into(),
                    status: "info".into(),
                    message: format!("Redirects to: {}", location),
                    duration_ms: 0,
                    detail: Some(format!(
                        "Status {} indicates a redirect. Follow the Location header to reach the final resource.",
                        status_code
                    )),
                });
            }

            // ── Step 6: Response Body Probe ─────────────────────────────
            let t2 = std::time::Instant::now();
            match response.bytes().await {
                Ok(body) => {
                    let body_len = body.len();
                    let preview: String =
                        String::from_utf8_lossy(&body[..std::cmp::min(body_len, 200)])
                            .chars()
                            .filter(|c| !c.is_control() || *c == '\n')
                            .collect();

                    steps.push(DiagnosticStep {
                        name: "Response Body".into(),
                        status: "info".into(),
                        message: format!("Received {} bytes", body_len),
                        duration_ms: t2.elapsed().as_millis() as u64,
                        detail: if !preview.trim().is_empty() {
                            Some(format!("Preview: {}", preview.trim()))
                        } else {
                            None
                        },
                    });
                }
                Err(e) => {
                    steps.push(DiagnosticStep {
                        name: "Response Body".into(),
                        status: "warn".into(),
                        message: format!("Could not read response body: {e}"),
                        duration_ms: t2.elapsed().as_millis() as u64,
                        detail: None,
                    });
                }
            }
        }
        Err(e) => {
            let msg = format!("{e}");
            let hint = if msg.contains("timeout") || msg.contains("timed out") {
                Some(format!(
                    "The server did not respond within {}s. It may be overloaded, \
                     behind a firewall, or the URL may be incorrect.",
                    timeout_secs
                ))
            } else if msg.contains("connection refused") {
                Some(format!(
                    "Connection refused on {}:{}. Verify the web server is running \
                     and listening on this port.",
                    host, port
                ))
            } else if msg.contains("certificate") || msg.contains("ssl") || msg.contains("tls") {
                Some("TLS/SSL error during the HTTP request. Try with verify_ssl=false for diagnostics.".into())
            } else {
                None
            };

            steps.push(DiagnosticStep {
                name: "HTTP Request".into(),
                status: "fail".into(),
                message: format!("Request failed: {}", msg),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: hint,
            });
        }
    }

    Ok(diagnostics::finish_report(
        &host,
        port,
        protocol,
        resolved_ip,
        steps,
        run_start,
    ))
}

#[tauri::command]
pub fn start_web_recording(
    session_id: String,
    record_headers: Option<bool>,
    sessions: tauri::State<'_, ProxySessionManagerState>,
) -> Result<(), String> {
    // Verify the proxy session exists
    let mgr = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entry = mgr
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Proxy session {} not found", session_id))?;

    let host = {
        // Extract host from target_url
        if let Some(scheme_end) = entry.target_url.find("://") {
            let after = &entry.target_url[scheme_end + 3..];
            after.split('/').next().unwrap_or("unknown").to_string()
        } else {
            entry.target_url.clone()
        }
    };

    let target_url = entry.target_url.clone();
    let connection_id = entry.connection_id.clone();
    drop(mgr);

    let mut recordings = active_web_recordings()
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if recordings.contains_key(&session_id) {
        return Err("Web recording already active for this session".into());
    }

    recordings.insert(
        session_id.clone(),
        WebRecordingState {
            start_time: std::time::Instant::now(),
            start_utc: chrono::Utc::now(),
            session_id: session_id.clone(),
            target_url,
            connection_id,
            host,
            entries: Vec::new(),
            record_headers: record_headers.unwrap_or(true),
        },
    );

    Ok(())
}

#[tauri::command]
pub fn stop_web_recording(session_id: String) -> Result<WebRecording, String> {
    let mut recordings = active_web_recordings()
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let state = recordings
        .remove(&session_id)
        .ok_or_else(|| format!("No active web recording for session {}", session_id))?;

    let total_bytes: u64 = state
        .entries
        .iter()
        .map(|e| e.request_body_size + e.response_body_size)
        .sum();

    Ok(WebRecording {
        metadata: WebRecordingMetadata {
            session_id: state.session_id,
            start_time: state.start_utc.to_rfc3339(),
            end_time: Some(chrono::Utc::now().to_rfc3339()),
            host: state.host,
            target_url: state.target_url,
            duration_ms: state.start_time.elapsed().as_millis() as u64,
            entry_count: state.entries.len(),
            total_bytes_transferred: total_bytes,
        },
        entries: state.entries,
    })
}

#[tauri::command]
pub fn is_web_recording(session_id: String) -> Result<bool, String> {
    let recordings = active_web_recordings()
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(recordings.contains_key(&session_id))
}

#[tauri::command]
pub fn get_web_recording_status(
    session_id: String,
) -> Result<Option<WebRecordingMetadata>, String> {
    let recordings = active_web_recordings()
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(recordings.get(&session_id).map(|state| {
        let total_bytes: u64 = state
            .entries
            .iter()
            .map(|e| e.request_body_size + e.response_body_size)
            .sum();
        WebRecordingMetadata {
            session_id: state.session_id.clone(),
            start_time: state.start_utc.to_rfc3339(),
            end_time: None,
            host: state.host.clone(),
            target_url: state.target_url.clone(),
            duration_ms: state.start_time.elapsed().as_millis() as u64,
            entry_count: state.entries.len(),
            total_bytes_transferred: total_bytes,
        }
    }))
}

#[tauri::command]
pub fn export_web_recording_har(recording: WebRecording) -> Result<String, String> {
    // HAR 1.2 format
    let entries: Vec<serde_json::Value> = recording
        .entries
        .iter()
        .map(|e| {
            serde_json::json!({
                "startedDateTime": recording.metadata.start_time,
                "time": e.duration_ms,
                "request": {
                    "method": e.method,
                    "url": e.url,
                    "httpVersion": "HTTP/1.1",
                    "headers": e.request_headers.iter().map(|(k, v)| {
                        serde_json::json!({"name": k, "value": v})
                    }).collect::<Vec<_>>(),
                    "queryString": [],
                    "headersSize": -1,
                    "bodySize": e.request_body_size as i64,
                },
                "response": {
                    "status": e.status,
                    "statusText": "",
                    "httpVersion": "HTTP/1.1",
                    "headers": e.response_headers.iter().map(|(k, v)| {
                        serde_json::json!({"name": k, "value": v})
                    }).collect::<Vec<_>>(),
                    "content": {
                        "size": e.response_body_size as i64,
                        "mimeType": e.content_type.as_deref().unwrap_or(""),
                    },
                    "redirectURL": "",
                    "headersSize": -1,
                    "bodySize": e.response_body_size as i64,
                },
                "cache": {},
                "timings": {
                    "send": 0,
                    "wait": e.duration_ms,
                    "receive": 0,
                },
            })
        })
        .collect();

    let har = serde_json::json!({
        "log": {
            "version": "1.2",
            "creator": {
                "name": "sortOfRemoteNG",
                "version": "1.0",
            },
            "pages": [],
            "entries": entries,
        }
    });

    serde_json::to_string_pretty(&har).map_err(|e| format!("JSON serialization failed: {}", e))
}

