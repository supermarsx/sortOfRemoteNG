use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

fn decode_tauri_base64(value: &str, label: &str) -> Result<String, String> {
    let decoded = STANDARD
        .decode(value.trim())
        .map_err(|error| format!("{label} is not valid base64: {error}"))?;
    String::from_utf8(decoded).map_err(|error| format!("{label} is not UTF-8: {error}"))
}

pub fn verify_artifact(
    public_key_base64: &str,
    artifact_path: &Path,
    signature_path: &Path,
) -> Result<(), String> {
    let public_key_text = decode_tauri_base64(public_key_base64, "updater public key")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|error| format!("invalid updater public key: {error}"))?;

    let signature_base64 = fs::read_to_string(signature_path).map_err(|error| {
        format!(
            "failed to read signature {}: {error}",
            signature_path.display()
        )
    })?;
    let signature_text = decode_tauri_base64(&signature_base64, "updater signature")?;
    let signature = Signature::decode(&signature_text)
        .map_err(|error| format!("invalid updater signature: {error}"))?;

    let artifact = fs::read(artifact_path).map_err(|error| {
        format!(
            "failed to read updater payload {}: {error}",
            artifact_path.display()
        )
    })?;
    public_key
        .verify(&artifact, &signature, true)
        .map_err(|error| {
            format!(
                "signature verification failed for {}: {error}",
                artifact_path.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    const PUBLIC_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const WRONG_PUBLIC_KEY: &str = "untrusted comment: deliberately wrong minisign public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO2";
    const SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

    fn fixture_paths(name: &str) -> (PathBuf, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before Unix epoch")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "sorng-updater-signature-{name}-{}-{nonce}",
            std::process::id()
        ));
        (base.with_extension("payload"), base.with_extension("sig"))
    }

    fn verify_fixture(public_key: &str, payload: &[u8], name: &str) -> Result<(), String> {
        let (artifact_path, signature_path) = fixture_paths(name);
        fs::write(&artifact_path, payload).expect("write payload fixture");
        fs::write(&signature_path, STANDARD.encode(SIGNATURE)).expect("write signature fixture");
        let result = verify_artifact(
            &STANDARD.encode(public_key),
            &artifact_path,
            &signature_path,
        );
        let _ = fs::remove_file(artifact_path);
        let _ = fs::remove_file(signature_path);
        result
    }

    #[test]
    fn accepts_valid_tauri_wrapped_minisign_signature() {
        verify_fixture(PUBLIC_KEY, b"test", "valid").expect("valid signature should verify");
    }

    #[test]
    fn rejects_a_different_public_key() {
        assert!(verify_fixture(WRONG_PUBLIC_KEY, b"test", "wrong-key").is_err());
    }

    #[test]
    fn rejects_tampered_payload_bytes() {
        assert!(verify_fixture(PUBLIC_KEY, b"Test", "tampered").is_err());
    }
}
