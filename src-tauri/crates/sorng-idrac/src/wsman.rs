//! WS-Management (WSMAN) SOAP/XML client for legacy iDRAC 6/7.
//!
//! Implements the DMTF WS-Management protocol as used by Dell DRAC/iDRAC
//! via `https://{host}:{port}/wsman`.
//! Uses DCIM profile classes (DCIM_SystemView, DCIM_CPUView, etc.).

use crate::error::{IdracError, IdracResult};
use crate::types::{IdracConfig, WsmanInstance};

use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;

/// Well-known WSMAN DCIM class names used by Dell iDRAC legacy management.
pub mod dcim_classes {
    pub const SYSTEM_VIEW: &str = "DCIM_SystemView";
    pub const CPU_VIEW: &str = "DCIM_CPUView";
    pub const MEMORY_VIEW: &str = "DCIM_MemoryView";
    pub const NIC_VIEW: &str = "DCIM_NICView";
    pub const PHYSICAL_DISK_VIEW: &str = "DCIM_PhysicalDiskView";
    pub const VIRTUAL_DISK_VIEW: &str = "DCIM_VirtualDiskView";
    pub const CONTROLLER_VIEW: &str = "DCIM_ControllerView";
    pub const ENCLOSURE_VIEW: &str = "DCIM_EnclosureView";
    pub const POWER_SUPPLY_VIEW: &str = "DCIM_PowerSupplyView";
    pub const FAN_VIEW: &str = "DCIM_FanView";
    pub const SENSOR_VIEW: &str = "DCIM_NumericSensorView";
    pub const BIOS_ENUMERATION: &str = "DCIM_BIOSEnumeration";
    pub const BIOS_STRING: &str = "DCIM_BIOSString";
    pub const BIOS_INTEGER: &str = "DCIM_BIOSInteger";
    pub const LIFECYCLE_JOB: &str = "DCIM_LifecycleJob";
    pub const SYSTEM_STRING: &str = "DCIM_SystemString";
    pub const IDRAC_CARD_VIEW: &str = "DCIM_iDRACCardView";
    pub const IDRAC_CARD_STRING: &str = "DCIM_iDRACCardString";
    pub const IDRAC_CARD_ENUMERATION: &str = "DCIM_iDRACCardEnumeration";
    pub const SOFTWARE_IDENTITY: &str = "DCIM_SoftwareIdentity";
    pub const SELLOG_ENTRY: &str = "DCIM_SELLogEntry";
    pub const LC_LOG_ENTRY: &str = "DCIM_LCLogEntry";
    pub const SYSTEM_ENUMERATION: &str = "DCIM_SystemEnumeration";
    pub const OS_DEPLOYMENT_SERVICE: &str = "DCIM_OSDeploymentService";
    pub const LC_SERVICE: &str = "DCIM_LCService";
    pub const JOB_SERVICE: &str = "DCIM_JobService";
    pub const RAID_SERVICE: &str = "DCIM_RAIDService";
    pub const BIOS_SERVICE: &str = "DCIM_BIOSService";
    pub const IDRAC_CARD_SERVICE: &str = "DCIM_iDRACCardService";
}

/// WS-Management SOAP namespaces.
pub mod ns {
    pub const SOAP: &str = "http://www.w3.org/2003/05/soap-envelope";
    pub const WSA: &str = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
    pub const WSMAN: &str = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd";
    pub const WSEN: &str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration";
    pub const WSINVOKE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer";
    pub const DCIM_BASE: &str = "http://schemas.dell.com/wbem/wscim/1/cim-schema/2";
}

/// WS-Management SOAP/XML client for legacy Dell iDRAC.
pub struct WsmanClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
    message_id: std::sync::atomic::AtomicU64,
}

impl WsmanClient {
    /// Build a new WSMAN client.
    pub fn new(config: &IdracConfig) -> IdracResult<Self> {
        let (username, password) = match &config.auth {
            crate::types::IdracAuthMethod::Basic { username, password }
            | crate::types::IdracAuthMethod::Session { username, password } => {
                (username.clone(), password.clone())
            }
        };

        let client = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| IdracError::wsman(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}/wsman", config.host, config.port);

        Ok(Self {
            client,
            base_url,
            username,
            password,
            message_id: std::sync::atomic::AtomicU64::new(1),
        })
    }

    fn next_message_id(&self) -> String {
        let id = self
            .message_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("uuid:sorng-{id:08}")
    }

