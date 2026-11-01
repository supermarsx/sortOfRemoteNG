//! Fixed native DevTools Security event projection. No command, URL, script or
//! trust override comes from the web page or the shell.
use base64::Engine;

pub(crate) const MAX_EVENT: usize = 3 * 1024 * 1024;
pub(crate) const MAX_CERT: usize = 256 * 1024;

/// Re-enable the app-owned internal observation subscription to request the
/// current state even when Chromium sees no change across a new document.
/// Always restore observation after a rejected disable submission. These are
/// fixed subscription commands, never certificate override/trust commands.
pub(crate) fn refresh_subscription(mut execute: impl FnMut(&'static str) -> bool) -> bool {
    let disabled = execute("Security.disable");
    let enabled = execute("Security.enable");
    disabled && enabled
}

fn token(value: &str, max: usize) -> Option<String> {
    (!value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() || byte == b' '))
    .then(|| value.to_owned())
}

/// The event's leaf must equal CEF's current NavigationEntry certificate. A
/// queued event from a different document must never supply its cipher.
pub(crate) fn read_transport(bytes: &[u8]) -> Option<(Vec<u8>, String, String)> {
    if bytes.len() > MAX_EVENT {
        return None;
    }
    let event: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let certificate = event
        .get("visibleSecurityState")?
        .get("certificateSecurityState")?;
    let encoded = certificate
        .get("certificate")?
        .as_array()?
        .first()?
        .as_str()?;
    if encoded.len() > (MAX_CERT + 2) / 3 * 4 {
        return None;
    }
    let leaf = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    if leaf.is_empty() || leaf.len() > MAX_CERT {
        return None;
    }
    Some((
        leaf,
        token(certificate.get("protocol")?.as_str()?, 64)?,
        token(certificate.get("cipher")?.as_str()?, 128)?,
    ))
}

#[cfg(test)]
fn transport(bytes: &[u8], leaf: &[u8]) -> Option<(String, String)> {
    let (current, protocol, cipher) = read_transport(bytes)?;
    (current == leaf).then_some((protocol, cipher))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(leaf: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"visibleSecurityState": {
            "certificateSecurityState": {"protocol":"TLS 1.3", "cipher":"AES_256_GCM",
            "certificate":[base64::engine::general_purpose::STANDARD.encode(leaf)]}
        }}))
        .unwrap()
    }
    #[test]
    fn transport_requires_exact_current_leaf_and_bounded_native_tokens() {
        assert_eq!(
            transport(&event(b"leaf"), b"leaf"),
            Some(("TLS 1.3".into(), "AES_256_GCM".into()))
        );
        assert_eq!(transport(&event(b"previous"), b"leaf"), None);
        let mut value: serde_json::Value = serde_json::from_slice(&event(b"leaf")).unwrap();
        value["visibleSecurityState"]["certificateSecurityState"]["cipher"] = "bad\nvalue".into();
        assert_eq!(
            transport(&serde_json::to_vec(&value).unwrap(), b"leaf"),
            None
        );
        value["visibleSecurityState"]["certificateSecurityState"]["cipher"] =
            "x".repeat(129).into();
        assert_eq!(
            transport(&serde_json::to_vec(&value).unwrap(), b"leaf"),
            None
        );
        assert_eq!(transport(&vec![b' '; MAX_EVENT + 1], b"leaf"), None);
    }
    #[test]
    fn refresh_always_restores_subscription_and_reports_either_submission_failure() {
        for failed in [None, Some("Security.disable"), Some("Security.enable")] {
            let mut commands = Vec::new();
            let accepted = refresh_subscription(|command| {
                commands.push(command);
                Some(command) != failed
            });
            assert_eq!(commands, ["Security.disable", "Security.enable"]);
            assert_eq!(accepted, failed.is_none());
        }
    }
}
