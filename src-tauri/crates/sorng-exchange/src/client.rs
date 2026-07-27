// ─── Exchange Integration – HTTP & PowerShell execution client ───────────────
//!
//! Dual-mode client: Graph API / REST for Exchange Online,
//! PowerShell script execution for on-prem Exchange.

use crate::auth;
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sorng_powershell::runspace_session::{
    NoopPowerShellSessionSink, PowerShellEventReplay, PowerShellSessionError,
    PowerShellSessionNetworkPath, PowerShellSessionOptions, PowerShellSessionPhase,
    PowerShellSessionService, PowerShellSessionServiceState, PowerShellStreamKind,
    PowerShellWsmanAuth, PowerShellWsmanEndpointProfile, PowerShellWsmanSessionOptions,
    PowerShellWsmanTrustPolicy,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

struct ExchangePowerShellSession {
    service: PowerShellSessionServiceState,
    session_id: String,
    command_lock: Mutex<()>,
}

/// Unified Exchange client supporting both Graph REST and PowerShell paths.
pub struct ExchangeClient {
    pub http: HttpClient,
    pub config: ExchangeConnectionConfig,
    pub graph_token: Option<ExchangeToken>,
    pub exo_token: Option<ExchangeToken>,
    pub ps_connected: bool,
    ps_session: Option<Arc<ExchangePowerShellSession>>,
}

impl ExchangeClient {
    pub fn new(config: ExchangeConnectionConfig) -> ExchangeResult<Self> {
        let mut builder = HttpClient::builder().timeout(Duration::from_secs(config.timeout_secs));
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| ExchangeError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| ExchangeError::connection(format!("http client build: {e}")))?;

        Ok(Self {
            http,
            config,
            graph_token: None,
            exo_token: None,
            ps_connected: false,
            ps_session: None,
        })
    }

    // ─── Token management ────────────────────────────────────────────────

    /// Ensure the Graph API token is valid, acquiring or refreshing as needed.
    pub async fn ensure_graph_token(&mut self) -> ExchangeResult<()> {
        let creds = self
            .config
            .online
            .as_ref()
            .ok_or_else(|| ExchangeError::auth("online credentials not configured"))?;

        if let Some(ref t) = self.graph_token {
            if !t.is_expired() {
                return Ok(());
            }
        }
        debug!("Graph token expired or missing – acquiring");
        let token = auth::acquire_graph_token(&self.http, creds).await?;
        self.graph_token = Some(token);
        Ok(())
    }

    /// Ensure the EXO management token is valid.
    pub async fn ensure_exo_token(&mut self) -> ExchangeResult<()> {
        let creds = self
            .config
            .online
            .as_ref()
            .ok_or_else(|| ExchangeError::auth("online credentials not configured"))?;

        if let Some(ref t) = self.exo_token {
            if !t.is_expired() {
                return Ok(());
            }
        }
        debug!("EXO token expired or missing – acquiring");
        let token = auth::acquire_exo_token(&self.http, creds).await?;
        self.exo_token = Some(token);
        Ok(())
    }

    fn bearer_graph(&self) -> ExchangeResult<String> {
        self.graph_token
            .as_ref()
            .map(|t| format!("Bearer {}", t.access_token))
            .ok_or_else(|| ExchangeError::auth("not authenticated (no Graph token)"))
    }

    #[allow(dead_code)]
    fn bearer_exo(&self) -> ExchangeResult<String> {
        self.exo_token
            .as_ref()
            .map(|t| format!("Bearer {}", t.access_token))
            .ok_or_else(|| ExchangeError::auth("not authenticated (no EXO token)"))
    }

    // ─── Graph REST helpers ──────────────────────────────────────────────

    /// GET a single JSON resource from Graph API.
    pub async fn graph_get<T: DeserializeOwned>(&self, path: &str) -> ExchangeResult<T> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph GET {url}");
        let resp = self
            .http
            .get(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph GET failed: {e}")))?;

        self.handle_response(resp).await
    }

    /// GET a paged list from Graph API.
    pub async fn graph_list<T: DeserializeOwned + Default>(
        &self,
        path: &str,
    ) -> ExchangeResult<Vec<T>> {
        let mut results = Vec::new();
        let mut url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        loop {
            debug!("Graph LIST {url}");
            let resp = self
                .http
                .get(&url)
                .header("Authorization", &auth)
                .header("Content-Type", "application/json")
                .send()
                .await
                .map_err(|e| ExchangeError::connection(format!("Graph LIST failed: {e}")))?;

            let list: GraphList<T> = self.handle_response(resp).await?;
            results.extend(list.value);
            match list.next_link {
                Some(next) if !next.is_empty() => url = next,
                _ => break,
            }
        }
        Ok(results)
    }

    /// POST JSON to Graph API.
    pub async fn graph_post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ExchangeResult<T> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph POST {url}");
        let resp = self
            .http
            .post(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph POST failed: {e}")))?;

        self.handle_response(resp).await
    }

    /// PATCH JSON on Graph API.
    pub async fn graph_patch<B: Serialize>(&self, path: &str, body: &B) -> ExchangeResult<()> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph PATCH {url}");
        let resp = self
            .http
            .patch(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph PATCH failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("Graph PATCH {status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        Ok(())
    }

    /// DELETE on Graph API.
    pub async fn graph_delete(&self, path: &str) -> ExchangeResult<()> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph DELETE {url}");
        let resp = self
            .http
            .delete(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph DELETE failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("Graph DELETE {status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        Ok(())
    }

    // ─── PowerShell execution helpers ────────────────────────────────────

    /// Validate that the configured on-premises authentication mode can be
    /// completed by the current WinRM transport.
    pub fn validate_ps_capability(&self) -> ExchangeResult<()> {
        let creds = self
            .config
            .on_prem
            .as_ref()
            .ok_or_else(|| ExchangeError::validation("on-prem credentials required"))?;
        build_ps_session_options(creds, self.config.timeout_secs).map(|_| ())
    }

    /// Open a persistent Exchange Management Shell runspace through the shared
    /// PowerShell remoting engine.
    pub async fn connect_power_shell(&mut self) -> ExchangeResult<()> {
        if self.ps_session.is_some() {
            self.ps_connected = true;
            return Ok(());
        }

        let creds = self
            .config
            .on_prem
            .as_ref()
            .ok_or_else(|| ExchangeError::validation("on-prem credentials required"))?;
        let options = build_ps_session_options(creds, self.config.timeout_secs)?;
        let service = PowerShellSessionService::new();
        let session_id = service
            .open_session(options, Arc::new(NoopPowerShellSessionSink))
            .await
            .map_err(|e| {
                ExchangeError::connection(format!(
                    "failed to open Exchange Management Shell on {}:{}: {e} ({})",
                    creds.server,
                    creds.port,
                    e.code()
                ))
            })?;

        self.ps_session = Some(Arc::new(ExchangePowerShellSession {
            service,
            session_id,
            command_lock: Mutex::new(()),
        }));
        self.ps_connected = true;

        // Creating a runspace only proves that WSMan accepted the shell. Probe
        // an Exchange cmdlet before reporting the integration as connected.
        if let Err(error) = self
            .run_ps(
                "$ErrorActionPreference = 'Stop'; \
                 Get-Command Get-Mailbox -ErrorAction Stop | Out-Null; \
                 Write-Output 'EMS_CONNECTED'",
            )
            .await
        {
            let _ = self.disconnect_power_shell().await;
            return Err(ExchangeError::connection(format!(
                "Exchange Management Shell opened, but Exchange cmdlets are unavailable: {}",
                error.message
            )));
        }

        Ok(())
    }

    /// Close the persistent Exchange Management Shell runspace.
    pub async fn disconnect_power_shell(&mut self) -> ExchangeResult<()> {
        self.disconnect_power_shell_using(|session| async move {
            session.service.close_session(&session.session_id).await
        })
        .await
    }

    async fn disconnect_power_shell_using<F, Fut>(&mut self, close: F) -> ExchangeResult<()>
    where
        F: FnOnce(Arc<ExchangePowerShellSession>) -> Fut,
        Fut: std::future::Future<Output = Result<(), PowerShellSessionError>>,
    {
        let Some(session) = self.ps_session.as_ref().cloned() else {
            self.ps_connected = false;
            return Ok(());
        };

        match close(session).await {
            Ok(()) | Err(PowerShellSessionError::SessionNotFound) => {
                self.ps_session = None;
                self.ps_connected = false;
                Ok(())
            }
            Err(error) => Err(ExchangeError::powershell(format!(
                "failed to close EMS session: {error}"
            ))),
        }
    }

    /// Execute a PowerShell command and return the raw stdout.
    pub async fn run_ps(&self, script: &str) -> ExchangeResult<String> {
        let session = self.ps_session.as_ref().ok_or_else(|| {
            ExchangeError::powershell(
                "Exchange Management Shell is not connected; connect the on-premises session first",
            )
        })?;
        // One persistent runspace can execute one pipeline at a time. Hold the
        // session-local gate across cursor capture, execution, completion and
        // replay collection so concurrent tabs cannot consume each other's
        // terminal state or output.
        let _command_guard = session.command_lock.lock().await;
        let initial = session
            .service
            .replay(&session.session_id, None)
            .await
            .map_err(|e| ps_session_error("read EMS event cursor", &e))?;
        let before = session
            .service
            .session(&session.session_id)
            .await
            .map_err(|e| ps_session_error("read EMS session state", &e))?;
        let terminal_count = before
            .stats
            .pipelines_completed
            .saturating_add(before.stats.pipelines_failed)
            .saturating_add(before.stats.pipelines_cancelled);
        let started = session
            .service
            .start_pipeline(&session.session_id, script.to_string(), false)
            .await
            .map_err(|e| ps_session_error("start EMS command", &e))?;

        let wait_for_completion = async {
            loop {
                let current = session
                    .service
                    .session(&session.session_id)
                    .await
                    .map_err(|e| ps_session_error("poll EMS command", &e))?;
                if matches!(
                    current.phase,
                    PowerShellSessionPhase::Failed
                        | PowerShellSessionPhase::Closed
                        | PowerShellSessionPhase::Closing
                ) {
                    return Err(ExchangeError::powershell(format!(
                        "Exchange Management Shell session ended while pipeline {} was running",
                        started.pipeline_id
                    )));
                }
                let current_terminal_count = current
                    .stats
                    .pipelines_completed
                    .saturating_add(current.stats.pipelines_failed)
                    .saturating_add(current.stats.pipelines_cancelled);
                if current.active_pipeline_id.as_deref() != Some(&started.pipeline_id)
                    && current_terminal_count > terminal_count
                {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };

        match tokio::time::timeout(
            Duration::from_secs(self.config.timeout_secs),
            wait_for_completion,
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => {
                let _ = session.service.cancel_pipeline(&session.session_id).await;
                return Err(ExchangeError::new(
                    ExchangeErrorKind::Timeout,
                    format!(
                        "Exchange Management Shell pipeline {} timed out after {} seconds",
                        started.pipeline_id, self.config.timeout_secs
                    ),
                ));
            }
        }

        let replay = session
            .service
            .replay(
                &session.session_id,
                Some(initial.next_sequence.saturating_sub(1)),
            )
            .await
            .map_err(|e| ps_session_error("read EMS command output", &e))?;
        collect_pipeline_output(&replay, &started.pipeline_id)
    }

    /// Execute a PowerShell command and deserialise the JSON output.
    pub async fn run_ps_json<T: DeserializeOwned>(&self, script: &str) -> ExchangeResult<T> {
        let json_script = auth::wrap_ps_json(script);
        let raw = self.run_ps(&json_script).await?;
        serde_json::from_str(&raw)
            .map_err(|e| ExchangeError::powershell(format!("JSON parse failed: {e}\nRaw: {raw}")))
    }

    /// Execute multiple PowerShell commands (pipeline).
    pub async fn run_ps_pipeline(&self, commands: &[&str]) -> ExchangeResult<String> {
        let joined = commands.join(" | ");
        self.run_ps(&joined).await
    }

    // ─── Response handling ───────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> ExchangeResult<T> {
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::NotFound,
                message: format!("resource not found: {body}"),
                status_code: Some(404),
                code: None,
            });
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Throttled,
                message: format!("throttled: {body}"),
                status_code: Some(429),
                code: None,
            });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("{status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        resp.json()
            .await
            .map_err(|e| ExchangeError::unknown(format!("response parse error: {e}")))
    }
}

