//! PowerShell CLIXML serialization and deserialization.
//!
//! Handles the conversion between PowerShell's CLIXML (XML-based serialization
//! format used for remote object transport) and JSON-friendly representations.

use crate::types::*;
use log::{debug, trace, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;

// ─── CLIXML Constants ────────────────────────────────────────────────────────

pub const CLIXML_HEADER: &str = "#< CLIXML";
pub const PS_NAMESPACE: &str = "http://schemas.microsoft.com/powershell/2004/04";

/// CLIXML type tags for PowerShell's serialization format.
pub struct CliXmlTag;

impl CliXmlTag {
    pub const OBJ: &'static str = "Obj";
    pub const REF_ID: &'static str = "RefId";
    pub const STRING: &'static str = "S";
    pub const INT32: &'static str = "I32";
    pub const INT64: &'static str = "I64";
    pub const INT16: &'static str = "I16";
    pub const BYTE: &'static str = "By";
    pub const UINT16: &'static str = "U16";
    pub const UINT32: &'static str = "U32";
    pub const UINT64: &'static str = "U64";
    pub const FLOAT: &'static str = "Sg";
    pub const DOUBLE: &'static str = "Db";
    pub const DECIMAL: &'static str = "D";
    pub const BOOL: &'static str = "B";
    pub const CHAR: &'static str = "C";
    pub const DATETIME: &'static str = "DT";
    pub const TIMESPAN: &'static str = "TS";
    pub const GUID: &'static str = "G";
    pub const URI: &'static str = "URI";
    pub const VERSION: &'static str = "Version";
    pub const SCRIPT_BLOCK: &'static str = "SBK";
    pub const NIL: &'static str = "Nil";
    pub const SECURE_STRING: &'static str = "SS";
    pub const TYPE_NAMES: &'static str = "TN";
    pub const TYPE_NAME: &'static str = "T";
    pub const TO_STRING: &'static str = "ToString";
    pub const PROPS: &'static str = "Props";
    pub const MEMBER_SET: &'static str = "MS";
    pub const NOTE_PROPERTY: &'static str = "N";
    pub const LIST: &'static str = "LST";
    pub const DICTIONARY: &'static str = "DCT";
    pub const DICT_ENTRY: &'static str = "En";
    pub const STACK: &'static str = "STK";
    pub const QUEUE: &'static str = "QUE";
    pub const BYTE_ARRAY: &'static str = "BA";
    pub const PROGRESS_RECORD: &'static str = "PR";
    pub const ERROR_RECORD: &'static str = "ER";
    pub const EXCEPTION: &'static str = "Ex";
    pub const INFORMATION_RECORD: &'static str = "IR";
}

// ─── PS Object Representation ────────────────────────────────────────────────

/// A deserialized PowerShell object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsObject {
    /// PowerShell type names (most specific first)
    #[serde(default)]
    pub type_names: Vec<String>,
    /// Adapted properties (NoteProperty, ScriptProperty, etc.)
    pub properties: HashMap<String, PsValue>,
    /// ToString() representation
    #[serde(default)]
    pub to_string: Option<String>,
    /// Base object value (for primitive wrappers)
    #[serde(default)]
    pub base_object: Option<Box<PsValue>>,
}

/// A PowerShell value (loosely typed, matching PS type system).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PsValue {
    Null,
    String(String),
    Int32(i32),
    Int64(i64),
    Float(f32),
    Double(f64),
    Decimal(String), // Keep as string to preserve precision
    Bool(bool),
    DateTime(String),
    TimeSpan(String),
    Guid(String),
    ByteArray(Vec<u8>),
    Array(Vec<PsValue>),
    Dictionary(Vec<(PsValue, PsValue)>),
    Object(PsObject),
    SecureString(String), // Encrypted representation
    ScriptBlock(String),
    Json(JsonValue), // Fallback to serde_json::Value
}

