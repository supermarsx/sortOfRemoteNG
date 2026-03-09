//! Process listing — ps parsing, tree building, search, top-N queries.

use crate::client;
use crate::error::ProcError;
use crate::types::*;
use std::collections::HashMap;

// ─── ps format strings ─────────────────────────────────────────────

const PS_FULL_FMT: &str =
    "pid,ppid,user,group,stat,nlwp,ni,pri,pcpu,pmem,rss,vsz,tty,wchan,lstart,etime,args";

// ─── Public API ─────────────────────────────────────────────────────

/// List all processes with basic info (ps aux style).
pub async fn list_processes(host: &ProcHost) -> Result<Vec<ProcessInfo>, ProcError> {
    let stdout = client::exec_ok(host, "ps", &["aux", "--no-header"]).await?;
    Ok(parse_ps_aux(&stdout))
}

/// List all processes with full extended fields.
pub async fn list_processes_full(host: &ProcHost) -> Result<Vec<ProcessInfo>, ProcError> {
    let stdout = client::exec_ok(host, "ps", &["-eo", PS_FULL_FMT, "--no-header"]).await?;
    Ok(parse_ps_full(&stdout))
}

/// Get a single process by PID, enriched with /proc data where possible.
pub async fn get_process(host: &ProcHost, pid: u32) -> Result<ProcessInfo, ProcError> {
    let pid_s = pid.to_string();
    let stdout = client::exec_ok(
        host,
        "ps",
        &["-p", &pid_s, "-o", PS_FULL_FMT, "--no-header"],
    )
    .await
    .map_err(|_| ProcError::ProcessNotFound(pid))?;

    let procs = parse_ps_full(&stdout);
    let mut proc_info = procs
        .into_iter()
        .next()
        .ok_or(ProcError::ProcessNotFound(pid))?;

    // Try to enrich with /proc data (best-effort).
    if let Ok(exe) = client::exec_shell_ok(host, &format!("readlink -f /proc/{pid}/exe")).await {
        proc_info.exe_path = exe.trim().to_string();
    }
    if let Ok(cwd) = client::exec_shell_ok(host, &format!("readlink -f /proc/{pid}/cwd")).await {
        proc_info.cwd = cwd.trim().to_string();
    }

    Ok(proc_info)
}

/// Build a full process tree.
pub async fn get_process_tree(host: &ProcHost) -> Result<Vec<ProcessTree>, ProcError> {
    let procs = list_processes_full(host).await?;
    Ok(build_process_tree(&procs))
}

/// Get direct children of a process.
pub async fn get_process_children(
    host: &ProcHost,
    pid: u32,
) -> Result<Vec<ProcessInfo>, ProcError> {
    let pid_s = pid.to_string();
    let stdout = client::exec_ok(
        host,
        "ps",
        &["--ppid", &pid_s, "-o", PS_FULL_FMT, "--no-header"],
    )
    .await?;
    Ok(parse_ps_full(&stdout))
}

/// Search processes matching a pattern (pgrep + ps).
pub async fn search_processes(
    host: &ProcHost,
    pattern: &str,
) -> Result<Vec<ProcessInfo>, ProcError> {
    let stdout = client::exec_shell_ok(
        host,
        &format!("pgrep -d, -f {} 2>/dev/null || true", shell_safe(pattern)),
    )
    .await?;
    let pids = stdout.trim();
    if pids.is_empty() {
        return Ok(Vec::new());
    }
    let ps_out =
        client::exec_ok(host, "ps", &["-p", pids, "-o", PS_FULL_FMT, "--no-header"]).await?;
    Ok(parse_ps_full(&ps_out))
}

