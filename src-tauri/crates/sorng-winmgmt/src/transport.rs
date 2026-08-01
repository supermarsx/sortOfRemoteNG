//! WMI-over-WinRM SOAP/HTTP transport layer.
//!
//! Implements the WS-Management protocol for querying remote WMI providers
//! over HTTP/HTTPS. Handles SOAP envelope construction, WQL query execution,
//! WMI method invocation, and enumeration operations.

use crate::types::*;
use chrono::Utc;
use futures::StreamExt;
use log::{debug, error, warn};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Constants ───────────────────────────────────────────────────────

const NS_SOAP: &str = "http://www.w3.org/2003/05/soap-envelope";
const NS_WSA: &str = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
const NS_WSMAN: &str = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd";
const NS_WSEN: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration";
const NS_WMI_BASE: &str = "http://schemas.microsoft.com/wbem/wsman/1/wmi";

const ACTION_ENUMERATE: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate";
const ACTION_PULL: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull";
const ACTION_GET: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Get";
const ACTION_PUT: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Put";
const ACTION_INVOKE_PREFIX: &str = "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2";

const DEFAULT_MAX_ENVELOPE: usize = 512_000;
const DEFAULT_MAX_ELEMENTS: u32 = 100;
const MIN_TIMEOUT_SECS: u64 = 5;
const MAX_TIMEOUT_SECS: u64 = 120;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_WQL_BYTES: usize = 32 * 1024;
const MAX_QUERY_ROWS: usize = 10_000;
const MAX_ENUMERATION_PAGES: usize = 128;
const MAX_ENUMERATION_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ENUMERATION_CONTEXT_BYTES: usize = 8 * 1024;
const MAX_METHOD_PARAMS: usize = 128;
const MAX_SELECTORS: usize = 64;
const MAX_METHOD_INPUT_BYTES: usize = 256 * 1024;
const MAX_COMMAND_BYTES: usize = 16 * 1024;
const MAX_AUTH_HEADER_BYTES: usize = 24 * 1024;
const MAX_ERROR_CHARS: usize = 512;

// ─── Transport ───────────────────────────────────────────────────────

/// Internal state for a WinRM-to-WMI transport connection.
pub struct WmiTransport {
    client: reqwest::Client,
    endpoint: String,
    auth_header: Option<String>,
    namespace: String,
    max_envelope_size: usize,
    operation_timeout: String,
    request_counter: u64,
}

impl std::fmt::Debug for WmiTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WmiTransport")
            .field("endpoint", &self.endpoint)
            .field("auth_header_present", &self.auth_header.is_some())
            .field("namespace", &self.namespace)
            .field("max_envelope_size", &self.max_envelope_size)
            .field("operation_timeout", &self.operation_timeout)
            .field("request_counter", &self.request_counter)
            .finish_non_exhaustive()
    }
}

impl WmiTransport {
    /// Create a new transport from a WMI connection config.
    pub fn new(config: &WmiConnectionConfig) -> Result<Self, String> {
        Self::validate_config(config)?;
        let endpoint = Self::validated_endpoint(config)?;
        let timeout_secs = u64::from(config.timeout_sec).clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);

        let builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .connect_timeout(std::time::Duration::from_secs(timeout_secs.min(15)))
            .redirect(reqwest::redirect::Policy::none());

        // Route TLS trust through the Trust Center (TOFU default). The legacy
        // `skip_ca_check || skip_cn_check` flags map to an explicit, revocable
        // `AlwaysTrust` override rather than a blind skip. See `crate::trust`.
        let client = crate::trust::build_wmi_client(builder, config)?;

