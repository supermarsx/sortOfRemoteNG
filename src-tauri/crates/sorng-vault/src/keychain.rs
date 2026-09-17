//! Cross-platform keychain/credential-store abstraction.
//!
//! Dispatches to the platform-specific back-end and provides a clean
//! async API for rest of the application.
//!
//! Callers always pass *logical* service names. Every back-end call goes
//! through [`physical_service`], which appends the isolated-profile namespace
//! installed by [`install_service_namespace`] (`<service>@<identifier>`).
//! Production installs no namespace, so its physical names are the logical
//! names byte for byte.

use std::borrow::Cow;
use std::sync::OnceLock;

use crate::types::*;
use zeroize::Zeroizing;

// ── Service namespace (isolated profiles) ───────────────────────────

/// Mirrors `sorng_core::app_identity::PRODUCTION_IDENTIFIER`. A namespace
/// naming it is refused: production must never be namespaced.
const PRODUCTION_IDENTIFIER: &str = "com.sortofremote.ng";

/// Maximum identifier length after the leading `@`.
const MAX_NAMESPACE_IDENTIFIER_LEN: usize = 128;

struct NamespaceSlot(OnceLock<Option<String>>);

impl NamespaceSlot {
    const fn new() -> Self {
        Self(OnceLock::new())
    }

    fn install(&self, namespace: Option<String>) -> VaultResult<()> {
        if let Some(namespace) = namespace.as_deref() {
            validate_namespace(namespace)?;
        }
        match self.0.set(namespace) {
            Ok(()) => Ok(()),
            Err(requested) => {
                let installed = self.get();
                if installed == requested.as_deref() {
                    Ok(())
                } else {
                    Err(VaultError::internal(format!(
                        "keychain service namespace is already installed as {installed:?}; refusing to replace it with {requested:?}"
                    )))
                }
            }
        }
    }

    fn get(&self) -> Option<&str> {
        self.0.get().and_then(Option::as_deref)
    }
}

static SERVICE_NAMESPACE: NamespaceSlot = NamespaceSlot::new();

/// Validate `^@[A-Za-z0-9][A-Za-z0-9.-]{0,127}$`, refusing the production
/// identifier in any letter case.
fn validate_namespace(namespace: &str) -> VaultResult<()> {
    let invalid = |reason: &str| {
        Err(VaultError::internal(format!(
            "invalid keychain service namespace {namespace:?}: {reason}"
        )))
    };
    let Some(identifier) = namespace.strip_prefix('@') else {
        return invalid("it must start with '@'");
    };
    let Some(first) = identifier.chars().next() else {
        return invalid("the identifier is empty");
    };
    if identifier.len() > MAX_NAMESPACE_IDENTIFIER_LEN {
        return invalid("the identifier is longer than 128 bytes");
    }
    if !first.is_ascii_alphanumeric() {
        return invalid("the identifier must start with an ASCII letter or digit");
    }
    if !identifier
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return invalid("only ASCII letters, digits, '.' and '-' may follow '@'");
    }
    if identifier.eq_ignore_ascii_case(PRODUCTION_IDENTIFIER) {
        return invalid("the production identifier never has a namespace");
    }
    Ok(())
}

fn apply_namespace<'a>(service: &'a str, namespace: Option<&str>) -> Cow<'a, str> {
    match namespace {
        None => Cow::Borrowed(service),
        Some(namespace) => Cow::Owned(format!("{service}{namespace}")),
    }
}

/// Install the process keychain namespace once, before any vault access.
///
/// `None` means production and leaves every service name unchanged.
/// `Some("@<identifier>")` suffixes every service name. Installing the same
/// value again is `Ok`; a different value is an error and changes nothing.
pub fn install_service_namespace(ns: Option<String>) -> VaultResult<()> {
    SERVICE_NAMESPACE.install(ns)
}

/// The installed namespace, or `None` for production or before install.
pub fn service_namespace() -> Option<&'static str> {
    SERVICE_NAMESPACE.get()
}

/// The service name the OS keychain actually sees for `logical`.
pub fn physical_service(logical: &str) -> Cow<'_, str> {
    apply_namespace(logical, service_namespace())
}

