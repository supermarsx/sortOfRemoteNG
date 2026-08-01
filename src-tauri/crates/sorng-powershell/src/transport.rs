//! WinRM SOAP/HTTP transport layer.
//!
//! Implements the WS-Management protocol for communicating with remote
//! PowerShell endpoints over HTTP/HTTPS. Handles SOAP envelope construction,
//! message correlation, shell lifecycle, and command I/O.

use crate::types::*;
use futures::StreamExt;
use log::{debug, error, trace, warn};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE};
use std::collections::HashMap;
use std::fmt;
use std::time::{Duration, Instant};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const MAX_SOAP_ENVELOPE_BYTES: usize = 1024 * 1024;
const MAX_SOAP_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_STDIN_BYTES: usize = 256 * 1024;
const MAX_AUTH_HEADER_BYTES: usize = 16 * 1024;
const MAX_CUSTOM_HEADERS: usize = 32;
const MAX_CUSTOM_HEADER_VALUE_BYTES: usize = 16 * 1024;
const MAX_COMMAND_WALL_TIME: Duration = Duration::from_secs(30 * 60);
const MAX_ACTIVE_SHELLS: usize = 64;

// ─── Transport State ─────────────────────────────────────────────────────────

/// Internal state for a WinRM HTTP transport connection.
pub struct WinRmTransport {
    /// HTTP client for making requests
    client: reqwest::Client,
    /// Endpoint URI
    endpoint: String,
    /// Authentication header value
    auth_header: Option<String>,
    /// Whether to skip certificate validation
    #[allow(dead_code)]
    skip_cert_validation: bool,
    /// Maximum envelope size in bytes (server negotiated)
    max_envelope_size: usize,
    /// Maximum response body accepted after decompression.
    max_response_size: usize,
    /// Operation timeout as ISO 8601 duration
    operation_timeout: String,
    /// Locale
    locale: String,
    /// Custom headers
    custom_headers: HashMap<String, String>,
    /// Active shell IDs managed by this transport
    active_shells: Vec<String>,
    /// Request counter for debugging
    request_counter: u64,
}

impl fmt::Debug for WinRmTransport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut custom_header_names = self.custom_headers.keys().collect::<Vec<_>>();
        custom_header_names.sort();
        f.debug_struct("WinRmTransport")
            .field("endpoint", &self.endpoint)
            .field(
                "auth_header",
                &self.auth_header.as_ref().map(|_| "[redacted]"),
            )
            .field("skip_cert_validation", &self.skip_cert_validation)
            .field("max_envelope_size", &self.max_envelope_size)
            .field("max_response_size", &self.max_response_size)
            .field("operation_timeout", &self.operation_timeout)
            .field("locale", &self.locale)
            .field("custom_header_names", &custom_header_names)
            .field("active_shells", &self.active_shells)
            .field("request_counter", &self.request_counter)
            .finish()
    }
}

