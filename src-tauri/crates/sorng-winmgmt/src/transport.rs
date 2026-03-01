//! WMI-over-WinRM SOAP/HTTP transport layer.
//!
//! Implements the WS-Management protocol for querying remote WMI providers
//! over HTTP/HTTPS. Handles SOAP envelope construction, WQL query execution,
//! WMI method invocation, and enumeration operations.

use crate::types::*;
use chrono::Utc;
use log::{debug, error, trace, warn};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Constants ───────────────────────────────────────────────────────

const NS_SOAP: &str = "http://www.w3.org/2003/05/soap-envelope";
const NS_WSA: &str = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
const NS_WSMAN: &str = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd";
const NS_WSEN: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration";
const NS_WMI_BASE: &str = "http://schemas.microsoft.com/wbem/wsman/1/wmi";
#[allow(dead_code)]
const NS_WSINVOKE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer";

const ACTION_ENUMERATE: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate";
const ACTION_PULL: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull";
const ACTION_GET: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Get";
const ACTION_PUT: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Put";
#[allow(dead_code)]
const ACTION_CREATE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create";
#[allow(dead_code)]
const ACTION_DELETE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete";
const ACTION_INVOKE_PREFIX: &str = "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2";

const DEFAULT_MAX_ENVELOPE: usize = 512_000;
const DEFAULT_MAX_ELEMENTS: u32 = 100;

// ─── Transport ───────────────────────────────────────────────────────

/// Internal state for a WinRM-to-WMI transport connection.
#[derive(Debug)]
pub struct WmiTransport {
    client: reqwest::Client,
    endpoint: String,
    auth_header: Option<String>,
    namespace: String,
    max_envelope_size: usize,
    operation_timeout: String,
    request_counter: u64,
}

impl WmiTransport {
    /// Create a new transport from a WMI connection config.
    pub fn new(config: &WmiConnectionConfig) -> Result<Self, String> {
        let endpoint = config.endpoint_uri();

        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_sec as u64))
            .connect_timeout(std::time::Duration::from_secs(15));

        if config.skip_ca_check || config.skip_cn_check {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let client = builder
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        Ok(Self {
            client,
            endpoint,
            auth_header: None,
            namespace: config.namespace.clone(),
            max_envelope_size: DEFAULT_MAX_ENVELOPE,
            operation_timeout: format!("PT{}S", config.timeout_sec),
            request_counter: 0,
        })
    }

    /// Set the authentication header value.
    pub fn set_auth(&mut self, header: String) {
        self.auth_header = Some(header);
    }

    /// Build authentication header from credentials.
    pub fn build_auth_header(config: &WmiConnectionConfig) -> Option<String> {
        let cred = config.credential.as_ref()?;

        match config.auth_method {
            WmiAuthMethod::Basic => {
                let user = if let Some(ref d) = cred.domain {
                    format!("{}\\{}", d, cred.username)
                } else {
                    cred.username.clone()
                };
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", user, cred.password),
                );
                Some(format!("Basic {}", encoded))
            }
            _ => {
                // NTLM / Negotiate / Kerberos / CredSSP negotiation requires
                // multi-step challenge-response handled externally. Fall back to
                // Basic for the transport layer. In production, the caller would
                // handle the SPNEGO dance and supply the final auth header.
                let user = if let Some(ref d) = cred.domain {
                    format!("{}\\{}", d, cred.username)
                } else {
                    cred.username.clone()
                };
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", user, cred.password),
                );
                Some(format!("Basic {}", encoded))
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
        let resource_uri = format!("{}/{}/*", NS_WMI_BASE, self.namespace.replace('\\', "/"));

        // Step 1: Enumerate with WQL filter
        let enum_ctx = self.enumerate(&resource_uri, Some(wql)).await?;

        // Step 2: Pull all results
        let mut all_items = Vec::new();
        let mut context = enum_ctx;

        loop {
            let (items, next_context, end_of_sequence) =
                self.pull(&resource_uri, &context).await?;
            all_items.extend(items);

            if end_of_sequence || next_context.is_empty() {
                break;
            }
            context = next_context;
        }

        Ok(all_items)
    }

    /// Invoke a WMI method on a class or instance.
    pub async fn invoke_method(
        &mut self,
        class_name: &str,
        method_name: &str,
        selector: Option<&[(&str, &str)]>,
        params: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
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
    pub async fn put_instance(
        &mut self,
        class_name: &str,
        selectors: &[(&str, &str)],
        properties: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
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
    ) -> Result<String, String> {
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
        Self::parse_enumeration_context(&response)
    }

    /// Pull the next batch from an enumeration.
    async fn pull(
        &mut self,
        resource_uri: &str,
        context: &str,
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
        Self::parse_pull_response(&response)
    }

    // ─── HTTP Layer ──────────────────────────────────────────────────

    /// Send a raw SOAP XML message and return the response body.
    async fn send_raw(&mut self, soap_body: &str) -> Result<String, String> {
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

        debug!(
            "WMI request #{} to {} ({} bytes)",
            req_id,
            self.endpoint,
            soap_body.len()
        );
        trace!("WMI request #{} body:\n{}", req_id, soap_body);

        let resp = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            .body(soap_body.to_string())
            .send()
            .await
            .map_err(|e| format!("WMI HTTP request failed: {}", e))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read WMI response body: {}", e))?;

        trace!("WMI response #{}: status={}, body length={}", req_id, status, body.len());

        if !status.is_success() {
            let fault = Self::extract_soap_fault(&body).unwrap_or_default();
            error!(
                "WMI SOAP fault (HTTP {}): {}",
                status.as_u16(),
                if fault.is_empty() { &body } else { &fault }
            );
            return Err(format!(
                "WMI request failed (HTTP {}): {}",
                status.as_u16(),
                if fault.is_empty() {
                    format!("HTTP error {}", status.as_u16())
                } else {
                    fault
                }
            ));
        }

        // Check for SOAP fault inside a 200 response
        if body.contains(":Fault") || body.contains("<Fault") {
            let fault = Self::extract_soap_fault(&body)
                .unwrap_or_else(|| "Unknown SOAP fault".to_string());
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
        let tag_end = trimmed.find(|c: char| c == ' ' || c == '>' || c == '/')?;
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
        let end = s[15..].find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len() - 15);
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

    Some(chrono::DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
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
        let (name, value) =
            WmiTransport::parse_simple_element("<p:Name>Hello</p:Name>").unwrap();
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
    fn test_connection_config_endpoint() {
        let config = WmiConnectionConfig {
            computer_name: "server01".to_string(),
            credential: None,
            protocol: WmiTransportProtocol::WinRm,
            auth_method: WmiAuthMethod::Negotiate,
            namespace: r"root\cimv2".to_string(),
            use_ssl: false,
            port: 0,
            skip_ca_check: false,
            timeout_sec: 30,
            skip_cn_check: false,
        };
        assert_eq!(config.endpoint_uri(), "http://server01:5985/wsman");
        assert_eq!(config.effective_port(), 5985);
    }
}
