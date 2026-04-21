//! SoftEther PACK codec — clean-room Rust port of `Mayaqua/Pack.c`.
//!
//! PACK is SoftEther's tag/length/value dict serialization format. Every
//! non-data-plane control message in the SoftEther SSL-VPN protocol —
//! `ClientAuth`, `ClientConnect`, server-hello replies, all administrative
//! RPCs — rides on top of PACK. The watermark handshake is the only
//! control-plane message that is NOT a PACK (it is an HTTP POST with a
//! fixed binary body).
//!
//! This module is the prerequisite for SE-2..7. It owns only the codec:
//! no I/O, no crypto, no TAP/TUN. Higher layers compose `Pack`s with
//! specific named elements per `Cedar/Protocol.c`.
//!
//! # Clean-room port
//!
//! The implementation was written by reading `Mayaqua/Pack.c`,
//! `Mayaqua/Pack.h`, and the `Read/WriteBuf*` helpers in `Mayaqua/Memory.c`
//! of SoftEtherVPN_Stable (GPLv2), then re-expressing the wire format in
//! idiomatic Rust. No C code is copied. The project ships its own
//! re-implementation under its own license.
//!
//! # Wire format
//!
//! All integers are big-endian. The top-level layout is:
//!
//! ```text
//! [u32: num_elements]
//!   per element:
//!     [u32: name_len + 1]     <-- "+1" is a virtual NUL byte
//!     [name_len bytes]        <-- element name, ASCII, no NUL in body
//!     [u32: value_type]
//!     [u32: num_values]
//!       per value:
//!         VALUE_INT    (0): [u32]
//!         VALUE_DATA   (1): [u32: len][len bytes]
//!         VALUE_STR    (2): [u32: len][len bytes]           <-- no NUL
//!         VALUE_UNISTR (3): [u32: utf8_len + 1][utf8_len bytes][0x00]
//!         VALUE_INT64  (4): [u64]
//! ```
//!
//! The UNISTR asymmetry (trailing NUL IS on the wire, counted in the
//! length prefix) is easy to miss and would break server interop — it
//! matches `WriteValue` in Pack.c which does
//! `u_size = CalcUniToUtf8(u) + 1; ... WriteBuf(b, u, u_size)`. Element
//! names use the same "+1 virtual NUL in length, no NUL in body" scheme
//! as WriteBufStr.
//!
//! # Limits
//!
//! | Limit | Value | Source |
//! |---|---|---|
//! | `MAX_ELEMENT_NAME_LEN` | 128 bytes | SE-1 spec (brief) |
//! | `MAX_VALUE_SIZE` | 128 MiB | Conservative cap (C source: 96 MiB / 384 MiB) |
//! | `MAX_VALUE_NUM` | 65_536 | Matches C 32-bit build |
//! | `MAX_ELEMENT_NUM` | 131_072 | Matches C 32-bit build |
//!
//! Note: upstream C Pack.h sets `MAX_ELEMENT_NAME_LEN = 63`. The SE-1 brief
//! explicitly specifies 128. We follow the brief — this is strictly looser
//! than the C reference (any name a real SoftEther server would send fits
//! in 63 bytes, well under our 128 ceiling), so interop is unaffected.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::fmt;

// ─── Constants (mirroring Mayaqua/Pack.h) ────────────────────────────────

/// Maximum element-name length in bytes. Per SE-1 brief.
pub const MAX_ELEMENT_NAME_LEN: usize = 128;

/// Maximum byte size of a single `Value`'s payload.
pub const MAX_VALUE_SIZE: usize = 128 * 1024 * 1024;

/// Maximum number of values per element (array cardinality).
pub const MAX_VALUE_NUM: usize = 65_536;

/// Maximum number of elements in a single `Pack`.
pub const MAX_ELEMENT_NUM: usize = 131_072;

// VALUE_TYPE tags as they appear on the wire (from Pack.h).
const VALUE_INT: u32 = 0;
const VALUE_DATA: u32 = 1;
const VALUE_STR: u32 = 2;
const VALUE_UNISTR: u32 = 3;
const VALUE_INT64: u32 = 4;

// ─── Public types ────────────────────────────────────────────────────────

/// A single PACK value. The enum discriminant maps 1:1 to the wire tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    /// `VALUE_INT` — 4-byte big-endian unsigned.
    Int(u32),
    /// `VALUE_DATA` — length-prefixed opaque bytes.
    Data(Vec<u8>),
    /// `VALUE_STR` — length-prefixed ASCII/UTF-8. No NUL on the wire.
    Str(String),
    /// `VALUE_UNISTR` — length-prefixed UTF-8. Trailing NUL IS on the wire.
    UniStr(String),
    /// `VALUE_INT64` — 8-byte big-endian unsigned.
    Int64(u64),
}

impl Value {
    fn type_tag(&self) -> u32 {
        match self {
            Value::Int(_) => VALUE_INT,
            Value::Data(_) => VALUE_DATA,
            Value::Str(_) => VALUE_STR,
            Value::UniStr(_) => VALUE_UNISTR,
            Value::Int64(_) => VALUE_INT64,
        }
    }
}

/// A named, type-homogeneous sequence of values.
///
/// In the wire format each element has a single `value_type` tag and a
/// `num_values` count, so all values inside one element must share a
/// variant. The API enforces this: mixing types under the same name
/// returns [`PackError::TypeMismatch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Element {
    pub name: String,
    pub values: Vec<Value>,
}

/// An ordered map of named elements.
///
/// The underlying storage is a `Vec<Element>` (not a HashMap), because the
/// C reference and SoftEther server both treat the on-wire element order
/// as meaningful for some RPCs. Lookups are linear but element counts are
/// typically small (<100 for any real control message).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Pack {
    elements: Vec<Element>,
}