impl Drop for WinRmTransport {
    fn drop(&mut self) {
        self.auth_header.zeroize();
        for value in self.custom_headers.values_mut() {
            value.zeroize();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SoapMessageMetadata {
    request_id: u64,
    status: Option<u16>,
    body_bytes: usize,
}

impl SoapMessageMetadata {
    fn request(request_id: u64, body_bytes: usize) -> Self {
        Self {
            request_id,
            status: None,
            body_bytes,
        }
    }

    fn response(request_id: u64, status: reqwest::StatusCode, body_bytes: usize) -> Self {
        Self {
            request_id,
            status: Some(status.as_u16()),
            body_bytes,
        }
    }
}

fn winrm_http_status_error(status: reqwest::StatusCode, body_bytes: usize) -> String {
    format!(
        "WinRM error (HTTP {}; remote response omitted; {} bytes)",
        status, body_bytes
    )
}

impl WinRmTransport {
    /// Create a new WinRM transport from configuration.
    pub fn new(config: &PsRemotingConfig) -> Result<Self, String> {
        config.validate_security()?;
        validate_legacy_transport_config(config)?;
        let endpoint = config.try_endpoint_uri()?;

        let mut client_builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(
                config.session_option.operation_timeout_sec as u64,
            ))
            .connect_timeout(std::time::Duration::from_secs(
                config.session_option.open_timeout_sec as u64,
            ))
            .pool_max_idle_per_host(1);

        if config.session_option.no_compression {
            client_builder = client_builder.no_gzip().no_brotli().no_deflate();
        }

        // TLS certificate decisions route through the Trust Center (TOFU by
        // default). The legacy `skip_ca_check` / `skip_cn_check` flags now map
        // to an explicit, revocable `AlwaysTrust` override rather than a blind
        // `danger_accept_invalid_certs(true)`.
        let client = crate::tls::build_winrm_client(client_builder, config)
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let operation_timeout = format!("PT{}S", config.session_option.operation_timeout_sec);

        Ok(Self {
            client,
            endpoint,
            auth_header: None,
            skip_cert_validation: config.skip_ca_check,
            max_envelope_size: MAX_SOAP_ENVELOPE_BYTES,
            max_response_size: ((config.session_option.max_received_data_size_mb as usize)
                .saturating_mul(1024 * 1024))
            .clamp(512 * 1024, MAX_SOAP_RESPONSE_BYTES),
            operation_timeout,
            locale: config.session_option.culture.clone(),
            custom_headers: config.custom_headers.clone(),
            active_shells: Vec::new(),
            request_counter: 0,
        })
    }

    /// Set the authentication header (e.g., Basic base64 or NTLM token).
    pub fn set_auth_header(&mut self, header: String) -> Result<(), String> {
        if header.is_empty() || header.len() > MAX_AUTH_HEADER_BYTES {
            return Err(
                "WinRM authentication header is empty or exceeds the safety limit".to_string(),
            );
        }
        HeaderValue::from_str(&header)
            .map_err(|_| "Invalid WinRM authentication header".to_string())?;
        if let Some(mut previous_header) = self.auth_header.replace(header) {
            previous_header.zeroize();
        }
        Ok(())
    }

    /// Send a raw SOAP envelope and return the response body.
    pub async fn send_message(&mut self, soap_body: &str) -> Result<String, String> {
        if soap_body.len() > self.max_envelope_size {
            return Err(format!(
                "WinRM SOAP envelope exceeds the {} byte safety limit",
                self.max_envelope_size
            ));
        }
        self.request_counter = self.request_counter.saturating_add(1);
        let req_id = self.request_counter;

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/soap+xml;charset=UTF-8"),
        );

        if let Some(ref auth) = self.auth_header {
            headers.insert(
                reqwest::header::AUTHORIZATION,
                HeaderValue::from_str(auth)
                    .map_err(|_| "Invalid authentication header".to_string())?,
            );
        }

        for (key, value) in &self.custom_headers {
            let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|_| "Invalid WinRM custom header name".to_string())?;
            let val = HeaderValue::from_str(value)
                .map_err(|_| "Invalid WinRM custom header value".to_string())?;
            headers.insert(name, val);
        }

        let request_metadata = SoapMessageMetadata::request(req_id, soap_body.len());
        debug!("WinRM request: {request_metadata:?} (endpoint redacted)");
        trace!("WinRM request metadata: {request_metadata:?}");

        let response = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            // reqwest takes ownership of its request-body allocation and does
            // not expose that buffer for explicit zeroization. Callers in this
            // crate keep the source command/envelope in `Zeroizing` storage;
            // the transport-owned copy is the remaining library boundary.
            .body(soap_body.to_string())
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "WinRM HTTP request timed out".to_string()
                } else if error.is_connect() {
                    "WinRM HTTP connection failed".to_string()
                } else {
                    "WinRM HTTP request failed".to_string()
                }
            })?;

        let status = response.status();
        if response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|length| length > self.max_response_size)
        {
            return Err(format!(
                "WinRM response exceeds the {} byte safety limit",
                self.max_response_size
            ));
        }

        let mut response_bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("Failed to read WinRM response body: {error}"))?;
            if response_bytes.len().saturating_add(chunk.len()) > self.max_response_size {
                response_bytes.zeroize();
                return Err(format!(
                    "WinRM response exceeds the {} byte safety limit",
                    self.max_response_size
                ));
            }
            response_bytes.extend_from_slice(&chunk);
        }
        let body_text = match String::from_utf8(response_bytes) {
            Ok(body) => body,
            Err(error) => {
                let mut invalid = error.into_bytes();
                invalid.zeroize();
                return Err("WinRM response is not valid UTF-8".to_string());
            }
        };
        let body = Zeroizing::new(body_text);

        let response_metadata = SoapMessageMetadata::response(req_id, status, body.len());
        trace!("WinRM response metadata: {response_metadata:?}");

        if !status.is_success() {
            error!("WinRM request failed: {response_metadata:?}");
            return Err(winrm_http_status_error(status, body.len()));
        }

        // A successful response is intentionally handed to the caller. The
        // transport copy is still zeroized immediately after this clone.
        Ok(body.to_string())
    }

    // ─── Shell Management ────────────────────────────────────────────────

    /// Create a new WinRM shell (remote runspace) and return its shell ID.
    pub async fn create_shell(
        &mut self,
        resource_uri: &str,
        config_name: &str,
        session_options: &PsSessionOption,
    ) -> Result<String, String> {
        let message_id = Uuid::new_v4().to_string();
        let shell_id = Uuid::new_v4().to_string().to_uppercase();

        let envelope = build_create_shell_envelope(
            &self.endpoint,
            &message_id,
            resource_uri,
            config_name,
            &self.operation_timeout,
            &self.locale,
            session_options,
            &shell_id,
        );

        let response = self.send_message(&envelope).await?;

        // Parse shell ID from response (may differ from our suggested ID)
        let actual_shell_id = extract_shell_id(&response)
            .ok_or_else(|| "WinRM create-shell response did not contain a shell ID".to_string())?;
        validate_wsman_identifier("shell", &actual_shell_id)?;
        if self.active_shells.len() >= MAX_ACTIVE_SHELLS {
            return Err("WinRM transport shell limit reached".to_string());
        }

        self.active_shells.push(actual_shell_id.clone());
        debug!("Created WinRM shell: {}", actual_shell_id);

        Ok(actual_shell_id)
    }

    /// Delete (close) a WinRM shell.
    pub async fn delete_shell(&mut self, shell_id: &str) -> Result<(), String> {
        validate_wsman_identifier("shell", shell_id)?;
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_delete_shell_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        self.active_shells.retain(|id| id != shell_id);
        debug!("Deleted WinRM shell: {}", shell_id);

        Ok(())
    }

    /// Execute a command within a shell and return the command ID.
    pub async fn execute_command(
        &mut self,
        shell_id: &str,
        command: &str,
        arguments: &[String],
    ) -> Result<String, String> {
        validate_wsman_identifier("shell", shell_id)?;
        if command.is_empty() || command.len() > 1024 {
            return Err("WinRM command name is empty or exceeds the safety limit".to_string());
        }
        let argument_bytes = arguments.iter().try_fold(0usize, |total, argument| {
            total
                .checked_add(argument.len())
                .ok_or_else(|| "WinRM command argument size overflow".to_string())
        })?;
        if arguments.len() > 64 || argument_bytes > MAX_SOAP_ENVELOPE_BYTES {
            return Err("WinRM command arguments exceed the safety limit".to_string());
        }
        let message_id = Uuid::new_v4().to_string();

        let envelope = Zeroizing::new(build_command_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command,
            arguments,
            &self.operation_timeout,
        ));

        let response = self.send_message(envelope.as_str()).await?;
        // WinRM assigns the authoritative command ID; only its response value
        // is valid for subsequent receive and signal operations.
        let actual_command_id = extract_command_id(&response)
            .ok_or_else(|| "WinRM command response did not contain a command ID".to_string())?;
        validate_wsman_identifier("command", &actual_command_id)?;

        debug!(
            "Executed command in shell {}: {}",
            shell_id, actual_command_id
        );

        Ok(actual_command_id)
    }

    /// Execute a PowerShell script block by encoding it in base64 and using
    /// the powershell.exe -EncodedCommand pattern.
    pub async fn execute_ps_command(
        &mut self,
        shell_id: &str,
        script: &str,
    ) -> Result<String, String> {
        // Encode as UTF-16LE base64 (required by PowerShell -EncodedCommand)
        let utf16 = Zeroizing::new(
            script
                .encode_utf16()
                .flat_map(|c| c.to_le_bytes())
                .collect::<Vec<u8>>(),
        );
        let encoded = Zeroizing::new(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            utf16.as_slice(),
        ));
        let arguments = Zeroizing::new(vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-EncodedCommand".to_string(),
            encoded.to_string(),
        ]);

        self.execute_command(shell_id, "powershell.exe", arguments.as_slice())
            .await
    }

    /// Receive output from a running command. Returns (stdout, stderr, is_done).
    pub async fn receive_output(
        &mut self,
        shell_id: &str,
        command_id: &str,
    ) -> Result<(String, String, bool), String> {
        validate_wsman_identifier("shell", shell_id)?;
        validate_wsman_identifier("command", command_id)?;
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_receive_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command_id,
            &self.operation_timeout,
        );

        let response = self.send_message(&envelope).await?;
        parse_receive_response(&response)
    }

    /// Receive all output by polling until the command completes.
    pub async fn receive_all_output(
        &mut self,
        shell_id: &str,
        command_id: &str,
    ) -> Result<(String, String), String> {
        let mut stdout = String::new();
        let mut stderr = String::new();
        let deadline = Instant::now() + MAX_COMMAND_WALL_TIME;

        loop {
            if Instant::now() >= deadline {
                let _ = self
                    .signal_command(shell_id, command_id, WsManSignal::TERMINATE)
                    .await;
                return Err("WinRM command exceeded the 30 minute safety limit".to_string());
            }
            let (out, err, done) = self.receive_output(shell_id, command_id).await?;
            if stdout
                .len()
                .saturating_add(stderr.len())
                .saturating_add(out.len())
                .saturating_add(err.len())
                > MAX_COMMAND_OUTPUT_BYTES
            {
                let _ = self
                    .signal_command(shell_id, command_id, WsManSignal::TERMINATE)
                    .await;
                return Err(format!(
                    "WinRM command output exceeds the {} byte safety limit",
                    MAX_COMMAND_OUTPUT_BYTES
                ));
            }
            stdout.push_str(&out);
            stderr.push_str(&err);

            if done {
                break;
            }
        }

        Ok((stdout, stderr))
    }

    /// Send stdin data to a running command.
    pub async fn send_input(
        &mut self,
        shell_id: &str,
        command_id: &str,
        data: &str,
        end_of_stream: bool,
    ) -> Result<(), String> {
        validate_wsman_identifier("shell", shell_id)?;
        validate_wsman_identifier("command", command_id)?;
        if data.len() > MAX_STDIN_BYTES {
            return Err(format!(
                "WinRM stdin exceeds the {} byte safety limit",
                MAX_STDIN_BYTES
            ));
        }
        let message_id = Uuid::new_v4().to_string();

        let encoded = Zeroizing::new(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            data.as_bytes(),
        ));

        let envelope = Zeroizing::new(build_send_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command_id,
            encoded.as_str(),
            end_of_stream,
            &self.operation_timeout,
        ));

        self.send_message(envelope.as_str()).await?;
        Ok(())
    }

    /// Send a signal to a command (e.g., terminate, Ctrl+C).
    pub async fn signal_command(
        &mut self,
        shell_id: &str,
        command_id: &str,
        signal_code: &str,
    ) -> Result<(), String> {
        validate_wsman_identifier("shell", shell_id)?;
        validate_wsman_identifier("command", command_id)?;
        if signal_code.len() > 512 || !signal_code.starts_with("http") {
            return Err("Invalid WinRM signal code".to_string());
        }
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_signal_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command_id,
            signal_code,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        debug!(
            "Sent signal {} to command {} in shell {}",
            signal_code, command_id, shell_id
        );

        Ok(())
    }

    /// Disconnect a shell (for later reconnection).
    pub async fn disconnect_shell(&mut self, shell_id: &str) -> Result<(), String> {
        validate_wsman_identifier("shell", shell_id)?;
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_disconnect_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        debug!("Disconnected shell: {}", shell_id);

        Ok(())
    }

    /// Reconnect to a previously disconnected shell.
    pub async fn reconnect_shell(&mut self, shell_id: &str) -> Result<(), String> {
        validate_wsman_identifier("shell", shell_id)?;
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_reconnect_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        debug!("Reconnected to shell: {}", shell_id);

        Ok(())
    }

    /// Send a keep-alive (empty receive) to maintain the session.
    pub async fn keepalive(&mut self, shell_id: &str) -> Result<u64, String> {
        validate_wsman_identifier("shell", shell_id)?;
        let start = std::time::Instant::now();
        let message_id = Uuid::new_v4().to_string();

        let envelope = build_keepalive_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        let latency = start.elapsed().as_millis() as u64;

        debug!("Keep-alive for shell {} latency: {}ms", shell_id, latency);
        Ok(latency)
    }

    /// Close all active shells on this transport.
    pub async fn cleanup(&mut self) -> Vec<String> {
        let shells: Vec<String> = self.active_shells.clone();
        let mut errors = Vec::new();

        for shell_id in &shells {
            if let Err(e) = self.delete_shell(shell_id).await {
                warn!("Failed to cleanup shell {}: {}", shell_id, e);
                errors.push(format!("{}: {}", shell_id, e));
            }
        }

        errors
    }
}

