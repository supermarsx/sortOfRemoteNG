use crate::error::LdapError;
use crate::types::{LdapHost, SshAuth, SshConfig};
use log::debug;
use tokio::process::Command;
pub async fn exec(
    host: &LdapHost,
    program: &str,
    args: &[&str],
) -> Result<(String, String, i32), LdapError> {
    debug!("ldap exec: {} {}", program, args.join(" "));
    let output = if let Some(ssh) = &host.ssh {
        exec_remote(ssh, host.use_sudo, program, args).await?
    } else {
        exec_local(host.use_sudo, program, args).await?
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
pub async fn read_file(host: &LdapHost, path: &str) -> Result<String, LdapError> {
    exec_ok(host, "cat", &[path]).await
}
async fn exec_local(
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<std::process::Output, LdapError> {
    Ok(if sudo {
        Command::new("sudo").arg(prog).args(args).output().await?
    } else {
        Command::new(prog).args(args).output().await?
    })
}
async fn exec_remote(
    ssh: &SshConfig,
    sudo: bool,
    prog: &str,
    args: &[&str],
) -> Result<std::process::Output, LdapError> {
    let rc = if sudo {
        format!("sudo {} {}", prog, args.join(" "))
    } else {
        format!("{} {}", prog, args.join(" "))
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
    Ok(cmd.output().await?)
}
