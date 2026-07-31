use crate::error::LdapError;
use crate::types::{LdapHost, SshAuth, SshConfig};
use sorng_ssh::ssh::integration::{
    output_bounded_with_input, BoundedCommandExt, ExternalSshConfig, IntegrationSshSession,
};
use tokio::process::Command;

const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_REMOTE_COMMAND_BYTES: usize = 256 * 1024;
const MAX_IDENTITY_BYTES: usize = 1024;
const MAX_KEY_PATH_BYTES: usize = 32 * 1024;
const MAX_PASSWORD_BYTES: usize = 64 * 1024;
const MAX_STDIN_BYTES: usize = 8 * 1024 * 1024;
const LDAP_PASSWORD_WRAPPER: &str = "umask 077; d=$(mktemp -d) || exit 125; \
cleanup() { rm -rf \"$d\"; }; trap cleanup EXIT; \
trap 'cleanup; exit 130' HUP INT TERM; \
IFS= read -r pw || exit 125; printf '%s' \"$pw\" >\"$d/password\" || exit 125; \
unset pw; program=$1; shift; \"$program\" -y \"$d/password\" \"$@\"";

/// Shell-quote a string for safe embedding in a POSIX shell command.
/// Wraps in single quotes and escapes embedded single quotes.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

pub async fn exec(
    host: &LdapHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), LdapError> {
    if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await
    } else {
        Ok(collect_output(
            exec_local(host.use_sudo, program, args, None).await?,
        ))
    }
}

pub async fn exec_with_stdin(
    host: &LdapHost,
    program: &str,
    args: &[&str],
    stdin_data: &[u8],
) -> Result<(String, String, i32), LdapError> {
    if stdin_data.len() > MAX_STDIN_BYTES {
        return Err(LdapError::SshError(
            "Command input exceeds the 8 MiB limit".to_string(),
        ));
    }
    if let Some(ssh) = &host.ssh {
        return exec_remote_with_stdin(ssh, host.use_sudo, program, args, stdin_data).await;
    }
    Ok(collect_output(
        exec_local(host.use_sudo, program, args, Some(stdin_data)).await?,
    ))
}

pub async fn exec_ldap_ok(
    host: &LdapHost,
    program: &str,
    args: &[&str],
    stdin_data: Option<&[u8]>,
) -> Result<String, LdapError> {
    let Some(password) = host.bind_password.as_deref() else {
        return match stdin_data {
            Some(data) => exec_ok_with_stdin(host, program, args, data).await,
            None => exec_ok(host, program, args).await,
        };
    };
    if password.len() > MAX_PASSWORD_BYTES
        || password
            .as_bytes()
            .iter()
            .any(|byte| matches!(*byte, b'\0' | b'\r' | b'\n'))
    {
        return Err(LdapError::SshError(
            "LDAP bind passwords containing NUL or line breaks, or exceeding 64 KiB, are unavailable through the protected transport".to_string(),
        ));
    }

    let data_len = stdin_data.map_or(0, |data| data.len());
    if password.len().saturating_add(1).saturating_add(data_len) > MAX_STDIN_BYTES {
        return Err(LdapError::SshError(
            "LDAP password and operation input exceed the 8 MiB limit".to_string(),
        ));
    }

    let mut payload = Vec::with_capacity(password.len() + 1 + data_len);
    payload.extend_from_slice(password.as_bytes());
    payload.push(b'\n');
    if let Some(data) = stdin_data {
        payload.extend_from_slice(data);
    }
    let mut wrapper_args = Vec::with_capacity(args.len() + 4);
    wrapper_args.extend(["-c", LDAP_PASSWORD_WRAPPER, "sorng-ldap-bind", program]);
    wrapper_args.extend_from_slice(args);
    let result = exec_ok_with_stdin(host, "sh", &wrapper_args, &payload).await;
    payload.fill(0);
    result
}

pub async fn exec_ok(host: &LdapHost, program: &str, args: &[&str]) -> Result<String, LdapError> {
    let (stdout, stderr, code) = exec(host, program, args).await?;
    if code != 0 {
        return Err(LdapError::CommandFailed {
            command: program.to_string(),
            exit_code: code,
            stderr,
        });
    }
    Ok(stdout)
}

pub async fn exec_ok_with_stdin(
    host: &LdapHost,
    program: &str,
    args: &[&str],
    stdin_data: &[u8],
) -> Result<String, LdapError> {
    let (stdout, stderr, code) = exec_with_stdin(host, program, args, stdin_data).await?;
    if code != 0 {
        return Err(LdapError::CommandFailed {
            command: program.to_string(),
            exit_code: code,
            stderr,
        });
    }
    Ok(stdout)
}

pub async fn read_file(host: &LdapHost, path: &str) -> Result<String, LdapError> {
    exec_ok(host, "cat", &[path]).await
}

async fn exec_local(
    sudo: bool,
    prog: &str,
    args: &[&str],
    stdin_data: Option<&[u8]>,
) -> Result<std::process::Output, LdapError> {
    let mut cmd = if sudo {
        let mut c = Command::new("sudo");
        c.args(["-n", "--", prog]).args(args);
        c
    } else {
        let mut c = Command::new(prog);
        c.args(args);
        c
    };

    if let Some(data) = stdin_data {
        Ok(output_bounded_with_input(&mut cmd, data).await?)
    } else {
        Ok(cmd.output_bounded().await?)
    }
}