// ─── SOAP Envelope Builders ──────────────────────────────────────────────────

/// Build the SOAP envelope header (common for all messages).
fn build_soap_header(
    action: &str,
    endpoint: &str,
    message_id: &str,
    resource_uri: Option<&str>,
    shell_id: Option<&str>,
    timeout: &str,
) -> String {
    let mut header = format!(
        r#"<s:Header>
      <a:To>{endpoint}</a:To>
      <a:Action s:mustUnderstand="true">{action}</a:Action>
      <w:ResourceURI s:mustUnderstand="true">{resource}</w:ResourceURI>
      <a:MessageID>uuid:{message_id}</a:MessageID>
      <a:ReplyTo>
        <a:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address>
      </a:ReplyTo>
      <w:OperationTimeout>{timeout}</w:OperationTimeout>"#,
        endpoint = endpoint,
        action = action,
        resource = resource_uri.unwrap_or(WsManResourceUri::SHELL),
        message_id = message_id,
        timeout = timeout,
    );

    if let Some(sid) = shell_id {
        header.push_str(&format!(
            r#"
      <w:SelectorSet>
        <w:Selector Name="ShellId">{}</w:Selector>
      </w:SelectorSet>"#,
            sid
        ));
    }

    header.push_str("\n    </s:Header>");
    header
}

