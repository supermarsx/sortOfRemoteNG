//! Process control — signal sending, renice, ionice, CPU affinity.

use crate::client;
use crate::error::ProcError;
use crate::types::{ProcHost, Signal};

/// Send a signal to a single process.
pub async fn kill_process(host: &ProcHost, pid: u32, signal: Signal) -> Result<(), ProcError> {
    let sig_arg = format!("-{}", signal.number());
    let pid_s = pid.to_string();
    let (_, stderr, exit_code) = client::exec(host, "kill", &[&sig_arg, &pid_s]).await?;
    if exit_code != 0 {
        if stderr.contains("No such process") {
            return Err(ProcError::ProcessNotFound(pid));
        }
        return Err(ProcError::SignalFailed(format!(
            "kill {} PID {}: {}",
            sig_arg, pid, stderr.trim()
        )));
    }
    Ok(())
}

/// Send a signal to multiple processes.
pub async fn kill_processes(
    host: &ProcHost,
    pids: &[u32],
    signal: Signal,
) -> Result<(), ProcError> {
    if pids.is_empty() {
        return Ok(());
    }
    let sig_arg = format!("-{}", signal.number());
    let pid_strs: Vec<String> = pids.iter().map(|p| p.to_string()).collect();
    let mut args: Vec<&str> = vec![&sig_arg];
    for p in &pid_strs {
        args.push(p.as_str());
    }
    let (_, stderr, exit_code) = client::exec(host, "kill", &args).await?;
    if exit_code != 0 {
        return Err(ProcError::SignalFailed(format!(
            "kill {} PIDs {:?}: {}",
            sig_arg, pids, stderr.trim()
        )));
    }
    Ok(())
}

/// Kill all processes by name (killall).
pub async fn killall(host: &ProcHost, name: &str, signal: Signal) -> Result<(), ProcError> {
    let sig_arg = format!("-{}", signal.number());
    let (_, stderr, exit_code) =
        client::exec(host, "killall", &[&sig_arg, name]).await?;
    if exit_code != 0 {
        return Err(ProcError::SignalFailed(format!(
            "killall {} {}: {}",
            sig_arg, name, stderr.trim()
        )));
    }
    Ok(())
}

/// Kill processes by pattern (pkill).
pub async fn pkill(host: &ProcHost, pattern: &str, signal: Signal) -> Result<(), ProcError> {
    let sig_arg = format!("-{}", signal.number());
    let (_, stderr, exit_code) =
        client::exec(host, "pkill", &[&sig_arg, "-f", pattern]).await?;
    // pkill returns 1 when no processes matched, which is not an error for us.
    if exit_code != 0 && exit_code != 1 {
        return Err(ProcError::SignalFailed(format!(
            "pkill {} -f {}: {}",
            sig_arg, pattern, stderr.trim()
        )));
    }
    Ok(())
}

/// Change process scheduling priority (renice).
pub async fn renice(host: &ProcHost, pid: u32, niceness: i32) -> Result<(), ProcError> {
    let nice_s = niceness.to_string();
    let pid_s = pid.to_string();
    let (_, stderr, exit_code) =
        client::exec(host, "renice", &["-n", &nice_s, "-p", &pid_s]).await?;
    if exit_code != 0 {
        if stderr.contains("No such process") {
            return Err(ProcError::ProcessNotFound(pid));
        }
        return Err(ProcError::CommandFailed {
            command: format!("renice -n {} -p {}", niceness, pid),
            exit_code,
            stderr,
        });
    }
    Ok(())
}

/// Change process I/O scheduling class and priority.
/// class: 0=none, 1=realtime, 2=best-effort, 3=idle.
pub async fn ionice(
    host: &ProcHost,
    pid: u32,
    class: u8,
    priority: Option<u8>,
) -> Result<(), ProcError> {
    let class_s = class.to_string();
    let pid_s = pid.to_string();
    let mut args = vec!["-c", &class_s];
    let prio_s;
    if let Some(prio) = priority {
        prio_s = prio.to_string();
        args.extend_from_slice(&["-n", &prio_s]);
    }
    args.extend_from_slice(&["-p", &pid_s]);
    client::exec_ok(host, "ionice", &args).await?;
    Ok(())
}

/// Set CPU affinity for a process (taskset).
/// cpus is a list of CPU core numbers, e.g. [0, 1, 3].
pub async fn set_cpu_affinity(
    host: &ProcHost,
    pid: u32,
    cpus: &[u32],
) -> Result<(), ProcError> {
    let cpu_list = cpus
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let pid_s = pid.to_string();
    client::exec_ok(host, "taskset", &["-cp", &cpu_list, &pid_s]).await?;
    Ok(())
}

/// Get CPU affinity for a process (taskset -pc pid).
pub async fn get_cpu_affinity(host: &ProcHost, pid: u32) -> Result<Vec<u32>, ProcError> {
    let pid_s = pid.to_string();
    let stdout =
        client::exec_ok(host, "taskset", &["-pc", &pid_s]).await?;
    // Output: "pid 1234's current affinity list: 0-3" or "0,2,4"
    parse_cpu_affinity(&stdout)
}

/// Parse taskset output into a list of CPU numbers.
fn parse_cpu_affinity(output: &str) -> Result<Vec<u32>, ProcError> {
    let raw = output
        .rsplit(':')
        .next()
        .unwrap_or("")
        .trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let mut cpus = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if let Some((start, end)) = part.split_once('-') {
            let s: u32 = start.trim().parse().map_err(|_| {
                ProcError::ParseError(format!("Invalid CPU range: {part}"))
            })?;
            let e: u32 = end.trim().parse().map_err(|_| {
                ProcError::ParseError(format!("Invalid CPU range: {part}"))
            })?;
            for cpu in s..=e {
                cpus.push(cpu);
            }
        } else {
            let cpu: u32 = part.parse().map_err(|_| {
                ProcError::ParseError(format!("Invalid CPU number: {part}"))
            })?;
            cpus.push(cpu);
        }
    }
    Ok(cpus)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cpu_affinity_range() {
        let output = "pid 1234's current affinity list: 0-3";
        let cpus = parse_cpu_affinity(output).unwrap();
        assert_eq!(cpus, vec![0, 1, 2, 3]);
    }

    #[test]
    fn test_parse_cpu_affinity_list() {
        let output = "pid 5678's current affinity list: 0,2,4,6";
        let cpus = parse_cpu_affinity(output).unwrap();
        assert_eq!(cpus, vec![0, 2, 4, 6]);
    }

    #[test]
    fn test_parse_cpu_affinity_mixed() {
        let output = "pid 999's current affinity list: 0-1,4,6-7";
        let cpus = parse_cpu_affinity(output).unwrap();
        assert_eq!(cpus, vec![0, 1, 4, 6, 7]);
    }

    #[test]
    fn test_signal_numbers() {
        assert_eq!(Signal::Sigterm.number(), 15);
        assert_eq!(Signal::Sigkill.number(), 9);
        assert_eq!(Signal::Sighup.number(), 1);
    }

    #[test]
    fn test_signal_names() {
        assert_eq!(Signal::Sigterm.name(), "TERM");
        assert_eq!(Signal::Sigkill.name(), "KILL");
        assert_eq!(Signal::Sigusr1.name(), "USR1");
    }
}