impl PsValue {
    /// Convert to a serde_json::Value for frontend consumption.
    pub fn to_json(&self) -> JsonValue {
        match self {
            PsValue::Null => JsonValue::Null,
            PsValue::String(s) => json!(s),
            PsValue::Int32(n) => json!(n),
            PsValue::Int64(n) => json!(n),
            PsValue::Float(n) => json!(n),
            PsValue::Double(n) => json!(n),
            PsValue::Decimal(s) => json!(s),
            PsValue::Bool(b) => json!(b),
            PsValue::DateTime(s) => json!(s),
            PsValue::TimeSpan(s) => json!(s),
            PsValue::Guid(s) => json!(s),
            PsValue::ByteArray(b) => {
                json!(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    b
                ))
            }
            PsValue::Array(arr) => {
                JsonValue::Array(arr.iter().map(|v| v.to_json()).collect())
            }
            PsValue::Dictionary(entries) => {
                let mut map = serde_json::Map::new();
                for (k, v) in entries {
                    let key = match k {
                        PsValue::String(s) => s.clone(),
                        other => format!("{:?}", other),
                    };
                    map.insert(key, v.to_json());
                }
                JsonValue::Object(map)
            }
            PsValue::Object(obj) => obj.to_json(),
            PsValue::SecureString(_) => json!("***SECURE***"),
            PsValue::ScriptBlock(s) => json!({ "scriptBlock": s }),
            PsValue::Json(v) => v.clone(),
        }
    }
}

impl PsObject {
    /// Convert to JSON representation.
    pub fn to_json(&self) -> JsonValue {
        let mut map = serde_json::Map::new();

        // Add type metadata
        if !self.type_names.is_empty() {
            map.insert(
                "__typenames".to_string(),
                json!(self.type_names),
            );
        }

        // Add properties
        for (key, value) in &self.properties {
            map.insert(key.clone(), value.to_json());
        }

        // Add toString if available and no other useful repr
        if let Some(ref ts) = self.to_string {
            map.insert("__toString".to_string(), json!(ts));
        }

        JsonValue::Object(map)
    }
}

// ─── CLIXML Parser ───────────────────────────────────────────────────────────

/// Parse a CLIXML string into a list of PsObjects.
pub fn parse_clixml(clixml: &str) -> Result<Vec<PsObject>, String> {
    let xml = if clixml.starts_with(CLIXML_HEADER) {
        // Strip the header line
        clixml
            .lines()
            .skip(1)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        clixml.to_string()
    };

    let xml = xml.trim();
    if xml.is_empty() {
        return Ok(Vec::new());
    }

    debug!("Parsing CLIXML ({} bytes)", xml.len());
    trace!("CLIXML content:\n{}", xml);

    let mut objects = Vec::new();
    let mut parser = CliXmlParser::new(xml);
    parser.parse_root(&mut objects)?;

    debug!("Parsed {} objects from CLIXML", objects.len());
    Ok(objects)
}

/// Parse CLIXML into JSON values directly (more efficient for frontend).
pub fn parse_clixml_to_json(clixml: &str) -> Result<Vec<JsonValue>, String> {
    let objects = parse_clixml(clixml)?;
    Ok(objects.iter().map(|obj| obj.to_json()).collect())
}

/// Simple XML-based CLIXML parser.
struct CliXmlParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> CliXmlParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn remaining(&self) -> &str {
        &self.input[self.pos..]
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let ch = self.input.as_bytes()[self.pos];
            if ch == b' ' || ch == b'\t' || ch == b'\n' || ch == b'\r' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parse_root(&mut self, objects: &mut Vec<PsObject>) -> Result<(), String> {
        self.skip_whitespace();

        // Handle <Objs> wrapper
        if self.remaining().starts_with("<Objs") {
            self.skip_past(">")?;
            self.parse_objects_content(objects)?;
        } else {
            // Try to parse individual objects
            while self.pos < self.input.len() {
                self.skip_whitespace();
                if self.remaining().is_empty() {
                    break;
                }
                if self.remaining().starts_with("<Obj") {
                    if let Ok(obj) = self.parse_object() {
                        objects.push(obj);
                    }
                } else if self.remaining().starts_with("<S") || self.remaining().starts_with("<I32") {
                    // Primitive output
                    let value = self.parse_value()?;
                    let mut obj = PsObject {
                        type_names: Vec::new(),
                        properties: HashMap::new(),
                        to_string: None,
                        base_object: Some(Box::new(value)),
                    };
                    objects.push(obj);
                } else {
                    // Skip unrecognized content
                    self.pos += 1;
                }
            }
        }

        Ok(())
    }

