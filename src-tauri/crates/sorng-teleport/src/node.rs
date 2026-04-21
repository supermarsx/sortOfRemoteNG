//! # Teleport SSH Node Management
//!
//! List nodes, connect via SSH, execute commands, port forwarding,
//! SCP, and label-based node selection.

use crate::types::*;
use std::collections::HashMap;

/// Build `tsh ls` command to list nodes.
pub fn list_nodes_command(
    cluster: Option<&str>,
    labels: Option<&str>,
    format_json: bool,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "ls".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if let Some(l) = labels {
        cmd.push(format!("--query={}", l));
    }
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh ssh` command to connect to a node.
pub fn ssh_command(
    user: &str,
    host: &str,
    cluster: Option<&str>,
    port: Option<u16>,
    command: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "ssh".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if let Some(p) = port {
        cmd.push(format!("--port={}", p));
    }
    cmd.push(format!("{}@{}", user, host));
    if let Some(c) = command {
        cmd.push("--".to_string());
        cmd.push(c.to_string());
    }
    cmd
}

/// Build `tsh scp` command.
pub fn scp_command(src: &str, dst: &str, recursive: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "scp".to_string()];
    if recursive {
        cmd.push("-r".to_string());
    }
    cmd.push(src.to_string());
    cmd.push(dst.to_string());
    cmd
}

/// Build port forwarding command.
pub fn port_forward_command(
    host: &str,
    local_port: u16,
    remote_port: u16,
    cluster: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "ssh".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    cmd.push(format!("-L{}:localhost:{}", local_port, remote_port));
    cmd.push(host.to_string());
    cmd
}

/// Filter nodes by label key-value pairs.
pub fn filter_nodes_by_labels<'a>(
    nodes: &[&'a TeleportNode],
    labels: &HashMap<String, String>,
) -> Vec<&'a TeleportNode> {
    nodes
        .iter()
        .filter(|n| {
            labels
                .iter()
                .all(|(k, v)| n.labels.get(k).map(|nv| nv == v).unwrap_or(false))
        })
        .copied()
        .collect()
}

/// Collect all unique label keys across nodes.
pub fn all_label_keys(nodes: &[&TeleportNode]) -> Vec<String> {
    let mut keys: Vec<String> = nodes
        .iter()
        .flat_map(|n| n.labels.keys().cloned())
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// Group nodes by a specific label key.
pub fn group_nodes_by_label<'a>(
    nodes: &[&'a TeleportNode],
    label_key: &str,
) -> HashMap<String, Vec<&'a TeleportNode>> {
    let mut map: HashMap<String, Vec<&'a TeleportNode>> = HashMap::new();
    for node in nodes {
        let key = node
            .labels
            .get(label_key)
            .cloned()
            .unwrap_or_else(|| "(unlabeled)".to_string());
        map.entry(key).or_default().push(node);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssh_command() {
        let cmd = ssh_command("root", "my-server", Some("prod"), None, None);
        assert!(cmd.contains(&"tsh".to_string()));
        assert!(cmd.contains(&"ssh".to_string()));
        assert!(cmd.contains(&"root@my-server".to_string()));
        assert!(cmd.iter().any(|c| c.contains("--cluster=prod")));
    }

    #[test]
    fn test_ssh_command_with_command() {
        let cmd = ssh_command("admin", "host1", None, Some(2222), Some("uptime"));
        assert!(cmd.contains(&"--".to_string()));
        assert!(cmd.contains(&"uptime".to_string()));
        assert!(cmd.iter().any(|c| c.contains("--port=2222")));
    }

    #[test]
    fn test_scp_command() {
        let cmd = scp_command("local.txt", "admin@host:/tmp/", true);
        assert!(cmd.contains(&"-r".to_string()));
        assert!(cmd.contains(&"local.txt".to_string()));
    }

    #[test]
    fn test_port_forward_command() {
        let cmd = port_forward_command("host", 8080, 80, None);
        assert!(cmd.iter().any(|c| c.contains("-L8080:localhost:80")));
    }

    #[test]
    fn test_filter_nodes_by_labels() {
        let mut labels_prod = HashMap::new();
        labels_prod.insert("env".into(), "prod".into());
        let n1 = TeleportNode {
            id: "n1".into(),
            hostname: "h1".into(),
            address: "".into(),
            labels: labels_prod.clone(),
            tunnel: false,
            sub_kind: NodeSubKind::Regular,
            namespace: "default".into(),
            cluster_name: "root".into(),
            version: None,
            os: None,
            public_addrs: vec![],
            peer_addr: None,
            rotation: None,
        };
        let n2 = TeleportNode {
            id: "n2".into(),
            hostname: "h2".into(),
            labels: HashMap::new(),
            ..n1.clone()
        };
        let filter = HashMap::from([("env".to_string(), "prod".to_string())]);
        let result = filter_nodes_by_labels(&[&n1, &n2], &filter);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "n1");
    }
}