    /// Check if the WSMAN endpoint is reachable and credentials are valid.
    pub async fn check_connection(&self) -> IdracResult<bool> {
        match self.identify().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// WSMAN Identify operation — basic connectivity check.
    pub async fn identify(&self) -> IdracResult<String> {
        let envelope = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{SOAP}" xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>"#,
            SOAP = ns::SOAP,
        );

        let resp_text = self.send_soap(&envelope).await?;
        // Extract ProductVersion from response
        if let Some(start) = resp_text.find("<wsmid:ProductVersion>") {
            if let Some(end) = resp_text.find("</wsmid:ProductVersion>") {
                let ver = &resp_text[start + 22..end];
                return Ok(ver.to_string());
            }
        }
        Ok("Unknown".to_string())
    }

    /// Enumerate all instances of a DCIM class.
    pub async fn enumerate(&self, class_name: &str) -> IdracResult<Vec<WsmanInstance>> {
        let resource_uri = format!("{}/{}", ns::DCIM_BASE, class_name);
        let msg_id = self.next_message_id();

        let envelope = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{SOAP}" xmlns:wsa="{WSA}" xmlns:wsman="{WSMAN}" xmlns:wsen="{WSEN}">
  <s:Header>
    <wsa:To>{url}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:MessageID>{msg_id}</wsa:MessageID>
    <wsa:Action>{WSEN}/Enumerate</wsa:Action>
    <wsman:MaxEnvelopeSize>512000</wsman:MaxEnvelopeSize>
    <wsa:ReplyTo>
      <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <wsen:Enumerate>
      <wsman:OptimizeEnumeration/>
      <wsman:MaxElements>100</wsman:MaxElements>
    </wsen:Enumerate>
  </s:Body>
</s:Envelope>"#,
            SOAP = ns::SOAP,
            WSA = ns::WSA,
            WSMAN = ns::WSMAN,
            WSEN = ns::WSEN,
            url = self.base_url,
            resource_uri = resource_uri,
            msg_id = msg_id,
        );