/// Errors returned by the PACK codec.
///
/// `InvalidMagic` is retained from the SE-1 brief even though PACK has no
/// magic number — callers may prepend their own framing magic. The codec
/// itself never emits this variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackError {
    /// Reserved; see docs above.
    InvalidMagic,
    /// Buffer ended mid-value / mid-header.
    Truncated,
    /// `VALUE_STR` / `VALUE_UNISTR` body was not valid UTF-8.
    InvalidUtf8,
    /// A length prefix or count exceeds the configured limit.
    TooLarge,
    /// `value_type` on the wire was not one of `{0, 1, 2, 3, 4}`.
    UnknownValueType(u32),
    /// Caller tried to add an element with a name longer than
    /// [`MAX_ELEMENT_NAME_LEN`].
    NameTooLong(usize),
    /// Caller tried to add a value under a name that already exists with
    /// a different variant.
    TypeMismatch {
        name: String,
        existing: &'static str,
        attempted: &'static str,
    },
    /// `WriteBufStr` encoding of an empty name would produce `len=0`,
    /// which the reader treats as an error. Reject on the write side too.
    EmptyName,
}

impl fmt::Display for PackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackError::InvalidMagic => write!(f, "invalid PACK magic"),
            PackError::Truncated => write!(f, "PACK buffer truncated"),
            PackError::InvalidUtf8 => write!(f, "PACK string contained invalid UTF-8"),
            PackError::TooLarge => write!(f, "PACK length prefix exceeds configured maximum"),
            PackError::UnknownValueType(t) => write!(f, "unknown PACK value type: {t}"),
            PackError::NameTooLong(n) => write!(
                f,
                "element name too long: {n} bytes (max {MAX_ELEMENT_NAME_LEN})"
            ),
            PackError::TypeMismatch {
                name,
                existing,
                attempted,
            } => write!(
                f,
                "element '{name}' already exists as {existing}; cannot append {attempted}"
            ),
            PackError::EmptyName => write!(f, "element name must not be empty"),
        }
    }
}

impl std::error::Error for PackError {}

// ─── Pack API ────────────────────────────────────────────────────────────

impl Pack {
    /// Construct an empty `Pack`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of distinct named elements in this pack.
    pub fn len(&self) -> usize {
        self.elements.len()
    }

    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    /// Ordered slice view of all elements. Useful for callers that need
    /// to inspect the pack beyond the typed `get_*` helpers.
    pub fn elements(&self) -> &[Element] {
        &self.elements
    }

    // --- writers ---------------------------------------------------------

    /// Append an `Int` value to element `name` (creating it if absent).
    ///
    /// Deviation from the SE-1 brief: the brief signature returns `()`,
    /// but the "name too long → error" test requires a fallible return.
    /// Returning `Result<(), PackError>` was the only way to satisfy
    /// both the signature contract and the test contract. The other
    /// `add_*` methods follow the same pattern.
    pub fn add_int(&mut self, name: &str, value: u32) -> Result<(), PackError> {
        self.push_value(name, Value::Int(value))
    }

    pub fn add_int64(&mut self, name: &str, value: u64) -> Result<(), PackError> {
        self.push_value(name, Value::Int64(value))
    }

    pub fn add_data(
        &mut self,
        name: &str,
        value: impl Into<Vec<u8>>,
    ) -> Result<(), PackError> {
        self.push_value(name, Value::Data(value.into()))
    }

    pub fn add_str(&mut self, name: &str, value: impl Into<String>) -> Result<(), PackError> {
        self.push_value(name, Value::Str(value.into()))
    }

    pub fn add_unistr(
        &mut self,
        name: &str,
        value: impl Into<String>,
    ) -> Result<(), PackError> {
        self.push_value(name, Value::UniStr(value.into()))
    }

    fn push_value(&mut self, name: &str, value: Value) -> Result<(), PackError> {
        validate_name(name)?;
        if let Some(idx) = self.find_index(name) {
            let existing_tag = self.elements[idx]
                .values
                .first()
                .map(type_name_of)
                .unwrap_or("empty");
            let new_tag = type_name_of(&value);
            // Empty elements can happen only via from_bytes decoding a
            // zero-length element array, which we still allow-typing via
            // the stored values slot. Real servers never send num_value=0
            // but we don't error on it.
            if !self.elements[idx].values.is_empty()
                && self.elements[idx].values[0].type_tag() != value.type_tag()
            {
                return Err(PackError::TypeMismatch {
                    name: name.to_string(),
                    existing: existing_tag,
                    attempted: new_tag,
                });
            }
            if self.elements[idx].values.len() + 1 > MAX_VALUE_NUM {
                return Err(PackError::TooLarge);
            }
            self.elements[idx].values.push(value);
        } else {
            if self.elements.len() + 1 > MAX_ELEMENT_NUM {
                return Err(PackError::TooLarge);
            }
            self.elements.push(Element {
                name: name.to_string(),
                values: vec![value],
            });
        }
        Ok(())
    }

    // --- readers ---------------------------------------------------------

    /// First `Int` value for the named element (or `None` if missing /
    /// wrong type).
    pub fn get_int(&self, name: &str) -> Option<u32> {
        match self.first_value(name)? {
            Value::Int(v) => Some(*v),
            _ => None,
        }
    }

    pub fn get_int64(&self, name: &str) -> Option<u64> {
        match self.first_value(name)? {
            Value::Int64(v) => Some(*v),
            _ => None,
        }
    }

    pub fn get_data(&self, name: &str) -> Option<&[u8]> {
        match self.first_value(name)? {
            Value::Data(v) => Some(v.as_slice()),
            _ => None,
        }
    }

    pub fn get_str(&self, name: &str) -> Option<&str> {
        match self.first_value(name)? {
            Value::Str(v) => Some(v.as_str()),
            _ => None,
        }
    }

    pub fn get_unistr(&self, name: &str) -> Option<&str> {
        match self.first_value(name)? {
            Value::UniStr(v) => Some(v.as_str()),
            _ => None,
        }
    }

    /// All values for the named element. Returns an empty slice if absent.
    pub fn get_values(&self, name: &str) -> &[Value] {
        self.find_index(name)
            .map(|i| self.elements[i].values.as_slice())
            .unwrap_or(&[])
    }

    fn find_index(&self, name: &str) -> Option<usize> {
        self.elements.iter().position(|e| e.name == name)
    }

    fn first_value(&self, name: &str) -> Option<&Value> {
        self.find_index(name).and_then(|i| self.elements[i].values.first())
    }

    // --- codec -----------------------------------------------------------

    /// Serialize to a `Vec<u8>` per `WritePack` in Pack.c.
    pub fn to_bytes(&self) -> Result<Vec<u8>, PackError> {
        let mut out = Vec::with_capacity(self.estimate_size());
        write_u32(&mut out, self.elements.len() as u32);
        for el in &self.elements {
            write_element(&mut out, el)?;
        }
        Ok(out)
    }

