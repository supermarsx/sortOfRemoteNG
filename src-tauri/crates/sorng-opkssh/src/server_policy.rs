//! # opkssh Server Policy Management
//!
//! Manage `/etc/opk/providers`, `/etc/opk/auth_id`, and `~/.opk/auth_id`
//! on remote servers via SSH command execution.

use crate::types::*;

/// Build a shell script to read the server's opkssh configuration.
pub fn build_read_config_script() -> String {
    r##"echo "===OPKSSH_CONFIG_BEGIN==="
echo "===VERSION_BEGIN==="
if command -v opkssh >/dev/null 2>&1; then
    opkssh --version 2>&1 || echo "unknown"
    echo "installed:true"
else
    echo "installed:false"
fi
echo "===VERSION_END==="
echo "===PROVIDERS_BEGIN==="
if [ -f /etc/opk/providers ]; then
    cat /etc/opk/providers
else
    echo "# file not found"
fi
echo "===PROVIDERS_END==="
echo "===GLOBAL_AUTH_ID_BEGIN==="
if [ -f /etc/opk/auth_id ]; then
    cat /etc/opk/auth_id
else
    echo "# file not found"
fi
echo "===GLOBAL_AUTH_ID_END==="
echo "===USER_AUTH_ID_BEGIN==="
if [ -f ~/.opk/auth_id ]; then
    cat ~/.opk/auth_id
else
    echo "# file not found"
fi
echo "===USER_AUTH_ID_END==="
echo "===SSHD_CONFIG_BEGIN==="
if [ -f /etc/ssh/sshd_config ]; then
    grep -i "AuthorizedKeysCommand\|opkssh\|opksshuser" /etc/ssh/sshd_config 2>/dev/null || echo "# no opkssh entries"
else
    echo "# sshd_config not found"
fi
echo "===SSHD_CONFIG_END==="
echo "===OPKSSH_CONFIG_END==="
"##
    .to_string()
}

/// Parse the server config output.
pub fn parse_server_config(raw: &str) -> ServerOpksshConfig {
    let extract = |begin: &str, end: &str| -> String {
        let start = raw.find(begin).map(|i| i + begin.len()).unwrap_or(0);
        let stop = raw.find(end).unwrap_or(raw.len());
        if start < stop {
            raw[start..stop].trim().to_string()
        } else {
            String::new()
        }
    };

    let version_section = extract("===VERSION_BEGIN===", "===VERSION_END===");
    let installed = version_section.contains("installed:true");
    let version = version_section
        .lines()
        .find(|l| !l.contains("installed:") && !l.trim().is_empty())
        .map(|l| l.trim().to_string());

    let providers_raw = extract("===PROVIDERS_BEGIN===", "===PROVIDERS_END===");
    let providers = parse_providers(&providers_raw);

    let global_auth_raw = extract("===GLOBAL_AUTH_ID_BEGIN===", "===GLOBAL_AUTH_ID_END===");
    let global_auth_ids = parse_auth_ids(&global_auth_raw);

    let user_auth_raw = extract("===USER_AUTH_ID_BEGIN===", "===USER_AUTH_ID_END===");
    let user_auth_ids = parse_auth_ids(&user_auth_raw);

    let sshd_snippet = extract("===SSHD_CONFIG_BEGIN===", "===SSHD_CONFIG_END===");
    let sshd_config_snippet = if sshd_snippet.contains("# no opkssh")
        || sshd_snippet.contains("# sshd_config not found")
    {
        None
    } else {
        Some(sshd_snippet)
    };

    ServerOpksshConfig {
        installed,
        version,
        providers,
        global_auth_ids,
        user_auth_ids,
        sshd_config_snippet,
    }
}

/// Parse `/etc/opk/providers` content.
fn parse_providers(content: &str) -> Vec<ProviderEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 3 {
            let expiration = match parts[2] {
                "12h" => ExpirationPolicy::TwelveHours,
                "24h" => ExpirationPolicy::TwentyFourHours,
                "48h" => ExpirationPolicy::FortyEightHours,
                "1week" => ExpirationPolicy::OneWeek,
                "oidc" => ExpirationPolicy::Oidc,
                "oidc-refreshed" => ExpirationPolicy::OidcRefreshed,
                _ => ExpirationPolicy::TwentyFourHours,
            };
            entries.push(ProviderEntry {
                issuer: parts[0].to_string(),
                client_id: parts[1].to_string(),
                expiration_policy: expiration,
            });
        }
    }
    entries
}

/// Parse an `auth_id` file content.
fn parse_auth_ids(content: &str) -> Vec<AuthIdEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 3 {
            entries.push(AuthIdEntry {
                principal: parts[0].to_string(),
                identity: parts[1].to_string(),
                issuer: parts[2..].join(" "),
            });
        } else if parts.len() == 2 {
            // Issuer may be implied or missing
            entries.push(AuthIdEntry {
                principal: parts[0].to_string(),
                identity: parts[1].to_string(),
                issuer: String::new(),
            });
        }
    }
    entries
}

/// Build the command to add an authorized identity on the server.
pub fn build_add_identity_command(entry: &AuthIdEntry) -> String {
    // Resolve common alias patterns
    let issuer_arg = match entry.issuer.as_str() {
        i if i.contains("accounts.google.com") => "google".to_string(),
        i if i.contains("login.microsoftonline.com") => "azure".to_string(),
        i if i.contains("gitlab.com") => "gitlab".to_string(),
        other => other.to_string(),
    };

    format!(
        "sudo opkssh add {} {} {}",
        shell_escape(&entry.principal),
        shell_escape(&entry.identity),
        shell_escape(&issuer_arg)
    )
}

