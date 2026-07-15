//! CLIXML encoder.
//!
//! Every `<Obj>` element in the output carries a monotonic `RefId` issued
//! by [`RefIdAllocator`] so the decoder on the other side can resolve
//! back-references. Each call to [`to_clixml`] gets its own allocator —
//! references are scoped to the top-level call.

use std::cell::Cell;

use super::{PsObject, PsValue};

/// Serialize a [`PsValue`] into a CLIXML fragment (no `<Objs>` wrapper).
#[must_use]
pub fn to_clixml(value: &PsValue) -> String {
    let alloc = RefIdAllocator::new();
    let mut out = String::new();
    write_value_with(&mut out, value, None, &alloc);
    out
}

/// Allocator for monotonically increasing `RefId` values.
///
/// Callers that build CLIXML in multiple stages (e.g. the pipeline
/// creation XML, which is assembled field-by-field) can instantiate
/// their own allocator and thread it through the helpers so the whole
/// document uses a single numbering scheme.
#[derive(Debug)]
pub struct RefIdAllocator {
    next: Cell<u32>,
}

impl RefIdAllocator {
    /// Start issuing ids from `0`.
    #[must_use]
    pub fn new() -> Self {
        Self { next: Cell::new(0) }
    }

    /// Start issuing ids from `start` — useful when two allocator-free
    /// XML fragments need to be concatenated without overlapping.
    #[must_use]
    pub fn starting_at(start: u32) -> Self {
        Self {
            next: Cell::new(start),
        }
    }

    /// Allocate the next id.
    pub fn next(&self) -> u32 {
        let v = self.next.get();
        self.next.set(v + 1);
        v
    }
}

impl Default for RefIdAllocator {
    fn default() -> Self {
        Self::new()
    }
}

/// Write a value threading a caller-owned [`RefIdAllocator`] through
/// nested objects.
pub(crate) fn write_value_with(
    out: &mut String,
    value: &PsValue,
    name: Option<&str>,
    alloc: &RefIdAllocator,
) {
    match value {
        PsValue::Null => write_simple(out, "Nil", "", name, true),
        PsValue::Bool(b) => write_simple(out, "B", if *b { "true" } else { "false" }, name, false),
        PsValue::I8(v) => write_simple(out, "SB", &v.to_string(), name, false),
        PsValue::U8(v) => write_simple(out, "By", &v.to_string(), name, false),
        PsValue::I16(v) => write_simple(out, "I16", &v.to_string(), name, false),
        PsValue::U16(v) => write_simple(out, "U16", &v.to_string(), name, false),
        PsValue::I32(v) => write_simple(out, "I32", &v.to_string(), name, false),
        PsValue::U32(v) => write_simple(out, "U32", &v.to_string(), name, false),
        PsValue::I64(v) => write_simple(out, "I64", &v.to_string(), name, false),
        PsValue::U64(v) => write_simple(out, "U64", &v.to_string(), name, false),
        PsValue::F32(v) => write_simple(out, "Sg", &format_float(*v as f64), name, false),
        PsValue::Double(v) => write_simple(out, "Db", &format_float(*v), name, false),
        PsValue::Decimal(s) => write_simple(out, "D", &escape(s), name, false),
        PsValue::Char(c) => write_simple(out, "C", &(*c as u32).to_string(), name, false),
        PsValue::String(s) => write_simple(out, "S", &escape(s), name, false),
        PsValue::Bytes(b) => write_simple(out, "BA", &base64_encode(b), name, false),
        PsValue::DateTime(s) => write_simple(out, "DT", &escape(s), name, false),
        PsValue::Duration(s) => write_simple(out, "TS", &escape(s), name, false),
        PsValue::Guid(g) => write_simple(out, "G", &g.hyphenated().to_string(), name, false),
        PsValue::Version(s) => write_simple(out, "Version", &escape(s), name, false),
        PsValue::Uri(s) => write_simple(out, "URI", &escape(s), name, false),
        PsValue::Xml(s) => write_simple(out, "XD", &escape(s), name, false),
        PsValue::ScriptBlock(s) => write_simple(out, "SCT", &escape(s), name, false),
        PsValue::SecureString(s) => write_simple(out, "SS", &escape(s), name, false),
        PsValue::List(items) => {
            open_obj(out, name, alloc);
            out.push_str("<LST>");
            for item in items {
                write_value_with(out, item, None, alloc);
            }
            out.push_str("</LST>");
            out.push_str("</Obj>");
        }
        PsValue::Dict(entries) => {
            open_obj(out, name, alloc);
            out.push_str("<DCT>");
            for (k, v) in entries {
                out.push_str("<En>");
                write_value_with(out, k, Some("Key"), alloc);
                write_value_with(out, v, Some("Value"), alloc);
                out.push_str("</En>");
            }
            out.push_str("</DCT>");
            out.push_str("</Obj>");
        }
        PsValue::Object(obj) => write_object(out, obj, name, alloc),
    }
}