    /// Deserialize from bytes per `ReadPack` in Pack.c.
    pub fn from_bytes(data: &[u8]) -> Result<Self, PackError> {
        let mut cur = Cursor::new(data);
        let num = cur.read_u32()?;
        if num as usize > MAX_ELEMENT_NUM {
            return Err(PackError::TooLarge);
        }
        let mut elements = Vec::with_capacity(num as usize);
        let mut seen: HashMap<String, ()> = HashMap::new();
        for _ in 0..num {
            let el = read_element(&mut cur)?;
            // Preserve ordering; duplicates are theoretically possible on
            // the wire but the C reference does not de-duplicate either.
            seen.insert(el.name.clone(), ());
            elements.push(el);
        }
        Ok(Pack { elements })
    }

    fn estimate_size(&self) -> usize {
        // Rough heuristic; sizing is a perf hint only.
        4 + self
            .elements
            .iter()
            .map(|e| {
                4 + e.name.len()
                    + 4
                    + 4
                    + e.values
                        .iter()
                        .map(|v| match v {
                            Value::Int(_) => 4,
                            Value::Int64(_) => 8,
                            Value::Data(b) => 4 + b.len(),
                            Value::Str(s) => 4 + s.len(),
                            Value::UniStr(s) => 4 + s.len() + 1,
                        })
                        .sum::<usize>()
            })
            .sum::<usize>()
    }
}

fn type_name_of(v: &Value) -> &'static str {
    match v {
        Value::Int(_) => "Int",
        Value::Data(_) => "Data",
        Value::Str(_) => "Str",
        Value::UniStr(_) => "UniStr",
        Value::Int64(_) => "Int64",
    }
}

fn validate_name(name: &str) -> Result<(), PackError> {
    let n = name.len();
    if n == 0 {
        return Err(PackError::EmptyName);
    }
    if n > MAX_ELEMENT_NAME_LEN {
        return Err(PackError::NameTooLong(n));
    }
    Ok(())
}

// ─── Low-level serialization helpers ─────────────────────────────────────

fn write_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_be_bytes());
}

fn write_u64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_be_bytes());
}

fn write_lenprefixed(out: &mut Vec<u8>, len: u32, body: &[u8]) {
    write_u32(out, len);
    out.extend_from_slice(body);
}

/// `WriteBufStr` — length is `body_len + 1` (virtual NUL), body has no NUL.
fn write_bufstr(out: &mut Vec<u8>, s: &str) -> Result<(), PackError> {
    let bytes = s.as_bytes();
    if bytes.len() > MAX_VALUE_SIZE {
        return Err(PackError::TooLarge);
    }
    // Wrap-around safety: bytes.len() ≤ MAX_VALUE_SIZE ≪ u32::MAX - 1.
    write_u32(out, (bytes.len() as u32) + 1);
    out.extend_from_slice(bytes);
    Ok(())
}

fn write_element(out: &mut Vec<u8>, e: &Element) -> Result<(), PackError> {
    validate_name(&e.name)?;
    write_bufstr(out, &e.name)?;
    // Type tag. An empty element defaults to VALUE_INT on the wire to
    // match C's behaviour (the type is recorded on the element, not the
    // value, so we must pick one even if num_values is 0). In practice
    // `push_value` guarantees at least one value before serialization.
    let tag = e.values.first().map(Value::type_tag).unwrap_or(VALUE_INT);
    write_u32(out, tag);
    if e.values.len() > MAX_VALUE_NUM {
        return Err(PackError::TooLarge);
    }
    write_u32(out, e.values.len() as u32);
    for v in &e.values {
        write_value(out, v)?;
    }
    Ok(())
}

fn write_value(out: &mut Vec<u8>, v: &Value) -> Result<(), PackError> {
    match v {
        Value::Int(n) => write_u32(out, *n),
        Value::Int64(n) => write_u64(out, *n),
        Value::Data(b) => {
            if b.len() > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            write_lenprefixed(out, b.len() as u32, b);
        }
        Value::Str(s) => {
            let bytes = s.as_bytes();
            if bytes.len() > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            // STR on the wire: length = body_len exactly (no virtual NUL,
            // body has no NUL). This is the opposite of element-name
            // encoding (which uses WriteBufStr semantics).
            write_lenprefixed(out, bytes.len() as u32, bytes);
        }
        Value::UniStr(s) => {
            let bytes = s.as_bytes();
            if bytes.len().saturating_add(1) > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            // UNISTR: length = utf8_len + 1, body = utf8_bytes + 0x00.
            write_u32(out, (bytes.len() as u32) + 1);
            out.extend_from_slice(bytes);
            out.push(0);
        }
    }
    Ok(())
}