        let resp_text = self.send_soap(&envelope).await?;
        Self::parse_enumerate_response(&resp_text, class_name)
    }

    /// Invoke a DCIM method (e.g., RequestStateChange on CIM_ComputerSystem).
    pub async fn invoke(
        &self,
        class_name: &str,
        method_name: &str,
        selectors: &[(&str, &str)],
        params: &[(&str, &str)],
    ) -> IdracResult<HashMap<String, String>> {
        let resource_uri = format!("{}/{}", ns::DCIM_BASE, class_name);
        let msg_id = self.next_message_id();

        let selector_xml: String = selectors
            .iter()
            .map(|(k, v)| format!(r#"<wsman:Selector Name="{k}">{v}</wsman:Selector>"#))
            .collect::<Vec<_>>()
            .join("\n        ");

        let param_xml: String = params
            .iter()
            .map(|(k, v)| format!("<p:{k}>{v}</p:{k}>"))
            .collect::<Vec<_>>()
            .join("\n        ");

        let action_uri = format!("{}/{}/{}", ns::DCIM_BASE, class_name, method_name);

        let envelope = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{SOAP}" xmlns:wsa="{WSA}" xmlns:wsman="{WSMAN}" xmlns:p="{resource_uri}">
  <s:Header>
    <wsa:To>{url}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:MessageID>{msg_id}</wsa:MessageID>
    <wsa:Action>{action_uri}</wsa:Action>
    <wsman:SelectorSet>
      {selector_xml}
    </wsman:SelectorSet>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <p:{method_name}_INPUT>
      {param_xml}
    </p:{method_name}_INPUT>
  </s:Body>
</s:Envelope>"#,
            SOAP = ns::SOAP,
            WSA = ns::WSA,
            WSMAN = ns::WSMAN,
            url = self.base_url,
            resource_uri = resource_uri,
            msg_id = msg_id,
            action_uri = action_uri,
            selector_xml = selector_xml,
            method_name = method_name,
            param_xml = param_xml,
        );

        let resp_text = self.send_soap(&envelope).await?;
        Self::parse_invoke_response(&resp_text)
    }

    /// Get a single instance by selectors (WSMAN Get).
    pub async fn get_instance(
        &self,
        class_name: &str,
        selectors: &[(&str, &str)],
    ) -> IdracResult<WsmanInstance> {
        let resource_uri = format!("{}/{}", ns::DCIM_BASE, class_name);
        let msg_id = self.next_message_id();

        let selector_xml: String = selectors
            .iter()
            .map(|(k, v)| format!(r#"<wsman:Selector Name="{k}">{v}</wsman:Selector>"#))
            .collect::<Vec<_>>()
            .join("\n        ");

        let envelope = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="{SOAP}" xmlns:wsa="{WSA}" xmlns:wsman="{WSMAN}">
  <s:Header>
    <wsa:To>{url}</wsa:To>
    <wsman:ResourceURI>{resource_uri}</wsman:ResourceURI>
    <wsa:MessageID>{msg_id}</wsa:MessageID>
    <wsa:Action>{TRANSFER}/Get</wsa:Action>
    <wsman:SelectorSet>
      {selector_xml}
    </wsman:SelectorSet>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body/>
</s:Envelope>"#,
            SOAP = ns::SOAP,
            WSA = ns::WSA,
            WSMAN = ns::WSMAN,
            TRANSFER = ns::WSINVOKE,
            url = self.base_url,
            resource_uri = resource_uri,
            msg_id = msg_id,
            selector_xml = selector_xml,
        );

        let resp_text = self.send_soap(&envelope).await?;
        let mut instances = Self::parse_body_instances(&resp_text, class_name);
        instances
            .pop()
            .ok_or_else(|| IdracError::not_found(format!("Instance not found for {class_name}")))
    }

    // ── Internal ────────────────────────────────────────────────────

    async fn send_soap(&self, envelope: &str) -> IdracResult<String> {
        let resp = self
            .client
            .post(&self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "application/soap+xml;charset=UTF-8")
            .body(envelope.to_string())
            .send()
            .await
            .map_err(|e| IdracError::wsman(format!("WSMAN request failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| IdracError::parse(format!("Failed to read WSMAN response: {e}")))?;

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(IdracError::auth("WSMAN authentication failed"));
        }

        if !status.is_success() {
            // Try to extract SOAP fault
            if let Some(fault) = Self::extract_soap_fault(&body) {
                return Err(IdracError::wsman(format!("SOAP fault: {fault}")));
            }
            return Err(IdracError::wsman(format!(
                "WSMAN error {}: {}",
                status.as_u16(),
                &body[..body.len().min(500)]
            )));
        }

        Ok(body)
    }

    fn extract_soap_fault(xml: &str) -> Option<String> {
        // Simple XML text extraction for fault reason
        if let Some(start) = xml.find("<s:Reason>") {
            if let Some(end) = xml.find("</s:Reason>") {
                let fragment = &xml[start..end];
                // Strip XML tags for readability
                let text: String = fragment
                    .chars()
                    .fold((String::new(), false), |(mut acc, in_tag), c| {
                        if c == '<' {
                            (acc, true)
                        } else if c == '>' {
                            (acc, false)
                        } else if !in_tag {
                            acc.push(c);
                            (acc, false)
                        } else {
                            (acc, true)
                        }
                    })
                    .0
                    .trim()
                    .to_string();
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        None
    }

    /// Parse Enumerate response body to extract instances.
    fn parse_enumerate_response(
        xml: &str,
        class_name: &str,
    ) -> IdracResult<Vec<WsmanInstance>> {
        Ok(Self::parse_body_instances(xml, class_name))
    }

    /// Parse invoke response to extract return values.
    fn parse_invoke_response(
        xml: &str,
    ) -> IdracResult<HashMap<String, String>> {
        let mut result = HashMap::new();

        // Look for ReturnValue
        if let Some(rv) = Self::extract_tag_value(xml, "ReturnValue") {
            result.insert("ReturnValue".to_string(), rv);
        }

        // Look for JobID
        if let Some(job_id) = Self::extract_tag_value(xml, "JobID")
            .or_else(|| Self::extract_tag_value(xml, "Job"))
        {
            result.insert("JobID".to_string(), job_id);
        }

        // Look for Message
        if let Some(msg) = Self::extract_tag_value(xml, "Message") {
            result.insert("Message".to_string(), msg);
        }

        Ok(result)
    }

    /// Simple XML body instance parser.
    /// Extracts `<p:{class_name}>...</p:{class_name}>` blocks from the SOAP body.
    fn parse_body_instances(xml: &str, class_name: &str) -> Vec<WsmanInstance> {
        let mut instances = Vec::new();

        // Find all instance blocks — they may be prefixed with various namespace prefixes
        // We look for the class name in any element
        let search_patterns = [
            format!("<p:{class_name}"),
            format!("<n1:{class_name}"),
            format!("<{class_name}"),
        ];

        for pattern in &search_patterns {
            let mut search_from = 0;
            while let Some(start_pos) = xml[search_from..].find(pattern.as_str()) {
                let abs_start = search_from + start_pos;

                // Find the end of this instance block
                let end_patterns = [
                    format!("</p:{class_name}>"),
                    format!("</n1:{class_name}>"),
                    format!("</{class_name}>"),
                ];

                let end_pos = end_patterns
                    .iter()
                    .filter_map(|ep| {
                        xml[abs_start..].find(ep.as_str()).map(|p| abs_start + p + ep.len())
                    })
                    .min();

                if let Some(end) = end_pos {
                    let block = &xml[abs_start..end];
                    let properties = Self::extract_properties(block);
                    if !properties.is_empty() {
                        instances.push(WsmanInstance {
                            class_name: class_name.to_string(),
                            properties,
                        });
                    }
                    search_from = end;
                } else {
                    break;
                }
            }
            if !instances.is_empty() {
                break;
            }
        }

        instances
    }

    /// Extract property name=value pairs from an XML block.
    fn extract_properties(block: &str) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        let mut pos = 0;
        while pos < block.len() {
            // Find next opening tag
            if let Some(lt) = block[pos..].find('<') {
                let tag_start = pos + lt;
                if let Some(gt) = block[tag_start..].find('>') {
                    let tag_end = tag_start + gt;
                    let tag_content = &block[tag_start + 1..tag_end];

                    // Skip closing tags, processing instructions, CDATA
                    if tag_content.starts_with('/')
                        || tag_content.starts_with('?')
                        || tag_content.starts_with('!')
                    {
                        pos = tag_end + 1;
                        continue;
                    }

                    // Remove namespace prefix and attributes
                    let tag_name = tag_content
                        .split_whitespace()
                        .next()
                        .unwrap_or(tag_content);
                    let tag_name = if let Some(colon) = tag_name.rfind(':') {
                        &tag_name[colon + 1..]
                    } else {
                        tag_name
                    };
                    let tag_name = tag_name.trim_end_matches('/');

                    // Self-closing tag = null value
                    if tag_content.ends_with('/') {
                        props.insert(
                            tag_name.to_string(),
                            serde_json::Value::Null,
                        );
                        pos = tag_end + 1;
                        continue;
                    }

                    // Find closing tag
                    let value_start = tag_end + 1;
                    let close_patterns = [
                        format!("</p:{tag_name}>"),
                        format!("</n1:{tag_name}>"),
                        format!("</{tag_name}>"),
                    ];

                    let close_pos = close_patterns
                        .iter()
                        .filter_map(|cp| {
                            block[value_start..].find(cp.as_str()).map(|p| value_start + p)
                        })
                        .min();

                    if let Some(close) = close_pos {
                        let value = block[value_start..close].trim();
                        if !value.is_empty() {
                            // Try to parse as number
                            if let Ok(n) = value.parse::<i64>() {
                                props.insert(
                                    tag_name.to_string(),
                                    serde_json::Value::Number(n.into()),
                                );
                            } else if let Ok(f) = value.parse::<f64>() {
                                if let Some(n) = serde_json::Number::from_f64(f) {
                                    props.insert(
                                        tag_name.to_string(),
                                        serde_json::Value::Number(n),
                                    );
                                } else {
                                    props.insert(
                                        tag_name.to_string(),
                                        serde_json::Value::String(value.to_string()),
                                    );
                                }
                            } else {
                                props.insert(
                                    tag_name.to_string(),
                                    serde_json::Value::String(value.to_string()),
                                );
                            }
                        }
                        pos = close;
                    } else {
                        pos = tag_end + 1;
                    }
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        props
    }

    /// Extract text content of a specific tag (first occurrence).
    fn extract_tag_value(xml: &str, tag_name: &str) -> Option<String> {
        let patterns = [
            (format!("<p:{tag_name}>"), format!("</p:{tag_name}>")),
            (format!("<n1:{tag_name}>"), format!("</n1:{tag_name}>")),
            (format!("<{tag_name}>"), format!("</{tag_name}>")),
        ];

        for (open, close) in &patterns {
            if let Some(start) = xml.find(open.as_str()) {
                let val_start = start + open.len();
                if let Some(end) = xml[val_start..].find(close.as_str()) {
                    return Some(xml[val_start..val_start + end].trim().to_string());
                }
            }
        }
        None
    }
}
