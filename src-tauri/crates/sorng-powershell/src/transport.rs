//! WinRM SOAP/HTTP transport layer.
//!
//! Implements the WS-Management protocol for communicating with remote
//! PowerShell endpoints over HTTP/HTTPS. Handles SOAP envelope construction,
//! message correlation, shell lifecycle, and command I/O.

use crate::types::*;
use chrono::Utc;
use log::{debug, error, trace, warn};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ─── Transport State ─────────────────────────────────────────────────────────

/// Internal state for a WinRM HTTP transport connection.
#[derive(Debug)]
pub struct WinRmTransport {
    /// HTTP client for making requests
    client: reqwest::Client,
    /// Endpoint URI
    endpoint: String,
    /// Authentication header value
    auth_header: Option<String>,
    /// Whether to skip certificate validation
    skip_cert_validation: bool,
    /// Maximum envelope size in bytes (server negotiated)
    max_envelope_size: usize,
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

impl WinRmTransport {
    /// Create a new WinRM transport from configuration.
    pub fn new(config: &PsRemotingConfig) -> Result<Self, String> {
        let endpoint = config.endpoint_uri();

        let mut client_builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(
                config.session_option.operation_timeout_sec as u64,
            ))
            .connect_timeout(std::time::Duration::from_secs(
                config.session_option.open_timeout_sec as u64,
            ));

        if config.skip_ca_check || config.skip_cn_check {
            client_builder = client_builder.danger_accept_invalid_certs(true);
        }

        if config.session_option.no_compression {
            client_builder = client_builder.no_gzip().no_brotli().no_deflate();
        }

        let client = client_builder
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let operation_timeout = format!("PT{}S", config.session_option.operation_timeout_sec);

        Ok(Self {
            client,
            endpoint,
            auth_header: None,
            skip_cert_validation: config.skip_ca_check,
            max_envelope_size: 512000, // 500 KB default, negotiated during shell creation
            operation_timeout,
            locale: config.session_option.culture.clone(),
            custom_headers: config.custom_headers.clone(),
            active_shells: Vec::new(),
            request_counter: 0,
        })
    }

    /// Set the authentication header (e.g., Basic base64 or NTLM token).
    pub fn set_auth_header(&mut self, header: String) {
        self.auth_header = Some(header);
    }

    /// Send a raw SOAP envelope and return the response body.
    pub async fn send_message(&mut self, soap_body: &str) -> Result<String, String> {
        self.request_counter += 1;
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
                    .map_err(|e| format!("Invalid auth header: {}", e))?,
            );
        }

        for (key, value) in &self.custom_headers {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                headers.insert(name, val);
            }
        }

        debug!(
            "WinRM request #{} to {} ({} bytes)",
            req_id,
            self.endpoint,
            soap_body.len()
        );
        trace!("WinRM request #{} body:\n{}", req_id, soap_body);

        let response = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            .body(soap_body.to_string())
            .send()
            .await
            .map_err(|e| format!("WinRM HTTP request failed: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read WinRM response body: {}", e))?;

        trace!("WinRM response #{}: status={}, body:\n{}", req_id, status, body);

        if !status.is_success() {
            let fault = parse_soap_fault(&body).unwrap_or_else(|| body.clone());
            error!("WinRM request #{} failed: {} - {}", req_id, status, fault);
            return Err(format!("WinRM error (HTTP {}): {}", status, fault));
        }

        Ok(body)
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
        let actual_shell_id = extract_shell_id(&response).unwrap_or(shell_id);

        self.active_shells.push(actual_shell_id.clone());
        debug!("Created WinRM shell: {}", actual_shell_id);

        Ok(actual_shell_id)
    }

    /// Delete (close) a WinRM shell.
    pub async fn delete_shell(&mut self, shell_id: &str) -> Result<(), String> {
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
        let message_id = Uuid::new_v4().to_string();
        let command_id = Uuid::new_v4().to_string().to_uppercase();

        let envelope = build_command_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command,
            arguments,
            &self.operation_timeout,
        );

        let response = self.send_message(&envelope).await?;
        let actual_command_id =
            extract_command_id(&response).unwrap_or(command_id);

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
        let utf16: Vec<u8> = script
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &utf16);

        self.execute_command(
            shell_id,
            "powershell.exe",
            &[
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-EncodedCommand".to_string(),
                encoded,
            ],
        )
        .await
    }

    /// Receive output from a running command. Returns (stdout, stderr, is_done).
    pub async fn receive_output(
        &mut self,
        shell_id: &str,
        command_id: &str,
    ) -> Result<(String, String, bool), String> {
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

        loop {
            let (out, err, done) = self.receive_output(shell_id, command_id).await?;
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
        let message_id = Uuid::new_v4().to_string();

        let encoded =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data.as_bytes());

        let envelope = build_send_envelope(
            &self.endpoint,
            &message_id,
            shell_id,
            command_id,
            &encoded,
            end_of_stream,
            &self.operation_timeout,
        );

        self.send_message(&envelope).await?;
        Ok(())
    }

    /// Send a signal to a command (e.g., terminate, Ctrl+C).
    pub async fn signal_command(
        &mut self,
        shell_id: &str,
        command_id: &str,
        signal_code: &str,
    ) -> Result<(), String> {
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

fn build_create_shell_envelope(
    endpoint: &str,
    message_id: &str,
    resource_uri: &str,
    config_name: &str,
    timeout: &str,
    locale: &str,
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

    let end_attr = if end_of_stream {
        r#" End="true""#
    } else {
        ""
    };

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
    extract_stream_data(response, "stdout", &mut stdout);
    // Extract stderr streams
    extract_stream_data(response, "stderr", &mut stderr);

    // Check if command state is "Done"
    let is_done = response.contains("State=\"http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done\"")
        || response.contains("CommandState State=\"Done\"");

    Ok((stdout, stderr, is_done))
}

/// Extract base64-encoded stream data and decode it.
fn extract_stream_data(response: &str, stream_name: &str, output: &mut String) {
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
                    if let Ok(decoded) = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        encoded,
                    ) {
                        if let Ok(text) = String::from_utf8(decoded) {
                            output.push_str(&text);
                        }
                    }
                }
                search_from = data_start + end_pos;
            } else {
                break;
            }
        } else {
            break;
        }
    }
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

    /// Connect via SSH. The actual SSH session is delegated to sorng-ssh.
    pub async fn connect(&mut self, credential: &PsCredential) -> Result<(), String> {
        // In a real implementation, this would establish an SSH connection
        // using the sorng-ssh crate and start the powershell subsystem.
        log::info!(
            "SSH PS transport: connecting to {}:{} as {}",
            self.host,
            self.port,
            credential.username
        );
        self.connected = true;
        Ok(())
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