/// Wrap header + body into a full SOAP envelope.
fn wrap_envelope(header: &str, body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{soap}" xmlns:a="{addr}" xmlns:w="{wsman}" xmlns:p="{wsmand}" xmlns:rsp="{shell}" xmlns:wsen="{wsen}" xmlns:wset="{wset}" xmlns:xsi="{xsi}">
    {header}
    <s:Body>
      {body}
    </s:Body>
</s:Envelope>"#,
        soap = WsManNamespace::SOAP,
        addr = WsManNamespace::ADDRESSING,
        wsman = WsManNamespace::WSMAN,
        wsmand = WsManNamespace::WSMAND,
        shell = WsManNamespace::SHELL,
        wsen = WsManNamespace::WSEN,
        wset = WsManNamespace::WSET,
        xsi = WsManNamespace::XMLSCHEMA_INST,
        header = header,
        body = body,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_create_shell_envelope(
    endpoint: &str,
    message_id: &str,
    resource_uri: &str,
    _config_name: &str,
    timeout: &str,
    _locale: &str,
    options: &PsSessionOption,
    shell_id: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Create.uri(),
        endpoint,
        message_id,
        Some(resource_uri),
        None,
        timeout,
    );

    let body = format!(
        r#"<rsp:Shell ShellId="{shell_id}">
        <rsp:InputStreams>stdin</rsp:InputStreams>
        <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
        <rsp:IdleTimeout>PT{idle}S</rsp:IdleTimeout>
        <rsp:Environment>
          <rsp:Variable Name="PSMODULEPATH"></rsp:Variable>
        </rsp:Environment>
        <w:OptionSet>
          <w:Option Name="WINRS_NOPROFILE">{no_profile}</w:Option>
          <w:Option Name="WINRS_CODEPAGE">65001</w:Option>
          <w:Option Name="WINRS_CONSOLEMODE_STDIN">TRUE</w:Option>
        </w:OptionSet>
      </rsp:Shell>"#,
        shell_id = shell_id,
        idle = options.idle_timeout_sec,
        no_profile = if options.skip_machine_profile {
            "TRUE"
        } else {
            "FALSE"
        },
    );

    wrap_envelope(&header, &body)
}