    fn parse_objects_content(&mut self, objects: &mut Vec<PsObject>) -> Result<(), String> {
        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</Objs>") || self.remaining().is_empty() {
                break;
            }
            if self.remaining().starts_with("<Obj") {
                if let Ok(obj) = self.parse_object() {
                    objects.push(obj);
                }
            } else {
                self.pos += 1;
            }
        }
        Ok(())
    }

    fn parse_object(&mut self) -> Result<PsObject, String> {
        let mut obj = PsObject {
            type_names: Vec::new(),
            properties: HashMap::new(),
            to_string: None,
            base_object: None,
        };

        // Skip <Obj ...>
        self.skip_past(">")?;

        loop {
            self.skip_whitespace();
            let rem = self.remaining();

            if rem.starts_with("</Obj>") {
                self.pos += 6;
                break;
            }

            if rem.starts_with("<TN") {
                obj.type_names = self.parse_type_names()?;
            } else if rem.starts_with("<ToString>") {
                self.pos += 10;
                obj.to_string = Some(self.read_until("</ToString>")?);
                self.skip_past(">")?;
            } else if rem.starts_with("<Props>") {
                self.pos += 7;
                self.parse_properties(&mut obj.properties)?;
            } else if rem.starts_with("<MS>") {
                self.pos += 4;
                self.parse_member_set(&mut obj.properties)?;
            } else if rem.starts_with("<LST>") {
                // List as base object
                self.pos += 5;
                let items = self.parse_list_content()?;
                obj.base_object = Some(Box::new(PsValue::Array(items)));
            } else if rem.starts_with("<DCT>") {
                self.pos += 5;
                let entries = self.parse_dict_content()?;
                obj.base_object = Some(Box::new(PsValue::Dictionary(entries)));
            } else if rem.starts_with("<") {
                // Try to parse as a value element
                if let Ok(val) = self.parse_value() {
                    obj.base_object = Some(Box::new(val));
                } else {
                    // Skip unrecognized element
                    self.skip_element()?;
                }
            } else {
                self.pos += 1;
            }
        }

        Ok(obj)
    }

    fn parse_type_names(&mut self) -> Result<Vec<String>, String> {
        let mut names = Vec::new();
        self.skip_past(">")?;

        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</TN") {
                self.skip_past(">")?;
                break;
            }
            if self.remaining().starts_with("<T>") {
                self.pos += 3;
                names.push(self.read_until("</T>")?);
                self.skip_past(">")?;
            } else {
                self.pos += 1;
            }
        }

        Ok(names)
    }

    fn parse_properties(&mut self, props: &mut HashMap<String, PsValue>) -> Result<(), String> {
        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</Props>") {
                self.pos += 8;
                break;
            }
            if self.remaining().starts_with("<") {
                let (name, value) = self.parse_named_value()?;
                if let Some(n) = name {
                    props.insert(n, value);
                }
            } else {
                self.pos += 1;
            }
        }
        Ok(())
    }

    fn parse_member_set(&mut self, props: &mut HashMap<String, PsValue>) -> Result<(), String> {
        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</MS>") {
                self.pos += 5;
                break;
            }
            if self.remaining().starts_with("<") {
                let (name, value) = self.parse_named_value()?;
                if let Some(n) = name {
                    props.insert(n, value);
                }
            } else {
                self.pos += 1;
            }
        }
        Ok(())
    }

    fn parse_named_value(&mut self) -> Result<(Option<String>, PsValue), String> {
        // Extract the N="..." attribute for the name
        let tag_start = self.pos;
        let tag_content = self.read_tag_opening()?;

        let name = extract_attribute(&tag_content, "N")
            .map(|s| s.to_string());

        // Determine the value type from the tag
        let tag_name = tag_content
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_start_matches('<')
            .trim_end_matches('/')
            .trim_end_matches('>');

        // Self-closing tag
        if tag_content.ends_with("/>") {
            return Ok((name, PsValue::Null));
        }

        let close_tag = format!("</{}>", tag_name);
        let value = match tag_name {
            "Nil" => PsValue::Null,
            "S" => PsValue::String(xml_unescape(&self.read_until(&close_tag)?)),
            "I32" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Int32(text.parse().unwrap_or(0))
            }
            "I64" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Int64(text.parse().unwrap_or(0))
            }
            "I16" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Int32(text.parse().unwrap_or(0))
            }
            "Db" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Double(text.parse().unwrap_or(0.0))
            }
            "Sg" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Float(text.parse().unwrap_or(0.0))
            }
            "D" => PsValue::Decimal(self.read_until(&close_tag)?),
            "B" => {
                let text = self.read_until(&close_tag)?;
                PsValue::Bool(text.to_lowercase() == "true")
            }
            "DT" => PsValue::DateTime(self.read_until(&close_tag)?),
            "TS" => PsValue::TimeSpan(self.read_until(&close_tag)?),
            "G" => PsValue::Guid(self.read_until(&close_tag)?),
            "BA" => {
                let text = self.read_until(&close_tag)?;
                let bytes = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    text.trim(),
                )
                .unwrap_or_default();
                PsValue::ByteArray(bytes)
            }
            "SBK" => PsValue::ScriptBlock(self.read_until(&close_tag)?),
            "SS" => PsValue::SecureString(self.read_until(&close_tag)?),
            "Obj" => {
                // Nested object - rewind and parse
                self.pos = tag_start;
                let obj = self.parse_object()?;
                PsValue::Object(obj)
            }
            "LST" => {
                let items = self.parse_list_content()?;
                PsValue::Array(items)
            }
            "DCT" => {
                let entries = self.parse_dict_content()?;
                PsValue::Dictionary(entries)
            }
            _ => {
                // Unknown type, try to read as string
                let text = self.read_until(&close_tag).unwrap_or_default();
                PsValue::String(text)
            }
        };

        // Skip closing tag
        if !matches!(tag_name, "Obj" | "Nil") {
            let _ = self.skip_past(">");
        }

        Ok((name, value))
    }

    fn parse_value(&mut self) -> Result<PsValue, String> {
        let (_name, value) = self.parse_named_value()?;
        Ok(value)
    }

    fn parse_list_content(&mut self) -> Result<Vec<PsValue>, String> {
        let mut items = Vec::new();
        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</LST>") {
                self.pos += 6;
                break;
            }
            if self.remaining().starts_with("<") {
                items.push(self.parse_value()?);
            } else {
                self.pos += 1;
            }
        }
        Ok(items)
    }

    fn parse_dict_content(&mut self) -> Result<Vec<(PsValue, PsValue)>, String> {
        let mut entries = Vec::new();
        loop {
            self.skip_whitespace();
            if self.remaining().starts_with("</DCT>") {
                self.pos += 6;
                break;
            }
            if self.remaining().starts_with("<En>") || self.remaining().starts_with("<En ") {
                self.skip_past(">")?;
                let mut key = PsValue::Null;
                let mut value = PsValue::Null;

                loop {
                    self.skip_whitespace();
                    if self.remaining().starts_with("</En>") {
                        self.pos += 5;
                        break;
                    }
                    let (name, val) = self.parse_named_value()?;
                    match name.as_deref() {
                        Some("Key") => key = val,
                        Some("Value") => value = val,
                        _ => {}
                    }
                }
                entries.push((key, value));
            } else {
                self.pos += 1;
            }
        }
        Ok(entries)
    }

    // ─── Helper Methods ──────────────────────────────────────────────

    fn skip_past(&mut self, pattern: &str) -> Result<(), String> {
        if let Some(idx) = self.remaining().find(pattern) {
            self.pos += idx + pattern.len();
            Ok(())
        } else {
            Err(format!(
                "Expected '{}' not found in remaining CLIXML",
                pattern
            ))
        }
    }

    fn read_until(&mut self, pattern: &str) -> Result<String, String> {
        if let Some(idx) = self.remaining().find(pattern) {
            let text = self.remaining()[..idx].to_string();
            self.pos += idx;
            Ok(text)
        } else {
            Err(format!("Expected '{}' not found", pattern))
        }
    }

    fn read_tag_opening(&mut self) -> Result<String, String> {
        // Read from < to > (inclusive)
        if !self.remaining().starts_with('<') {
            return Err("Expected '<' at start of tag".to_string());
        }
        if let Some(end) = self.remaining().find('>') {
            let tag = self.remaining()[..=end].to_string();
            self.pos += end + 1;
            Ok(tag)
        } else {
            Err("Unclosed tag".to_string())
        }
    }

    fn skip_element(&mut self) -> Result<(), String> {
        // Skip a full element including its children
        let tag_content = self.read_tag_opening()?;
        if tag_content.ends_with("/>") {
            return Ok(()); // Self-closing
        }
        let tag_name = tag_content
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_start_matches('<');
        let close_tag = format!("</{}>", tag_name);
        self.skip_past(&close_tag)
    }
}

