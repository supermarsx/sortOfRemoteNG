//! PAM module discovery — list installed modules, inspect, find usage.

use crate::client;
use crate::error::PamError;
use crate::types::{PamHost, PamModuleInfo};
use log::debug;

/// Well-known PAM module descriptions.
fn known_module_description(name: &str) -> &str {
    match name {
        "pam_unix.so" => "Standard Unix authentication (password, shadow)",
        "pam_permit.so" => "Always permit access (use with caution)",
        "pam_deny.so" => "Always deny access",
        "pam_env.so" => "Set/unset environment variables",
        "pam_faildelay.so" => "Set delay on authentication failure",
        "pam_limits.so" => "Set resource limits from limits.conf",
        "pam_securetty.so" => "Restrict root login to secure TTYs",
        "pam_nologin.so" => "Prevent non-root login when /etc/nologin exists",
        "pam_wheel.so" => "Restrict su access to wheel group",
        "pam_cracklib.so" => "Password strength checking via cracklib",
        "pam_pwquality.so" => "Password quality checking (replacement for pam_cracklib)",
        "pam_tally2.so" => "Login counter / account lockout",
        "pam_faillock.so" => "Account lockout (replaces pam_tally2)",
        "pam_access.so" => "Access control based on login name/host/tty",
        "pam_time.so" => "Time-based access control",
        "pam_motd.so" => "Display message of the day",
        "pam_mail.so" => "Check for new mail on login",
        "pam_lastlog.so" => "Display last login information",
        "pam_loginuid.so" => "Set loginuid process attribute",
        "pam_namespace.so" => "Polyinstantiated directory isolation",
        "pam_selinux.so" => "SELinux context management",
        "pam_sepermit.so" => "SELinux permit/deny based on user mapping",
        "pam_systemd.so" => "Systemd login session registration",
        "pam_keyinit.so" => "Kernel session keyring management",
        "pam_mkhomedir.so" => "Create home directory on first login",
        "pam_umask.so" => "Set file mode creation mask",
        "pam_succeed_if.so" => "Conditional test (uid, gid, shell, etc.)",
        "pam_listfile.so" => "Allow/deny based on a list file",
        "pam_cap.so" => "Set inheritable capabilities",
        "pam_ftp.so" => "Anonymous FTP authentication",
        "pam_ldap.so" => "LDAP authentication",
        "pam_sss.so" => "SSSD authentication (LDAP/Kerberos/AD)",
        "pam_winbind.so" => "Samba Winbind authentication (Active Directory)",
        "pam_krb5.so" => "Kerberos 5 authentication",
        "pam_google_authenticator.so" => "Google Authenticator TOTP/HOTP two-factor",
        "pam_oath.so" => "OATH one-time password authentication",
        "pam_duo.so" => "Duo Security two-factor authentication",
        "pam_u2f.so" => "Universal 2nd Factor (U2F/FIDO) authentication",
        "pam_ecryptfs.so" => "eCryptfs home directory encryption",
        "pam_fprintd.so" => "Fingerprint authentication via fprintd",
        "pam_gnome_keyring.so" => "GNOME Keyring unlock on login",
        "pam_kwallet5.so" => "KDE Wallet unlock on login",
        "pam_script.so" => "Execute scripts during PAM operations",
        "pam_exec.so" => "Execute an external command",
        "pam_debug.so" => "PAM debugging helper",
        "pam_rhosts.so" => "Network authentication via .rhosts",
        "pam_rootok.so" => "Authenticate if UID is 0 (root)",
        "pam_shells.so" => "Check that login shell is listed in /etc/shells",
        "pam_xauth.so" => "Forward X authentication cookies across su/sudo",
        "pam_tty_audit.so" => "TTY input audit logging",
        _ => "PAM module",
    }
}

/// Standard paths where PAM modules are installed.
const MODULE_SEARCH_PATHS: &[&str] = &[
    "/lib/security",
    "/lib64/security",
    "/lib/x86_64-linux-gnu/security",
    "/usr/lib/security",
    "/usr/lib64/security",
    "/usr/lib/x86_64-linux-gnu/security",
    "/usr/lib/aarch64-linux-gnu/security",
];

/// List all available PAM modules on the host.
pub async fn list_available_modules(host: &PamHost) -> Result<Vec<PamModuleInfo>, PamError> {
    let mut modules = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for search_path in MODULE_SEARCH_PATHS {
        if !client::dir_exists(host, search_path).await.unwrap_or(false) {
            continue;
        }

        let files = match client::list_dir(host, search_path).await {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file_name in &files {
            if !file_name.ends_with(".so") {
                continue;
            }
            if seen.contains(file_name) {
                continue;
            }
            seen.insert(file_name.clone());

            let full_path = format!("{}/{}", search_path, file_name);
            modules.push(PamModuleInfo {
                name: file_name.clone(),
                path: full_path,
                description: known_module_description(file_name).to_string(),
                available: true,
            });
        }
    }

    modules.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(modules)
}

/// Get information about a specific PAM module.
pub async fn get_module_info(host: &PamHost, module_name: &str) -> Result<PamModuleInfo, PamError> {
    let name = if module_name.ends_with(".so") {
        module_name.to_string()
    } else {
        format!("{}.so", module_name)
    };

    for search_path in MODULE_SEARCH_PATHS {
        let full_path = format!("{}/{}", search_path, name);
        if client::file_exists(host, &full_path).await.unwrap_or(false) {
            return Ok(PamModuleInfo {
                name: name.clone(),
                path: full_path,
                description: known_module_description(&name).to_string(),
                available: true,
            });
        }
    }

    Err(PamError::ModuleNotFound(name))
}

/// Check if a PAM module exists on the host (by path or name).
pub async fn check_module_exists(host: &PamHost, module_path: &str) -> Result<bool, PamError> {
    // If it's an absolute path, check directly
    if module_path.starts_with('/') {
        return client::file_exists(host, module_path).await;
    }

    // Otherwise search standard paths
    let name = if module_path.ends_with(".so") {
        module_path.to_string()
    } else {
        format!("{}.so", module_path)
    };

    for search_path in MODULE_SEARCH_PATHS {
        let full_path = format!("{}/{}", search_path, name);
        if client::file_exists(host, &full_path).await.unwrap_or(false) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Find which PAM services reference a given module name.
pub async fn find_module_users(host: &PamHost, module_name: &str) -> Result<Vec<String>, PamError> {
    let name = if module_name.ends_with(".so") {
        module_name.to_string()
    } else {
        format!("{}.so", module_name)
    };

    // Use grep on /etc/pam.d/ for efficiency
    let cmd = format!(
        "grep -rl '{}' /etc/pam.d/ 2>/dev/null | xargs -I{{}} basename {{}}",
        name
    );
    let (stdout, _, _) = client::exec(host, "sh", &["-c", &cmd]).await?;

    let mut services: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();
    services.sort();
    services.dedup();
    debug!("Module {} used by: {:?}", name, services);
    Ok(services)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_module_descriptions() {
        assert_eq!(
            known_module_description("pam_unix.so"),
            "Standard Unix authentication (password, shadow)"
        );
        assert_eq!(known_module_description("pam_unknown_xyz.so"), "PAM module");
    }
}
