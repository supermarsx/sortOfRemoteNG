use super::*;

// Presentation-parser fixtures only. Their signatures deliberately are not
// trusted: real TLS routing/handshake coverage uses http_tls_test_fixture.rs.
fn der(tag: u8, value: impl AsRef<[u8]>) -> Vec<u8> {
    let value = value.as_ref();
    let mut result = vec![tag];
    if value.len() < 128 {
        result.push(value.len() as u8);
    } else {
        let bytes = value.len().to_be_bytes();
        let start = bytes.iter().position(|byte| *byte != 0).unwrap();
        result.push(0x80 | (bytes.len() - start) as u8);
        result.extend_from_slice(&bytes[start..]);
    }
    result.extend_from_slice(value);
    result
}
fn sequence(values: impl IntoIterator<Item = Vec<u8>>) -> Vec<u8> {
    der(0x30, values.into_iter().flatten().collect::<Vec<_>>())
}
fn oid(value: &str) -> Vec<u8> {
    let parts: Vec<u64> = value.split('.').map(|part| part.parse().unwrap()).collect();
    let mut bytes = vec![(parts[0] * 40 + parts[1]) as u8];
    for value in &parts[2..] {
        let mut value = *value;
        let mut encoded = vec![(value & 127) as u8];
        value >>= 7;
        while value != 0 {
            encoded.push(0x80 | (value & 127) as u8);
            value >>= 7;
        }
        bytes.extend(encoded.into_iter().rev());
    }
    der(6, bytes)
}
fn dn(values: &[(&str, &str)]) -> Vec<u8> {
    sequence(
        values
            .iter()
            .map(|(kind, value)| der(0x31, sequence([oid(kind), der(0x0c, value.as_bytes())]))),
    )
}
fn algorithm(value: &str, parameter: Option<&str>) -> Vec<u8> {
    let mut values = vec![oid(value)];
    if let Some(parameter) = parameter {
        values.push(oid(parameter));
    }
    sequence(values)
}
fn spki(alg: &str, parameter: Option<&str>, key: &[u8]) -> Vec<u8> {
    sequence([
        algorithm(alg, parameter),
        der(3, [vec![0], key.to_vec()].concat()),
    ])
}
fn rsa_spki() -> Vec<u8> {
    let modulus = [vec![0, 0x80], vec![1; 255]].concat();
    let key = sequence([der(2, modulus), der(2, [1, 0, 1])]);
    spki("1.2.840.113549.1.1.1", None, &key)
}
fn extension(kind: &str, critical: bool, value: Vec<u8>) -> Vec<u8> {
    let mut values = vec![oid(kind)];
    if critical {
        values.push(der(1, [0xff]));
    }
    values.push(der(4, value));
    sequence(values)
}
fn certificate(subject: Vec<u8>, key: Vec<u8>, extensions: Vec<Vec<u8>>) -> Vec<u8> {
    let signature = algorithm("1.2.840.113549.1.1.11", None);
    let tbs = sequence([
        der(0xa0, der(2, [2])),
        der(2, [1, 2, 3]),
        signature.clone(),
        dn(&[
            ("2.5.4.3", "Fixture issuer"),
            ("2.5.4.10", "Example test CA"),
        ]),
        sequence([der(0x17, b"200101000000Z"), der(0x17, b"400101000000Z")]),
        subject,
        key,
        der(0xa3, sequence(extensions)),
    ]);
    sequence([tbs, signature, der(3, [0, 1, 2, 3])])
}
fn fixture() -> Vec<u8> {
    certificate(dn(&[("2.5.4.3", "example.test")]), rsa_spki(), vec![])
}