        Ok(Self {
            client,
            endpoint,
            auth_header: None,
            namespace: config.namespace.clone(),
            max_envelope_size: DEFAULT_MAX_ENVELOPE,
            operation_timeout: format!("PT{}S", timeout_secs),
            request_counter: 0,
        })
    }

    pub(crate) fn validate_config(config: &WmiConnectionConfig) -> Result<(), String> {
        if !matches!(config.protocol, WmiTransportProtocol::WinRm) {
            return Err(
                "DCOM transport is unavailable because authenticated DCOM/RPC is not implemented"
                    .to_string(),
            );
        }
        if !matches!(config.auth_method, WmiAuthMethod::Basic) {
            return Err(
                "Selected WinRM authentication is unavailable; only Basic over verified HTTPS is implemented"
                    .to_string(),
            );
        }
        if !config.use_ssl {
            return Err(
                "Plaintext WinRM is disabled because WS-Management message encryption is not implemented"
                    .to_string(),
            );
        }
        if config.namespace.is_empty()
            || config.namespace.len() > 256
            || !config
                .namespace
                .split(['\\', '/'])
                .all(Self::is_safe_xml_name)
        {
            return Err("Invalid or oversized WMI namespace".to_string());
        }
        if let Some(credential) = &config.credential {
            if credential.username.is_empty()
                || credential.username.len() > 512
                || credential.password.len() > 16 * 1024
                || credential.domain.as_ref().is_some_and(|d| d.len() > 255)
            {
                return Err("Invalid or oversized WinRM credentials".to_string());
            }
        }
        Self::validated_endpoint(config).map(|_| ())
    }

    fn validated_endpoint(config: &WmiConnectionConfig) -> Result<String, String> {
        let host = config.computer_name.trim();
        if host.is_empty()
            || host.len() > 253
            || host != config.computer_name
            || host.contains("://")
            || host.chars().any(|c| {
                c.is_control() || c.is_whitespace() || matches!(c, '/' | '\\' | '@' | '?' | '#')
            })
        {
            return Err("Invalid WinRM host".to_string());
        }

        let host_for_url = if host.contains(':') && !(host.starts_with('[') && host.ends_with(']'))
        {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        let port = config.effective_port();
        let endpoint = url::Url::parse(&format!("https://{host_for_url}:{port}/wsman"))
            .map_err(|_| "Invalid WinRM endpoint".to_string())?;
        if endpoint.scheme() != "https"
            || endpoint.host_str().is_none()
            || endpoint.username() != ""
            || endpoint.password().is_some()
            || endpoint.port_or_known_default() != Some(port)
            || endpoint.path() != "/wsman"
        {
            return Err("Invalid WinRM endpoint".to_string());
        }
        Ok(endpoint.to_string())
    }

    fn is_safe_xml_name(value: &str) -> bool {
        let mut chars = value.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    }

    fn validate_method_inputs(
        class_name: &str,
        method_name: Option<&str>,
        selectors: &[(&str, &str)],
        params: &HashMap<String, String>,
    ) -> Result<(), String> {
        if !Self::is_safe_xml_name(class_name)
            || method_name.is_some_and(|name| !Self::is_safe_xml_name(name))
        {
            return Err("Invalid WMI class or method identifier".to_string());
        }
        if selectors.len() > MAX_SELECTORS || params.len() > MAX_METHOD_PARAMS {
            return Err("WMI operation contains too many selectors or parameters".to_string());
        }

        let mut total_bytes = 0usize;
        for (name, value) in selectors {
            if !Self::is_safe_xml_name(name) {
                return Err("Invalid WMI selector identifier".to_string());
            }
            total_bytes = total_bytes
                .checked_add(name.len())
                .and_then(|n| n.checked_add(value.len()))
                .ok_or_else(|| "WMI operation input is too large".to_string())?;
        }
        for (name, value) in params {
            if !Self::is_safe_xml_name(name) {
                return Err("Invalid WMI parameter identifier".to_string());
            }
            total_bytes = total_bytes
                .checked_add(name.len())
                .and_then(|n| n.checked_add(value.len()))
                .ok_or_else(|| "WMI operation input is too large".to_string())?;
        }
        if total_bytes > MAX_METHOD_INPUT_BYTES {
            return Err("WMI operation input exceeds the safety limit".to_string());
        }
        Ok(())
    }

    fn bounded_error(input: &str) -> String {
        input
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .take(MAX_ERROR_CHARS)
            .collect()
    }

    fn account_enumeration_response_bytes(
        total: &mut usize,
        response_bytes: usize,
    ) -> Result<(), String> {
        let next_total = (*total)
            .checked_add(response_bytes)
            .ok_or_else(|| "WMI enumeration response byte count overflow".to_string())?;
        if next_total > MAX_ENUMERATION_RESPONSE_BYTES {
            return Err("WMI enumeration responses exceed the aggregate body safety limit".to_string());
        }
        *total = next_total;
        Ok(())
    }

    /// Set the authentication header value.
    pub fn set_auth(&mut self, header: String) {
        self.auth_header = Some(header);
    }

    /// Build authentication header from credentials.
    pub fn build_auth_header(config: &WmiConnectionConfig) -> Option<String> {
        let cred = config.credential.as_ref()?;
        Some(Self::encode_basic_auth(
            &cred.username,
            &cred.password,
            cred.domain.as_deref(),
        ))
    }

    /// Build the explicitly configured Basic auth header as a labeled candidate.
    /// Username variants are not guessed because they can select a different account.
    pub fn build_auth_variants(config: &WmiConnectionConfig) -> Vec<(String, String)> {
        let cred = match config.credential.as_ref() {
            Some(c) => c,
            None => return Vec::new(),
        };
        vec![(
            "configured credential".to_string(),
            Self::encode_basic_auth(&cred.username, &cred.password, cred.domain.as_deref()),
        )]
    }

    fn encode_basic_auth(user: &str, pass: &str, domain: Option<&str>) -> String {
        let full_user = if let Some(d) = domain {
            format!("{}\\{}", d, user)
        } else {
            user.to_string()
        };
        Self::encode_basic_auth_raw(&full_user, pass)
    }

    fn encode_basic_auth_raw(user: &str, pass: &str) -> String {
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", user, pass),
        );
        format!("Basic {}", encoded)
    }

    /// Try the explicitly configured credential with a lightweight Identify request.
    pub async fn try_auth_variants(&mut self, config: &WmiConnectionConfig) -> Result<(), String> {
        let variants = Self::build_auth_variants(config);
        let Some((_, header)) = variants.into_iter().next() else {
            return Ok(()); // no credentials to try
        };

        self.auth_header = Some(header);
        match self.test_connection().await {
            Ok(_) => {
                debug!("Configured credential accepted");
                Ok(())
            }
            Err(e) => {
                if e.contains("401") {
                    debug!("Configured credential rejected (attempt 1)");
                }
                Err(e)
            }
        }
    }

    /// Test the transport by issuing an identify request.
    pub async fn test_connection(&mut self) -> Result<bool, String> {
        let msg_id = Uuid::new_v4().to_string();
        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsa:Action>http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity/Identify</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
  </s:Header>
  <s:Body/>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            endpoint = self.endpoint,
            msg_id = msg_id,
        );

        let response = self.send_raw(&body).await?;
        Ok(response.contains("IdentifyResponse") || response.contains("ProductVersion"))
    }

    // ─── Core Operations ─────────────────────────────────────────────

    /// Execute a WQL query and return raw XML results.
    pub async fn wql_query(&mut self, wql: &str) -> Result<Vec<HashMap<String, String>>, String> {
        if wql.is_empty() || wql.len() > MAX_WQL_BYTES || wql.contains('\0') {
            return Err("Invalid or oversized WQL query".to_string());
        }
        let resource_uri = format!("{}/{}/*", NS_WMI_BASE, self.namespace.replace('\\', "/"));
        let mut enumeration_response_bytes = 0usize;

        // Step 1: Enumerate with WQL filter
        let (initial_items, enum_ctx, end_of_sequence) =
            self.enumerate(&resource_uri, Some(wql), &mut enumeration_response_bytes)
                .await?;

        // Step 2: Pull all results
        if initial_items.len() > MAX_QUERY_ROWS {
            return Err("WMI query result exceeds the row safety limit".to_string());
        }
        let mut all_items = initial_items;
        if end_of_sequence || enum_ctx.is_empty() {
            return Ok(all_items);
        }
        let mut context = enum_ctx;
        let mut seen_contexts = std::collections::HashSet::new();

        for _ in 0..MAX_ENUMERATION_PAGES {
            if context.len() > MAX_ENUMERATION_CONTEXT_BYTES
                || !seen_contexts.insert(context.clone())
            {
                return Err("Invalid or repeated WinRM enumeration context".to_string());
            }
            let (items, next_context, end_of_sequence) = self
                .pull(&resource_uri, &context, &mut enumeration_response_bytes)
                .await?;
            if all_items.len().saturating_add(items.len()) > MAX_QUERY_ROWS {
                return Err("WMI query result exceeds the row safety limit".to_string());
            }
            all_items.extend(items);

            if end_of_sequence || next_context.is_empty() {
                return Ok(all_items);
            }
            context = next_context;
        }

        Err("WMI enumeration exceeded the page safety limit".to_string())
    }

    /// Invoke a WMI method on a class or instance.
    pub(crate) async fn invoke_method(
        &mut self,
        class_name: &str,
        method_name: &str,
        selector: Option<&[(&str, &str)]>,
        params: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
        Self::validate_method_inputs(
            class_name,
            Some(method_name),
            selector.unwrap_or_default(),
            params,
        )?;
        let resource_uri = format!(
            "{}/{}/{}",
            NS_WMI_BASE,
            self.namespace.replace('\\', "/"),
            class_name
        );
        let action = format!("{}/{}/{}", ACTION_INVOKE_PREFIX, class_name, method_name);
        let msg_id = Uuid::new_v4().to_string();

        let selector_xml = if let Some(sels) = selector {
            sels.iter()
                .map(|(k, v)| {
                    format!(
                        r#"<wsman:Selector Name="{}">{}</wsman:Selector>"#,
                        xml_escape(k),
                        xml_escape(v)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n        ")
        } else {
            String::new()
        };

        let selector_set = if selector_xml.is_empty() {
            String::new()
        } else {
            format!(
                r#"<wsman:SelectorSet>
        {}
    </wsman:SelectorSet>"#,
                selector_xml
            )
        };

        let param_xml = params
            .iter()
            .map(|(k, v)| {
                format!(
                    "<p:{key} xmlns:p=\"{resource_uri}\">{value}</p:{key}>",
                    key = xml_escape(k),
                    resource_uri = resource_uri,
                    value = xml_escape(v),
                )
            })
            .collect::<Vec<_>>()
            .join("\n      ");

        let input_xml = if param_xml.is_empty() {
            format!(
                r#"<p:{method}_INPUT xmlns:p="{uri}"/>"#,
                method = method_name,
                uri = resource_uri,
            )
        } else {
            format!(
                r#"<p:{method}_INPUT xmlns:p="{uri}">
      {params}
    </p:{method}_INPUT>"#,
                method = method_name,
                uri = resource_uri,
                params = param_xml,
            )
        };

        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:Action>{action}</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsman:MaxEnvelopeSize>{max_env}</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>{timeout}</wsman:OperationTimeout>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    {selector_set}
  </s:Header>
  <s:Body>
    {input_xml}
  </s:Body>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            endpoint = self.endpoint,
            resource_uri = resource_uri,
            action = action,
            msg_id = msg_id,
            max_env = self.max_envelope_size,
            timeout = self.operation_timeout,
            selector_set = selector_set,
            input_xml = input_xml,
        );

        let response = self.send_raw(&body).await?;
        Self::parse_method_response(&response, method_name)
    }

    /// Get a single WMI instance by class + selectors.
    pub async fn get_instance(
        &mut self,
        class_name: &str,
        selectors: &[(&str, &str)],
    ) -> Result<HashMap<String, String>, String> {
        Self::validate_method_inputs(class_name, None, selectors, &HashMap::new())?;
        let resource_uri = format!(
            "{}/{}/{}",
            NS_WMI_BASE,
            self.namespace.replace('\\', "/"),
            class_name
        );
        let msg_id = Uuid::new_v4().to_string();

        let selector_xml = selectors
            .iter()
            .map(|(k, v)| {
                format!(
                    r#"<wsman:Selector Name="{}">{}</wsman:Selector>"#,
                    xml_escape(k),
                    xml_escape(v)
                )
            })
            .collect::<Vec<_>>()
            .join("\n        ");

        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:Action>{ACTION_GET}</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsman:MaxEnvelopeSize>{max_env}</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>{timeout}</wsman:OperationTimeout>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsman:SelectorSet>
        {selector_xml}
    </wsman:SelectorSet>
  </s:Header>
  <s:Body/>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            endpoint = self.endpoint,
            resource_uri = resource_uri,
            ACTION_GET = ACTION_GET,
            msg_id = msg_id,
            max_env = self.max_envelope_size,
            timeout = self.operation_timeout,
            selector_xml = selector_xml,
        );

        let response = self.send_raw(&body).await?;
        Self::parse_single_instance(&response)
    }

    /// Put (update) a single WMI instance.
    pub(crate) async fn put_instance(
        &mut self,
        class_name: &str,
        selectors: &[(&str, &str)],
        properties: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
        Self::validate_method_inputs(class_name, None, selectors, properties)?;
        let resource_uri = format!(
            "{}/{}/{}",
            NS_WMI_BASE,
            self.namespace.replace('\\', "/"),
            class_name
        );
        let msg_id = Uuid::new_v4().to_string();

        let selector_xml = selectors
            .iter()
            .map(|(k, v)| {
                format!(
                    r#"<wsman:Selector Name="{}">{}</wsman:Selector>"#,
                    xml_escape(k),
                    xml_escape(v)
                )
            })
            .collect::<Vec<_>>()
            .join("\n        ");

        let props_xml = properties
            .iter()
            .map(|(k, v)| {
                format!(
                    "<p:{key} xmlns:p=\"{uri}\">{val}</p:{key}>",
                    key = xml_escape(k),
                    uri = resource_uri,
                    val = xml_escape(v)
                )
            })
            .collect::<Vec<_>>()
            .join("\n      ");

        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:Action>{ACTION_PUT}</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsman:MaxEnvelopeSize>{max_env}</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>{timeout}</wsman:OperationTimeout>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsman:SelectorSet>
        {selector_xml}
    </wsman:SelectorSet>
  </s:Header>
  <s:Body>
    <p:{class_name} xmlns:p="{resource_uri}">
      {props_xml}
    </p:{class_name}>
  </s:Body>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            endpoint = self.endpoint,
            resource_uri = resource_uri,
            ACTION_PUT = ACTION_PUT,
            msg_id = msg_id,
            max_env = self.max_envelope_size,
            timeout = self.operation_timeout,
            selector_xml = selector_xml,
            class_name = class_name,
            props_xml = props_xml,
        );

        let response = self.send_raw(&body).await?;
        Self::parse_single_instance(&response)
    }

    // ─── Enumerate / Pull ────────────────────────────────────────────

    /// Start a WS-Enumeration and return the context token.
    async fn enumerate(
        &mut self,
        resource_uri: &str,
        wql_filter: Option<&str>,
        aggregate_response_bytes: &mut usize,
    ) -> Result<(Vec<HashMap<String, String>>, String, bool), String> {
        let msg_id = Uuid::new_v4().to_string();

        let filter_xml = if let Some(wql) = wql_filter {
            format!(
                r#"<wsman:Filter Dialect="http://schemas.microsoft.com/wbem/wsman/1/WQL">{}</wsman:Filter>"#,
                xml_escape(wql)
            )
        } else {
            String::new()
        };

        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}" xmlns:wsen="{NS_WSEN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:Action>{ACTION_ENUMERATE}</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsman:MaxEnvelopeSize>{max_env}</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>{timeout}</wsman:OperationTimeout>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
  </s:Header>
  <s:Body>
    <wsen:Enumerate>
      <wsman:OptimizeEnumeration/>
      <wsman:MaxElements>{max_elem}</wsman:MaxElements>
      {filter_xml}
    </wsen:Enumerate>
  </s:Body>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            NS_WSEN = NS_WSEN,
            endpoint = self.endpoint,
            resource_uri = resource_uri,
            ACTION_ENUMERATE = ACTION_ENUMERATE,
            msg_id = msg_id,
            max_env = self.max_envelope_size,
            timeout = self.operation_timeout,
            max_elem = DEFAULT_MAX_ELEMENTS,
            filter_xml = filter_xml,
        );

        let response = self.send_raw(&body).await?;
        Self::account_enumeration_response_bytes(aggregate_response_bytes, response.len())?;
        Self::parse_pull_response(&response)
    }

    /// Pull the next batch from an enumeration.
    async fn pull(
        &mut self,
        resource_uri: &str,
        context: &str,
        aggregate_response_bytes: &mut usize,
    ) -> Result<(Vec<HashMap<String, String>>, String, bool), String> {
        let msg_id = Uuid::new_v4().to_string();

        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{NS_SOAP}" xmlns:wsa="{NS_WSA}" xmlns:wsman="{NS_WSMAN}" xmlns:wsen="{NS_WSEN}">
  <s:Header>
    <wsa:To>{endpoint}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:Action>{ACTION_PULL}</wsa:Action>
    <wsa:MessageID>uuid:{msg_id}</wsa:MessageID>
    <wsman:MaxEnvelopeSize>{max_env}</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>{timeout}</wsman:OperationTimeout>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
  </s:Header>
  <s:Body>
    <wsen:Pull>
      <wsen:EnumerationContext>{context}</wsen:EnumerationContext>
      <wsman:MaxElements>{max_elem}</wsman:MaxElements>
    </wsen:Pull>
  </s:Body>
</s:Envelope>"#,
            NS_SOAP = NS_SOAP,
            NS_WSA = NS_WSA,
            NS_WSMAN = NS_WSMAN,
            NS_WSEN = NS_WSEN,
            endpoint = self.endpoint,
            resource_uri = resource_uri,
            ACTION_PULL = ACTION_PULL,
            msg_id = msg_id,
            max_env = self.max_envelope_size,
            timeout = self.operation_timeout,
            context = xml_escape(context),
            max_elem = DEFAULT_MAX_ELEMENTS,
        );

        let response = self.send_raw(&body).await?;
        Self::account_enumeration_response_bytes(aggregate_response_bytes, response.len())?;
        Self::parse_pull_response(&response)
    }

    // ─── HTTP Layer ──────────────────────────────────────────────────

    /// Send a raw SOAP XML message and return the response body.
    async fn send_raw(&mut self, soap_body: &str) -> Result<String, String> {
        if soap_body.len() > self.max_envelope_size {
            return Err("WMI SOAP request exceeds the envelope safety limit".to_string());
        }
        self.request_counter = self.request_counter.saturating_add(1);
        let req_id = self.request_counter;

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/soap+xml;charset=UTF-8"),
        );

        if let Some(ref auth) = self.auth_header {
            if auth.len() > MAX_AUTH_HEADER_BYTES || !auth.starts_with("Basic ") {
                return Err("Invalid WinRM authentication header".to_string());
            }
            headers.insert(
                reqwest::header::AUTHORIZATION,
                HeaderValue::from_str(auth).map_err(|e| format!("Invalid auth header: {}", e))?,
            );
        }

        debug!(
            "WMI request #{} to {} ({} bytes)",
            req_id,
            self.endpoint,
            soap_body.len()
        );
        let resp = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            .body(soap_body.to_string())
            .send()
            .await
            .map_err(|e| {
                format!(
                    "WMI HTTP request failed: {}",
                    Self::bounded_error(&e.to_string())
                )
            })?;

        let status = resp.status();
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err("WMI response exceeds the body safety limit".to_string());
        }

        // Capture WWW-Authenticate header before consuming the response body.
        // This tells us what auth methods the server actually supports.
        let www_auth = resp
            .headers()
            .get_all(reqwest::header::WWW_AUTHENTICATE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect::<Vec<_>>()
            .join(", ");

        let mut body_bytes = Vec::new();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                format!(
                    "Failed to read WMI response body: {}",
                    Self::bounded_error(&e.to_string())
                )
            })?;
            if body_bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err("WMI response exceeds the body safety limit".to_string());
            }
            body_bytes.extend_from_slice(&chunk);
        }
        let body = String::from_utf8(body_bytes)
            .map_err(|_| "WMI response is not valid UTF-8".to_string())?;

        if !status.is_success() {
            let fault = Self::safe_fault_summary(&body);
            error!(
                "WMI request #{} failed with HTTP {}",
                req_id,
                status.as_u16()
            );

            let mut msg = format!("WMI request failed (HTTP {}): {}", status.as_u16(), fault);

            // For 401, include the server's supported auth methods
            if status.as_u16() == 401 && !www_auth.is_empty() {
                msg.push_str(&format!(
                    " [Server accepts: {}]",
                    Self::bounded_error(&www_auth)
                ));
            }

            return Err(msg);
        }

        // Check for SOAP fault inside a 200 response
        if body.contains(":Fault") || body.contains("<Fault") {
            let fault = Self::safe_fault_summary(&body);
            return Err(format!("WMI SOAP fault: {}", fault));
        }

        Ok(body)
    }

    // ─── XML Parsing Helpers ─────────────────────────────────────────

    /// Extract SOAP fault message from response.
    fn extract_soap_fault(xml: &str) -> Option<String> {
        // Look for <s:Fault> ... <s:Text ...>MESSAGE</s:Text>
        if let Some(start) = xml.find("<s:Text") {
            if let Some(gt) = xml[start..].find('>') {
                let after = start + gt + 1;
                if let Some(end) = xml[after..].find("</s:Text>") {
                    return Some(xml[after..after + end].to_string());
                }
            }
        }
        // Alternative: faultstring
        if let Some(start) = xml.find("<faultstring>") {
            let after = start + "<faultstring>".len();
            if let Some(end) = xml[after..].find("</faultstring>") {
                return Some(xml[after..after + end].to_string());
            }
        }
        // wsman:Message
        if let Some(start) = xml.find("<wsman:Message>") {
            let after = start + "<wsman:Message>".len();
            if let Some(end) = xml[after..].find("</wsman:Message>") {
                return Some(xml[after..after + end].to_string());
            }
        }
        None
    }

    fn safe_fault_summary(xml: &str) -> String {
        let fault = Self::extract_soap_fault(xml)
            .map(|value| xml_unescape(&value))
            .unwrap_or_default()
            .to_ascii_lowercase();
        if fault.contains("access denied")
            || fault.contains("unauthorized")
            || fault.contains("authentication")
            || fault.contains("credential")
        {
            "Remote management authentication or authorization failed".to_string()
        } else if fault.contains("timeout") || fault.contains("timed out") {
            "Remote management operation timed out".to_string()
        } else if fault.contains("invalid")
            || fault.contains("syntax")
            || fault.contains("query")
            || fault.contains("selector")
        {
            "Remote management request was rejected as invalid".to_string()
        } else if fault.contains("not found") || fault.contains("unknown resource") {
            "Remote management resource was not found".to_string()
        } else {
            "Remote management service returned a SOAP fault".to_string()
        }
    }

    /// Parse an EnumerateResponse to extract the enumeration context.
    fn parse_enumeration_context(xml: &str) -> Result<String, String> {
        // Look for <wsen:EnumerationContext> or <EnumerationContext>
        let patterns = [
            ("<wsen:EnumerationContext>", "</wsen:EnumerationContext>"),
            ("<EnumerationContext>", "</EnumerationContext>"),
            ("<n:EnumerationContext>", "</n:EnumerationContext>"),
        ];

        for (open, close) in &patterns {
            if let Some(start) = xml.find(open) {
                let after = start + open.len();
                if let Some(end) = xml[after..].find(close) {
                    return Ok(xml[after..after + end].to_string());
                }
            }
        }

        // If the enumerate returned items directly (OptimizeEnumeration),
        // there may be no context but an EndOfSequence marker
        if xml.contains("EndOfSequence") {
            return Ok(String::new());
        }

        Err("Failed to parse enumeration context from WMI response".to_string())
    }

    /// Parse a PullResponse to extract items, next context, and end-of-sequence.
    #[allow(clippy::type_complexity)]
    fn parse_pull_response(
        xml: &str,
    ) -> Result<(Vec<HashMap<String, String>>, String, bool), String> {
        let end_of_sequence = xml.contains("EndOfSequence");

        // Extract next enumeration context
        let next_ctx = Self::parse_enumeration_context(xml).unwrap_or_default();

        // Extract items from <wsen:Items> or <Items>
        let items = Self::extract_items(xml);

        Ok((items, next_ctx, end_of_sequence))
    }

    /// Extract WMI items from the response XML.
    fn extract_items(xml: &str) -> Vec<HashMap<String, String>> {
        let mut results = Vec::new();

        // Find the Items block
        let items_start = xml
            .find("<wsen:Items>")
            .or_else(|| xml.find("<Items>"))
            .or_else(|| xml.find("<n:Items>"));

        let items_end = xml
            .find("</wsen:Items>")
            .or_else(|| xml.find("</Items>"))
            .or_else(|| xml.find("</n:Items>"));

        let items_xml = if let (Some(start), Some(end)) = (items_start, items_end) {
            // Find the actual end of the opening tag
            let body_start = xml[start..].find('>').map(|p| start + p + 1).unwrap_or(end);
            &xml[body_start..end]
        } else {
            // No Items wrapper — try Body directly
            let body_start = xml.find("<s:Body>").or_else(|| xml.find("<Body>"));
            let body_end = xml.find("</s:Body>").or_else(|| xml.find("</Body>"));
            if let (Some(s), Some(e)) = (body_start, body_end) {
                let inner_start = xml[s..].find('>').map(|p| s + p + 1).unwrap_or(e);
                &xml[inner_start..e]
            } else {
                return results;
            }
        };

        // Parse individual items — each WMI object is an XML element
        // whose child elements are properties
        let item_blocks = Self::split_top_level_elements(items_xml);
        for block in item_blocks {
            let props = Self::parse_properties(&block);
            if !props.is_empty() {
                results.push(props);
            }
        }

        results
    }

    /// Split a block of XML into top-level element strings.
    fn split_top_level_elements(xml: &str) -> Vec<String> {
        let mut elements = Vec::new();
        let trimmed = xml.trim();
        if trimmed.is_empty() {
            return elements;
        }

        let mut depth = 0i32;
        let mut current_start: Option<usize> = None;
        let chars: Vec<char> = trimmed.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            if chars[i] == '<' {
                if i + 1 < chars.len() && chars[i + 1] == '/' {
                    // Closing tag
                    depth -= 1;
                    if depth == 0 {
                        // Find end of this closing tag
                        if let Some(end) = trimmed[i..].find('>') {
                            let end_pos = i + end + 1;
                            if let Some(start) = current_start {
                                elements.push(trimmed[start..end_pos].to_string());
                            }
                            current_start = None;
                            i = end_pos;
                            continue;
                        }
                    }
                } else if i + 1 < chars.len() && chars[i + 1] == '?' {
                    // Processing instruction — skip
                    if let Some(end) = trimmed[i..].find("?>") {
                        i = i + end + 2;
                        continue;
                    }
                } else {
                    // Opening or self-closing tag
                    if depth == 0 {
                        current_start = Some(i);
                    }

                    // Check for self-closing
                    if let Some(tag_end) = trimmed[i..].find('>') {
                        let tag_region = &trimmed[i..i + tag_end + 1];
                        if tag_region.ends_with("/>") {
                            if depth == 0 {
                                elements.push(tag_region.to_string());
                                current_start = None;
                                i = i + tag_end + 1;
                                continue;
                            }
                            // Self-closing inside deeper element — doesn't affect depth
                        } else {
                            depth += 1;
                        }
                    }
                }
            }
            i += 1;
        }

        elements
    }

    /// Parse property child elements from an XML item block.
    fn parse_properties(xml: &str) -> HashMap<String, String> {
        let mut props = HashMap::new();

        // Find inner content (skip the wrapper element)
        let inner = if let Some(first_gt) = xml.find('>') {
            let body = &xml[first_gt + 1..];
            if let Some(last_lt) = body.rfind("</") {
                &body[..last_lt]
            } else {
                body
            }
        } else {
            return props;
        };

        // Match property elements: <ns:PropName>value</ns:PropName> or <PropName>value</PropName>
        let prop_elements = Self::split_top_level_elements(inner);
        for elem in prop_elements {
            if let Some((name, value)) = Self::parse_simple_element(&elem) {
                // Strip namespace prefix
                let clean_name = if let Some(pos) = name.find(':') {
                    name[pos + 1..].to_string()
                } else {
                    name
                };
                props.insert(clean_name, value);
            }
        }

        props
    }

    /// Parse a simple XML element like `<ns:Name attr="x">value</ns:Name>`.
    fn parse_simple_element(xml: &str) -> Option<(String, String)> {
        let trimmed = xml.trim();
        if !trimmed.starts_with('<') {
            return None;
        }

        // Extract tag name
        let tag_end = trimmed.find([' ', '>', '/'])?;
        let tag_name = trimmed[1..tag_end].to_string();

        // Check for xsi:nil="true" (null value)
        if trimmed.contains("xsi:nil=\"true\"") || trimmed.contains("nil=\"true\"") {
            return Some((tag_name, String::new()));
        }

        // Self-closing = empty value
        if trimmed.ends_with("/>") {
            return Some((tag_name, String::new()));
        }

        // Extract value between > and </
        let value_start = trimmed.find('>')? + 1;
        let closing = format!("</{}", tag_name);
        let alt_closing = "</".to_string();
        let value_end = trimmed[value_start..]
            .find(&closing)
            .or_else(|| trimmed[value_start..].find(&alt_closing))?;

        let value = xml_unescape(&trimmed[value_start..value_start + value_end]);
        Some((tag_name, value))
    }

    /// Parse the result of a WMI method invocation.
    fn parse_method_response(
        xml: &str,
        method_name: &str,
    ) -> Result<HashMap<String, String>, String> {
        // Find the OUTPUT element: <p:MethodName_OUTPUT ...>...</p:MethodName_OUTPUT>
        let output_tag = format!("{}_OUTPUT", method_name);
        let result = Self::extract_items(xml);

        if let Some(first) = result.into_iter().next() {
            return Ok(first);
        }

        // Try parsing the body directly for the output element
        let body_start = xml.find("<s:Body>").or_else(|| xml.find("<Body>"));
        let body_end = xml.find("</s:Body>").or_else(|| xml.find("</Body>"));

        if let (Some(s), Some(e)) = (body_start, body_end) {
            let inner_start = xml[s..].find('>').map(|p| s + p + 1).unwrap_or(e);
            let body_xml = &xml[inner_start..e];
            let props = Self::parse_properties(body_xml);
            if !props.is_empty() {
                return Ok(props);
            }
        }

        // If we find an output tag at all, parse it
        if xml.contains(&output_tag) {
            let props = Self::parse_properties(xml);
            if !props.is_empty() {
                return Ok(props);
            }
        }

        warn!("No output found for method {}", method_name);
        Ok(HashMap::new())
    }

    /// Parse a single instance from a Get response.
    fn parse_single_instance(xml: &str) -> Result<HashMap<String, String>, String> {
        let body_start = xml
            .find("<s:Body>")
            .or_else(|| xml.find("<Body>"))
            .ok_or_else(|| "No Body element in WMI response".to_string())?;
        let body_end = xml
            .find("</s:Body>")
            .or_else(|| xml.find("</Body>"))
            .ok_or_else(|| "No closing Body element in WMI response".to_string())?;

        let inner_start = xml[body_start..]
            .find('>')
            .map(|p| body_start + p + 1)
            .unwrap_or(body_end);
        let body_xml = &xml[inner_start..body_end];

        let props = Self::parse_properties(body_xml);
        if props.is_empty() {
            warn!("Empty instance returned from WMI Get");
        }
        Ok(props)
    }

    /// Execute an arbitrary command on the remote host via Win32_Process.Create.
    ///
    /// Returns the output of the command invocation (return value and process id).
    pub(crate) async fn exec_command(&mut self, command: &str) -> Result<String, String> {
        if command.is_empty() || command.len() > MAX_COMMAND_BYTES || command.contains('\0') {
            return Err("Invalid or oversized remote command".to_string());
        }
        let mut params = HashMap::new();
        params.insert("CommandLine".to_string(), command.to_string());

        let result = self
            .invoke_method("Win32_Process", "Create", None, &params)
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(1);

        if return_value != 0 {
            return Err(format!(
                "Command execution failed with return code {}",
                return_value
            ));
        }

        Ok(result.get("ProcessId").cloned().unwrap_or_default())
    }
}

