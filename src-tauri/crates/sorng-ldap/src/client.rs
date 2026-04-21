use crate::error::LdapError;
use crate::types::{LdapHost, SshAuth, SshConfig};
use log::debug;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Shell-quote a string for safe embedding in a POSIX shell command.
/// Wraps in single quotes and escapes embedded single quotes.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub async fn exec(
    host: &LdapHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), LdapError> {
    debug!("ldap exec: {} {}", program, args.join(" "));
    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args, None).await?
    } else {
        exec_local(host.use_sudo, program, args, None).await?
    };
    Ok((
        String::from_utf8_lossy(&output.stdout).into(),
        String::from_utf8_lossy(&output.stderr).into(),
        output.status.code().unwrap_or(-1),
    ))
}

pub async fn exec_with_stdin(
    host: &LdapHost,
    program: &str,
    args: &[&str],
    stdin_data: &[u8],
) -> Result<(String, String, i32), LdapError> {
    debug!("ldap exec (stdin): {} {}", program, args.join(" "));
    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args, Some(stdin_data)).await?
    } else {
        exec_local(host.use_sudo, program, args, Some(stdin_data)).await?
    };
    Ok((
        String::from_utf8_lossy(&output.stdout).into(),
        String::from_utf8_lossy(&output.stderr).into(),
        output.status.code().unwrap_or(-1),
    ))
}

pub async fn exec_ok(host: &LdapHost, program: &str, args: &[&str]) -> Result<String, LdapError> {
    let (stdout, stderr, code) = exec(host, program, args).await?;
    if code != 0 {
        return Err(LdapError::CommandFailed {
            command: format!("{program} {}", args.join(" ")),
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
            command: format!("{program} {}", args.join(" ")),
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
        c.arg(prog).args(args);
        c
    } else {
        let mut c = Command::new(prog);
        c.args(args);
        c
    };

    if let Some(data) = stdin_data {
        cmd.stdin(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(data).await?;
            drop(stdin);
        }
        Ok(child.wait_with_output().await?)
    } else {
        Ok(cmd.output().await?)
    }
}

async fn exec_remote(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
    stdin_data: Option<&[u8]>,
) -> Result<std::process::Output, LdapError> {
    // Build a properly quoted remote command
    let quoted_args: Vec<String> = args.iter().map(|a| shell_quote(a)).collect();
    let rc = if sudo {
        format!("sudo {} {}", shell_quote(prog), quoted_args.join(" "))
    } else {
        format!("{} {}", shell_quote(prog), quoted_args.join(" "))
    };

    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg(format!("ConnectTimeout={}", ssh.timeout_secs))
        .arg("-p")
        .arg(ssh.port.to_string());
    if let SshAuth::PrivateKey { key_path, .. } = &ssh.auth {
        cmd.arg("-i").arg(key_path);
    }
    cmd.arg(format!("{}@{}", ssh.username, ssh.host)).arg(&rc);

    if let Some(data) = stdin_data {
        cmd.stdin(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(data).await?;
            drop(stdin);
        }
        Ok(child.wait_with_output().await?)
    } else {
        Ok(cmd.output().await?)
    }
}