// ── Platform dispatch helpers ───────────────────────────────────────
//
// Each helper that takes a service shadows it with `physical_service` as
// its first statement, so no back-end ever sees a logical name.

fn plat_store(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    let service = physical_service(service);
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::store_secret(&service, account, secret).map_err(VaultError::platform)
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::store_secret(&service, account, secret)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::store_secret(&service, account, secret)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::store_secret(&service, account, secret)
    }
}

fn plat_read(service: &str, account: &str) -> VaultResult<Zeroizing<Vec<u8>>> {
    let service = physical_service(service);
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::read_secret_optional(&service, account)
            .map_err(VaultError::platform)?
            .map(Zeroizing::new)
            .ok_or_else(|| VaultError::not_found("credential not found"))
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::read_secret(&service, account).map(Zeroizing::new)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::read_secret(&service, account)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::read_secret(&service, account).map(Zeroizing::new)
    }
}

fn plat_delete(service: &str, account: &str) -> VaultResult<()> {
    let service = physical_service(service);
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::delete_secret(&service, account).map_err(VaultError::platform)
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::delete_secret(&service, account)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::delete_secret(&service, account)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::delete_secret(&service, account)
    }
}

fn plat_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::is_available()
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::is_available()
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::is_available()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::is_available()
    }
}

fn plat_backend_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::backend_name()
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::backend_name()
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::backend_name()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::backend_name()
    }
}