fn extract_attribute<'a>(tag: &'a str, attr_name: &str) -> Option<&'a str> {
    let pattern = format!("{}=\"", attr_name);
    if let Some(start) = tag.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = tag[value_start..].find('"') {
            return Some(&tag[value_start..value_start + end]);
        }
    }
    None
}

fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

// ─── CLIXML Generator ────────────────────────────────────────────────────────

/// Serialize a JSON value into CLIXML format for sending to PowerShell.
pub fn json_to_clixml(value: &JsonValue) -> String {
    let mut xml = String::new();
    xml.push_str(&format!(
        "<Objs Version=\"1.1.0.1\" xmlns=\"{}\">\n",
        PS_NAMESPACE
    ));
    write_value_as_clixml(&mut xml, value, 1);
    xml.push_str("</Objs>");
    xml
}

fn write_value_as_clixml(xml: &mut String, value: &JsonValue, indent: usize) {
    let pad = "  ".repeat(indent);
    match value {
        JsonValue::Null => {
            xml.push_str(&format!("{}<Nil />\n", pad));
        }
        JsonValue::Bool(b) => {
            xml.push_str(&format!("{}<B>{}</B>\n", pad, b));
        }
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    xml.push_str(&format!("{}<I32>{}</I32>\n", pad, i));
                } else {
                    xml.push_str(&format!("{}<I64>{}</I64>\n", pad, i));
                }
            } else if let Some(f) = n.as_f64() {
                xml.push_str(&format!("{}<Db>{}</Db>\n", pad, f));
            }
        }
        JsonValue::String(s) => {
            xml.push_str(&format!("{}<S>{}</S>\n", pad, xml_escape_str(s)));
        }
        JsonValue::Array(arr) => {
            xml.push_str(&format!("{}<Obj>\n{}<LST>\n", pad, pad));
            for item in arr {
                write_value_as_clixml(xml, item, indent + 2);
            }
            xml.push_str(&format!("{}</LST>\n{}</Obj>\n", pad, pad));
        }
        JsonValue::Object(map) => {
            xml.push_str(&format!("{}<Obj>\n{}<MS>\n", pad, pad));
            for (key, val) in map {
                match val {
                    JsonValue::Null => {
                        xml.push_str(&format!(
                            "{}  <Nil N=\"{}\" />\n",
                            pad,
                            xml_escape_str(key)
                        ));
                    }
                    JsonValue::String(s) => {
                        xml.push_str(&format!(
                            "{}  <S N=\"{}\">{}</S>\n",
                            pad,
                            xml_escape_str(key),
                            xml_escape_str(s)
                        ));
                    }
                    JsonValue::Bool(b) => {
                        xml.push_str(&format!(
                            "{}  <B N=\"{}\">{}</B>\n",
                            pad,
                            xml_escape_str(key),
                            b
                        ));
                    }
                    JsonValue::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            xml.push_str(&format!(
                                "{}  <I64 N=\"{}\">{}</I64>\n",
                                pad,
                                xml_escape_str(key),
                                i
                            ));
                        } else if let Some(f) = n.as_f64() {
                            xml.push_str(&format!(
                                "{}  <Db N=\"{}\">{}</Db>\n",
                                pad,
                                xml_escape_str(key),
                                f
                            ));
                        }
                    }
                    _ => {
                        // Nested complex objects
                        write_value_as_clixml(xml, val, indent + 2);
                    }
                }
            }
            xml.push_str(&format!("{}</MS>\n{}</Obj>\n", pad, pad));
        }
    }
}