#[test]
fn captures_full_metadata_and_exact_presented_order_without_invented_root() {
    let sans = sequence([
        der(0x82, b"example.test"),
        der(0x81, b"admin@example.test"),
        der(0x86, b"https://example.test/"),
        der(0x87, [192, 0, 2, 10]),
        der(0x87, std::net::Ipv6Addr::LOCALHOST.octets()),
    ]);
    let leaf = certificate(
        dn(&[
            ("2.5.4.3", "example.test"),
            ("2.5.4.10", "Example Org"),
            ("2.5.4.11", "First team"),
            ("2.5.4.11", "Second team"),
            ("2.5.4.6", "GB"),
            ("2.5.4.8", "London"),
            ("2.5.4.7", "London"),
            ("1.2.840.113549.1.9.1", "admin@example.test"),
        ]),
        rsa_spki(),
        vec![
            extension("2.5.29.17", false, sans),
            extension("1.2.3.4.5", true, der(4, [4, 5, 6])),
        ],
    );
    let intermediate = fixture();
    let info = capture_peer_certificate_chain(&[&leaf, &intermediate]).unwrap();
    assert!(info.warnings.is_empty(), "{:?}", info.warnings);
    assert_eq!(info.capture.source, "peer-presented");
    assert_eq!(info.capture.certificate_count, 2);
    assert_eq!(
        info.capture.total_der_bytes,
        leaf.len() + intermediate.len()
    );
    assert_eq!(info.chain.len(), 2);
    assert_eq!(
        STANDARD.decode(&info.chain[0].details.der_base64).unwrap(),
        leaf
    );
    assert_eq!(
        STANDARD.decode(&info.chain[1].details.der_base64).unwrap(),
        intermediate
    );
    assert_eq!(info.subject_cn.as_deref(), Some("example.test"));
    assert_eq!(info.subject_org.as_deref(), Some("Example Org"));
    assert_eq!(info.subject_ou.as_deref(), Some("First team"));
    assert_eq!(info.subject_email.as_deref(), Some("admin@example.test"));
    assert_eq!(info.issuer_cn.as_deref(), Some("Fixture issuer"));
    assert!(info.subject.as_ref().unwrap().contains("Second team"));
    assert_eq!(info.details.subject_attributes.len(), 8);
    assert_eq!(info.details.subject_attributes[3].rdn, 3);
    assert_eq!(info.valid_from.as_deref(), Some("2020-01-01T00:00:00Z"));
    assert_eq!(info.valid_to.as_deref(), Some("2040-01-01T00:00:00Z"));
    assert_eq!(info.version, Some(3));
    assert_eq!(info.key_size, Some(2048));
    assert_eq!(info.serial.as_deref(), Some("01:02:03"));
    assert_eq!(
        info.details.signature_algorithm_oid.as_deref(),
        Some("1.2.840.113549.1.1.11")
    );
    assert_eq!(info.details.signature_value_base64.as_deref(), Some("AQID"));
    assert_eq!(
        info.san,
        [
            "DNS:example.test",
            "email:admin@example.test",
            "URI:https://example.test/",
            "IP:192.0.2.10",
            "IP:::1"
        ]
    );
    let unknown = &info.details.extensions[1];
    assert!(unknown.critical);
    assert_eq!(unknown.oid, "1.2.3.4.5");
    assert_eq!(
        STANDARD.decode(&unknown.value_der_base64).unwrap(),
        der(4, [4, 5, 6])
    );
    assert_eq!(info.fingerprint, hex::encode(Sha256::digest(&leaf)));
    assert_eq!(
        info.details.fingerprints.sha384,
        hex::encode(Sha384::digest(&leaf))
    );
    assert_eq!(
        info.details.fingerprints.sha512,
        hex::encode(Sha512::digest(&leaf))
    );
    assert_eq!(info.pem.as_deref(), Some(info.details.pem.as_str()));
    let wire = serde_json::to_value(&info).unwrap();
    assert!(wire["details"]["public_key"]["spki_der_base64"].is_string());
    assert_eq!(
        wire["chain"][1]["details"]["der_base64"],
        STANDARD.encode(&intermediate)
    );
    assert!(
        parse_tls_certificate_details(&leaf, "untrusted caller value")
            .diagnostic_detail
            .unwrap()
            .contains("example.test")
    );
}

#[test]
fn legitimate_san_only_subject_remains_empty_not_fabricated() {
    let cert = certificate(
        dn(&[]),
        rsa_spki(),
        vec![extension(
            "2.5.29.17",
            true,
            sequence([der(0x82, b"example.test")]),
        )],
    );
    let info = capture_peer_certificate_chain(&[cert]).unwrap();
    assert_eq!(info.subject.as_deref(), Some(""));
    assert!(info.subject_cn.is_none());
    assert!(info.details.subject_attributes.is_empty());
    assert_eq!(info.san, ["DNS:example.test"]);
    assert!(info.warnings.is_empty());
}

#[test]
fn known_key_sizes_are_precise_and_unknown_algorithms_do_not_invent_bits() {
    for (alg, parameter, bytes, expected) in [
        (
            "1.2.840.10045.2.1",
            Some("1.3.132.0.35"),
            vec![4; 133],
            Some(521),
        ),
        ("1.3.101.112", None, vec![1; 32], Some(256)),
        ("1.3.101.113", None, vec![1; 57], Some(448)),
        ("1.2.3.4.5", None, vec![1; 32], None),
    ] {
        let cert = certificate(dn(&[]), spki(alg, parameter, &bytes), vec![]);
        let info = capture_peer_certificate_chain(&[cert]).unwrap();
        assert!(info.warnings.is_empty(), "{:?}", info.warnings);
        assert_eq!(info.details.public_key.as_ref().unwrap().algorithm_oid, alg);
        assert_eq!(info.key_size, expected);
    }
    assert_eq!(bit_length(&[0, 0x7f, 0xff]), Some(15));
    assert_eq!(bit_length(&[0, 0x80, 0]), Some(16));
    assert_eq!(bit_length(&[0]), None);
}