/// Count vault entries for the given service name.
fn plat_count(service: &str) -> usize {
    let service = physical_service(service);
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::count_entries(&service).unwrap_or(0)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = service;
        0 // macOS Keychain enumeration requires Security framework queries
    }
    #[cfg(target_os = "linux")]
    {
        let _ = service;
        0 // Linux Secret Service enumeration requires libsecret collection listing
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = service;
        0
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Store a UTF-8 string secret in the OS vault.
pub async fn store(service: &str, account: &str, secret: &str) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    let secret = Zeroizing::new(secret.as_bytes().to_vec());
    tokio::task::spawn_blocking(move || plat_store(&service, &account, secret.as_slice()))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Store raw bytes in the OS vault.
pub async fn store_bytes(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    let secret = Zeroizing::new(secret.to_vec());
    tokio::task::spawn_blocking(move || plat_store(&service, &account, secret.as_slice()))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Read a secret as UTF-8 string from the OS vault.
pub async fn read(service: &str, account: &str) -> VaultResult<String> {
    let bytes = read_bytes_zeroizing(service, account).await?;
    std::str::from_utf8(bytes.as_slice())
        .map(str::to_owned)
        .map_err(|e| VaultError::serde(format!("Secret is not valid UTF-8: {e}")))
}

/// Read raw bytes from the OS vault into an automatically zeroizing buffer.
pub async fn read_bytes_zeroizing(service: &str, account: &str) -> VaultResult<Zeroizing<Vec<u8>>> {
    let service = service.to_owned();
    let account = account.to_owned();
    tokio::task::spawn_blocking(move || plat_read(&service, &account))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Read raw bytes from the OS vault.
///
/// The returned bytes are owned by the caller. Prefer
/// [`read_bytes_zeroizing`] when the caller can keep the zeroizing wrapper.
pub async fn read_bytes(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    let mut bytes = read_bytes_zeroizing(service, account).await?;
    Ok(std::mem::take(&mut *bytes))
}

/// Delete a secret from the OS vault.
pub async fn delete(service: &str, account: &str) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    tokio::task::spawn_blocking(move || plat_delete(&service, &account))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Is the vault backend available on this platform?
pub fn is_available() -> bool {
    plat_available()
}

/// Human name of the current vault backend.
pub fn backend_name() -> &'static str {
    plat_backend_name()
}

/// Get overall vault status.
pub async fn status() -> VaultResult<VaultStatus> {
    let available = is_available();
    let backend = backend_name().to_string();
    let entry_count = tokio::task::spawn_blocking(|| plat_count(SERVICE_NAME))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?;
    Ok(VaultStatus {
        available,
        backend,
        entry_count,
        biometric_enabled: sorng_biometrics::availability::is_available().await,
        message: if available {
            Some("Vault is ready".into())
        } else {
            Some("Vault backend is not available".into())
        },
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Convenience: store/read the master DEK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate a random 256-bit data-encryption key and store it in the vault.
pub async fn generate_and_store_dek() -> VaultResult<Vec<u8>> {
    let mut dek = Zeroizing::new([0u8; 32]);
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut *dek);
    store_bytes(SERVICE_NAME, MASTER_DEK_ACCOUNT, &dek[..]).await?;
    Ok(dek.to_vec())
}

/// Read the master DEK from the vault.  Returns `Err(NotFound)` if
/// no DEK has been stored yet.
pub async fn read_dek() -> VaultResult<Vec<u8>> {
    read_bytes(SERVICE_NAME, MASTER_DEK_ACCOUNT).await
}

/// Read-or-create: returns the existing DEK, or generates a new one.
pub async fn ensure_dek() -> VaultResult<Vec<u8>> {
    match read_dek().await {
        Ok(dek) => Ok(dek),
        Err(error) if matches!(error.kind, VaultErrorKind::NotFound) => {
            generate_and_store_dek().await
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // Tests must never install into the process-wide SERVICE_NAMESPACE: every
    // test in this binary shares it. Set-once behaviour is exercised on local
    // slots, and nothing here reaches a real OS keychain.

    const E2E_NAMESPACE: &str = "@com.sortofremote.ng.e2e";
    const README_CAPTURE_NAMESPACE: &str = "@com.sortofremote.ng.readme-capture";

    /// Every logical service production keeps secrets under.
    const PRODUCTION_SERVICES: &[&str] = &[
        SERVICE_NAME,
        "com.sortofremoteng.vault",
        "sortofremoteng.internal.rest-api",
        "sortofremoteng.internal.database-protection.v1",
        "sortofremoteng.internal.database-key",
        "com.sortofremoteng.vpn",
        "com.sortofremoteng.integrations",
        "sortofremoteng.connection-notes",
        "sortofremoteng.ssh-command-history",
        "com.sortofremoteng.biometric",
        "com.sortofremoteng.biometric.se-fallback",
        "sortofremoteng-passkey",
    ];

    /// Arbitrary names the generic vault IPC accepts from the frontend.
    const EDGE_SERVICES: &[&str] = &[
        "",
        " ",
        "integration@example.com",
        "a/b",
        "*",
        "ünïcode",
        "com.sortofremoteng.vault@com.sortofremote.ng.e2e",
    ];

    const ACCOUNTS: &[&str] = &[MASTER_DEK_ACCOUNT, STORAGE_KEY_ACCOUNT, "api-key", "a/b"];

    /// Mirrors the harness cleanup pattern `^[^/@*]+@<identifier>/[^*]+$`.
    fn matches_isolated_cleanup_target(target: &str, identifier: &str) -> bool {
        let Some((service, account)) = target.split_once('/') else {
            return false;
        };
        let Some(logical) = service
            .strip_suffix(identifier)
            .and_then(|rest| rest.strip_suffix('@'))
        else {
            return false;
        };
        !logical.is_empty()
            && !logical.contains(['/', '@', '*'])
            && !account.is_empty()
            && !account.contains('*')
    }

    fn assert_byte_identical(physical: Cow<'_, str>, logical: &str) {
        assert!(
            matches!(physical, Cow::Borrowed(_)),
            "{logical:?} must not be reallocated"
        );
        assert_eq!(physical.as_bytes(), logical.as_bytes());
        assert_eq!(physical.as_ptr(), logical.as_ptr());
    }

    // ── production byte identity ────────────────────────────────────

    #[test]
    fn uninstalled_process_keeps_every_service_name_byte_identical() {
        assert_eq!(service_namespace(), None);
        for service in PRODUCTION_SERVICES.iter().chain(EDGE_SERVICES) {
            assert_byte_identical(physical_service(service), service);
        }
        assert_eq!(
            format!("{}/{MASTER_DEK_ACCOUNT}", physical_service(SERVICE_NAME)),
            "com.sortofremoteng.vault/master-dek"
        );
    }

    #[test]
    fn production_namespace_keeps_every_service_name_byte_identical() {
        let slot = NamespaceSlot::new();
        assert!(slot.install(None).is_ok());
        assert_eq!(slot.get(), None);
        for service in PRODUCTION_SERVICES.iter().chain(EDGE_SERVICES) {
            assert_byte_identical(apply_namespace(service, slot.get()), service);
        }
    }

    // ── isolated namespaces ─────────────────────────────────────────

    #[test]
    fn isolated_namespace_suffixes_every_service() {
        let slot = NamespaceSlot::new();
        assert!(slot.install(Some(E2E_NAMESPACE.to_string())).is_ok());
        assert_eq!(slot.get(), Some(E2E_NAMESPACE));
        for service in PRODUCTION_SERVICES.iter().chain(EDGE_SERVICES) {
            let physical = apply_namespace(service, slot.get());
            assert_eq!(physical, format!("{service}{E2E_NAMESPACE}"));
            assert_ne!(physical, *service);
        }
        assert_eq!(
            apply_namespace(SERVICE_NAME, Some(E2E_NAMESPACE)),
            "com.sortofremoteng.vault@com.sortofremote.ng.e2e"
        );
        assert_eq!(
            format!(
                "{}/{MASTER_DEK_ACCOUNT}",
                apply_namespace(SERVICE_NAME, Some(E2E_NAMESPACE))
            ),
            "com.sortofremoteng.vault@com.sortofremote.ng.e2e/master-dek"
        );
        assert_eq!(
            apply_namespace(
                "sortofremoteng.internal.database-protection.v1",
                Some(README_CAPTURE_NAMESPACE)
            ),
            "sortofremoteng.internal.database-protection.v1@com.sortofremote.ng.readme-capture"
        );
    }

    #[test]
    fn cleanup_pattern_matches_isolated_targets_and_never_production() {
        for service in PRODUCTION_SERVICES {
            assert!(!service.contains(['@', '/', '*']), "{service:?}");
            for account in ACCOUNTS {
                for identifier in [
                    "com.sortofremote.ng.e2e",
                    "com.sortofremote.ng.readme-capture",
                ] {
                    let namespace = format!("@{identifier}");
                    let production = format!("{service}/{account}");
                    let isolated =
                        format!("{}/{account}", apply_namespace(service, Some(&namespace)));
                    assert!(!matches_isolated_cleanup_target(&production, identifier));
                    assert!(
                        matches_isolated_cleanup_target(&isolated, identifier),
                        "{isolated}"
                    );
                }
            }
        }
        assert!(!matches_isolated_cleanup_target(
            "com.sortofremoteng.vault@com.sortofremote.ng.e2e/master-dek",
            "com.sortofremote.ng.readme-capture"
        ));
    }

    #[test]
    fn invalid_namespaces_are_rejected_without_installing() {
        let too_long = format!("@{}", "a".repeat(MAX_NAMESPACE_IDENTIFIER_LEN + 1));
        let longest = format!("@{}", "a".repeat(MAX_NAMESPACE_IDENTIFIER_LEN));
        for namespace in [
            "",
            "@",
            "com.sortofremote.ng.e2e",
            "@@com.sortofremote.ng.e2e",
            "@.com.sortofremote.ng.e2e",
            "@-com.sortofremote.ng.e2e",
            "@com.sortofremote.ng/e2e",
            "@com.sortofremote.ng.*",
            "@com.sortofremote.ng e2e",
            "@com.sortofremote.ng.e2e\n",
            "@com.sortofremote.ng@e2e",
            "@com#sortofremote",
            "@com_sortofremote",
            too_long.as_str(),
            "@com.sortofremote.ng",
            "@COM.SORTOFREMOTE.NG",
        ] {
            let slot = NamespaceSlot::new();
            assert!(
                slot.install(Some(namespace.to_string())).is_err(),
                "{namespace:?} must be rejected"
            );
            assert!(slot.0.get().is_none(), "{namespace:?} must not install");
        }
        assert!(NamespaceSlot::new().install(Some(longest)).is_ok());
    }

    #[test]
    fn namespace_installs_once() {
        let isolated = NamespaceSlot::new();
        assert!(isolated.install(Some(E2E_NAMESPACE.to_string())).is_ok());
        assert!(isolated.install(Some(E2E_NAMESPACE.to_string())).is_ok());
        assert!(isolated
            .install(Some(README_CAPTURE_NAMESPACE.to_string()))
            .is_err());
        assert!(isolated.install(None).is_err());
        assert_eq!(isolated.get(), Some(E2E_NAMESPACE));

        let production = NamespaceSlot::new();
        assert!(production.install(None).is_ok());
        assert!(production.install(None).is_ok());
        assert!(production.install(Some(E2E_NAMESPACE.to_string())).is_err());
        assert_eq!(production.get(), None);
    }

    #[test]
    fn process_install_rejects_invalid_namespaces_without_installing() {
        assert!(install_service_namespace(Some("@com.sortofremote.ng".to_string())).is_err());
        assert!(install_service_namespace(Some("com.sortofremote.ng.e2e".to_string())).is_err());
        assert_eq!(service_namespace(), None);
    }

    // ── no bypass ───────────────────────────────────────────────────

    const SERVICE_HELPERS: [&str; 4] = ["plat_store", "plat_read", "plat_delete", "plat_count"];
    const SERVICELESS_HELPERS: [&str; 2] = ["plat_available", "plat_backend_name"];
    const RESOLVE_PHYSICAL: &str = "let service = physical_service(service);";

    fn strip_line_comments(source: &str) -> String {
        source
            .lines()
            .map(|line| line.find("//").map_or(line, |index| &line[..index]))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn first_backend_reference(source: &str) -> Option<usize> {
        ["sorng_vault_windows", "platform::"]
            .iter()
            .filter_map(|pattern| source.find(pattern))
            .min()
    }

    /// The text before the first top-level `fn`, and each top-level `fn` as
    /// (name, text up to the next top-level `fn`).
    fn top_level_fns(source: &str) -> (&str, Vec<(&str, &str)>) {
        let mut starts = Vec::new();
        let mut offset = 0;
        for line in source.split_inclusive('\n') {
            let decl = line.strip_prefix("pub ").unwrap_or(line);
            let decl = decl.strip_prefix("async ").unwrap_or(decl);
            if let Some(rest) = decl.strip_prefix("fn ") {
                let name = rest.split(['(', '<']).next().unwrap_or_default();
                starts.push((offset, name));
            }
            offset += line.len();
        }
        let preamble = &source[..starts.first().map_or(source.len(), |(start, _)| *start)];
        let items = starts
            .iter()
            .enumerate()
            .map(|(index, (start, name))| {
                let end = starts
                    .get(index + 1)
                    .map_or(source.len(), |(next, _)| *next);
                (*name, &source[*start..end])
            })
            .collect();
        (preamble, items)
    }

    /// Every way `source` (keychain.rs without its tests) could hand a
    /// back-end a service name that did not go through `physical_service`.
    fn backend_contract_violations(source: &str) -> Vec<String> {
        let source = strip_line_comments(source);
        let (preamble, items) = top_level_fns(&source);
        let mut violations = Vec::new();
        if first_backend_reference(preamble).is_some() {
            violations.push("a back-end is referenced outside any fn".to_string());
        }

        let mut helpers_seen = Vec::new();
        for (name, text) in items {
            let Some(first_backend) = first_backend_reference(text) else {
                continue;
            };
            if SERVICE_HELPERS.contains(&name) {
                let body = text.find('{').map_or("", |open| &text[open + 1..]);
                if !text.starts_with(&format!("fn {name}(service: &str")) {
                    violations.push(format!("{name} must take `service: &str` first"));
                }
                if !body.trim_start().starts_with(RESOLVE_PHYSICAL)
                    || text.find(RESOLVE_PHYSICAL) > Some(first_backend)
                {
                    violations.push(format!("{name} must start with `{RESOLVE_PHYSICAL}`"));
                }
                if text.matches(RESOLVE_PHYSICAL).count() != 1 {
                    violations.push(format!("{name} must resolve the service exactly once"));
                }
            } else if SERVICELESS_HELPERS.contains(&name) {
                if !text.starts_with(&format!("fn {name}() ")) {
                    violations.push(format!("{name} must not take a service"));
                }
            } else {
                violations.push(format!(
                    "{name} reaches a keychain back-end directly; route it through a plat_* helper"
                ));
            }
            helpers_seen.push(name);
        }
        for helper in SERVICE_HELPERS.iter().chain(SERVICELESS_HELPERS.iter()) {
            if helpers_seen.iter().filter(|seen| *seen == helper).count() != 1 {
                violations.push(format!("expected exactly one back-end helper {helper}"));
            }
        }
        violations
    }

    /// keychain.rs without its tests, with LF line endings whatever the
    /// checkout uses.
    fn production_keychain_source() -> String {
        let source = include_str!("keychain.rs").replace("\r\n", "\n");
        source.split("#[cfg(test)]").next().unwrap().to_string()
    }

    #[test]
    fn every_backend_call_receives_the_physical_service() {
        let source = production_keychain_source();
        assert_eq!(backend_contract_violations(&source), Vec::<String>::new());
        let crlf = source.replace('\n', "\r\n");
        assert_eq!(backend_contract_violations(&crlf), Vec::<String>::new());
    }

    #[test]
    fn backend_contract_detects_bypasses() {
        let source = production_keychain_source();
        let source = source.as_str();
        let resolve_in_store = "fn plat_store(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {\n    let service = physical_service(service);\n";
        assert!(source.contains(resolve_in_store));
        let bypasses = [
            source.replacen(
                resolve_in_store,
                "fn plat_store(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {\n",
                1,
            ),
            source.replacen(
                resolve_in_store,
                "fn plat_store(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {\n    sorng_vault_windows::delete_secret(service, account).ok();\n    let service = physical_service(service);\n",
                1,
            ),
            source.replacen(
                "fn plat_count(service: &str) -> usize {",
                "fn plat_count(logical: &str) -> usize {\n    let service = logical;",
                1,
            ),
            format!(
                "{source}\nfn plat_wipe(service: &str) {{\n    crate::platform::linux::delete_secret(service, \"master-dek\").ok();\n}}\n"
            ),
            format!(
                "{source}\npub async fn read_raw(service: &str) {{\n    sorng_vault_windows::read_secret(service, \"x\").ok();\n}}\n"
            ),
            source.replacen(
                "use zeroize::Zeroizing;",
                "use zeroize::Zeroizing;\nuse sorng_vault_windows::delete_secret;",
                1,
            ),
            source.replacen("fn plat_backend_name()", "fn plat_backend_name(service: &str)", 1),
        ];
        for (index, bypass) in bypasses.iter().enumerate() {
            assert_ne!(bypass, source, "mutation {index} did not apply");
            assert!(
                !backend_contract_violations(bypass).is_empty(),
                "mutation {index} went undetected"
            );
        }
    }

    #[test]
    fn no_other_vault_source_reaches_a_platform_backend() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut pending = vec![src.clone()];
        let mut scanned = 0;
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).expect("read vault src dir") {
                let path = entry.expect("vault src entry").path();
                if path.is_dir() {
                    if path != src.join("platform") {
                        pending.push(path);
                    }
                    continue;
                }
                let is_rust = path.extension().and_then(|ext| ext.to_str()) == Some("rs");
                if !is_rust || path == src.join("keychain.rs") {
                    continue;
                }
                let source = std::fs::read_to_string(&path).expect("read vault source");
                assert_eq!(
                    first_backend_reference(&strip_line_comments(&source)),
                    None,
                    "{} reaches a keychain back-end directly; call sorng_vault::keychain instead",
                    path.display()
                );
                scanned += 1;
            }
        }
        assert!(scanned >= 3, "scanned only {scanned} vault sources");
        assert!(first_backend_reference("crate::platform::linux::read_secret(s, a)").is_some());
        assert!(first_backend_reference("sorng_vault_windows::count_entries(s)").is_some());
    }
}
