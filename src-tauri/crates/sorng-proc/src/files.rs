//! Open files and sockets — lsof, /proc/pid/fd, ss parsing.

use crate::client;
use crate::error::ProcError;
use crate::types::*;

/// List open files for a single process via /proc/pid/fd and fallback to lsof.
pub async fn list_open_files(host: &ProcHost, pid: u32) -> Result<Vec<OpenFile>, ProcError> {
    // Try /proc/pid/fd first (no extra tools required).
    let cmd = format!(
        "ls -la /proc/{pid}/fd/ 2>/dev/null | tail -n +2"
    );
    let (stdout, _, exit_code) = client::exec_shell(host, &cmd).await?;
    if exit_code == 0 && !stdout.trim().is_empty() {
        return Ok(parse_proc_fd_listing(&stdout));
    }
    // Fallback: lsof -p
    let pid_s = pid.to_string();
    let stdout = client::exec_ok(host, "lsof", &["-p", &pid_s, "-F", "ftDn"]).await?;
    Ok(parse_lsof_fields(&stdout))
}

/// List all open files on the system via lsof.
pub async fn list_all_open_files(host: &ProcHost) -> Result<Vec<OpenFile>, ProcError> {
    let stdout = client::exec_ok(host, "lsof", &["-F", "ftDn"]).await?;
    Ok(parse_lsof_fields(&stdout))
}

/// List all sockets via `ss -tulnp`.
pub async fn list_sockets(host: &ProcHost) -> Result<Vec<SocketInfo>, ProcError> {
    let stdout = client::exec_ok(host, "ss", &["-tulnp"]).await?;
    Ok(parse_ss_output(&stdout))
}

/// List sockets belonging to a specific process.
pub async fn list_process_sockets(host: &ProcHost, pid: u32) -> Result<Vec<SocketInfo>, ProcError> {
    let all = list_sockets(host).await?;
    Ok(all.into_iter().filter(|s| s.pid == Some(pid)).collect())
}

/// List listening ports only via `ss -tlnp`.
pub async fn list_listening_ports(host: &ProcHost) -> Result<Vec<SocketInfo>, ProcError> {
    let stdout = client::exec_ok(host, "ss", &["-tlnp"]).await?;
    Ok(parse_ss_output(&stdout))
}

/// Find open files matching a name pattern via `lsof`.
pub async fn find_files_by_name(host: &ProcHost, pattern: &str) -> Result<Vec<OpenFile>, ProcError> {
    let stdout = client::exec_ok(host, "lsof", &["-F", "ftDn", pattern]).await?;
    Ok(parse_lsof_fields(&stdout))
}

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse `ls -la /proc/<pid>/fd/` output.
/// Each line: lrwx------ 1 root root 64 Jan  2 08:00 0 -> /dev/null
fn parse_proc_fd_listing(output: &str) -> Vec<OpenFile> {
    let mut files = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // The arrow separates the fd symlink from its target.
        let (left, target) = match line.split_once(" -> ") {
            Some((l, r)) => (l.trim(), r.trim().to_string()),
            None => continue,
        };

        let left_tokens: Vec<&str> = left.split_whitespace().collect();
        if left_tokens.is_empty() {
            continue;
        }
        // fd number is the last token before " -> "
        let fd_str = left_tokens.last().unwrap_or(&"").to_string();
        let perms = left_tokens.first().unwrap_or(&"");
        let mode = extract_fd_mode(perms);
        let file_type = classify_target(&target);

        files.push(OpenFile {
            fd: fd_str,
            file_type,
            path: target,
            mode,
        });
    }
    files
}

/// Classify a /proc/pid/fd target path into a FileType.
fn classify_target(path: &str) -> FileType {
    if path.starts_with("socket:") {
        FileType::Socket
    } else if path.starts_with("pipe:") {
        FileType::Pipe
    } else if path.starts_with("anon_inode:") {
        FileType::AnonInode
    } else if path.starts_with("/dev/") {
        FileType::Device
    } else if path.ends_with('/') {
        FileType::Directory
    } else if path.starts_with('/') {
        FileType::Regular
    } else {
        FileType::Unknown
    }
}