#[test]
fn malformed_or_trailing_der_is_preserved_instead_of_dropped_from_chain() {
    let valid = fixture();
    let mut trailing = valid.clone();
    trailing.push(0);
    let truncated = valid[..valid.len() - 10].to_vec();
    let malformed = vec![0x30, 1, 0xff];
    let info = capture_peer_certificate_chain(&[
        valid,
        trailing.clone(),
        truncated.clone(),
        malformed.clone(),
    ])
    .unwrap();
    assert_eq!(info.chain.len(), 4);
    assert_eq!(info.warnings.len(), 3);
    for (entry, expected) in info.chain[1..].iter().zip([trailing, truncated, malformed]) {
        assert!(entry.details.parse_error.is_some());
        assert_eq!(
            STANDARD.decode(&entry.details.der_base64).unwrap(),
            expected
        );
        assert_eq!(entry.fingerprint, hex::encode(Sha256::digest(&expected)));
        assert!(entry.details.pem.contains("BEGIN CERTIFICATE"));
    }
}

#[test]
fn hostile_display_controls_are_visible_and_exact_der_remains_available() {
    let cert = certificate(
        dn(&[("2.5.4.3", "example\0.test\u{202e}evil")]),
        rsa_spki(),
        vec![],
    );
    let info = capture_peer_certificate_chain(&[&cert]).unwrap();
    assert!(info.warnings.is_empty());
    assert_eq!(
        info.subject_cn.as_deref(),
        Some("example\\u{0000}.test\\u{202e}evil")
    );
    assert!(!info.subject.as_ref().unwrap().contains('\0'));
    assert_eq!(STANDARD.decode(&info.details.der_base64).unwrap(), cert);
}

#[test]
fn san_bound_includes_legacy_type_prefix_and_keeps_raw_on_overflow() {
    for (size, accepted) in [(MAX_TEXT_BYTES - 4, true), (MAX_TEXT_BYTES - 3, false)] {
        let dns = vec![b'a'; size];
        let cert = certificate(
            dn(&[]),
            rsa_spki(),
            vec![extension("2.5.29.17", false, sequence([der(0x82, dns)]))],
        );
        let info = capture_peer_certificate_chain(&[&cert]).unwrap();
        assert_eq!(info.warnings.is_empty(), accepted);
        assert!(info.san.iter().all(|value| value.len() <= MAX_TEXT_BYTES));
        if accepted {
            assert_eq!(info.san[0].len(), MAX_TEXT_BYTES);
        }
        assert_eq!(STANDARD.decode(&info.details.der_base64).unwrap(), cert);
    }
}

#[test]
fn metadata_count_limits_return_explicit_warning_with_raw_capture() {
    let many_sans = sequence((0..=MAX_SANS).map(|_| der(0x82, b"example.test")));
    let many_extensions = (0..=MAX_EXTENSIONS)
        .map(|_| extension("1.2.3.4", false, der(5, [])))
        .collect();
    let many_names = vec![("2.5.4.3", "x"); MAX_ATTRIBUTES + 1];
    for cert in [
        certificate(
            dn(&[]),
            rsa_spki(),
            vec![extension("2.5.29.17", false, many_sans)],
        ),
        certificate(dn(&[]), rsa_spki(), many_extensions),
        certificate(dn(&many_names), rsa_spki(), vec![]),
    ] {
        let info = capture_peer_certificate_chain(&[&cert]).unwrap();
        assert_eq!(info.warnings.len(), 1);
        assert!(info.warnings[0].contains("limit"));
        assert_eq!(STANDARD.decode(&info.details.der_base64).unwrap(), cert);
    }
}

#[test]
fn hard_capture_bounds_fail_explicitly_without_returning_partial_chains() {
    assert!(capture_peer_certificate_chain(&Vec::<Vec<u8>>::new())
        .unwrap_err()
        .contains("did not present"));
    assert!(capture_peer_certificate_chain(&[Vec::<u8>::new()])
        .unwrap_err()
        .contains("empty"));
    assert!(
        capture_peer_certificate_chain(&vec![vec![1]; MAX_CERTIFICATES + 1])
            .unwrap_err()
            .contains("32-certificate")
    );
    assert!(
        capture_peer_certificate_chain(&[vec![1; MAX_CERTIFICATE_BYTES + 1]])
            .unwrap_err()
            .contains("256 KiB")
    );
    assert!(
        capture_peer_certificate_chain(&vec![vec![1; MAX_CERTIFICATE_BYTES]; 9])
            .unwrap_err()
            .contains("2 MiB DER")
    );
    // Base64/PEM, raw extensions and the repeated leaf projection count toward
    // the separate wire limit even when DER input is below its own limit.
    assert!(
        capture_peer_certificate_chain(&vec![vec![1; MAX_CERTIFICATE_BYTES]; 3])
            .unwrap_err()
            .contains("2 MiB response")
    );
}