async fn exec_remote(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<(String, String, i32), LdapError> {
    let remote_cmd = build_remote_command(sudo, prog, args)?;
    let (private_key, password) = ssh_credentials(ssh)?;
    let timeout_secs = ssh.timeout_secs.clamp(1, 300);
    let session = IntegrationSshSession::new(ExternalSshConfig {
        host: ssh.host.trim(),
        username: ssh.username.trim(),
        port: ssh.port,
        private_key,
        password,
        connect_timeout_secs: timeout_secs,
    });
    let result = session
        .execute(&remote_cmd, Some(timeout_secs.saturating_mul(1_000)))
        .await;
    let _ = session.disconnect().await;
    match result {
        Ok(stdout) => Ok((
            bound_text(stdout, MAX_STDOUT_BYTES, false),
            String::new(),
            0,
        )),
        Err(error) => Ok((
            String::new(),
            bound_text(error, MAX_STDERR_BYTES, false),
            -1,
        )),
    }
}

async fn exec_remote_with_stdin(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
    stdin_data: &[u8],
) -> Result<(String, String, i32), LdapError> {
    let remote_cmd = build_remote_command(sudo, prog, args)?;
    let (private_key, password) = ssh_credentials(ssh)?;
    let timeout_secs = ssh.timeout_secs.clamp(1, 300);
    let session = IntegrationSshSession::new(ExternalSshConfig {
        host: ssh.host.trim(),
        username: ssh.username.trim(),
        port: ssh.port,
        private_key,
        password,
        connect_timeout_secs: timeout_secs,
    });
    let result = session
        .execute_with_input(
            &remote_cmd,
            stdin_data.to_vec(),
            Some(timeout_secs.saturating_mul(1_000)),
        )
        .await;
    let _ = session.disconnect().await;
    match result {
        Ok(stdout) => Ok((
            bound_text(stdout, MAX_STDOUT_BYTES, false),
            String::new(),
            0,
        )),
        Err(error) => Ok((
            String::new(),
            bound_text(error, MAX_STDERR_BYTES, false),
            -1,
        )),
    }
}

fn ssh_credentials<'a>(
    ssh: &'a SshConfig,
) -> Result<(Option<&'a str>, Option<&'a str>), LdapError> {
    validate_ssh_identity(ssh)?;
    match &ssh.auth {
        SshAuth::Password { password } if password.is_empty() => Err(LdapError::SshError(
            "SSH password cannot be empty".to_string(),
        )),
        SshAuth::Password { password } if password.len() > MAX_PASSWORD_BYTES => {
            Err(LdapError::SshError("SSH password is too large".to_string()))
        }
        SshAuth::Password { password } => Ok((None, Some(password.as_str()))),
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } if passphrase.as_ref().is_some_and(|value| !value.is_empty()) => {
            Err(LdapError::SshError(
                "Encrypted SSH private keys are not supported by this integration".to_string(),
            ))
        }
        SshAuth::PrivateKey { key_path, .. } if key_path.trim().is_empty() => Err(
            LdapError::SshError("SSH private key path cannot be empty".to_string()),
        ),
        SshAuth::PrivateKey { key_path, .. } if key_path.len() > MAX_KEY_PATH_BYTES => Err(
            LdapError::SshError("SSH private key path is too large".to_string()),
        ),
        SshAuth::PrivateKey { key_path, .. } => Ok((Some(key_path.as_str()), None)),
        SshAuth::Agent => Ok((None, None)),
    }
}

fn validate_ssh_identity(ssh: &SshConfig) -> Result<(), LdapError> {
    if ssh.host.trim().is_empty() || ssh.username.trim().is_empty() {
        return Err(LdapError::SshError(
            "SSH host and username cannot be empty".to_string(),
        ));
    }
    if ssh.host.len() > MAX_IDENTITY_BYTES || ssh.username.len() > MAX_IDENTITY_BYTES {
        return Err(LdapError::SshError(
            "SSH host or username is too large".to_string(),
        ));
    }
    if ssh.port == 0 {
        return Err(LdapError::SshError(
            "SSH port must be greater than zero".to_string(),
        ));
    }
    Ok(())
}

fn build_remote_command(sudo: bool, program: &str, args: &[&str]) -> Result<String, LdapError> {
    if program.trim().is_empty()
        || program.contains('\0')
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(LdapError::SshError(
            "Remote command contains an empty program or NUL byte".to_string(),
        ));
    }
    let size = args.iter().try_fold(program.len(), |total, arg| {
        total.checked_add(arg.len().saturating_add(3))
    });
    if !matches!(size, Some(value) if value <= MAX_REMOTE_COMMAND_BYTES) {
        return Err(LdapError::SshError(
            "Remote command is too large".to_string(),
        ));
    }
    let mut words = Vec::with_capacity(args.len() + 4);
    if sudo {
        words.extend([shell_quote("sudo"), shell_quote("-n"), shell_quote("--")]);
    }
    words.push(shell_quote(program));
    words.extend(args.iter().map(|arg| shell_quote(arg)));
    Ok(words.join(" "))
}

fn collect_output(output: std::process::Output) -> (String, String, i32) {
    (
        bound_bytes(&output.stdout, MAX_STDOUT_BYTES),
        bound_bytes(&output.stderr, MAX_STDERR_BYTES),
        output.status.code().unwrap_or(-1),
    )
}

fn bound_bytes(bytes: &[u8], max_bytes: usize) -> String {
    let clipped = bytes.len() > max_bytes;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned();
    bound_text(text, max_bytes, clipped)
}

fn bound_text(mut text: String, max_bytes: usize, force_marker: bool) -> String {
    const MARKER: &str = "\n[output truncated]";
    if !force_marker && text.len() <= max_bytes {
        return text;
    }
    let mut keep = text.len().min(max_bytes.saturating_sub(MARKER.len()));
    while keep > 0 && !text.is_char_boundary(keep) {
        keep -= 1;
    }
    text.truncate(keep);
    text.push_str(MARKER);
    text
}