// ─── XML Utility Functions ───────────────────────────────────────────

/// Escape special characters for XML content.
pub fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Unescape XML entities.
pub fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Parse a WMI datetime string (CIM_DATETIME) to chrono DateTime.
/// Format: yyyymmddHHMMSS.mmmmmmsUUU  (e.g., 20231015143022.000000+000)
pub fn parse_wmi_datetime(s: &str) -> Option<chrono::DateTime<Utc>> {
    if s.len() < 14 {
        return None;
    }

    let year: i32 = s[0..4].parse().ok()?;
    let month: u32 = s[4..6].parse().ok()?;
    let day: u32 = s[6..8].parse().ok()?;
    let hour: u32 = s[8..10].parse().ok()?;
    let minute: u32 = s[10..12].parse().ok()?;
    let second: u32 = s[12..14].parse().ok()?;

    let microsecond = if s.len() > 15 && s.as_bytes()[14] == b'.' {
        let end = s[15..]
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(s.len() - 15);
        let us_str = &s[15..15 + end];
        let padded = format!("{:0<6}", us_str);
        padded[..6].parse::<u32>().unwrap_or(0)
    } else {
        0
    };

    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let time = NaiveTime::from_hms_micro_opt(hour, minute, second, microsecond)?;
    let naive = NaiveDateTime::new(date, time);

    Some(chrono::DateTime::<Utc>::from_naive_utc_and_offset(
        naive, Utc,
    ))
}

