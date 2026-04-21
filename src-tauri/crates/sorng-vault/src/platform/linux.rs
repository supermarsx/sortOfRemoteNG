//! Linux Secret Service back-end.
//!
//! Uses the `secret-tool` CLI (part of `libsecret`) to interact with
//! the Secret Service D-Bus API (GNOME Keyring / KDE Wallet).
//!
//! A future enhancement could use `zbus` directly to speak the
//! `org.freedesktop.Secret.Service` D-Bus protocol, avoiding the
//! subprocess overhead.

use crate::types::*;
use std::io::Write;
use std::process::{Command, Stdio};

/// Store a secret via `secret-tool store`.
pub(crate) fn store_secret(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    let label = format!("sortOfRemoteNG: {account}");

    let mut child = Command::new("secret-tool")
        .args([
            "store",
            &format!("--label={label}"),
            "service",
            service,
            "account",
            account,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| VaultError::platform(format!("secret-tool spawn: {e}")))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(secret)
            .map_err(|e| VaultError::platform(format!("secret-tool stdin: {e}")))?;
    }

    let status = child
        .wait()
        .map_err(|e| VaultError::platform(format!("secret-tool wait: {e}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(VaultError::platform(format!(
            "secret-tool store exited with {}",
            status.code().unwrap_or(-1)
        )))
    }
}

/// Read a secret via `secret-tool lookup`.
pub(crate) fn read_secret(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    let output = Command::new("secret-tool")
        .args(["lookup", "service", service, "account", account])
        .output()
        .map_err(|e| VaultError::platform(format!("secret-tool lookup spawn: {e}")))?;

    if output.status.success() && !output.stdout.is_empty() {
        Ok(output.stdout)
    } else {
        Err(VaultError::not_found(format!(
            "secret-tool lookup found nothing for {service}/{account}"
        )))
    }
}

/// Delete a secret via `secret-tool clear`.
pub(crate) fn delete_secret(service: &str, account: &str) -> VaultResult<()> {
    let output = Command::new("secret-tool")
        .args(["clear", "service", service, "account", account])
        .output()
        .map_err(|e| VaultError::platform(format!("secret-tool clear spawn: {e}")))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(VaultError::not_found(format!(
            "secret-tool clear failed for {service}/{account}"
        )))
    }
}

/// Check whether `secret-tool` is available on this system.
pub(crate) fn is_available() -> bool {
    Command::new("which")
        .arg("secret-tool")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub(crate) fn backend_name() -> &'static str {
    "Linux Secret Service (secret-tool)"
}