/// Extract simplified mode string from permission chars (e.g. "lrwx------" -> "rwx").
fn extract_fd_mode(perms: &str) -> String {
    if perms.len() < 4 {
        return String::new();
    }
    // Skip first char (type indicator) and take owner bits.
    perms[1..4].to_string()
}

/// Parse lsof `-F ftDn` field output.
/// Lines start with a field-identifier char: f=fd, t=type, D=device, n=name, p=pid.
fn parse_lsof_fields(output: &str) -> Vec<OpenFile> {
    let mut files = Vec::new();
    let mut fd = String::new();
    let mut ftype = String::new();
    let mut name = String::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (tag, value) = line.split_at(1);
        match tag {
            "p" => {
                // New process — flush previous file if any.
                flush_lsof_file(&mut files, &fd, &ftype, &name);
                fd.clear();
                ftype.clear();
                name.clear();
            }
            "f" => {
                // New file descriptor — flush previous.
                flush_lsof_file(&mut files, &fd, &ftype, &name);
                fd = value.to_string();
                ftype.clear();
                name.clear();
            }
            "t" => ftype = value.to_string(),
            "n" => name = value.to_string(),
            _ => {}
        }
    }
    flush_lsof_file(&mut files, &fd, &ftype, &name);
    files
}

fn flush_lsof_file(
    files: &mut Vec<OpenFile>,
    fd: &str,
    ftype: &str,
    name: &str,
) {
    if fd.is_empty() && name.is_empty() {
        return;
    }
    let file_type = match ftype {
        "REG" | "VREG" => FileType::Regular,
        "DIR" | "VDIR" => FileType::Directory,
        "IPv4" | "IPv6" | "sock" | "unix" => FileType::Socket,
        "FIFO" | "PIPE" => FileType::Pipe,
        "CHR" | "BLK" => FileType::Device,
        "a_inode" => FileType::AnonInode,
        _ => FileType::Unknown,
    };
    files.push(OpenFile {
        fd: fd.to_string(),
        file_type,
        path: name.to_string(),
        mode: String::new(),
    });
}

/// Parse `ss -tulnp` output into SocketInfo records.
/// Header: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
fn parse_ss_output(output: &str) -> Vec<SocketInfo> {
    let mut sockets = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Netid") || line.starts_with("State") {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        // Expect at least 6 fields: netid state recv-q send-q local peer [process]
        if tokens.len() < 6 {
            continue;
        }
        let protocol = match tokens[0] {
            "tcp" => SocketProtocol::Tcp,
            "udp" => SocketProtocol::Udp,
            "tcp6" | "tcpv6" => SocketProtocol::Tcp6,
            "udp6" | "udpv6" => SocketProtocol::Udp6,
            "u_str" | "u_dgr" | "u_seq" => SocketProtocol::Unix,
            _ => continue,
        };
        let state = tokens[1].to_string();
        let local_addr = tokens[4].to_string();
        let remote_addr = tokens[5].to_string();

        let (pid, program) = if tokens.len() > 6 {
            parse_ss_process_field(&tokens[6..].join(" "))
        } else {
            (None, String::new())
        };

        sockets.push(SocketInfo {
            protocol,
            local_addr,
            remote_addr,
            state,
            pid,
            program,
        });
    }
    sockets
}