fn build_delete_shell_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Delete.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    wrap_envelope(&header, "")
}

fn build_command_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    command: &str,
    arguments: &[String],
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Command.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let args_xml: String = arguments
        .iter()
        .map(|a| format!("<rsp:Arguments>{}</rsp:Arguments>", xml_escape(a)))
        .collect::<Vec<_>>()
        .join("\n        ");

    let body = format!(
        r#"<rsp:CommandLine>
        <rsp:Command>{command}</rsp:Command>
        {args}
      </rsp:CommandLine>"#,
        command = xml_escape(command),
        args = args_xml,
    );

    wrap_envelope(&header, &body)
}

fn build_receive_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    command_id: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Receive.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let body = format!(
        r#"<rsp:Receive>
        <rsp:DesiredStream CommandId="{command_id}">stdout stderr</rsp:DesiredStream>
      </rsp:Receive>"#,
        command_id = command_id,
    );

    wrap_envelope(&header, &body)
}

fn build_send_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    command_id: &str,
    encoded_data: &str,
    end_of_stream: bool,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Send.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let end_attr = if end_of_stream { r#" End="true""# } else { "" };

    let body = format!(
        r#"<rsp:Send>
        <rsp:Stream Name="stdin" CommandId="{command_id}"{end}>{data}</rsp:Stream>
      </rsp:Send>"#,
        command_id = command_id,
        end = end_attr,
        data = encoded_data,
    );

    wrap_envelope(&header, &body)
}