fn build_ps_session_options(
    creds: &ExchangeOnPremCredentials,
    timeout_secs: u64,
) -> ExchangeResult<PowerShellSessionOptions> {
    if creds.server.trim().is_empty() {
        return Err(ExchangeError::validation(
            "on-prem Exchange server cannot be empty",
        ));
    }
    if creds.port == 0 {
        return Err(ExchangeError::validation(
            "on-prem Exchange PowerShell port must be greater than zero",
        ));
    }
    if creds.username.trim().is_empty() {
        return Err(ExchangeError::validation(
            "on-prem Exchange username cannot be empty",
        ));
    }
    if creds.password.is_empty() {
        return Err(ExchangeError::validation(
            "on-prem Exchange password cannot be empty",
        ));
    }
    if !creds.use_ssl {
        return Err(ExchangeError::validation(
            "Exchange PowerShell Basic and NTLM authentication require HTTPS in this client",
        ));
    }
    if creds.skip_cert_check {
        return Err(ExchangeError::validation(
            "Exchange PowerShell no longer permits certificate-validation bypass. \
             Trust or pin the server certificate in Trust Center, then disable skipCertCheck.",
        ));
    }
    if timeout_secs == 0 || timeout_secs > 300 {
        return Err(ExchangeError::validation(
            "Exchange PowerShell timeout must be between 1 and 300 seconds",
        ));
    }

    let (authentication, username, domain) = match creds.auth_method {
        OnPremAuthMethod::Basic => (PowerShellWsmanAuth::Basic, creds.username.clone(), None),
        OnPremAuthMethod::Ntlm => {
            let (domain, username) = creds.username.split_once('\\').ok_or_else(|| {
                ExchangeError::validation(
                    "NTLM authentication requires the username in DOMAIN\\username format",
                )
            })?;
            if domain.trim().is_empty() || username.trim().is_empty() {
                return Err(ExchangeError::validation(
                    "NTLM authentication requires non-empty DOMAIN and username values",
                ));
            }
            (
                PowerShellWsmanAuth::Ntlm,
                username.to_string(),
                Some(domain.to_string()),
            )
        }
        OnPremAuthMethod::Kerberos | OnPremAuthMethod::Negotiate => {
            return Err(ExchangeError::powershell(format!(
                "{:?} authentication is not supported by the verified Exchange WSMan adapter. \
                 Select Basic or explicit NTLM over HTTPS.",
                creds.auth_method
            )));
        }
    };
    let endpoint = auth::build_ps_connection_uri(creds);
    let parsed_endpoint = url::Url::parse(&endpoint).map_err(|error| {
        ExchangeError::validation(format!("invalid Exchange endpoint: {error}"))
    })?;
    if parsed_endpoint.scheme() != "https"
        || parsed_endpoint.host_str().is_none()
        || !parsed_endpoint.username().is_empty()
        || parsed_endpoint.password().is_some()
        || parsed_endpoint.path() != "/PowerShell/"
        || parsed_endpoint.query().is_some()
        || parsed_endpoint.fragment().is_some()
    {
        return Err(ExchangeError::validation(
            "on-prem Exchange server did not produce a valid HTTPS /PowerShell/ endpoint",
        ));
    }

    Ok(PowerShellSessionOptions::Wsman(
        PowerShellWsmanSessionOptions {
            endpoint,
            username,
            password: creds.password.clone(),
            domain,
            authentication,
            endpoint_profile: PowerShellWsmanEndpointProfile::Exchange,
            tls_trust: PowerShellWsmanTrustPolicy::TrustCenter,
            network_path: PowerShellSessionNetworkPath::Direct,
            connection_id: None,
            configuration_name: "Microsoft.Exchange".to_string(),
            culture: "en-US".to_string(),
            connect_timeout_ms: timeout_secs.saturating_mul(1_000),
            request_timeout_ms: timeout_secs.saturating_mul(1_000),
            idle_timeout_sec: 7_200,
            max_envelope_bytes: 512 * 1024,
            max_response_bytes: 8 * 1024 * 1024,
            max_auth_rounds: 3,
            max_empty_receives: 32,
            event_capacity: 8_192,
            command_queue_capacity: 16,
            queue_wait_timeout_ms: 2_000,
        },
    ))
}