fn format_float(v: f64) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v.is_infinite() {
        if v.is_sign_positive() {
            "Infinity".into()
        } else {
            "-Infinity".into()
        }
    } else {
        format!("{v}")
    }
}

fn write_simple(out: &mut String, tag: &str, body: &str, name: Option<&str>, self_close: bool) {
    if self_close {
        if let Some(n) = name {
            out.push('<');
            out.push_str(tag);
            out.push_str(" N=\"");
            out.push_str(&escape(n));
            out.push_str("\"/>");
        } else {
            out.push('<');
            out.push_str(tag);
            out.push_str("/>");
        }
        return;
    }
    match name {
        Some(n) => {
            out.push('<');
            out.push_str(tag);
            out.push_str(" N=\"");
            out.push_str(&escape(n));
            out.push_str("\">");
            out.push_str(body);
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
        None => {
            out.push('<');
            out.push_str(tag);
            out.push('>');
            out.push_str(body);
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
    }
}

fn open_obj(out: &mut String, name: Option<&str>, alloc: &RefIdAllocator) {
    let id = alloc.next();
    match name {
        Some(n) => {
            out.push_str("<Obj N=\"");
            out.push_str(&escape(n));
            out.push_str(&format!("\" RefId=\"{id}\">"));
        }
        None => out.push_str(&format!("<Obj RefId=\"{id}\">")),
    }
}

fn write_object(out: &mut String, obj: &PsObject, name: Option<&str>, alloc: &RefIdAllocator) {
    open_obj(out, name, alloc);
    if !obj.type_names.is_empty() {
        out.push_str(&format!("<TN RefId=\"{}\">", alloc.next()));
        for tn in &obj.type_names {
            out.push_str("<T>");
            out.push_str(&escape(tn));
            out.push_str("</T>");
        }
        out.push_str("</TN>");
    }
    if let Some(ts) = &obj.to_string {
        out.push_str("<ToString>");
        out.push_str(&escape(ts));
        out.push_str("</ToString>");
    }
    // The synthetic "_value" property is rendered as a bare child of
    // the Obj (used for enum encoding via `ps_enum`).
    let value_prop = obj.properties.get("_value").cloned();
    let other_props: Vec<(&String, &PsValue)> = obj
        .properties
        .iter()
        .filter(|(k, _)| k.as_str() != "_value")
        .collect();
    if let Some(v) = &value_prop {
        write_value_with(out, v, None, alloc);
    }
    if !other_props.is_empty() {
        out.push_str("<MS>");
        for (k, v) in other_props {
            write_value_with(out, v, Some(k), alloc);
        }
        out.push_str("</MS>");
    }
    out.push_str("</Obj>");
}

/// Build a `<Obj>` representing a .NET `enum` value with the full type
/// hierarchy that strict PSRP server-side deserialisers expect.
///
/// Output shape (RefId numbering is left to the caller's allocator):
/// ```xml
/// <Obj RefId="…">
///   <TN RefId="…">
///     <T>System.Management.Automation.Runspaces.PSThreadOptions</T>
///     <T>System.Enum</T>
///     <T>System.ValueType</T>
///     <T>System.Object</T>
///   </TN>
///   <ToString>Default</ToString>
///   <I32>0</I32>
/// </Obj>
/// ```
#[must_use]
pub fn ps_enum(enum_type: &str, value_name: &str, integer_value: i32) -> PsValue {
    let mut obj = PsObject::new().with_type_names([
        enum_type.to_string(),
        "System.Enum".to_string(),
        "System.ValueType".to_string(),
        "System.Object".to_string(),
    ]);
    obj.to_string = Some(value_name.to_string());
    // The enum's wire value is a *bare* integer at the root of the
    // object's body — we represent it via a synthetic `_value` property
    // that the encoder treats specially below.
    obj.properties
        .insert("_value".into(), PsValue::I32(integer_value));
    PsValue::Object(obj)
}

/// Build the minimum-viable `HostInfo` object required by an
/// `InitRunspacePool` message — declares "no host" so the server
/// doesn't try to call back into us during the handshake.
#[must_use]
pub fn ps_host_info_null() -> PsValue {
    PsValue::Object(
        PsObject::new()
            .with("_isHostNull", PsValue::Bool(true))
            .with("_isHostUINull", PsValue::Bool(true))
            .with("_isHostRawUINull", PsValue::Bool(true))
            .with("_useRunspaceHost", PsValue::Bool(true)),
    )
}

/// Escape a string for XML attribute / text content.
///
/// Control characters below 0x20 (except `\t`, `\n`, `\r`) are emitted as
/// PowerShell's `_xHHHH_` escapes.
#[must_use]
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {
                out.push_str(&format!("_x{:04X}_", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// Minimal, allocation-conscious base64 encoder (standard alphabet).
#[must_use]
pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut chunks = bytes.chunks_exact(3);
    for chunk in &mut chunks {
        let b0 = chunk[0] as usize;
        let b1 = chunk[1] as usize;
        let b2 = chunk[2] as usize;
        out.push(ALPHABET[b0 >> 2] as char);
        out.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        out.push(ALPHABET[((b1 & 0x0F) << 2) | (b2 >> 6)] as char);
        out.push(ALPHABET[b2 & 0x3F] as char);
    }
    let rem = chunks.remainder();
    match rem.len() {
        0 => {}
        1 => {
            let b0 = rem[0] as usize;
            out.push(ALPHABET[b0 >> 2] as char);
            out.push(ALPHABET[(b0 & 0x03) << 4] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let b0 = rem[0] as usize;
            let b1 = rem[1] as usize;
            out.push(ALPHABET[b0 >> 2] as char);
            out.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
            out.push(ALPHABET[(b1 & 0x0F) << 2] as char);
            out.push('=');
        }
        _ => unreachable!(),
    }
    out
}

/// Decode a base64 string, ignoring whitespace.
pub(crate) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for c in s.chars() {
        if c.is_whitespace() {
            continue;
        }
        if c == '=' {
            break;
        }
        let v = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            _ => return None,
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn primitives() {
        assert_eq!(to_clixml(&PsValue::Null), "<Nil/>");
        assert_eq!(to_clixml(&PsValue::Bool(true)), "<B>true</B>");
        assert_eq!(to_clixml(&PsValue::Bool(false)), "<B>false</B>");
        assert_eq!(to_clixml(&PsValue::I32(-7)), "<I32>-7</I32>");
        assert_eq!(to_clixml(&PsValue::I64(42)), "<I64>42</I64>");
        assert_eq!(to_clixml(&PsValue::Double(1.5)), "<Db>1.5</Db>");
        assert_eq!(to_clixml(&PsValue::F32(0.5)), "<Sg>0.5</Sg>");
        assert_eq!(to_clixml(&PsValue::I8(-1)), "<SB>-1</SB>");
        assert_eq!(to_clixml(&PsValue::U8(255)), "<By>255</By>");
        assert_eq!(to_clixml(&PsValue::I16(-1)), "<I16>-1</I16>");
        assert_eq!(to_clixml(&PsValue::U16(65_535)), "<U16>65535</U16>");
        assert_eq!(to_clixml(&PsValue::U32(1)), "<U32>1</U32>");
        assert_eq!(to_clixml(&PsValue::U64(1)), "<U64>1</U64>");
        assert_eq!(to_clixml(&PsValue::Char('A')), "<C>65</C>");
        assert_eq!(to_clixml(&PsValue::Decimal("1.5".into())), "<D>1.5</D>");
    }

    #[test]
    fn string_like_variants() {
        assert_eq!(
            to_clixml(&PsValue::DateTime("2024-01-01T00:00:00".into())),
            "<DT>2024-01-01T00:00:00</DT>"
        );
        assert_eq!(
            to_clixml(&PsValue::Duration("00:00:05".into())),
            "<TS>00:00:05</TS>"
        );
        assert_eq!(
            to_clixml(&PsValue::Version("5.1.0.0".into())),
            "<Version>5.1.0.0</Version>"
        );
        assert_eq!(
            to_clixml(&PsValue::Uri("http://x".into())),
            "<URI>http://x</URI>"
        );
        assert_eq!(
            to_clixml(&PsValue::Xml("<a/>".into())),
            "<XD>&lt;a/&gt;</XD>"
        );
        assert_eq!(
            to_clixml(&PsValue::ScriptBlock("Get-Date".into())),
            "<SCT>Get-Date</SCT>"
        );
        assert_eq!(to_clixml(&PsValue::SecureString("x".into())), "<SS>x</SS>");
    }

    #[test]
    fn guid_encoding() {
        let g = Uuid::parse_str("11112222-3333-4444-5555-666677778888").unwrap();
        assert_eq!(
            to_clixml(&PsValue::Guid(g)),
            "<G>11112222-3333-4444-5555-666677778888</G>"
        );
    }

    #[test]
    fn byte_array_roundtrip() {
        let bytes = vec![0u8, 1, 2, 3, 4, 5];
        let b64 = base64_encode(&bytes);
        assert_eq!(b64, "AAECAwQF");
        assert_eq!(base64_decode(&b64).unwrap(), bytes);
        assert_eq!(
            to_clixml(&PsValue::Bytes(bytes.clone())),
            format!("<BA>{b64}</BA>")
        );
    }

    #[test]
    fn base64_edge_cases() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64_decode("  Zm\n9v ").unwrap(), b"foo");
        assert!(base64_decode("!!!").is_none());
    }

    #[test]
    fn double_special_values() {
        assert_eq!(to_clixml(&PsValue::Double(f64::NAN)), "<Db>NaN</Db>");
        assert_eq!(
            to_clixml(&PsValue::Double(f64::INFINITY)),
            "<Db>Infinity</Db>"
        );
        assert_eq!(
            to_clixml(&PsValue::Double(f64::NEG_INFINITY)),
            "<Db>-Infinity</Db>"
        );
    }

    #[test]
    fn string_escaping() {
        let xml = to_clixml(&PsValue::String("<hi & \"world\" 'x'\u{0001}".into()));
        assert!(xml.contains("&lt;"));
        assert!(xml.contains("&amp;"));
        assert!(xml.contains("&quot;"));
        assert!(xml.contains("&apos;"));
        assert!(xml.contains("_x0001_"));
    }

    #[test]
    fn space_is_not_escaped() {
        let xml = to_clixml(&PsValue::String("a b".into()));
        assert!(!xml.contains("_x0020_"));
        assert!(xml.contains("a b"));
    }

    #[test]
    fn list_encoding() {
        let v = PsValue::List(vec![PsValue::I32(1), PsValue::String("a".into())]);
        let xml = to_clixml(&v);
        assert!(xml.contains("<LST>"));
        assert!(xml.contains("<I32>1</I32>"));
        assert!(xml.contains("<S>a</S>"));
    }

    #[test]
    fn dict_encoding() {
        let v = PsValue::Dict(vec![(PsValue::String("k".into()), PsValue::I32(9))]);
        let xml = to_clixml(&v);
        assert!(xml.contains("<DCT>"));
        assert!(xml.contains("<En>"));
        assert!(xml.contains("N=\"Key\""));
        assert!(xml.contains("N=\"Value\""));
    }

    #[test]
    fn object_encoding_with_typenames_and_tostring() {
        let obj = PsObject::new()
            .with("Name", PsValue::String("Alice".into()))
            .with("Id", PsValue::I32(7))
            .with_type_names(["System.Diagnostics.Process"]);
        let mut obj = obj;
        obj.to_string = Some("alice".into());
        let xml = to_clixml(&PsValue::Object(obj));
        assert!(xml.contains("<TN RefId=\"1\">"));
        assert!(xml.contains("<T>System.Diagnostics.Process</T>"));
        assert!(xml.contains("<ToString>alice</ToString>"));
        assert!(xml.contains("<MS>"));
        assert!(xml.contains("<S N=\"Name\">Alice</S>"));
        assert!(xml.contains("<I32 N=\"Id\">7</I32>"));
    }

    #[test]
    fn nil_with_name() {
        let xml = to_clixml(&PsValue::Object(
            PsObject::new().with("Maybe", PsValue::Null),
        ));
        assert!(xml.contains("<Nil N=\"Maybe\"/>"));
    }

    #[test]
    fn refid_allocator() {
        let a = RefIdAllocator::new();
        assert_eq!(a.next(), 0);
        assert_eq!(a.next(), 1);
        assert_eq!(a.next(), 2);
        let b = RefIdAllocator::starting_at(42);
        assert_eq!(b.next(), 42);
        assert_eq!(b.next(), 43);
        let _ = RefIdAllocator::default();
    }
}
