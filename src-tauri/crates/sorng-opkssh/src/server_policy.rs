//! # opkssh Server Policy Management
//!
//! Manage `/etc/opk/providers`, `/etc/opk/auth_id`, and `~/.opk/auth_id`
//! on remote servers via SSH command execution.
//!
//! These helpers stay on the admin side of the seam. They intentionally keep
//! remote policy edits and installation in CLI fallback territory instead of
//! broadening the client login contract. The backend now renders those admin
//! commands through small `sh -c` wrappers with positional arguments where that
//! meaningfully reduces inline shell interpolation risk, but the transport is
//! still the generic SSH shell path for the first shipping version.

use crate::types::*;

enum ServerAdminAction<'a> {
    AddIdentity(&'a AuthIdEntry),
    RemoveIdentity {
        entry: &'a AuthIdEntry,
        user_level: bool,
    },
    AddProvider(&'a ProviderEntry),
    RemoveProvider(&'a ProviderEntry),
    Install(&'a ServerInstallOptions),
}

impl ServerAdminAction<'_> {
    fn render(self) -> String {
        match self {
            ServerAdminAction::AddIdentity(entry) => {
                let issuer = normalize_issuer_alias(&entry.issuer);
                render_sudo_sh_command(
                    r#"opkssh add "$1" "$2" "$3""#,
                    &[&entry.principal, &entry.identity, &issuer],
                )
            }
            ServerAdminAction::RemoveIdentity { entry, user_level } => {
                let script = if user_level {
                    r#"file="${HOME}/.opk/auth_id"
principal="$1"
identity="$2"
issuer="$3"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
awk -v principal="$principal" -v identity="$identity" -v issuer="$issuer" '
function join_from(start, out, idx) {
    out = ""
    for (idx = start; idx <= NF; idx++) {
        out = out (idx == start ? "" : OFS) $idx
    }
    return out
}
{
    if ($0 ~ /^[[:space:]]*#/ || NF == 0) {
        print
        next
    }
    if ($1 == principal && $2 == identity && (issuer == "" || join_from(3) == issuer)) {
        next
    }
    print
}
' "$file" > "$tmp" && cat "$tmp" > "$file""#
                } else {
                    r#"file="/etc/opk/auth_id"
principal="$1"
identity="$2"
issuer="$3"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
awk -v principal="$principal" -v identity="$identity" -v issuer="$issuer" '
function join_from(start, out, idx) {
    out = ""
    for (idx = start; idx <= NF; idx++) {
        out = out (idx == start ? "" : OFS) $idx
    }
    return out
}
{
    if ($0 ~ /^[[:space:]]*#/ || NF == 0) {
        print
        next
    }
    if ($1 == principal && $2 == identity && (issuer == "" || join_from(3) == issuer)) {
        next
    }
    print
}
' "$file" > "$tmp" && cat "$tmp" > "$file""#
                };
                let args = [
                    entry.principal.as_str(),
                    entry.identity.as_str(),
                    entry.issuer.as_str(),
                ];
                if user_level {
                    render_sh_command(script, &args)
                } else {
                    render_sudo_sh_command(script, &args)
                }
            }
            ServerAdminAction::AddProvider(entry) => {
                let line = render_provider_line(entry);
                render_sudo_sh_command(
                    r#"printf '%s\n' "$1" >> /etc/opk/providers"#,
                    &[&line],
                )
            }
            ServerAdminAction::RemoveProvider(entry) => {
                let line = render_provider_line(entry);
                render_sudo_sh_command(
                    r#"line="$1"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
awk -v line="$line" '$0 != line { print }' /etc/opk/providers > "$tmp" && cat "$tmp" > /etc/opk/providers"#,
                    &[&line],
                )
            }
            ServerAdminAction::Install(opts) => build_install_command_inner(opts),
        }
    }
}

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
        let Some(start_index) = raw.find(begin).map(|index| index + begin.len()) else {
            return String::new();
        };
        let Some(stop_offset) = raw[start_index..].find(end) else {
            return String::new();
        };
        raw[start_index..start_index + stop_offset].trim().to_string()
    };

    let version_section = extract("===VERSION_BEGIN===", "===VERSION_END===");
    let installed = version_section.contains("installed:true");
    let version = version_section
        .lines()
        .find(|line| !line.contains("installed:") && !line.trim().is_empty())
        .map(|line| line.trim().to_string());

    let providers_raw = extract("===PROVIDERS_BEGIN===", "===PROVIDERS_END===");
    let providers = parse_providers(&providers_raw);

    let global_auth_raw = extract("===GLOBAL_AUTH_ID_BEGIN===", "===GLOBAL_AUTH_ID_END===");
    let global_auth_ids = parse_auth_ids(&global_auth_raw);

    let user_auth_raw = extract("===USER_AUTH_ID_BEGIN===", "===USER_AUTH_ID_END===");
    let user_auth_ids = parse_auth_ids(&user_auth_raw);

    let sshd_snippet = extract("===SSHD_CONFIG_BEGIN===", "===SSHD_CONFIG_END===");
    let sshd_config_snippet = if sshd_snippet.contains("# no opkssh")
        || sshd_snippet.contains("# sshd_config not found")
        || sshd_snippet.trim().is_empty()
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
            entries.push(ProviderEntry {
                issuer: parts[0].to_string(),
                client_id: parts[1].to_string(),
                expiration_policy: parse_expiration_policy(parts[2]),
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
    ServerAdminAction::AddIdentity(entry).render()
}

/// Build the command to remove an authorized identity.
/// opkssh does not have a native remove command, so we edit the auth_id file directly.
pub fn build_remove_identity_command(entry: &AuthIdEntry, user_level: bool) -> String {
    ServerAdminAction::RemoveIdentity { entry, user_level }.render()
}

/// Build the command to add a provider entry to `/etc/opk/providers`.
pub fn build_add_provider_command(entry: &ProviderEntry) -> String {
    ServerAdminAction::AddProvider(entry).render()
}

/// Build the command to remove a provider entry from `/etc/opk/providers`.
pub fn build_remove_provider_command(entry: &ProviderEntry) -> String {
    ServerAdminAction::RemoveProvider(entry).render()
}

/// Build the server install script command.
pub fn build_install_command(opts: &ServerInstallOptions) -> String {
    ServerAdminAction::Install(opts).render()
}

fn parse_expiration_policy(value: &str) -> ExpirationPolicy {
    match value {
        "12h" => ExpirationPolicy::TwelveHours,
        "24h" => ExpirationPolicy::TwentyFourHours,
        "48h" => ExpirationPolicy::FortyEightHours,
        "1week" => ExpirationPolicy::OneWeek,
        "oidc" => ExpirationPolicy::Oidc,
        "oidc-refreshed" => ExpirationPolicy::OidcRefreshed,
        _ => ExpirationPolicy::TwentyFourHours,
    }
}

fn normalize_issuer_alias(issuer: &str) -> String {
    match issuer {
        value if value.contains("accounts.google.com") => "google".to_string(),
        value if value.contains("login.microsoftonline.com") => "azure".to_string(),
        value if value.contains("gitlab.com") => "gitlab".to_string(),
        other => other.to_string(),
    }
}

fn render_provider_line(entry: &ProviderEntry) -> String {
    format!(
        "{} {} {}",
        entry.issuer, entry.client_id, entry.expiration_policy
    )
}

fn build_install_command_inner(opts: &ServerInstallOptions) -> String {
    if opts.use_install_script {
        r#"wget -qO- "https://raw.githubusercontent.com/openpubkey/opkssh/main/scripts/install-linux.sh" | sudo bash"#
            .to_string()
    } else if let Some(url) = opts.custom_binary_url.as_ref().filter(|url| !url.trim().is_empty()) {
        render_sh_command(
            r#"curl -L "$1" -o /tmp/opkssh && chmod +x /tmp/opkssh && sudo mv /tmp/opkssh /usr/local/bin/opkssh"#,
            &[url],
        )
    } else {
        r#"ARCH=$(uname -m); case "$ARCH" in aarch64|arm64) URL="https://github.com/openpubkey/opkssh/releases/latest/download/opkssh-linux-arm64" ;; *) URL="https://github.com/openpubkey/opkssh/releases/latest/download/opkssh-linux-amd64" ;; esac; curl -L "$URL" -o /tmp/opkssh && chmod +x /tmp/opkssh && sudo mv /tmp/opkssh /usr/local/bin/opkssh && echo "opkssh installed successfully""#.to_string()
    }
}

fn render_sh_command(script: &str, args: &[&str]) -> String {
    render_shell_command(None, script, args)
}

fn render_sudo_sh_command(script: &str, args: &[&str]) -> String {
    render_shell_command(Some("sudo"), script, args)
}

fn render_shell_command(prefix: Option<&str>, script: &str, args: &[&str]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 4 + usize::from(prefix.is_some()));
    if let Some(prefix) = prefix {
        parts.push(prefix.to_string());
    }
    parts.push("sh".to_string());
    parts.push("-c".to_string());
    parts.push(shell_escape(script));
    parts.push("sh".to_string());
    for arg in args {
        parts.push(shell_escape(arg));
    }
    parts.join(" ")
}

/// Simple shell escaping for arguments.
fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    if value.chars().all(is_shell_safe_char) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn is_shell_safe_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(character, '_' | '-' | '/' | '.' | ':' | '@' | '%' | '+' | '=' | ',')
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
        assert!(cmd.starts_with("sudo sh -c "));
        assert!(cmd.contains("opkssh add \"$1\" \"$2\" \"$3\""));
        assert!(cmd.ends_with(" sh root alice@gmail.com google"));
    }

    #[test]
    fn test_build_remove_identity_command_without_explicit_issuer() {
        let entry = AuthIdEntry {
            principal: "root".into(),
            identity: "alice@gmail.com".into(),
            issuer: String::new(),
        };

        let cmd = build_remove_identity_command(&entry, true);
        assert!(cmd.starts_with("sh -c "));
        assert!(cmd.contains("${HOME}/.opk/auth_id"));
        assert!(cmd.contains("awk -v principal="));
        assert!(cmd.contains("cat \"$tmp\" > \"$file\""));
        assert!(cmd.ends_with(" sh root alice@gmail.com ''"));
    }

    #[test]
    fn test_build_add_provider_command_uses_literal_line_argument() {
        let entry = ProviderEntry {
            issuer: "https://accounts.google.com".into(),
            client_id: "abc123".into(),
            expiration_policy: ExpirationPolicy::TwentyFourHours,
        };

        let cmd = build_add_provider_command(&entry);
        assert!(cmd.starts_with("sudo sh -c "));
        assert!(cmd.contains("/etc/opk/providers"));
        assert!(cmd.contains("$1"));
        assert!(cmd.ends_with(" sh 'https://accounts.google.com abc123 24h'"));
    }

    #[test]
    fn test_build_remove_provider_command_matches_full_line_literally() {
        let entry = ProviderEntry {
            issuer: "https://accounts.google.com".into(),
            client_id: "abc123".into(),
            expiration_policy: ExpirationPolicy::TwentyFourHours,
        };

        let cmd = build_remove_provider_command(&entry);
        assert!(cmd.starts_with("sudo sh -c "));
        assert!(cmd.contains("awk -v line=\"$line\""));
        assert!(cmd.contains("/etc/opk/providers"));
        assert!(cmd.ends_with(" sh 'https://accounts.google.com abc123 24h'"));
    }

    #[test]
    fn test_build_install_command_uses_positional_url_argument() {
        let cmd = build_install_command(&ServerInstallOptions {
            session_id: String::new(),
            use_install_script: false,
            custom_binary_url: Some("https://example.com/opkssh binary".into()),
        });

        assert!(cmd.starts_with("sh -c "));
        assert!(cmd.contains("curl -L \"$1\" -o /tmp/opkssh"));
        assert!(cmd.ends_with(" sh 'https://example.com/opkssh binary'"));
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