fn build_signal_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    command_id: &str,
    signal_code: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Signal.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let body = format!(
        r#"<rsp:Signal CommandId="{command_id}">
        <rsp:Code>{signal}</rsp:Code>
      </rsp:Signal>"#,
        command_id = command_id,
        signal = signal_code,
    );

    wrap_envelope(&header, &body)
}

fn build_disconnect_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Signal.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let body = format!(
        r#"<rsp:Signal>
        <rsp:Code>{}</rsp:Code>
      </rsp:Signal>"#,
        WsManSignal::PS_DISCONNECT,
    );

    wrap_envelope(&header, &body)
}

fn build_reconnect_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Signal.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    let body = format!(
        r#"<rsp:Signal>
        <rsp:Code>{}</rsp:Code>
      </rsp:Signal>"#,
        WsManSignal::PS_RECONNECT,
    );

    wrap_envelope(&header, &body)
}

fn build_keepalive_envelope(
    endpoint: &str,
    message_id: &str,
    shell_id: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Get.uri(),
        endpoint,
        message_id,
        Some(WsManResourceUri::SHELL),
        Some(shell_id),
        timeout,
    );

    wrap_envelope(&header, "")
}

// ─── Response Parsers ────────────────────────────────────────────────────────

/// Extract the ShellId from a Create response.
fn extract_shell_id(response: &str) -> Option<String> {
    // Look for ShellId in the response XML
    let pattern = "ShellId=\"";
    if let Some(start) = response.find(pattern) {
        let rest = &response[start + pattern.len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    // Also check for <rsp:ShellId> element
    let pattern2 = "<rsp:ShellId>";
    if let Some(start) = response.find(pattern2) {
        let rest = &response[start + pattern2.len()..];
        if let Some(end) = rest.find('<') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// Extract the CommandId from a Command response.
fn extract_command_id(response: &str) -> Option<String> {
    let pattern = "CommandId=\"";
    if let Some(start) = response.find(pattern) {
        let rest = &response[start + pattern.len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    let pattern2 = "<rsp:CommandId>";
    if let Some(start) = response.find(pattern2) {
        let rest = &response[start + pattern2.len()..];
        if let Some(end) = rest.find('<') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// Parse Receive response to extract stdout, stderr, and completion status.
pub fn parse_receive_response(response: &str) -> Result<(String, String, bool), String> {
    let mut stdout = String::new();
    let mut stderr = String::new();

    // Extract stdout streams
    extract_stream_data(response, "stdout", &mut stdout)?;
    // Extract stderr streams
    extract_stream_data(response, "stderr", &mut stderr)?;

    // Check if command state is "Done"
    let is_done = response.contains(
        "State=\"http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done\"",
    ) || response.contains("CommandState State=\"Done\"");

    Ok((stdout, stderr, is_done))
}

/// Extract base64-encoded stream data and decode it.
fn extract_stream_data(
    response: &str,
    stream_name: &str,
    output: &mut String,
) -> Result<(), String> {
    let pattern = format!("Name=\"{}\"", stream_name);
    let mut search_from = 0;

    while let Some(attr_pos) = response[search_from..].find(&pattern) {
        let abs_pos = search_from + attr_pos;
        // Find the > that closes the opening tag
        if let Some(gt_pos) = response[abs_pos..].find('>') {
            let data_start = abs_pos + gt_pos + 1;
            // Find the closing </rsp:Stream> tag
            if let Some(end_pos) = response[data_start..].find("</rsp:Stream>") {
                let encoded = &response[data_start..data_start + end_pos].trim();
                if !encoded.is_empty() {
                    let mut decoded =
                        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                            .map_err(|_| format!("Invalid base64 in WinRM {stream_name} stream"))?;
                    let text = match std::str::from_utf8(&decoded) {
                        Ok(text) => text.to_string(),
                        Err(_) => {
                            decoded.zeroize();
                            return Err(format!("Invalid UTF-8 in WinRM {stream_name} stream"));
                        }
                    };
                    decoded.zeroize();
                    output.push_str(&text);
                }
                search_from = data_start + end_pos;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    Ok(())
}

fn validate_wsman_identifier(kind: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '{' | '}'))
    {
        return Err(format!("Invalid WinRM {kind} identifier"));
    }
    Ok(())
}

fn validate_legacy_transport_config(config: &PsRemotingConfig) -> Result<(), String> {
    let options = &config.session_option;
    if !(1..=300).contains(&options.operation_timeout_sec)
        || !(1..=300).contains(&options.open_timeout_sec)
        || !(1..=300).contains(&options.cancel_timeout_sec)
        || !(30..=86_400).contains(&options.idle_timeout_sec)
    {
        return Err("WinRM timeouts are outside the supported safety bounds".to_string());
    }
    if !(1..=64).contains(&options.max_received_data_size_mb)
        || !(1..=16).contains(&options.max_received_object_size_mb)
        || !(1..=100).contains(&options.max_commands_per_shell)
        || options.max_connection_retry_count > 10
        || options.max_connection_retry_delay_sec > 60
        || (options.keepalive_interval_sec > 0 && options.keepalive_interval_sec < 5)
    {
        return Err("WinRM resource limits are outside the supported safety bounds".to_string());
    }
    if config.credential.username.is_empty()
        || config.credential.username.len() > 512
        || config
            .credential
            .password
            .as_ref()
            .is_none_or(|password| {
                password.is_empty() || password.len() > 16 * 1024
            })
    {
        return Err("WinRM Basic credentials are missing or exceed the safety limit".to_string());
    }
    if config.proxy.is_some() {
        return Err("WinRM proxy settings are not supported by the legacy transport".to_string());
    }
    if config.skip_revocation_check {
        return Err(
            "WinRM revocation-check overrides are not supported by the legacy transport"
                .to_string(),
        );
    }
    if config.custom_headers.len() > MAX_CUSTOM_HEADERS {
        return Err("Too many WinRM custom headers".to_string());
    }
    for (name, value) in &config.custom_headers {
        let parsed_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "Invalid WinRM custom header name".to_string())?;
        HeaderValue::from_str(value)
            .map_err(|_| "Invalid WinRM custom header value".to_string())?;
        if value.len() > MAX_CUSTOM_HEADER_VALUE_BYTES {
            return Err("WinRM custom header value exceeds the safety limit".to_string());
        }
        let is_transport_controlled = parsed_name == reqwest::header::AUTHORIZATION
            || parsed_name == reqwest::header::PROXY_AUTHORIZATION
            || parsed_name == reqwest::header::HOST
            || parsed_name == reqwest::header::CONTENT_LENGTH
            || parsed_name == reqwest::header::COOKIE;
        if is_transport_controlled {
            return Err(format!(
                "WinRM custom header '{}' is controlled by the transport",
                parsed_name
            ));
        }
    }
    Ok(())
}

/// Parse a SOAP fault from a WinRM error response.
pub fn parse_soap_fault(response: &str) -> Option<String> {
    // Look for wsmanfault message
    if let Some(start) = response.find("Message=\"") {
        let rest = &response[start + 9..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    // Look for <s:Text> in Fault
    if let Some(start) = response.find("<s:Text") {
        if let Some(gt) = response[start..].find('>') {
            let text_start = start + gt + 1;
            if let Some(end) = response[text_start..].find("</s:Text>") {
                return Some(response[text_start..text_start + end].to_string());
            }
        }
    }
    // Look for faultstring
    if let Some(start) = response.find("<faultstring>") {
        let text_start = start + 13;
        if let Some(end) = response[text_start..].find("</faultstring>") {
            return Some(response[text_start..text_start + end].to_string());
        }
    }
    None
}

/// XML-escape a string for inclusion in SOAP envelopes.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ─── Enumeration Support (for CIM / WS-Enumeration) ─────────────────────────

/// Build an Enumerate request for WS-Enumeration (used by CIM).
pub fn build_enumerate_envelope(
    endpoint: &str,
    message_id: &str,
    resource_uri: &str,
    filter: Option<&str>,
    filter_dialect: Option<&str>,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Enumerate.uri(),
        endpoint,
        message_id,
        Some(resource_uri),
        None,
        timeout,
    );

    let filter_xml = if let Some(f) = filter {
        let dialect = filter_dialect.unwrap_or("http://schemas.microsoft.com/wbem/wsman/1/WQL");
        format!(
            r#"<w:Filter Dialect="{}">{}</w:Filter>"#,
            dialect,
            xml_escape(f)
        )
    } else {
        String::new()
    };

    let body = format!(
        r#"<wsen:Enumerate>
        <w:OptimizeEnumeration/>
        <w:MaxElements>100</w:MaxElements>
        {filter}
      </wsen:Enumerate>"#,
        filter = filter_xml,
    );

    wrap_envelope(&header, &body)
}

/// Build a Pull request for WS-Enumeration.
pub fn build_pull_envelope(
    endpoint: &str,
    message_id: &str,
    resource_uri: &str,
    enumeration_context: &str,
    timeout: &str,
) -> String {
    let header = build_soap_header(
        WsManAction::Pull.uri(),
        endpoint,
        message_id,
        Some(resource_uri),
        None,
        timeout,
    );

    let body = format!(
        r#"<wsen:Pull>
        <wsen:EnumerationContext>{context}</wsen:EnumerationContext>
        <wsen:MaxElements>100</wsen:MaxElements>
      </wsen:Pull>"#,
        context = enumeration_context,
    );

    wrap_envelope(&header, &body)
}

// ─── SSH Transport Stub ──────────────────────────────────────────────────────

/// Placeholder for SSH-based PowerShell Remoting transport (PS 7+).
/// When SSH transport is selected, PowerShell commands are executed via
/// an SSH subsystem rather than WinRM/SOAP.
#[derive(Debug)]
pub struct SshPsTransport {
    /// Target host
    pub host: String,
    /// Target port
    pub port: u16,
    /// SSH subsystem name
    pub subsystem: String,
    /// Whether connected
    pub connected: bool,
}

impl SshPsTransport {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            host: host.to_string(),
            port,
            subsystem: "powershell".to_string(),
            connected: false,
        }
    }

    /// Refuse to report a connection until an authenticated SSH subsystem
    /// transport with host-key verification is implemented.
    pub async fn connect(&mut self, _credential: &PsCredential) -> Result<(), String> {
        self.connected = false;
        Err("PowerShell Remoting over SSH is not supported by the current backend".to_string())
    }

    pub async fn execute(&self, script: &str) -> Result<String, String> {
        if !self.connected {
            return Err("SSH PS transport not connected".to_string());
        }
        // Stub: would send script through SSH subsystem
        log::debug!("SSH PS transport: execute script ({} chars)", script.len());
        Ok(String::new())
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        self.connected = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNIQUE_SECRET: &str = "SORNG_WINRM_LOG_SECRET_c23e8914";

    #[tokio::test]
    async fn ssh_placeholder_fails_closed() {
        let credential = PsCredential {
            username: "alice".to_string(),
            password: Some("secret".to_string()),
            domain: None,
            certificate_path: None,
            certificate_thumbprint: None,
            private_key_path: None,
            ssh_key_path: None,
        };
        let mut transport = SshPsTransport::new("server.example", 22);
        let error = transport.connect(&credential).await.unwrap_err();
        assert!(error.contains("not supported"));
        assert!(!transport.connected);
    }

    #[test]
    fn soap_log_metadata_and_http_errors_never_include_message_bodies() {
        let secret_body = format!("<s:Envelope><Password>{UNIQUE_SECRET}</Password></s:Envelope>");
        let request_metadata = SoapMessageMetadata::request(41, secret_body.len());
        let response_metadata =
            SoapMessageMetadata::response(41, reqwest::StatusCode::UNAUTHORIZED, secret_body.len());
        let request_debug = format!("{request_metadata:?}");
        let response_debug = format!("{response_metadata:?}");
        let error = winrm_http_status_error(reqwest::StatusCode::UNAUTHORIZED, secret_body.len());

        assert!(request_debug.contains(&secret_body.len().to_string()));
        assert!(response_debug.contains("401"));
        assert!(!request_debug.contains(UNIQUE_SECRET));
        assert!(!response_debug.contains(UNIQUE_SECRET));
        assert!(error.contains("remote response omitted"));
        assert!(!error.contains(UNIQUE_SECRET));
    }

    #[test]
    fn transport_debug_redacts_auth_and_custom_header_values() {
        let transport = WinRmTransport {
            client: reqwest::Client::new(),
            endpoint: "https://server.example:5986/wsman".to_string(),
            auth_header: Some(format!("Basic {UNIQUE_SECRET}")),
            skip_cert_validation: false,
            max_envelope_size: 512_000,
            max_response_size: MAX_SOAP_RESPONSE_BYTES,
            operation_timeout: "PT180S".to_string(),
            locale: "en-US".to_string(),
            custom_headers: HashMap::from([(
                "X-Admin-Token".to_string(),
                UNIQUE_SECRET.to_string(),
            )]),
            active_shells: Vec::new(),
            request_counter: 0,
        };

        let transport_debug = format!("{transport:?}");
        assert!(transport_debug.contains("[redacted]"));
        assert!(transport_debug.contains("X-Admin-Token"));
        assert!(!transport_debug.contains(UNIQUE_SECRET));
    }
}