/// Get top-N processes sorted by a field (cpu, mem, io).
pub async fn top_processes(
    host: &ProcHost,
    by: &str,
    count: usize,
) -> Result<Vec<TopProcess>, ProcError> {
    let sort_key = match by {
        "cpu" | "pcpu" => "pcpu",
        "mem" | "pmem" | "rss" => "pmem",
        _ => "pcpu",
    };
    let count_s = count.to_string();
    let stdout = client::exec_ok(
        host,
        "ps",
        &[
            "-eo",
            "pid,user,pcpu,pmem,comm",
            "--sort",
            &format!("-{sort_key}"),
            "--no-header",
        ],
    )
    .await?;

    let mut results = Vec::new();
    for line in stdout.lines() {
        if results.len() >= count_s.parse::<usize>().unwrap_or(count) {
            break;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        results.push(TopProcess {
            pid: fields[0].parse().unwrap_or(0),
            user: fields[1].to_string(),
            cpu_percent: fields[2].parse().unwrap_or(0.0),
            memory_percent: fields[3].parse().unwrap_or(0.0),
            command: fields[4..].join(" "),
        });
    }
    Ok(results)
}

/// Count processes grouped by state.
pub async fn count_processes(host: &ProcHost) -> Result<HashMap<ProcessState, usize>, ProcError> {
    let stdout = client::exec_ok(host, "ps", &["-eo", "stat", "--no-header"]).await?;
    let mut counts: HashMap<ProcessState, usize> = HashMap::new();
    for line in stdout.lines() {
        let stat = line.trim();
        if let Some(ch) = stat.chars().next() {
            let state = ProcessState::from_stat_char(ch);
            *counts.entry(state).or_insert(0) += 1;
        }
    }
    Ok(counts)
}

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse `ps aux --no-header` output.
fn parse_ps_aux(output: &str) -> Vec<ProcessInfo> {
    let mut procs = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
        let fields: Vec<&str> = line.splitn(11, char::is_whitespace).collect();
        if fields.len() < 11 {
            continue;
        }
        let stat_str = fields[7].trim();
        let state = stat_str
            .chars()
            .next()
            .map(ProcessState::from_stat_char)
            .unwrap_or(ProcessState::Unknown);

        procs.push(ProcessInfo {
            pid: fields[1].trim().parse().unwrap_or(0),
            ppid: 0,
            user: fields[0].trim().to_string(),
            group: String::new(),
            state,
            command: fields[10].trim().to_string(),
            full_cmdline: fields[10].trim().to_string(),
            exe_path: String::new(),
            cwd: String::new(),
            cpu_percent: fields[2].trim().parse().unwrap_or(0.0),
            memory_percent: fields[3].trim().parse().unwrap_or(0.0),
            rss_bytes: fields[5].trim().parse::<u64>().unwrap_or(0) * 1024,
            vsz_bytes: fields[4].trim().parse::<u64>().unwrap_or(0) * 1024,
            threads: 0,
            nice: 0,
            priority: 0,
            start_time: fields[8].trim().to_string(),
            elapsed: String::new(),
            tty: fields[6].trim().to_string(),
            wchan: String::new(),
        });
    }
    procs
}

/// Parse `ps -eo pid,ppid,user,group,stat,nlwp,ni,pri,pcpu,pmem,rss,vsz,tty,wchan,lstart,etime,args --no-header`.
fn parse_ps_full(output: &str) -> Vec<ProcessInfo> {
    let mut procs = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // The lstart field is multi-word (e.g. "Thu Jan  2 14:30:00 2025") so we parse carefully.
        // Fields before lstart: pid ppid user group stat nlwp ni pri pcpu pmem rss vsz tty wchan
        // That's 14 whitespace-delimited tokens, then lstart (5 tokens), then etime (1), then args (rest).
        let tokens: Vec<&str> = line.split_whitespace().collect();
        // Minimum: 14 fixed + 5 lstart + 1 etime + 1 args = 21
        if tokens.len() < 21 {
            continue;
        }

        let pid: u32 = tokens[0].parse().unwrap_or(0);
        let ppid: u32 = tokens[1].parse().unwrap_or(0);
        let user = tokens[2].to_string();
        let group = tokens[3].to_string();
        let stat_str = tokens[4];
        let nlwp: u32 = tokens[5].parse().unwrap_or(0);
        let nice: i32 = tokens[6].parse().unwrap_or(0);
        let pri: i32 = tokens[7].parse().unwrap_or(0);
        let pcpu: f64 = tokens[8].parse().unwrap_or(0.0);
        let pmem: f64 = tokens[9].parse().unwrap_or(0.0);
        let rss: u64 = tokens[10].parse().unwrap_or(0);
        let vsz: u64 = tokens[11].parse().unwrap_or(0);
        let tty = tokens[12].to_string();
        let wchan = tokens[13].to_string();

        // lstart is 5 tokens: day-of-week month day time year
        let start_time = tokens[14..19].join(" ");
        let elapsed = tokens[19].to_string();
        let command = tokens[20..].join(" ");

        let state = stat_str
            .chars()
            .next()
            .map(ProcessState::from_stat_char)
            .unwrap_or(ProcessState::Unknown);

        procs.push(ProcessInfo {
            pid,
            ppid,
            user,
            group,
            state,
            command: command.clone(),
            full_cmdline: command,
            exe_path: String::new(),
            cwd: String::new(),
            cpu_percent: pcpu,
            memory_percent: pmem,
            rss_bytes: rss * 1024,
            vsz_bytes: vsz * 1024,
            threads: nlwp,
            nice,
            priority: pri,
            start_time,
            elapsed,
            tty,
            wchan,
        });
    }
    procs
}

/// Build a hierarchical process tree from a flat list.
fn build_process_tree(procs: &[ProcessInfo]) -> Vec<ProcessTree> {
    let mut children_map: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut root_indices = Vec::new();

    for (i, p) in procs.iter().enumerate() {
        if p.ppid == 0 || !procs.iter().any(|parent| parent.pid == p.ppid) {
            root_indices.push(i);
        } else {
            children_map.entry(p.ppid).or_default().push(i);
        }
    }

    root_indices
        .iter()
        .map(|&i| build_tree_node(procs, &children_map, i))
        .collect()
}