fn xml_escape_str(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ─── Error Record Parser ─────────────────────────────────────────────────────

/// Parse a CLIXML error stream into PsErrorRecord structures.
pub fn parse_error_stream(clixml: &str) -> Vec<PsErrorRecord> {
    let mut errors = Vec::new();

    // Simple extraction of error messages from CLIXML error streams
    let objects = parse_clixml(clixml).unwrap_or_default();

    for obj in &objects {
        if obj.type_names.iter().any(|t| t.contains("ErrorRecord")) {
            let error = PsErrorRecord {
                exception_type: obj
                    .properties
                    .get("Exception")
                    .and_then(|v| match v {
                        PsValue::Object(o) => o.type_names.first().cloned(),
                        _ => None,
                    })
                    .unwrap_or_else(|| "System.Exception".to_string()),
                message: obj
                    .properties
                    .get("Exception")
                    .and_then(|v| match v {
                        PsValue::Object(o) => o
                            .properties
                            .get("Message")
                            .and_then(|m| match m {
                                PsValue::String(s) => Some(s.clone()),
                                _ => None,
                            }),
                        _ => None,
                    })
                    .or_else(|| obj.to_string.clone())
                    .unwrap_or_else(|| "Unknown error".to_string()),
                fully_qualified_error_id: obj
                    .properties
                    .get("FullyQualifiedErrorId")
                    .and_then(|v| match v {
                        PsValue::String(s) => Some(s.clone()),
                        _ => None,
                    }),
                category: obj
                    .properties
                    .get("CategoryInfo")
                    .and_then(|v| match v {
                        PsValue::Object(o) => o.to_string.clone(),
                        PsValue::String(s) => Some(s.clone()),
                        _ => None,
                    }),
                target_object: obj
                    .properties
                    .get("TargetObject")
                    .and_then(|v| match v {
                        PsValue::String(s) => Some(s.clone()),
                        _ => None,
                    }),
                script_stack_trace: obj
                    .properties
                    .get("ScriptStackTrace")
                    .and_then(|v| match v {
                        PsValue::String(s) => Some(s.clone()),
                        _ => None,
                    }),
                invocation_info: obj
                    .properties
                    .get("InvocationInfo")
                    .and_then(|v| match v {
                        PsValue::Object(o) => o.to_string.clone(),
                        _ => None,
                    }),
                pipeline_iteration_info: None,
            };
            errors.push(error);
        }
    }

    // Fallback: extract inline error text if no structured records found
    if errors.is_empty() && clixml.contains("S S=\"Error\"") {
        let pattern = "S S=\"Error\">";
        let mut search_pos = 0;
        while let Some(start) = clixml[search_pos..].find(pattern) {
            let abs_start = search_pos + start + pattern.len();
            if let Some(end) = clixml[abs_start..].find("</S>") {
                let msg = xml_unescape(&clixml[abs_start..abs_start + end]);
                if !msg.trim().is_empty() {
                    errors.push(PsErrorRecord {
                        exception_type: "System.Management.Automation.RemoteException"
                            .to_string(),
                        message: msg,
                        fully_qualified_error_id: None,
                        category: None,
                        target_object: None,
                        script_stack_trace: None,
                        invocation_info: None,
                        pipeline_iteration_info: None,
                    });
                }
                search_pos = abs_start + end;
            } else {
                break;
            }
        }
    }

    errors
}

/// Parse progress records from CLIXML.
pub fn parse_progress_stream(clixml: &str) -> Vec<PsProgressRecord> {
    let mut records = Vec::new();
    let objects = parse_clixml(clixml).unwrap_or_default();

    for obj in &objects {
        if obj
            .type_names
            .iter()
            .any(|t| t.contains("ProgressRecord"))
        {
            let record = PsProgressRecord {
                activity: extract_string_prop(&obj.properties, "Activity")
                    .unwrap_or_default(),
                status_description: extract_string_prop(&obj.properties, "StatusDescription")
                    .unwrap_or_default(),
                percent_complete: extract_int_prop(&obj.properties, "PercentComplete")
                    .unwrap_or(-1),
                seconds_remaining: extract_int_prop(&obj.properties, "SecondsRemaining")
                    .map(|v| v as i64)
                    .unwrap_or(-1),
                current_operation: extract_string_prop(
                    &obj.properties,
                    "CurrentOperation",
                ),
                parent_activity_id: extract_int_prop(
                    &obj.properties,
                    "ParentActivityId",
                )
                .unwrap_or(-1),
                activity_id: extract_int_prop(&obj.properties, "ActivityId")
                    .unwrap_or(0),
                record_type: ProgressRecordType::Processing,
            };
            records.push(record);
        }
    }

    records
}

fn extract_string_prop(props: &HashMap<String, PsValue>, key: &str) -> Option<String> {
    props.get(key).and_then(|v| match v {
        PsValue::String(s) => Some(s.clone()),
        _ => None,
    })
}

fn extract_int_prop(props: &HashMap<String, PsValue>, key: &str) -> Option<i32> {
    props.get(key).and_then(|v| match v {
        PsValue::Int32(n) => Some(*n),
        PsValue::Int64(n) => Some(*n as i32),
        PsValue::String(s) => s.parse().ok(),
        _ => None,
    })
}
