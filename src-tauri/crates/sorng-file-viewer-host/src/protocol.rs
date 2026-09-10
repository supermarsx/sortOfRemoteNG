use serde::{Deserialize, Serialize};
use std::io::Read;

pub const MAX_HEADER: usize = 4096;
pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const READY: &str = "SORNG_VIEWER_READY_V1\n";
pub const FAILURE: &str = "SORNG_VIEWER_FAILED_V1\n";
pub const UNSUPPORTED: &str = "SORNG_VIEWER_UNSUPPORTED_V1\n";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Image,
    Pdf,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageFit {
    Contain,
    Actual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySettings {
    pub text_wrap: bool,
    pub text_font_size: u8,
    pub image_fit: ImageFit,
}
impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            text_wrap: true,
            text_font_size: 14,
            image_fit: ImageFit::Contain,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Header {
    pub version: u32,
    pub kind: Kind,
    pub name: String,
    pub byte_length: u32,
    #[serde(default)]
    pub display: DisplaySettings,
}

pub struct Document {
    pub header: Header,
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidInput;

pub fn read_document(mut reader: impl Read) -> Result<Document, InvalidInput> {
    let mut prefix = [0u8; 4];
    reader.read_exact(&mut prefix).map_err(|_| InvalidInput)?;
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > MAX_HEADER {
        return Err(InvalidInput);
    }
    let mut json = vec![0; length];
    reader.read_exact(&mut json).map_err(|_| InvalidInput)?;
    let header: Header = serde_json::from_slice(&json).map_err(|_| InvalidInput)?;
    if header.version != 1
        || header.name.is_empty()
        || header.name.len() > 512
        || header.name.chars().any(|c| c.is_control())
        || (header.byte_length == 0 && header.kind != Kind::Text)
        || header.byte_length as usize > MAX_BYTES
        || !(10..=24).contains(&header.display.text_font_size)
    {
        return Err(InvalidInput);
    }
    let mut bytes = vec![0; header.byte_length as usize];
    reader.read_exact(&mut bytes).map_err(|_| InvalidInput)?;
    // Only non-decoding signature checks belong in the unsandboxed host.
    let mime = match header.kind {
        Kind::Text => {
            let text = std::str::from_utf8(&bytes).map_err(|_| InvalidInput)?;
            if text.contains('\0') {
                return Err(InvalidInput);
            }
            "text/plain; charset=utf-8"
        }
        Kind::Pdf if bytes.starts_with(b"%PDF-") => "application/pdf",
        Kind::Image if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
        Kind::Image if bytes.starts_with(b"\xff\xd8\xff") => "image/jpeg",
        Kind::Image if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => "image/gif",
        Kind::Image if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            "image/webp"
        }
        _ => return Err(InvalidInput),
    };
    Ok(Document {
        header,
        bytes,
        mime,
    })
}

/// Browser/runtime switches inherited from the launch environment are not trusted.
/// The broker should use an allowlisted environment; the helper also refuses overrides.
pub fn safe_environment(vars: impl IntoIterator<Item = (String, String)>) -> bool {
    vars.into_iter().all(|(key, _)| {
        let key = key.to_ascii_uppercase();
        !key.starts_with("WEBVIEW2_")
            && !key.starts_with("WEBKIT_")
            && !key.starts_with("DYLD_")
            && !key.starts_with("LD_")
            && !matches!(
                key.as_str(),
                "CHROME_LOG_FILE"
                    | "CHROME_HEADLESS"
                    | "GTK_MODULES"
                    | "GTK_PATH"
                    | "GIO_EXTRA_MODULES"
            )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(header: serde_json::Value, bytes: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(&header).unwrap();
        let mut output = (json.len() as u32).to_le_bytes().to_vec();
        output.extend(json);
        output.extend(bytes);
        output
    }
    fn header(kind: &str, len: usize) -> serde_json::Value {
        serde_json::json!({"version":1,"kind":kind,"name":"example","byteLength":len})
    }
    #[test]
    fn exact_bytes_and_settings_roundtrip_without_html_interpretation() {
        let bytes = b"<script>window.ipc.postMessage('bad')</script>";
        let mut head = header("text", bytes.len());
        head["name"] = "</title><script>bad()</script>".into();
        head["display"] =
            serde_json::json!({"textWrap":false,"textFontSize":18,"imageFit":"actual"});
        let doc = read_document(frame(head, bytes).as_slice()).unwrap();
        assert_eq!(doc.bytes, bytes);
        assert!(!doc.header.display.text_wrap);
        assert_eq!(doc.header.display.text_font_size, 18);
    }
    #[test]
    fn limits_are_checked_before_reading_body() {
        for size in [0, MAX_HEADER + 1, u32::MAX as usize] {
            assert!(read_document((size as u32).to_le_bytes().as_slice()).is_err());
        }
        assert!(read_document(frame(header("text", MAX_BYTES + 1), b"").as_slice()).is_err());
        assert!(read_document(frame(header("text", 10), b"short").as_slice()).is_err());
    }
    #[test]
    fn rejects_unknown_fields_versions_active_types_and_bad_settings() {
        for value in [
            serde_json::json!({"version":2,"kind":"text","name":"x","byteLength":1}),
            serde_json::json!({"version":1,"kind":"html","name":"x","byteLength":1}),
            serde_json::json!({"version":1,"kind":"text","name":"x","byteLength":1,"url":"file:///secret"}),
            serde_json::json!({"version":1,"kind":"text","name":"x","byteLength":1,"display":{"textWrap":true,"textFontSize":255,"imageFit":"contain"}}),
        ] {
            assert!(read_document(frame(value, b"a").as_slice()).is_err());
        }
        for bytes in [b"\xff".as_slice(), b"\0".as_slice()] {
            assert!(read_document(frame(header("text", bytes.len()), bytes).as_slice()).is_err());
        }
        assert!(read_document(frame(header("image", 6), b"<svg/>").as_slice()).is_err());
    }
    #[test]
    fn runtime_overrides_fail_closed_even_with_safe_looking_value() {
        for key in [
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
            "webkit_disable_sandbox_this_is_dangerous",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
        ] {
            assert!(!safe_environment([(key.into(), String::new())]));
        }
        assert!(safe_environment([(
            "SystemRoot".into(),
            "C:\\Windows".into()
        )]));
    }
}