// ─── Low-level deserialization helpers ───────────────────────────────────

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], PackError> {
        let end = self.pos.checked_add(n).ok_or(PackError::TooLarge)?;
        if end > self.data.len() {
            return Err(PackError::Truncated);
        }
        let out = &self.data[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn read_u32(&mut self) -> Result<u32, PackError> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_u64(&mut self) -> Result<u64, PackError> {
        let b = self.read_bytes(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
}

/// Mirror of `ReadBufStr` — reads a length that INCLUDES a virtual NUL
/// byte, subtracts 1, then reads `len - 1` bytes of body (no NUL).
fn read_bufstr(cur: &mut Cursor<'_>) -> Result<String, PackError> {
    let encoded_len = cur.read_u32()?;
    if encoded_len == 0 {
        // ReadBufStr returns false here; propagate as Truncated so the
        // error surface stays minimal. (The brief lists `Truncated` but
        // not a dedicated "zero-length name" variant; treat as framing.)
        return Err(PackError::Truncated);
    }
    let body_len = (encoded_len - 1) as usize;
    if body_len > MAX_ELEMENT_NAME_LEN {
        return Err(PackError::NameTooLong(body_len));
    }
    let bytes = cur.read_bytes(body_len)?;
    std::str::from_utf8(bytes)
        .map(|s| s.to_string())
        .map_err(|_| PackError::InvalidUtf8)
}

fn read_element(cur: &mut Cursor<'_>) -> Result<Element, PackError> {
    let name = read_bufstr(cur)?;
    let type_tag = cur.read_u32()?;
    let num_values = cur.read_u32()?;
    if num_values as usize > MAX_VALUE_NUM {
        return Err(PackError::TooLarge);
    }
    let mut values = Vec::with_capacity(num_values as usize);
    for _ in 0..num_values {
        values.push(read_value(cur, type_tag)?);
    }
    Ok(Element { name, values })
}

fn read_value(cur: &mut Cursor<'_>, type_tag: u32) -> Result<Value, PackError> {
    match type_tag {
        VALUE_INT => Ok(Value::Int(cur.read_u32()?)),
        VALUE_INT64 => Ok(Value::Int64(cur.read_u64()?)),
        VALUE_DATA => {
            let len = cur.read_u32()? as usize;
            if len > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            Ok(Value::Data(cur.read_bytes(len)?.to_vec()))
        }
        VALUE_STR => {
            let len = cur.read_u32()? as usize;
            if len > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            let bytes = cur.read_bytes(len)?;
            Ok(Value::Str(
                std::str::from_utf8(bytes)
                    .map_err(|_| PackError::InvalidUtf8)?
                    .to_string(),
            ))
        }
        VALUE_UNISTR => {
            let encoded_len = cur.read_u32()? as usize;
            if encoded_len > MAX_VALUE_SIZE {
                return Err(PackError::TooLarge);
            }
            // UNISTR wire length INCLUDES the trailing NUL (see Pack.c
            // `WriteValue`: u_size = CalcUniToUtf8(...) + 1). An
            // encoded_len of 0 means no body at all — treat as truncated
            // since the real encoder always writes at least the NUL.
            if encoded_len == 0 {
                return Err(PackError::Truncated);
            }
            let raw = cur.read_bytes(encoded_len)?;
            // Strip exactly one trailing NUL if present (C always writes
            // one). If the last byte isn't NUL we accept the bytes as-is
            // for permissiveness against servers that might drop it.
            let body = if raw.last() == Some(&0) {
                &raw[..raw.len() - 1]
            } else {
                raw
            };
            Ok(Value::UniStr(
                std::str::from_utf8(body)
                    .map_err(|_| PackError::InvalidUtf8)?
                    .to_string(),
            ))
        }
        other => Err(PackError::UnknownValueType(other)),
    }
}

// ═════════════════════════════════════════════════════════════════════════
//                               TESTS
// ═════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // 1. Round-trip of a single Int value
    #[test]
    fn roundtrip_int() {
        let mut p = Pack::new();
        p.add_int("foo", 42).unwrap();
        let bytes = p.to_bytes().unwrap();
        let decoded = Pack::from_bytes(&bytes).unwrap();
        assert_eq!(decoded.get_int("foo"), Some(42));
    }

    // 2. Round-trip covering every value type in a single pack
    #[test]
    fn roundtrip_all_types() {
        let mut p = Pack::new();
        p.add_int("i", 0xDEAD_BEEF).unwrap();
        p.add_int64("i64", 0x0123_4567_89AB_CDEF).unwrap();
        p.add_data("d", vec![0xDE, 0xAD, 0xBE, 0xEF]).unwrap();
        p.add_str("s", "hello").unwrap();
        p.add_unistr("u", "héllo").unwrap();

        let bytes = p.to_bytes().unwrap();
        let decoded = Pack::from_bytes(&bytes).unwrap();

        assert_eq!(decoded.get_int("i"), Some(0xDEAD_BEEF));
        assert_eq!(decoded.get_int64("i64"), Some(0x0123_4567_89AB_CDEF));
        assert_eq!(decoded.get_data("d"), Some(&[0xDE, 0xAD, 0xBE, 0xEF][..]));
        assert_eq!(decoded.get_str("s"), Some("hello"));
        assert_eq!(decoded.get_unistr("u"), Some("héllo"));
    }

    // 3. Multi-value (array) element — repeated add_* appends
    #[test]
    fn multi_value_array_element() {
        let mut p = Pack::new();
        p.add_int("arr", 1).unwrap();
        p.add_int("arr", 2).unwrap();
        p.add_int("arr", 3).unwrap();
        assert_eq!(p.elements().len(), 1);
        assert_eq!(p.get_values("arr").len(), 3);

        let bytes = p.to_bytes().unwrap();
        let decoded = Pack::from_bytes(&bytes).unwrap();
        let vals = decoded.get_values("arr");
        assert_eq!(vals.len(), 3);
        assert_eq!(vals[0], Value::Int(1));
        assert_eq!(vals[1], Value::Int(2));
        assert_eq!(vals[2], Value::Int(3));
        // get_int returns the first
        assert_eq!(decoded.get_int("arr"), Some(1));
    }

    // 4. Name too long (129 bytes) → NameTooLong error on write
    #[test]
    fn name_too_long_errors() {
        let long = "a".repeat(MAX_ELEMENT_NAME_LEN + 1); // 129 bytes
        let mut p = Pack::new();
        let err = p.add_int(&long, 0).unwrap_err();
        assert!(matches!(err, PackError::NameTooLong(129)));
    }

    // Exactly MAX is accepted
    #[test]
    fn name_exactly_max_is_ok() {
        let name = "a".repeat(MAX_ELEMENT_NAME_LEN);
        let mut p = Pack::new();
        p.add_int(&name, 1).unwrap();
        let round = Pack::from_bytes(&p.to_bytes().unwrap()).unwrap();
        assert_eq!(round.get_int(&name), Some(1));
    }

    // Empty name is rejected
    #[test]
    fn empty_name_errors() {
        let mut p = Pack::new();
        assert!(matches!(p.add_int("", 1).unwrap_err(), PackError::EmptyName));
    }

    // 5. UTF-8 round-trip for non-ASCII strings in both Str and UniStr
    #[test]
    fn utf8_roundtrip_non_ascii() {
        let mut p = Pack::new();
        p.add_str("greeting", "日本語 — café ☕").unwrap();
        p.add_unistr("uni", "Ωμέγα — naïve façade — 한글").unwrap();
        let decoded = Pack::from_bytes(&p.to_bytes().unwrap()).unwrap();
        assert_eq!(decoded.get_str("greeting"), Some("日本語 — café ☕"));
        assert_eq!(decoded.get_unistr("uni"), Some("Ωμέγα — naïve façade — 한글"));
    }

    // 6. Truncated input → Truncated error
    #[test]
    fn truncated_input_errors() {
        let mut p = Pack::new();
        p.add_int("foo", 42).unwrap();
        let bytes = p.to_bytes().unwrap();
        // Cut last 3 bytes — should land inside the value body
        for n in 1..=bytes.len() - 1 {
            let err = Pack::from_bytes(&bytes[..n]).unwrap_err();
            assert!(
                matches!(err, PackError::Truncated | PackError::TooLarge),
                "cut len={n} should be Truncated or TooLarge, got {err:?}"
            );
        }
    }

    #[test]
    fn empty_buffer_is_truncated() {
        assert!(matches!(
            Pack::from_bytes(&[]).unwrap_err(),
            PackError::Truncated
        ));
    }

    // 7. Known-good fixture stability.
    //
    // No public PCAP of real SoftEther PACKs is bundled in this repo, and
    // harvesting one dynamically is out of scope for a unit test. Per the
    // SE-1 brief's fallback ("otherwise generate a reference fixture with
    // our own encoder and assert stability"), we capture a hand-assembled
    // hex blob here. Regenerating requires deliberate intent — any
    // accidental wire-format regression in write_value/write_element /
    // write_bufstr will flip this test red.
    #[test]
    fn reference_fixture_is_byte_stable() {
        // Pack: { "ok": Int(1) }
        // Wire bytes:
        //   00 00 00 01                         num_elements = 1
        //     00 00 00 03                         name_len+1 = 3
        //     6F 6B                                "ok"
        //     00 00 00 00                         value_type = VALUE_INT
        //     00 00 00 01                         num_values = 1
        //       00 00 00 01                         Int(1)
        const REFERENCE_OK: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x6F, 0x6B, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        ];
        let mut p = Pack::new();
        p.add_int("ok", 1).unwrap();
        assert_eq!(p.to_bytes().unwrap(), REFERENCE_OK);

        // Round-trip the fixture through the decoder too
        let decoded = Pack::from_bytes(REFERENCE_OK).unwrap();
        assert_eq!(decoded.get_int("ok"), Some(1));

        // A Str fixture with a non-ASCII byte to verify no NUL creeps
        // into the STR body.
        //
        // Pack: { "m": Str("hi") }
        //   00 00 00 01
        //     00 00 00 02  name_len+1 = 2
        //     6D           "m"
        //     00 00 00 02  VALUE_STR
        //     00 00 00 01  num_values
        //       00 00 00 02  len = 2 (no +1 — STR has no wire NUL)
        //       68 69         "hi"
        const REFERENCE_STR: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x6D, 0x00, 0x00, 0x00, 0x02, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x68, 0x69,
        ];
        let mut q = Pack::new();
        q.add_str("m", "hi").unwrap();
        assert_eq!(q.to_bytes().unwrap(), REFERENCE_STR);
    }

    // UNISTR writes a trailing NUL byte in the body — pin this down.
    #[test]
    fn unistr_trailing_nul_on_wire() {
        let mut p = Pack::new();
        p.add_unistr("u", "hi").unwrap();
        let bytes = p.to_bytes().unwrap();
        // Expected layout:
        //   00 00 00 01
        //     00 00 00 02  name_len+1
        //     75           "u"
        //     00 00 00 03  VALUE_UNISTR
        //     00 00 00 01  num_values
        //       00 00 00 03  utf8_len+1 = 3
        //       68 69 00      "hi\0"
        let expected: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x75, 0x00, 0x00, 0x00, 0x03, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x68, 0x69, 0x00,
        ];
        assert_eq!(bytes, expected);
    }

    // STR has NO trailing NUL — pin this down too (mirror of above).
    #[test]
    fn str_no_trailing_nul_on_wire() {
        let mut p = Pack::new();
        p.add_str("s", "hi").unwrap();
        let bytes = p.to_bytes().unwrap();
        let expected: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x73, 0x00, 0x00, 0x00, 0x02, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x68, 0x69,
        ];
        assert_eq!(bytes, expected);
    }

    // Unknown value type on the wire surfaces as UnknownValueType(...)
    #[test]
    fn unknown_value_type_errors() {
        // num_elements=1, name "x", type=99, num_values=1, body (skipped)
        let bytes: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x78, 0x00, 0x00, 0x00, 0x63, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        ];
        let err = Pack::from_bytes(bytes).unwrap_err();
        assert!(matches!(err, PackError::UnknownValueType(99)));
    }

    // Invalid UTF-8 inside a STR value surfaces as InvalidUtf8
    #[test]
    fn invalid_utf8_in_str() {
        // Build: num_elements=1, name="s", type=STR, num_values=1,
        // str len=1, body=0xFF (invalid UTF-8 start byte)
        let bytes: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x73, 0x00, 0x00, 0x00, 0x02, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xFF,
        ];
        assert!(matches!(
            Pack::from_bytes(bytes).unwrap_err(),
            PackError::InvalidUtf8
        ));
    }

    // Type mismatch on add_* returns TypeMismatch (same name, different type)
    #[test]
    fn type_mismatch_on_add() {
        let mut p = Pack::new();
        p.add_int("foo", 1).unwrap();
        let err = p.add_str("foo", "bar").unwrap_err();
        match err {
            PackError::TypeMismatch {
                name,
                existing,
                attempted,
            } => {
                assert_eq!(name, "foo");
                assert_eq!(existing, "Int");
                assert_eq!(attempted, "Str");
            }
            other => panic!("expected TypeMismatch, got {other:?}"),
        }
    }

    // Oversize data value → TooLarge (without allocating 128 MiB — we
    // construct a wire frame claiming a huge length and hit the guard).
    #[test]
    fn oversize_length_prefix_errors() {
        // num_elements=1, name="d", type=DATA, num_values=1, len=u32::MAX
        let bytes: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x64, 0x00, 0x00, 0x00, 0x01, 0x00,
            0x00, 0x00, 0x01, 0xFF, 0xFF, 0xFF, 0xFF,
        ];
        assert!(matches!(
            Pack::from_bytes(bytes).unwrap_err(),
            PackError::TooLarge
        ));
    }

    // MAX_ELEMENT_NUM guard on decode
    #[test]
    fn oversize_num_elements_errors() {
        // num_elements=u32::MAX
        let bytes: &[u8] = &[0xFF, 0xFF, 0xFF, 0xFF];
        assert!(matches!(
            Pack::from_bytes(bytes).unwrap_err(),
            PackError::TooLarge
        ));
    }

    // Empty pack round-trips cleanly
    #[test]
    fn empty_pack_roundtrip() {
        let p = Pack::new();
        let bytes = p.to_bytes().unwrap();
        assert_eq!(bytes, &[0, 0, 0, 0]);
        let decoded = Pack::from_bytes(&bytes).unwrap();
        assert!(decoded.is_empty());
    }

    // Element order is preserved on write and on decode
    #[test]
    fn element_order_preserved() {
        let mut p = Pack::new();
        p.add_int("zebra", 1).unwrap();
        p.add_int("apple", 2).unwrap();
        p.add_int("mango", 3).unwrap();
        let names: Vec<&str> = p.elements().iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zebra", "apple", "mango"]);

        let bytes = p.to_bytes().unwrap();
        let decoded = Pack::from_bytes(&bytes).unwrap();
        let names: Vec<&str> = decoded.elements().iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zebra", "apple", "mango"]);
    }

    // Data value with zero-length body is valid (len=0 is a legal encoding)
    #[test]
    fn zero_length_data_value() {
        let mut p = Pack::new();
        p.add_data("empty", Vec::<u8>::new()).unwrap();
        let bytes = p.to_bytes().unwrap();
        let decoded = Pack::from_bytes(&bytes).unwrap();
        assert_eq!(decoded.get_data("empty"), Some(&[][..]));
    }

    // Getter type-mismatch returns None rather than panicking
    #[test]
    fn getter_wrong_type_returns_none() {
        let mut p = Pack::new();
        p.add_int("i", 7).unwrap();
        assert_eq!(p.get_str("i"), None);
        assert_eq!(p.get_unistr("i"), None);
        assert_eq!(p.get_data("i"), None);
        assert_eq!(p.get_int64("i"), None);
        assert_eq!(p.get_int("missing"), None);
    }

    // Int64 boundary values round-trip without sign-extension issues
    #[test]
    fn int64_boundaries() {
        let cases = [0u64, 1, u64::MAX, u64::MAX - 1, 1 << 63, (1 << 32) - 1];
        for v in cases {
            let mut p = Pack::new();
            p.add_int64("n", v).unwrap();
            let decoded = Pack::from_bytes(&p.to_bytes().unwrap()).unwrap();
            assert_eq!(decoded.get_int64("n"), Some(v), "roundtrip failed for {v}");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // t4-e12: Property-based / fuzz boundary tests.
    //
    // User override for this executor: the 128 MiB MAX_VALUE_SIZE cap is
    // kept as-is. These tests assert (a) round-trip identity and (b) that
    // malformed frames return Err cleanly — no panics, no unbounded
    // allocation.
    //
    // Notes on allocation safety under fuzz:
    //   * `from_bytes` uses `Vec::with_capacity(num as usize)` for the
    //     element vector after gating on MAX_ELEMENT_NUM (131_072). Same
    //     story for per-element `values`, gated on MAX_VALUE_NUM (65_536).
    //   * Per-value byte bodies use `read_bytes(n)?` which does NOT
    //     pre-allocate; it slices the input buffer and only allocates if
    //     the slice fits. Therefore a "size: u32::MAX" length prefix on a
    //     10-byte buffer cannot cause a huge allocation — it's caught by
    //     the TooLarge guard or Truncated guard before `to_vec()` runs.
    //   * These invariants are what the fuzz tests below pin down.
    // ════════════════════════════════════════════════════════════════════

    use proptest::prelude::*;

    fn arb_value() -> impl Strategy<Value = Value> {
        prop_oneof![
            any::<u32>().prop_map(Value::Int),
            any::<u64>().prop_map(Value::Int64),
            prop::collection::vec(any::<u8>(), 0..=128).prop_map(Value::Data),
            "[a-zA-Z0-9 _\\-]{0,64}".prop_map(Value::Str),
            "[a-zA-Z0-9 _\\-]{0,64}".prop_map(Value::UniStr),
        ]
    }

    fn arb_name() -> impl Strategy<Value = String> {
        "[a-zA-Z_][a-zA-Z0-9_]{0,63}".prop_map(|s| s.to_string())
    }

    // Build a Pack directly from (name, Vec<Value>) pairs, respecting the
    // type-homogeneous-per-element invariant that push_value enforces. We
    // only pick the first value's variant, then filter the rest to that
    // variant, so we can drive the encoder deterministically.
    fn pack_from_pairs(pairs: Vec<(String, Vec<Value>)>) -> Pack {
        let mut p = Pack::new();
        let mut seen_names: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for (name, vals) in pairs {
            if name.is_empty() || name.len() > MAX_ELEMENT_NAME_LEN {
                continue;
            }
            if !seen_names.insert(name.clone()) {
                continue;
            }
            if vals.is_empty() {
                continue;
            }
            let first_tag = vals[0].type_tag();
            for v in vals.into_iter().filter(|v| v.type_tag() == first_tag) {
                match &v {
                    Value::Int(n) => p.add_int(&name, *n).unwrap(),
                    Value::Int64(n) => p.add_int64(&name, *n).unwrap(),
                    Value::Data(b) => p.add_data(&name, b.clone()).unwrap(),
                    Value::Str(s) => p.add_str(&name, s.clone()).unwrap(),
                    Value::UniStr(s) => p.add_unistr(&name, s.clone()).unwrap(),
                }
            }
        }
        p
    }

    proptest! {
        // t4-e12 fuzz #1 — Round-trip identity on arbitrary Packs:
        //   decode(encode(pack)) == pack,   AND
        //   encode(decode(encode(pack))) == encode(pack)  (byte-exact).
        #[test]
        fn prop_roundtrip_identity(
            pairs in prop::collection::vec(
                (arb_name(), prop::collection::vec(arb_value(), 1..=4)),
                0..=8,
            )
        ) {
            let pack = pack_from_pairs(pairs);
            let bytes = pack.to_bytes().expect("encode");
            let decoded = Pack::from_bytes(&bytes).expect("decode");
            prop_assert_eq!(&pack, &decoded);
            let reencoded = decoded.to_bytes().expect("re-encode");
            prop_assert_eq!(bytes, reencoded);
        }

        // t4-e12 fuzz #2 — No panics on arbitrary input.
        //
        // Feed uniformly random bytes of varying lengths; the decoder must
        // always return a Result (never panic, never loop forever, never
        // allocate huge buffers). A 1 KiB fuzz input cannot possibly
        // contain a validly framed 128 MiB body, so Truncated/TooLarge/
        // UnknownValueType/InvalidUtf8/NameTooLong/InvalidMagic/EmptyName
        // are the only acceptable outcomes.
        #[test]
        fn prop_no_panic_on_random_bytes(bytes in prop::collection::vec(any::<u8>(), 0..=1024)) {
            let _ = Pack::from_bytes(&bytes);
        }

        // t4-e12 fuzz #3 — Truncation at every prefix length yields
        // either a successful decode (rare, at well-formed cut points) or
        // a clean Err. Never a panic.
        #[test]
        fn prop_truncation_is_clean(
            pairs in prop::collection::vec(
                (arb_name(), prop::collection::vec(arb_value(), 1..=3)),
                1..=4,
            ),
            cut in any::<u16>(),
        ) {
            let pack = pack_from_pairs(pairs);
            let bytes = pack.to_bytes().expect("encode");
            if bytes.is_empty() { return Ok(()); }
            let n = (cut as usize) % bytes.len();
            // Any prefix shorter than the full length must not panic.
            let _ = Pack::from_bytes(&bytes[..n]);
        }

        // t4-e12 fuzz #4 — A wire frame advertising a DATA length > 128 MiB
        // cap must produce TooLarge, not a giant allocation.
        #[test]
        fn prop_oversize_length_prefix_rejected(bogus_len in (MAX_VALUE_SIZE as u32 + 1)..=u32::MAX) {
            // num_elements=1, name "d", type=DATA, num_values=1, len=<bogus>
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());       // num_elements
            wire.extend_from_slice(&2u32.to_be_bytes());       // name_len+1
            wire.push(b'd');                                    // name
            wire.extend_from_slice(&VALUE_DATA.to_be_bytes());  // type
            wire.extend_from_slice(&1u32.to_be_bytes());       // num_values
            wire.extend_from_slice(&bogus_len.to_be_bytes());  // oversized body len
            // No body bytes — we must fail BEFORE any allocation.
            let err = Pack::from_bytes(&wire).unwrap_err();
            prop_assert!(matches!(err, PackError::TooLarge));
        }

        // t4-e12 fuzz #5 — A wire frame advertising a huge num_elements
        // (above MAX_ELEMENT_NUM) must produce TooLarge without allocating
        // the implied Vec::with_capacity.
        #[test]
        fn prop_oversize_element_count_rejected(n in (MAX_ELEMENT_NUM as u32 + 1)..=u32::MAX) {
            let bytes = n.to_be_bytes();
            prop_assert!(matches!(
                Pack::from_bytes(&bytes).unwrap_err(),
                PackError::TooLarge
            ));
        }

        // t4-e12 fuzz #6 — A wire frame advertising a huge num_values
        // (above MAX_VALUE_NUM) must produce TooLarge without allocating
        // the implied Vec::with_capacity.
        #[test]
        fn prop_oversize_value_count_rejected(n in (MAX_VALUE_NUM as u32 + 1)..=u32::MAX) {
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());       // num_elements
            wire.extend_from_slice(&2u32.to_be_bytes());       // name_len+1
            wire.push(b'x');                                    // name
            wire.extend_from_slice(&VALUE_INT.to_be_bytes());   // type
            wire.extend_from_slice(&n.to_be_bytes());           // num_values (huge)
            prop_assert!(matches!(
                Pack::from_bytes(&wire).unwrap_err(),
                PackError::TooLarge
            ));
        }

        // t4-e12 fuzz #7 — Unknown value-type tags are always rejected
        // cleanly (no panic). The set of known tags is {0..=4}.
        #[test]
        fn prop_unknown_value_type_rejected(t in 5u32..=u32::MAX) {
            // num_values=1 so the unknown tag actually flows into
            // read_value (num_values=0 skips the type-dispatch path).
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());       // num_elements
            wire.extend_from_slice(&2u32.to_be_bytes());       // name_len+1
            wire.push(b'x');                                    // name
            wire.extend_from_slice(&t.to_be_bytes());           // bogus type
            wire.extend_from_slice(&1u32.to_be_bytes());       // num_values=1
            wire.extend_from_slice(&0u32.to_be_bytes());       // dummy body
            prop_assert!(matches!(
                Pack::from_bytes(&wire).unwrap_err(),
                PackError::UnknownValueType(tt) if tt == t
            ));
        }

        // t4-e12 fuzz #8 — Invalid UTF-8 in a STR or UNISTR body surfaces
        // as InvalidUtf8 regardless of where in the body the bad byte
        // lands.
        #[test]
        fn prop_invalid_utf8_in_str_rejected(
            pad_len in 0usize..=32,
            pos in 0usize..=32,
        ) {
            let mut body = vec![b'a'; pad_len];
            let p = if pad_len == 0 { 0 } else { pos % pad_len.max(1) };
            if !body.is_empty() {
                body[p] = 0xFF;
            } else {
                body.push(0xFF);
            }
            let body_len = body.len() as u32;
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());
            wire.extend_from_slice(&2u32.to_be_bytes());
            wire.push(b's');
            wire.extend_from_slice(&VALUE_STR.to_be_bytes());
            wire.extend_from_slice(&1u32.to_be_bytes());
            wire.extend_from_slice(&body_len.to_be_bytes());
            wire.extend_from_slice(&body);
            prop_assert!(matches!(
                Pack::from_bytes(&wire).unwrap_err(),
                PackError::InvalidUtf8
            ));
        }

        // t4-e12 fuzz #9 — Bit-flip mutation of a valid encoding never
        // panics. Either the flipped frame decodes (to some Pack) or it
        // returns an Err — nothing in between.
        #[test]
        fn prop_bitflip_never_panics(
            pairs in prop::collection::vec(
                (arb_name(), prop::collection::vec(arb_value(), 1..=2)),
                1..=3,
            ),
            flip_at in any::<u16>(),
            flip_mask in any::<u8>(),
        ) {
            let pack = pack_from_pairs(pairs);
            let mut bytes = pack.to_bytes().expect("encode");
            if bytes.is_empty() { return Ok(()); }
            let idx = (flip_at as usize) % bytes.len();
            bytes[idx] ^= flip_mask;
            let _ = Pack::from_bytes(&bytes);
        }

        // t4-e12 fuzz #10 — "Deeply repeated" frames: a flat Pack with
        // many duplicate-named elements must still decode without error
        // (the C reference does not de-duplicate either). This also
        // exercises the seen-names bookkeeping in from_bytes.
        #[test]
        fn prop_duplicate_element_names_decode(
            name in arb_name(),
            n in 1usize..=64,
        ) {
            // Hand-build a wire frame with `n` copies of the same element
            // (the public API de-duplicates via push_value, so we go
            // straight to the wire).
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&(n as u32).to_be_bytes());
            for i in 0..n {
                wire.extend_from_slice(&((name.len() as u32) + 1).to_be_bytes());
                wire.extend_from_slice(name.as_bytes());
                wire.extend_from_slice(&VALUE_INT.to_be_bytes());
                wire.extend_from_slice(&1u32.to_be_bytes());
                wire.extend_from_slice(&(i as u32).to_be_bytes());
            }
            let decoded = Pack::from_bytes(&wire).expect("duplicates decode");
            prop_assert_eq!(decoded.elements().len(), n);
            // First match wins in get_int.
            prop_assert_eq!(decoded.get_int(&name), Some(0));
        }

        // t4-e12 fuzz #11 — "Deeply nested / oversized element count"
        // boundary: num_elements at the exact MAX is accepted by the
        // capacity check (though the body will truncate). num_elements at
        // MAX+1 is always TooLarge. Pins the boundary.
        #[test]
        fn prop_element_count_boundary(delta in 0u32..=64) {
            // At exactly the cap: passes the gate; body is too short so
            // we then get Truncated.
            let at_cap = (MAX_ELEMENT_NUM as u32).to_be_bytes();
            let err = Pack::from_bytes(&at_cap).unwrap_err();
            prop_assert!(matches!(err, PackError::Truncated));

            // Above the cap: always TooLarge.
            let above = ((MAX_ELEMENT_NUM as u32) + 1 + delta).to_be_bytes();
            prop_assert!(matches!(
                Pack::from_bytes(&above).unwrap_err(),
                PackError::TooLarge
            ));
        }

        // t4-e12 fuzz #12 — Zero-length name prefix (which would imply
        // encoded_len = 0 on the wire) is always Truncated, never a
        // panic — regardless of what follows in the buffer.
        #[test]
        fn prop_zero_length_name_rejected(trailer in prop::collection::vec(any::<u8>(), 0..=64)) {
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());  // num_elements=1
            wire.extend_from_slice(&0u32.to_be_bytes());  // name encoded_len=0
            wire.extend_from_slice(&trailer);
            prop_assert!(matches!(
                Pack::from_bytes(&wire).unwrap_err(),
                PackError::Truncated
            ));
        }

        // t4-e12 fuzz #13 — Name length prefix above MAX_ELEMENT_NAME_LEN
        // is rejected as NameTooLong, without reading the oversized body.
        #[test]
        fn prop_oversized_name_rejected(n in (MAX_ELEMENT_NAME_LEN as u32 + 2)..=u32::MAX / 2) {
            let mut wire = Vec::<u8>::new();
            wire.extend_from_slice(&1u32.to_be_bytes());
            wire.extend_from_slice(&n.to_be_bytes()); // encoded_len (body would be n-1)
            // Deliberately no body bytes — we must fail before reading.
            let err = Pack::from_bytes(&wire).unwrap_err();
            prop_assert!(matches!(err, PackError::NameTooLong(_)));
        }
    }

    // t4-e12 non-prop test: UNISTR with encoded_len=0 is Truncated (pinned
    // once, so we don't re-exercise in a proptest body).
    #[test]
    fn unistr_zero_encoded_len_rejected() {
        let mut wire = Vec::<u8>::new();
        wire.extend_from_slice(&1u32.to_be_bytes());
        wire.extend_from_slice(&2u32.to_be_bytes());
        wire.push(b'u');
        wire.extend_from_slice(&VALUE_UNISTR.to_be_bytes());
        wire.extend_from_slice(&1u32.to_be_bytes());
        wire.extend_from_slice(&0u32.to_be_bytes()); // encoded_len=0 => Truncated
        assert!(matches!(
            Pack::from_bytes(&wire).unwrap_err(),
            PackError::Truncated
        ));
    }

    // t4-e12 non-prop test: Oversize UNISTR body is TooLarge. Mirrors the
    // DATA-path test above but on the UNISTR branch (different guard).
    #[test]
    fn unistr_oversize_rejected() {
        let mut wire = Vec::<u8>::new();
        wire.extend_from_slice(&1u32.to_be_bytes());
        wire.extend_from_slice(&2u32.to_be_bytes());
        wire.push(b'u');
        wire.extend_from_slice(&VALUE_UNISTR.to_be_bytes());
        wire.extend_from_slice(&1u32.to_be_bytes());
        // 128 MiB + 1 — one byte above the cap.
        wire.extend_from_slice(&((MAX_VALUE_SIZE as u32) + 1).to_be_bytes());
        assert!(matches!(
            Pack::from_bytes(&wire).unwrap_err(),
            PackError::TooLarge
        ));
    }

    // t4-e12 non-prop test: Oversize STR body is TooLarge (different
    // branch from DATA / UNISTR).
    #[test]
    fn str_oversize_rejected() {
        let mut wire = Vec::<u8>::new();
        wire.extend_from_slice(&1u32.to_be_bytes());
        wire.extend_from_slice(&2u32.to_be_bytes());
        wire.push(b's');
        wire.extend_from_slice(&VALUE_STR.to_be_bytes());
        wire.extend_from_slice(&1u32.to_be_bytes());
        wire.extend_from_slice(&((MAX_VALUE_SIZE as u32) + 1).to_be_bytes());
        assert!(matches!(
            Pack::from_bytes(&wire).unwrap_err(),
            PackError::TooLarge
        ));
    }
}