/// Build the command to remove an authorized identity.
/// opkssh does not have a native remove command, so we edit the auth_id file directly.
pub fn build_remove_identity_command(entry: &AuthIdEntry, user_level: bool) -> String {
    let file = if user_level {
        "~/.opk/auth_id"
    } else {
        "/etc/opk/auth_id"
    };

    let pattern = format!(
        "{}\\s+{}\\s+{}",
        regex_escape(&entry.principal),
        regex_escape(&entry.identity),
        regex_escape(&entry.issuer)
    );

    if user_level {
        format!("sed -i '/{}/d' {}", pattern, file)
    } else {
        format!("sudo sed -i '/{}/d' {}", pattern, file)
    }
}

/// Build the command to add a provider entry to `/etc/opk/providers`.
pub fn build_add_provider_command(entry: &ProviderEntry) -> String {
    format!(
        "echo '{} {} {}' | sudo tee -a /etc/opk/providers > /dev/null",
        entry.issuer, entry.client_id, entry.expiration_policy
    )
}

/// Build the command to remove a provider entry from `/etc/opk/providers`.
pub fn build_remove_provider_command(entry: &ProviderEntry) -> String {
    let pattern = regex_escape(&entry.issuer);
    format!("sudo sed -i '/{}/d' /etc/opk/providers", pattern)
}

/// Build the server install script command.
pub fn build_install_command(opts: &ServerInstallOptions) -> String {
    if opts.use_install_script {
        r#"wget -qO- "https://raw.githubusercontent.com/openpubkey/opkssh/main/scripts/install-linux.sh" | sudo bash"#.to_string()
    } else if let Some(ref url) = opts.custom_binary_url {
        format!(
            "curl -L {} -o /tmp/opkssh && chmod +x /tmp/opkssh && sudo mv /tmp/opkssh /usr/local/bin/opkssh",
            url
        )
    } else {
        // Auto-detect architecture and download
        r#"ARCH=$(uname -m); case "$ARCH" in aarch64|arm64) URL="https://github.com/openpubkey/opkssh/releases/latest/download/opkssh-linux-arm64" ;; *) URL="https://github.com/openpubkey/opkssh/releases/latest/download/opkssh-linux-amd64" ;; esac; curl -L "$URL" -o /tmp/opkssh && chmod +x /tmp/opkssh && sudo mv /tmp/opkssh /usr/local/bin/opkssh && echo "opkssh installed successfully""#.to_string()
    }
}

/// Simple shell escaping for arguments.
fn shell_escape(s: &str) -> String {
    if s.contains(' ') || s.contains('\'') || s.contains('"') || s.contains('\\') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

/// Escape special regex characters for sed patterns.
fn regex_escape(s: &str) -> String {
    let special = [
        '/', '.', '*', '[', ']', '(', ')', '{', '}', '\\', '+', '?', '|', '^', '$',
    ];
    let mut result = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if special.contains(&c) {
            result.push('\\');
        }
        result.push(c);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_providers() {
        let content = r#"# Issuer Client-ID expiration-policy
https://accounts.google.com 206584157355-abc.apps.googleusercontent.com 24h
https://login.microsoftonline.com/9188040d/v2.0 096ce0a3 48h
"#;
        let entries = parse_providers(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].issuer, "https://accounts.google.com");
        assert_eq!(
            entries[0].expiration_policy,
            ExpirationPolicy::TwentyFourHours
        );
        assert_eq!(
            entries[1].expiration_policy,
            ExpirationPolicy::FortyEightHours
        );
    }

    #[test]
    fn test_parse_auth_ids() {
        let content = r#"# email/sub principal issuer
root alice@example.com https://accounts.google.com
dev bob@microsoft.com https://login.microsoftonline.com/tenant/v2.0
"#;
        let entries = parse_auth_ids(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].principal, "root");
        assert_eq!(entries[0].identity, "alice@example.com");
    }

    #[test]
    fn test_build_add_identity_command() {
        let entry = AuthIdEntry {
            principal: "root".into(),
            identity: "alice@gmail.com".into(),
            issuer: "https://accounts.google.com".into(),
        };
        let cmd = build_add_identity_command(&entry);
        assert_eq!(cmd, "sudo opkssh add root alice@gmail.com google");
    }

    #[test]
    fn test_parse_server_config() {
        let raw = r#"===OPKSSH_CONFIG_BEGIN===
===VERSION_BEGIN===
opkssh v0.13.0
installed:true
===VERSION_END===
===PROVIDERS_BEGIN===
https://accounts.google.com abc123 24h
===PROVIDERS_END===
===GLOBAL_AUTH_ID_BEGIN===
root alice@gmail.com https://accounts.google.com
===GLOBAL_AUTH_ID_END===
===USER_AUTH_ID_BEGIN===
# file not found
===USER_AUTH_ID_END===
===SSHD_CONFIG_BEGIN===
AuthorizedKeysCommand /usr/local/bin/opkssh verify %u %k %t
AuthorizedKeysCommandUser opksshuser
===SSHD_CONFIG_END===
===OPKSSH_CONFIG_END==="#;

        let config = parse_server_config(raw);
        assert!(config.installed);
        assert_eq!(config.version.as_deref(), Some("opkssh v0.13.0"));
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.global_auth_ids.len(), 1);
        assert!(config.user_auth_ids.is_empty());
        assert!(config.sshd_config_snippet.is_some());
    }
}