fn ps_session_error(
    operation: &str,
    error: &sorng_powershell::runspace_session::PowerShellSessionError,
) -> ExchangeError {
    ExchangeError::powershell(format!("{operation} failed: {error} ({})", error.code()))
}

fn collect_pipeline_output(
    replay: &PowerShellEventReplay,
    pipeline_id: &str,
) -> ExchangeResult<String> {
    if replay.truncated {
        return Err(ExchangeError::powershell(
            "Exchange Management Shell output exceeded the bounded replay buffer; \
             refusing to return partial results",
        ));
    }

    let events = replay
        .events
        .iter()
        .filter(|event| event.pipeline_id.as_deref() == Some(pipeline_id))
        .collect::<Vec<_>>();
    let errors = events
        .iter()
        .filter(|event| event.kind == PowerShellStreamKind::Error)
        .map(|event| event.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    let terminal_state = events
        .iter()
        .rev()
        .find(|event| event.kind == PowerShellStreamKind::PipelineState)
        .and_then(|event| event.pipeline_state.as_deref());

    if !errors.is_empty() || terminal_state != Some("completed") {
        let details = if errors.is_empty() {
            format!(
                "pipeline ended in state {}",
                terminal_state.unwrap_or("unknown")
            )
        } else {
            errors.join("; ")
        };
        return Err(ExchangeError::powershell(format!(
            "Exchange Management Shell command failed: {details}"
        )));
    }

    Ok(events
        .iter()
        .filter(|event| event.kind == PowerShellStreamKind::Output)
        .map(|event| event.text.as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_powershell::runspace_session::PowerShellSessionEvent;

    fn credentials(auth_method: OnPremAuthMethod) -> ExchangeOnPremCredentials {
        ExchangeOnPremCredentials {
            server: "mail01.contoso.test".to_string(),
            port: 8443,
            username: "CONTOSO\\admin".to_string(),
            password: "secret".to_string(),
            use_ssl: true,
            auth_method,
            skip_cert_check: false,
        }
    }

    #[tokio::test]
    async fn run_ps_fails_loudly_when_session_is_not_connected() {
        let client = ExchangeClient::new(ExchangeConnectionConfig::default())
            .expect("default Exchange client should build");

        let error = client
            .run_ps("Get-Mailbox")
            .await
            .expect_err("an unavailable PowerShell executor must not report success");

        assert_eq!(error.kind, ExchangeErrorKind::PowerShell);
        assert!(error.message.contains("not connected"));
    }

    #[tokio::test]
    async fn failed_disconnect_retains_the_powershell_session_for_retry() {
        let mut client = ExchangeClient::new(ExchangeConnectionConfig::default())
            .expect("default Exchange client should build");
        client.ps_session = Some(Arc::new(ExchangePowerShellSession {
            service: PowerShellSessionService::new(),
            session_id: "retryable-session".to_string(),
            command_lock: Mutex::new(()),
        }));
        client.ps_connected = true;

        let error = client
            .disconnect_power_shell_using(|_| async {
                Err(PowerShellSessionError::CommandTimedOut)
            })
            .await
            .expect_err("a failed close must remain retryable");
        assert_eq!(error.kind, ExchangeErrorKind::PowerShell);
        assert!(client.ps_connected);
        assert!(client.ps_session.is_some());

        client
            .disconnect_power_shell_using(|_| async { Ok(()) })
            .await
            .expect("a later retry should clear the retained session");
        assert!(!client.ps_connected);
        assert!(client.ps_session.is_none());
    }

    #[tokio::test]
    async fn missing_powershell_session_is_treated_as_already_closed() {
        let mut client = ExchangeClient::new(ExchangeConnectionConfig::default())
            .expect("default Exchange client should build");
        client.ps_session = Some(Arc::new(ExchangePowerShellSession {
            service: PowerShellSessionService::new(),
            session_id: "already-closed-session".to_string(),
            command_lock: Mutex::new(()),
        }));
        client.ps_connected = true;

        client
            .disconnect_power_shell_using(|_| async {
                Err(PowerShellSessionError::SessionNotFound)
            })
            .await
            .expect("typed session-not-found means teardown is complete");
        assert!(!client.ps_connected);
        assert!(client.ps_session.is_none());
    }

    #[tokio::test]
    async fn session_command_gate_serializes_entire_pipeline_boundaries() {
        let gate = Arc::new(Mutex::new(()));
        let first_pipeline = gate.lock().await;
        let second_gate = gate.clone();
        let (entered_tx, mut entered_rx) = tokio::sync::oneshot::channel();
        let second_pipeline = tokio::spawn(async move {
            let _guard = second_gate.lock().await;
            let _ = entered_tx.send(());
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut entered_rx)
                .await
                .is_err(),
            "a second pipeline entered while the first still held the session gate"
        );
        drop(first_pipeline);
        tokio::time::timeout(Duration::from_secs(1), entered_rx)
            .await
            .expect("second pipeline should enter after the first releases the gate")
            .expect("second pipeline should signal gate entry");
        second_pipeline
            .await
            .expect("second pipeline task should finish");
    }

    #[test]
    fn basic_https_maps_to_exchange_management_shell_endpoint() {
        let options = build_ps_session_options(&credentials(OnPremAuthMethod::Basic), 45)
            .expect("Basic over HTTPS should be supported");
        let PowerShellSessionOptions::Wsman(options) = options else {
            panic!("Exchange must use WSMan")
        };

        assert_eq!(
            options.endpoint,
            "https://mail01.contoso.test:8443/PowerShell/"
        );
        assert_eq!(options.configuration_name, "Microsoft.Exchange");
        assert_eq!(options.authentication, PowerShellWsmanAuth::Basic);
        assert_eq!(
            options.endpoint_profile,
            PowerShellWsmanEndpointProfile::Exchange
        );
        assert_eq!(options.tls_trust, PowerShellWsmanTrustPolicy::TrustCenter);
        assert_eq!(options.request_timeout_ms, 45_000);
    }

    #[test]
    fn basic_without_https_is_rejected_before_network_io() {
        let mut creds = credentials(OnPremAuthMethod::Basic);
        creds.use_ssl = false;
        creds.port = 80;

        let error = build_ps_session_options(&creds, 30)
            .expect_err("Basic over plaintext HTTP must be rejected");

        assert_eq!(error.kind, ExchangeErrorKind::Validation);
        assert!(error.message.contains("require HTTPS"));
    }

    #[test]
    fn explicit_ntlm_maps_domain_identity_to_exchange_profile() {
        let options = build_ps_session_options(&credentials(OnPremAuthMethod::Ntlm), 30)
            .expect("explicit NTLM over HTTPS should be supported");
        let PowerShellSessionOptions::Wsman(options) = options else {
            panic!("Exchange must use WSMan")
        };

        assert_eq!(options.authentication, PowerShellWsmanAuth::Ntlm);
        assert_eq!(options.username, "admin");
        assert_eq!(options.domain.as_deref(), Some("CONTOSO"));
    }

    #[test]
    fn ipv6_exchange_server_builds_a_valid_bracketed_endpoint() {
        let mut creds = credentials(OnPremAuthMethod::Basic);
        creds.server = "2001:db8::42".to_string();

        let options = build_ps_session_options(&creds, 30)
            .expect("an IPv6 Exchange server should produce a valid endpoint");
        let PowerShellSessionOptions::Wsman(options) = options else {
            panic!("Exchange must use WSMan")
        };

        assert_eq!(options.endpoint, "https://[2001:db8::42]:8443/PowerShell/");
    }

    #[test]
    fn malformed_exchange_server_is_rejected_before_network_io() {
        let mut creds = credentials(OnPremAuthMethod::Basic);
        creds.server = "https://mail01.contoso.test/other".to_string();

        let error = build_ps_session_options(&creds, 30)
            .expect_err("a server field containing a URL must not produce an ambiguous endpoint");

        assert_eq!(error.kind, ExchangeErrorKind::Validation);
        assert!(
            error.message.contains("/PowerShell/ endpoint"),
            "{}",
            error.message
        );
    }

    #[test]
    fn kerberos_and_negotiate_are_rejected_truthfully() {
        for method in [OnPremAuthMethod::Kerberos, OnPremAuthMethod::Negotiate] {
            let error = build_ps_session_options(&credentials(method.clone()), 30)
                .expect_err("unsupported authentication must not claim support");

            assert_eq!(error.kind, ExchangeErrorKind::PowerShell);
            assert!(error.message.contains(&format!("{method:?}")));
            assert!(error.message.contains("Basic or explicit NTLM"));
        }
    }

    #[test]
    fn certificate_bypass_is_rejected_in_favour_of_trust_center() {
        let mut creds = credentials(OnPremAuthMethod::Basic);
        creds.skip_cert_check = true;

        let error = build_ps_session_options(&creds, 30)
            .expect_err("certificate validation bypass must fail closed");

        assert_eq!(error.kind, ExchangeErrorKind::Validation);
        assert!(error.message.contains("Trust Center"));
        assert!(error.message.contains("skipCertCheck"));
    }

    fn event(
        sequence: u64,
        pipeline_id: &str,
        kind: PowerShellStreamKind,
        text: &str,
        pipeline_state: Option<&str>,
    ) -> PowerShellSessionEvent {
        PowerShellSessionEvent {
            session_id: "session".to_string(),
            sequence,
            timestamp_ms: 0,
            pipeline_id: Some(pipeline_id.to_string()),
            kind,
            text: text.to_string(),
            value: None,
            progress: None,
            pipeline_state: pipeline_state.map(str::to_string),
        }
    }

    fn replay(events: Vec<PowerShellSessionEvent>, truncated: bool) -> PowerShellEventReplay {
        PowerShellEventReplay {
            session_id: "session".to_string(),
            oldest_sequence: events.first().map_or(1, |event| event.sequence),
            next_sequence: events
                .last()
                .map_or(1, |event| event.sequence.saturating_add(1)),
            truncated,
            evicted_events: u64::from(truncated),
            events,
        }
    }

    #[test]
    fn pipeline_output_is_collected_in_sequence() {
        let replay = replay(
            vec![
                event(1, "pipeline", PowerShellStreamKind::Output, "one", None),
                event(2, "pipeline", PowerShellStreamKind::Output, "two", None),
                event(
                    3,
                    "pipeline",
                    PowerShellStreamKind::PipelineState,
                    "completed",
                    Some("completed"),
                ),
            ],
            false,
        );

        assert_eq!(
            collect_pipeline_output(&replay, "pipeline").unwrap(),
            "one\ntwo"
        );
    }

    #[test]
    fn pipeline_error_stream_is_never_returned_as_success() {
        let replay = replay(
            vec![
                event(
                    1,
                    "pipeline",
                    PowerShellStreamKind::Error,
                    "Get-Mailbox failed",
                    None,
                ),
                event(
                    2,
                    "pipeline",
                    PowerShellStreamKind::PipelineState,
                    "completed",
                    Some("completed"),
                ),
            ],
            false,
        );

        let error = collect_pipeline_output(&replay, "pipeline")
            .expect_err("error stream must fail the Exchange command");
        assert_eq!(error.kind, ExchangeErrorKind::PowerShell);
        assert!(error.message.contains("Get-Mailbox failed"));
    }

    #[test]
    fn truncated_replay_is_never_returned_as_partial_output() {
        let replay = replay(
            vec![event(
                99,
                "pipeline",
                PowerShellStreamKind::PipelineState,
                "completed",
                Some("completed"),
            )],
            true,
        );

        let error = collect_pipeline_output(&replay, "pipeline")
            .expect_err("truncated output must fail closed");
        assert_eq!(error.kind, ExchangeErrorKind::PowerShell);
        assert!(error.message.contains("partial results"));
    }
}
