//! Socket unit management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List all sockets.
pub async fn list_sockets(host: &SystemdHost) -> Result<Vec<SystemdSocket>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "systemctl",
        &[
            "list-sockets",
            "--all",
            "--no-pager",
            "--plain",
            "--no-legend",
        ],
    )
    .await?;
    Ok(parse_sockets(&stdout))
}

fn parse_sockets(output: &str) -> Vec<SystemdSocket> {
    // list-sockets --plain --no-legend columns: LISTEN [TYPE] UNIT ACTIVATES
    let mut entries: Vec<SystemdSocket> = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        // Detect whether a TYPE column is present (Stream, Datagram, etc.)
        let (listen, st, name, activates) = if parts.len() >= 4
            && matches!(
                parts[1],
                "Stream" | "Datagram" | "Sequential" | "FIFO" | "Special" | "Netlink"
            ) {
            let st = match parts[1] {
                "Stream" => SocketType::Stream,
                "Datagram" => SocketType::Datagram,
                "Sequential" => SocketType::Sequential,
                "FIFO" => SocketType::Fifo,
                "Special" => SocketType::Special,
                "Netlink" => SocketType::Netlink,
                _ => SocketType::Unknown,
            };
            (parts[0], st, parts[2], parts[3])
        } else {
            (parts[0], SocketType::Stream, parts[1], parts[2])
        };

        // Merge multiple listen addresses for the same socket unit
        if let Some(existing) = entries.iter_mut().find(|e| e.name == name) {
            existing.listen_addresses.push(listen.to_string());
        } else {
            entries.push(SystemdSocket {
                name: name.to_string(),
                listen_addresses: vec![listen.to_string()],
                activates: activates.to_string(),
                active: true,
                connections: 0,
                accepted: 0,
                socket_type: st,
            });
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sockets_with_type() {
        let output = "/run/dbus/system_bus_socket Stream dbus.socket dbus.service\n\
            /run/udev/control Datagram systemd-udevd.socket systemd-udevd.service\n";
        let sockets = parse_sockets(output);
        assert_eq!(sockets.len(), 2);
        assert_eq!(sockets[0].name, "dbus.socket");
        assert_eq!(sockets[0].socket_type, SocketType::Stream);
        assert_eq!(sockets[0].activates, "dbus.service");
        assert_eq!(sockets[1].socket_type, SocketType::Datagram);
    }

    #[test]
    fn test_parse_sockets_without_type() {
        let output = "/run/dbus/system_bus_socket dbus.socket dbus.service\n";
        let sockets = parse_sockets(output);
        assert_eq!(sockets.len(), 1);
        assert_eq!(sockets[0].name, "dbus.socket");
    }

    #[test]
    fn test_parse_sockets_merge_addresses() {
        let output = "/run/first Stream dbus.socket dbus.service\n\
            /run/second Stream dbus.socket dbus.service\n";
        let sockets = parse_sockets(output);
        assert_eq!(sockets.len(), 1);
        assert_eq!(sockets[0].listen_addresses.len(), 2);
    }
}