fn build_tree_node(
    procs: &[ProcessInfo],
    children_map: &HashMap<u32, Vec<usize>>,
    index: usize,
) -> ProcessTree {
    let process = procs[index].clone();
    let children = children_map
        .get(&process.pid)
        .map(|indices| {
            indices
                .iter()
                .map(|&ci| build_tree_node(procs, children_map, ci))
                .collect()
        })
        .unwrap_or_default();
    ProcessTree { process, children }
}

/// Minimal sanitisation for shell arguments used in format strings.
fn shell_safe(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ps_aux() {
        let output = "\
root         1  0.0  0.1 169536 13256 ?        Ss   Jan02   5:32 /sbin/init
www-data  1234  2.5  1.2 456789 98765 ?        Sl   10:30   1:23 /usr/sbin/apache2 -k start
nobody    5678  0.0  0.0      0     0 ?        Z    Jan01   0:00 [zombie] <defunct>
";
        let procs = parse_ps_aux(output);
        assert_eq!(procs.len(), 3);

        assert_eq!(procs[0].pid, 1);
        assert_eq!(procs[0].user, "root");
        assert_eq!(procs[0].state, ProcessState::Sleeping);
        assert_eq!(procs[0].rss_bytes, 13256 * 1024);

        assert_eq!(procs[1].pid, 1234);
        assert_eq!(procs[1].cpu_percent, 2.5);
        assert_eq!(procs[1].state, ProcessState::Sleeping);

        assert_eq!(procs[2].pid, 5678);
        assert_eq!(procs[2].state, ProcessState::Zombie);
    }

    #[test]
    fn test_parse_ps_full() {
        let output = "\
    1     0 root     root     Ss       1   0  20  0.0  0.1  13256 169536 ?        -      Thu Jan  2 08:00:00 2025     3-05:32:10 /sbin/init
 1234     1 www-data www-data Sl       4   0  20  2.5  1.2  98765 456789 ?        -      Thu Jan  2 10:30:00 2025        1:23:45 /usr/sbin/apache2 -k start
";
        let procs = parse_ps_full(output);
        assert_eq!(procs.len(), 2);

        assert_eq!(procs[0].pid, 1);
        assert_eq!(procs[0].ppid, 0);
        assert_eq!(procs[0].user, "root");
        assert_eq!(procs[0].group, "root");
        assert_eq!(procs[0].state, ProcessState::Sleeping);
        assert_eq!(procs[0].threads, 1);
        assert_eq!(procs[0].command, "/sbin/init");

        assert_eq!(procs[1].pid, 1234);
        assert_eq!(procs[1].ppid, 1);
        assert_eq!(procs[1].user, "www-data");
        assert_eq!(procs[1].cpu_percent, 2.5);
        assert_eq!(procs[1].command, "/usr/sbin/apache2 -k start");
    }

    #[test]
    fn test_build_process_tree() {
        let procs = vec![
            make_proc(1, 0, "init"),
            make_proc(100, 1, "sshd"),
            make_proc(200, 1, "nginx"),
            make_proc(201, 200, "nginx-worker"),
        ];
        let tree = build_process_tree(&procs);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].process.pid, 1);
        assert_eq!(tree[0].children.len(), 2);

        let nginx = tree[0]
            .children
            .iter()
            .find(|c| c.process.pid == 200)
            .unwrap();
        assert_eq!(nginx.children.len(), 1);
        assert_eq!(nginx.children[0].process.pid, 201);
    }

    #[test]
    fn test_count_states() {
        let output = "S\nS\nR\nZ\nS\nI\nI\n";
        let mut counts: HashMap<ProcessState, usize> = HashMap::new();
        for line in output.lines() {
            let stat = line.trim();
            if let Some(ch) = stat.chars().next() {
                let state = ProcessState::from_stat_char(ch);
                *counts.entry(state).or_insert(0) += 1;
            }
        }
        assert_eq!(counts[&ProcessState::Sleeping], 3);
        assert_eq!(counts[&ProcessState::Running], 1);
        assert_eq!(counts[&ProcessState::Zombie], 1);
        assert_eq!(counts[&ProcessState::Idle], 2);
    }

    fn make_proc(pid: u32, ppid: u32, cmd: &str) -> ProcessInfo {
        ProcessInfo {
            pid,
            ppid,
            user: "root".into(),
            group: "root".into(),
            state: ProcessState::Running,
            command: cmd.into(),
            full_cmdline: cmd.into(),
            exe_path: String::new(),
            cwd: String::new(),
            cpu_percent: 0.0,
            memory_percent: 0.0,
            rss_bytes: 0,
            vsz_bytes: 0,
            threads: 1,
            nice: 0,
            priority: 20,
            start_time: String::new(),
            elapsed: String::new(),
            tty: "?".into(),
            wchan: "-".into(),
        }
    }
}