/// Parse ss process field like `users:(("sshd",pid=1234,fd=3))`.
fn parse_ss_process_field(field: &str) -> (Option<u32>, String) {
    let mut pid = None;
    let mut program = String::new();

    // Extract program name in (("name",...))
    if let Some(start) = field.find("((\"") {
        if let Some(end) = field[start + 3..].find('"') {
            program = field[start + 3..start + 3 + end].to_string();
        }
    }
    // Extract pid=N
    if let Some(start) = field.find("pid=") {
        let rest = &field[start + 4..];
        let num_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        pid = rest[..num_end].parse().ok();
    }

    (pid, program)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_proc_fd_listing() {
        let output = "\
lrwx------ 1 root root 64 Jan  2 08:00 0 -> /dev/null
lrwx------ 1 root root 64 Jan  2 08:00 1 -> /dev/pts/0
lr-x------ 1 root root 64 Jan  2 08:00 3 -> /etc/passwd
l-wx------ 1 root root 64 Jan  2 08:00 4 -> pipe:[12345]
lrwx------ 1 root root 64 Jan  2 08:00 5 -> socket:[67890]
lrwx------ 1 root root 64 Jan  2 08:00 6 -> anon_inode:[eventpoll]
";
        let files = parse_proc_fd_listing(output);
        assert_eq!(files.len(), 6);

        assert_eq!(files[0].fd, "0");
        assert_eq!(files[0].file_type, FileType::Device);
        assert_eq!(files[0].path, "/dev/null");

        assert_eq!(files[2].fd, "3");
        assert_eq!(files[2].file_type, FileType::Regular);

        assert_eq!(files[3].fd, "4");
        assert_eq!(files[3].file_type, FileType::Pipe);

        assert_eq!(files[4].fd, "5");
        assert_eq!(files[4].file_type, FileType::Socket);

        assert_eq!(files[5].file_type, FileType::AnonInode);
    }

    #[test]
    fn test_parse_lsof_fields() {
        let output = "\
p1234
f0
tCHR
n/dev/null
f3
tREG
n/etc/passwd
f5
tIPv4
n*:22
";
        let files = parse_lsof_fields(output);
        assert_eq!(files.len(), 3);

        assert_eq!(files[0].fd, "0");
        assert_eq!(files[0].file_type, FileType::Device);

        assert_eq!(files[1].fd, "3");
        assert_eq!(files[1].file_type, FileType::Regular);
        assert_eq!(files[1].path, "/etc/passwd");

        assert_eq!(files[2].fd, "5");
        assert_eq!(files[2].file_type, FileType::Socket);
    }

    #[test]
    fn test_parse_ss_output() {
        let output = "\
Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process
tcp   LISTEN 0      128    0.0.0.0:22           0.0.0.0:*          users:((\"sshd\",pid=1234,fd=3))
tcp   LISTEN 0      511    0.0.0.0:80           0.0.0.0:*          users:((\"nginx\",pid=5678,fd=6))
udp   UNCONN 0      0      127.0.0.53%lo:53     0.0.0.0:*          users:((\"systemd-resolve\",pid=890,fd=12))
";
        let sockets = parse_ss_output(output);
        assert_eq!(sockets.len(), 3);

        assert_eq!(sockets[0].protocol, SocketProtocol::Tcp);
        assert_eq!(sockets[0].state, "LISTEN");
        assert_eq!(sockets[0].local_addr, "0.0.0.0:22");
        assert_eq!(sockets[0].pid, Some(1234));
        assert_eq!(sockets[0].program, "sshd");

        assert_eq!(sockets[1].pid, Some(5678));
        assert_eq!(sockets[1].program, "nginx");

        assert_eq!(sockets[2].protocol, SocketProtocol::Udp);
        assert_eq!(sockets[2].pid, Some(890));
    }

    #[test]
    fn test_parse_ss_process_field() {
        let (pid, prog) = parse_ss_process_field("users:((\"sshd\",pid=1234,fd=3))");
        assert_eq!(pid, Some(1234));
        assert_eq!(prog, "sshd");

        let (pid2, prog2) = parse_ss_process_field("");
        assert_eq!(pid2, None);
        assert_eq!(prog2, "");
    }

    #[test]
    fn test_classify_target() {
        assert_eq!(classify_target("socket:[12345]"), FileType::Socket);
        assert_eq!(classify_target("pipe:[12345]"), FileType::Pipe);
        assert_eq!(classify_target("anon_inode:[eventpoll]"), FileType::AnonInode);
        assert_eq!(classify_target("/dev/null"), FileType::Device);
        assert_eq!(classify_target("/etc/passwd"), FileType::Regular);
        assert_eq!(classify_target("/tmp/"), FileType::Directory);
    }
}
