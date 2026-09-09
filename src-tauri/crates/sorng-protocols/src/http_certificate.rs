//! Bounded presentation-only X.509 capture. Parsing is not certificate trust.
//! Never fetches AIA/OCSP/roots or replaces the normal verifier or approved pin.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha384, Sha512};
use x509_parser::{
    asn1_rs::{FromDer, ToDer},
    certificate::X509Certificate,
    extensions::{GeneralName, ParsedExtension},
    objects::{oid2sn, oid_registry},
    oid_registry::Oid,
    x509::X509Name,
};

const MAX_CERTIFICATES: usize = 32;
const MAX_CERTIFICATE_BYTES: usize = 256 * 1024;
const MAX_CHAIN_BYTES: usize = 2 * 1024 * 1024;
const MAX_WIRE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 4096;
const MAX_ATTRIBUTES: usize = 128;
const MAX_SANS: usize = 256;
const MAX_EXTENSIONS: usize = 128;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CertificateFingerprints {
    pub sha256: String,
    pub sha384: String,
    pub sha512: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateNameAttribute {
    pub rdn: usize,
    pub oid: String,
    pub name: Option<String>,
    pub value: String,
    pub value_der_base64: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateAlternativeName {
    #[serde(rename = "type")]
    pub name_type: String,
    pub value: String,
    pub oid: Option<String>,
    pub value_der_base64: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificatePublicKey {
    pub algorithm_oid: String,
    pub algorithm: String,
    pub parameter_oid: Option<String>,
    pub bits: Option<u32>,
    pub spki_der_base64: String,
    pub spki_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateExtension {
    pub oid: String,
    pub name: Option<String>,
    pub critical: bool,
    /// DER inside the extension's extnValue OCTET STRING, not the full Extension.
    pub value_der_base64: String,
    pub summary: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TlsCertificateDetails {
    pub der_base64: String,
    pub pem: String,
    pub fingerprints: CertificateFingerprints,
    pub subject_attributes: Vec<CertificateNameAttribute>,
    pub issuer_attributes: Vec<CertificateNameAttribute>,
    pub san_entries: Vec<CertificateAlternativeName>,
    pub serial: Option<String>,
    pub version: Option<u32>,
    pub signature_algorithm_oid: Option<String>,
    pub signature_algorithm: Option<String>,
    pub signature_parameters_der_base64: Option<String>,
    pub signature_value_base64: Option<String>,
    pub public_key: Option<CertificatePublicKey>,
    pub extensions: Vec<CertificateExtension>,
    /// Sanitized parser/limit warning. Original DER remains available; no fake metadata.
    pub parse_error: Option<String>,
}
/// The legacy five fields remain compatible with persisted identity DTOs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TlsCertificateChainEntry {
    pub subject: String,
    pub issuer: String,
    pub fingerprint: String,
    pub valid_from: String,
    pub valid_to: String,
    pub details: TlsCertificateDetails,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificateCapture {
    pub source: String,
    pub certificate_count: usize,
    pub total_der_bytes: usize,
    pub captured_at: String,
}
/// Full live inspection is separate from the minimal persisted approval identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificateInfo {
    pub fingerprint: String,
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub pem: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub serial: Option<String>,
    pub signature_algorithm: Option<String>,
    pub san: Vec<String>,
    pub subject_cn: Option<String>,
    pub subject_org: Option<String>,
    pub subject_ou: Option<String>,
    pub subject_country: Option<String>,
    pub subject_state: Option<String>,
    pub subject_locality: Option<String>,
    pub subject_email: Option<String>,
    pub issuer_cn: Option<String>,
    pub issuer_org: Option<String>,
    pub issuer_country: Option<String>,
    pub key_algorithm: Option<String>,
    pub key_size: Option<u32>,
    pub version: Option<u32>,
    /// Exactly the chain sent by this peer, in peer order, including the leaf.
    pub chain: Vec<TlsCertificateChainEntry>,
    pub details: TlsCertificateDetails,
    pub capture: TlsCertificateCapture,
    pub warnings: Vec<String>,
}

fn text(value: impl AsRef<str>) -> Result<String, String> {
    // Preserve hostile controls as visible escapes; raw ASN.1/DER remains exact.
    let mut result = String::new();
    for character in value.as_ref().chars() {
        if character.is_control()
            || matches!(character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            result.push_str(&format!("\\u{{{:04x}}}", character as u32));
        } else {
            result.push(character);
        }
        if result.len() > MAX_TEXT_BYTES {
            return Err("Certificate display metadata exceeds the 4096-byte field limit; inspect raw DER/PEM".into());
        }
    }
    Ok(result)
}
fn name(oid: &Oid<'_>) -> Option<String> {
    oid2sn(oid, oid_registry()).ok().map(str::to_owned)
}
fn oid_text(oid: &Oid<'_>) -> Result<String, String> {
    text(oid.to_id_string())
}
fn encoded_any(value: &x509_parser::asn1_rs::Any<'_>) -> Result<String, String> {
    value
        .to_der_vec()
        .map(|bytes| STANDARD.encode(bytes))
        .map_err(|_| "Certificate ASN.1 value could not be encoded".into())
}
fn attributes(dn: &X509Name<'_>) -> Result<Vec<CertificateNameAttribute>, String> {
    let mut result = Vec::new();
    for (rdn, group) in dn.iter().enumerate() {
        for attribute in group.iter() {
            if result.len() == MAX_ATTRIBUTES {
                return Err(
                    "Certificate DN exceeds the 128-attribute display limit; inspect raw DER/PEM"
                        .into(),
                );
            }
            let raw = encoded_any(attribute.attr_value())?;
            result.push(CertificateNameAttribute {
                rdn,
                oid: oid_text(attribute.attr_type())?,
                name: name(attribute.attr_type()),
                value: match attribute.as_str() {
                    Ok(value) => text(value)?,
                    Err(_) => text(format!("DER:{}", raw))?,
                },
                value_der_base64: raw,
            });
        }
    }
    Ok(result)
}
fn alt_name(value: &GeneralName<'_>) -> Result<CertificateAlternativeName, String> {
    let (kind, display, oid, raw) = match value {
        GeneralName::DNSName(value) => ("DNS", value.to_string(), None, None),
        GeneralName::RFC822Name(value) => ("email", value.to_string(), None, None),
        GeneralName::URI(value) => ("URI", value.to_string(), None, None),
        GeneralName::IPAddress(bytes) => {
            let display = match bytes.len() {
                4 => std::net::Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3]).to_string(),
                16 => std::net::Ipv6Addr::from(
                    <[u8; 16]>::try_from(*bytes).expect("checked IPv6 length"),
                )
                .to_string(),
                _ => {
                    return Err(
                        "Certificate contains a malformed SAN IP address; inspect raw DER/PEM"
                            .into(),
                    )
                }
            };
            ("IP", display, None, None)
        }
        GeneralName::DirectoryName(dn) => (
            "directoryName",
            dn.to_string(),
            None,
            Some(STANDARD.encode(dn.as_raw())),
        ),
        GeneralName::RegisteredID(oid) => (
            "registeredID",
            oid.to_id_string(),
            Some(oid.to_id_string()),
            None,
        ),
        GeneralName::OtherName(oid, bytes) => (
            "otherName",
            oid.to_id_string(),
            Some(oid.to_id_string()),
            Some(STANDARD.encode(bytes)),
        ),
        GeneralName::X400Address(value) => (
            "x400Address",
            "Raw ASN.1 value".into(),
            None,
            Some(encoded_any(value)?),
        ),
        GeneralName::EDIPartyName(value) => (
            "ediPartyName",
            "Raw ASN.1 value".into(),
            None,
            Some(encoded_any(value)?),
        ),
        GeneralName::Invalid(_, _) => {
            return Err("Certificate contains an undecodable SAN value; inspect raw DER/PEM".into())
        }
    };
    // Legacy SAN display strings also include the type prefix and share the
    // persisted identity's 4096-byte limit.
    text(format!("{kind}:{display}"))?;
    Ok(CertificateAlternativeName {
        name_type: kind.into(),
        value: text(display)?,
        oid: oid.map(text).transpose()?,
        value_der_base64: raw,
    })
}
fn bit_length(bytes: &[u8]) -> Option<u32> {
    let significant = bytes.iter().position(|byte| *byte != 0)?;
    Some(((bytes.len() - significant) * 8 - bytes[significant].leading_zeros() as usize) as u32)
}
fn public_key(cert: &X509Certificate<'_>) -> Result<CertificatePublicKey, String> {
    let spki = cert.public_key();
    let oid = oid_text(&spki.algorithm.algorithm)?;
    let parameter_oid = spki
        .algorithm
        .parameters
        .as_ref()
        .and_then(|value| value.as_oid().ok())
        .map(|oid| oid_text(&oid))
        .transpose()?;
    let (algorithm, bits) = match oid.as_str() {
        "1.2.840.113549.1.1.1" | "1.2.840.113549.1.1.10" => {
            let bits =
                x509_parser::public_key::RSAPublicKey::from_der(&spki.subject_public_key.data)
                    .ok()
                    .and_then(|(_, key)| bit_length(key.modulus));
            (
                if oid.ends_with(".10") {
                    "RSA-PSS"
                } else {
                    "RSA"
                }
                .into(),
                bits,
            )
        }
        "1.2.840.10045.2.1" => match parameter_oid.as_deref() {
            Some("1.2.840.10045.3.1.7") => ("EC (P-256)".into(), Some(256)),
            Some("1.3.132.0.34") => ("EC (P-384)".into(), Some(384)),
            Some("1.3.132.0.35") => ("EC (P-521)".into(), Some(521)),
            Some("1.3.132.0.10") => ("EC (secp256k1)".into(), Some(256)),
            _ => ("EC".into(), None),
        },
        "1.3.101.112" => ("Ed25519".into(), Some(256)),
        "1.3.101.113" => ("Ed448".into(), Some(448)),
        _ => (
            name(&spki.algorithm.algorithm).unwrap_or_else(|| oid.clone()),
            None,
        ),
    };
    Ok(CertificatePublicKey {
        algorithm_oid: oid,
        algorithm,
        parameter_oid,
        bits,
        spki_der_base64: STANDARD.encode(spki.raw),
        spki_sha256: hex::encode(Sha256::digest(spki.raw)),
    })
}
fn validity(value: x509_parser::time::ASN1Time) -> Result<String, String> {
    chrono::DateTime::from_timestamp(value.timestamp(), 0)
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .ok_or_else(|| "Certificate validity is outside the supported date range".into())
}
fn pem(der: &[u8]) -> String {
    let encoded = STANDARD.encode(der);
    let mut result = String::from("-----BEGIN CERTIFICATE-----\n");
    for part in encoded.as_bytes().chunks(64) {
        result.push_str(std::str::from_utf8(part).expect("base64 is ASCII"));
        result.push('\n');
    }
    result.push_str("-----END CERTIFICATE-----\n");
    result
}
fn populate(entry: &mut TlsCertificateChainEntry, der: &[u8]) -> Result<(), String> {
    let (rest, cert) = x509_parser::parse_x509_certificate(der)
        .map_err(|_| "Peer certificate could not be parsed as X.509; original DER/PEM retained")?;
    if !rest.is_empty() {
        return Err("Peer certificate contains trailing bytes; original DER/PEM retained".into());
    }
    entry.subject = text(cert.subject().to_string())?;
    entry.issuer = text(cert.issuer().to_string())?;
    entry.valid_from = validity(cert.validity().not_before)?;
    entry.valid_to = validity(cert.validity().not_after)?;
    let details = &mut entry.details;
    details.subject_attributes = attributes(cert.subject())?;
    details.issuer_attributes = attributes(cert.issuer())?;
    details.serial = Some(text(cert.raw_serial_as_string())?);
    details.version = Some(
        cert.version
            .0
            .checked_add(1)
            .ok_or("Certificate version is out of range")?,
    );
    details.signature_algorithm_oid = Some(oid_text(&cert.signature_algorithm.algorithm)?);
    details.signature_algorithm = Some(text(
        name(&cert.signature_algorithm.algorithm)
            .unwrap_or_else(|| cert.signature_algorithm.algorithm.to_id_string()),
    )?);
    details.signature_parameters_der_base64 = cert
        .signature_algorithm
        .parameters
        .as_ref()
        .map(encoded_any)
        .transpose()?;
    details.signature_value_base64 = Some(STANDARD.encode(&cert.signature_value.data));
    details.public_key = Some(public_key(&cert)?);
    if cert.extensions().len() > MAX_EXTENSIONS {
        return Err(
            "Certificate exceeds the 128-extension display limit; inspect raw DER/PEM".into(),
        );
    }
    let mut extension_error = false;
    for extension in cert.extensions() {
        let summary = match extension.parsed_extension() {
            ParsedExtension::BasicConstraints(value) => Some(format!(
                "CA: {}; path length: {}",
                value.ca,
                value
                    .path_len_constraint
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "unconstrained".into())
            )),
            ParsedExtension::KeyUsage(value) => Some(value.to_string()),
            ParsedExtension::SubjectAlternativeName(value) => {
                if details.san_entries.len() + value.general_names.len() > MAX_SANS {
                    return Err(
                        "Certificate exceeds the 256-SAN display limit; inspect raw DER/PEM".into(),
                    );
                }
                let entries: Vec<_> = value
                    .general_names
                    .iter()
                    .map(alt_name)
                    .collect::<Result<_, _>>()?;
                let count = entries.len();
                details.san_entries.extend(entries);
                Some(format!("{count} alternative names"))
            }
            ParsedExtension::ParseError { .. } => {
                extension_error = true;
                Some("Extension could not be decoded; raw DER retained".into())
            }
            _ => None,
        };
        details.extensions.push(CertificateExtension {
            oid: oid_text(&extension.oid)?,
            name: name(&extension.oid),
            critical: extension.critical,
            value_der_base64: STANDARD.encode(extension.value),
            summary: summary.map(text).transpose()?,
        });
    }
    if extension_error {
        return Err(
            "One or more certificate extensions could not be decoded; original DER retained".into(),
        );
    }
    Ok(())
}
fn parse_certificate(der: &[u8]) -> Result<TlsCertificateChainEntry, String> {
    if der.is_empty() || der.len() > MAX_CERTIFICATE_BYTES {
        return Err("Peer certificate is empty or exceeds the 256 KiB capture limit".into());
    }
    let fingerprint = hex::encode(Sha256::digest(der));
    let mut entry = TlsCertificateChainEntry {
        fingerprint: fingerprint.clone(),
        details: TlsCertificateDetails {
            der_base64: STANDARD.encode(der),
            pem: pem(der),
            fingerprints: CertificateFingerprints {
                sha256: fingerprint,
                sha384: hex::encode(Sha384::digest(der)),
                sha512: hex::encode(Sha512::digest(der)),
            },
            ..Default::default()
        },
        ..Default::default()
    };
    if let Err(error) = populate(&mut entry, der) {
        entry.details.parse_error = Some(error);
    }
    Ok(entry)
}
fn attribute_value(values: &[CertificateNameAttribute], oid: &str) -> Option<String> {
    values
        .iter()
        .find(|value| value.oid == oid)
        .map(|value| value.value.clone())
}
pub fn capture_peer_certificate_chain(
    ders: &[impl AsRef<[u8]>],
) -> Result<TlsCertificateInfo, String> {
    if ders.is_empty() {
        return Err("Server did not present a certificate".into());
    }
    if ders.len() > MAX_CERTIFICATES {
        return Err("Peer chain exceeds the 32-certificate capture limit".into());
    }
    let total = ders
        .iter()
        .try_fold(0usize, |total, der| total.checked_add(der.as_ref().len()))
        .ok_or("Peer certificate chain size overflow")?;
    if total > MAX_CHAIN_BYTES {
        return Err("Peer chain exceeds the 2 MiB DER capture limit".into());
    }
    let chain = ders
        .iter()
        .map(|der| parse_certificate(der.as_ref()))
        .collect::<Result<Vec<_>, _>>()?;
    let leaf = &chain[0];
    let details = &leaf.details;
    let subject = &details.subject_attributes;
    let issuer = &details.issuer_attributes;
    let warnings = chain
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            entry
                .details
                .parse_error
                .as_ref()
                .map(|error| format!("Peer certificate {}: {error}", index + 1))
        })
        .collect();
    let info = TlsCertificateInfo {
        fingerprint: leaf.fingerprint.clone(),
        subject: Some(leaf.subject.clone()),
        issuer: Some(leaf.issuer.clone()),
        pem: Some(details.pem.clone()),
        valid_from: Some(leaf.valid_from.clone()),
        valid_to: Some(leaf.valid_to.clone()),
        serial: details.serial.clone(),
        signature_algorithm: details.signature_algorithm_oid.clone(),
        san: details
            .san_entries
            .iter()
            .map(|entry| format!("{}:{}", entry.name_type, entry.value))
            .collect(),
        subject_cn: attribute_value(subject, "2.5.4.3"),
        subject_org: attribute_value(subject, "2.5.4.10"),
        subject_ou: attribute_value(subject, "2.5.4.11"),
        subject_country: attribute_value(subject, "2.5.4.6"),
        subject_state: attribute_value(subject, "2.5.4.8"),
        subject_locality: attribute_value(subject, "2.5.4.7"),
        subject_email: attribute_value(subject, "1.2.840.113549.1.9.1"),
        issuer_cn: attribute_value(issuer, "2.5.4.3"),
        issuer_org: attribute_value(issuer, "2.5.4.10"),
        issuer_country: attribute_value(issuer, "2.5.4.6"),
        key_algorithm: details.public_key.as_ref().map(|key| key.algorithm.clone()),
        key_size: details.public_key.as_ref().and_then(|key| key.bits),
        version: details.version,
        details: details.clone(),
        chain,
        capture: TlsCertificateCapture {
            source: "peer-presented".into(),
            certificate_count: ders.len(),
            total_der_bytes: total,
            captured_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        },
        warnings,
    };
    if serde_json::to_vec(&info)
        .map_err(|_| "Certificate capture could not be encoded")?
        .len()
        > MAX_WIRE_BYTES
    {
        return Err("Full certificate capture exceeds the 2 MiB response limit; no certificates were silently omitted".into());
    }
    Ok(info)
}
pub fn parse_chain_entry_from_der(der: &[u8]) -> Option<TlsCertificateChainEntry> {
    parse_certificate(der).ok()
}
pub struct ParsedTlsCertificateDetails {
    pub diagnostic_detail: Option<String>,
}
pub fn parse_tls_certificate_details(
    der: &[u8],
    _fingerprint: &str,
) -> ParsedTlsCertificateDetails {
    let diagnostic_detail = match parse_certificate(der) {
        Ok(entry) => format!(
            "Fingerprint: SHA256:{}\nSubject: {}\nIssuer: {}\nValid: {} -> {}{}",
            entry.fingerprint,
            entry.subject,
            entry.issuer,
            entry.valid_from,
            entry.valid_to,
            entry
                .details
                .parse_error
                .map(|error| format!("\n{error}"))
                .unwrap_or_default()
        ),
        Err(error) => error,
    };
    ParsedTlsCertificateDetails {
        diagnostic_detail: Some(diagnostic_detail),
    }
}

#[cfg(test)]
#[path = "http_certificate_tests.rs"]
mod tests;