/// Format a chrono DateTime to WMI CIM_DATETIME string.
pub fn format_wmi_datetime(dt: &chrono::DateTime<Utc>) -> String {
    dt.format("%Y%m%d%H%M%S.000000+000").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn test_xml_escape_unescape() {
        let input = "foo & <bar> \"baz\" 'qux'";
        let escaped = xml_escape(input);
        assert_eq!(
            escaped,
            "foo &amp; &lt;bar&gt; &quot;baz&quot; &apos;qux&apos;"
        );
        assert_eq!(xml_unescape(&escaped), input);
    }

    #[test]
    fn test_parse_wmi_datetime() {
        let dt = parse_wmi_datetime("20231015143022.000000+000").unwrap();
        assert_eq!(dt.year(), 2023);
        assert_eq!(dt.month(), 10);
        assert_eq!(dt.day(), 15);
    }

    #[test]
    fn test_format_wmi_datetime() {
        use chrono::TimeZone;
        let dt = Utc.with_ymd_and_hms(2023, 10, 15, 14, 30, 22).unwrap();
        let formatted = format_wmi_datetime(&dt);
        assert_eq!(formatted, "20231015143022.000000+000");
    }

    #[test]
    fn test_split_top_level_elements() {
        let xml = "<a>1</a><b><c>2</c></b><d/>";
        let elems = WmiTransport::split_top_level_elements(xml);
        assert_eq!(elems.len(), 3);
        assert_eq!(elems[0], "<a>1</a>");
        assert_eq!(elems[1], "<b><c>2</c></b>");
        assert_eq!(elems[2], "<d/>");
    }

    #[test]
    fn test_parse_simple_element() {
        let (name, value) = WmiTransport::parse_simple_element("<p:Name>Hello</p:Name>").unwrap();
        assert_eq!(name, "p:Name");
        assert_eq!(value, "Hello");
    }

    #[test]
    fn test_parse_simple_element_self_closing() {
        let (name, value) = WmiTransport::parse_simple_element("<Foo/>").unwrap();
        assert_eq!(name, "Foo");
        assert_eq!(value, "");
    }

    #[test]
    fn test_parse_properties() {
        let xml = r#"<p:Win32_Service xmlns:p="http://example.com"><p:Name>Spooler</p:Name><p:State>Running</p:State></p:Win32_Service>"#;
        let props = WmiTransport::parse_properties(xml);
        assert_eq!(props.get("Name").unwrap(), "Spooler");
        assert_eq!(props.get("State").unwrap(), "Running");
    }

    #[test]
    fn test_enumeration_response_budget_is_aggregate() {
        let mut consumed = MAX_ENUMERATION_RESPONSE_BYTES - MAX_RESPONSE_BYTES;
        WmiTransport::account_enumeration_response_bytes(&mut consumed, MAX_RESPONSE_BYTES)
            .expect("the exact aggregate response budget should be accepted");
        assert_eq!(consumed, MAX_ENUMERATION_RESPONSE_BYTES);

        let error = WmiTransport::account_enumeration_response_bytes(&mut consumed, 1)
            .expect_err("a later page must not exceed the aggregate response budget");
        assert!(error.contains("aggregate body safety limit"));
        assert_eq!(consumed, MAX_ENUMERATION_RESPONSE_BYTES);
    }

    #[test]
    fn test_connection_config_endpoint() {
        let config = WmiConnectionConfig {
            computer_name: "server01".to_string(),
            credential: None,
            protocol: WmiTransportProtocol::WinRm,
            auth_method: WmiAuthMethod::Negotiate,
            namespace: r"root\cimv2".to_string(),
            use_ssl: false,
            port: 0,
            alt_port: 0,
            skip_ca_check: false,
            timeout_sec: 30,
            skip_cn_check: false,
        };
        assert_eq!(config.endpoint_uri(), "http://server01:5985/wsman");
        assert_eq!(config.effective_port(), 5985);
    }
}
